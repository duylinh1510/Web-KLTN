import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parse } from 'csv-parse/sync';
import { randomUUID } from 'crypto';
import { Neo4jService } from '../neo4j/neo4j.service';
import { SchemaLlmService } from './schema-llm.service';
import { FeatureService } from './feature.service';
import { StarGraphService } from './star-graph.service';
import { CsvOutputService } from './csv-output.service';
import { Neo4jIngestService } from './neo4j-ingest.service';
import { DataPtService } from './data-pt.service';
import { GnnTrainService } from './gnn-train.service';
import { GnnInferenceService } from './gnn-inference.service';
import { DatasetMetaService, DatasetMeta, RawInfo } from './dataset-meta.service';
import { Csv2GraphRunDto } from './dto/csv2graph-run.dto';
import {
  Csv2GraphResult,
  Csv2GraphFiles,
  Csv2GraphStats,
  Csv2GraphInferenceResult,
  Csv2GraphPretrainedResult,
  Csv2GraphTrainingResult,
} from './dto/csv2graph-result.dto';
import {
  CsvRow,
  FullSchema,
  ClassificationSchema,
} from './interfaces/classification-schema.interface';

/**
 * Orchestrator: 2 branch theo trạng thái dataset hiện tại trên Neo4j.
 *
 * - DB rỗng → fullBuild():
 *     LLM classify → preprocess → star edges → ghi CSV/data.pt → ingest →
 *     lưu _latest_<database>.json (canonical schema cho lần sau).
 *
 * - DB đã có data → appendBuild():
 *     KHÔNG LLM, dùng schema canonical từ _latest_<database>.json.
 *     Validate header CSV phải là subset của canonical columns.
 *     Skip preprocessed.csv + data.pt (giữ data.pt build đầu).
 */
@Injectable()
export class Csv2GraphService {
  private readonly logger = new Logger(Csv2GraphService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly neo4j: Neo4jService,
    private readonly schemaLlm: SchemaLlmService,
    private readonly feature: FeatureService,
    private readonly starGraph: StarGraphService,
    private readonly csvOutput: CsvOutputService,
    private readonly neo4jIngest: Neo4jIngestService,
    private readonly dataPt: DataPtService,
    private readonly gnnTrain: GnnTrainService,
    private readonly gnnInference: GnnInferenceService,
    private readonly datasetMeta: DatasetMetaService,
  ) {}

  async run(
    fileBuffer: Buffer,
    originalFileName: string,
    dto: Csv2GraphRunDto,
  ): Promise<Csv2GraphResult> {
    const database = this.neo4j.getCurrentDatabase();
    const meta = this.datasetMeta.loadLatest(database);
    const numExistingNodes = meta
      ? await this.datasetMeta.countNodes(meta.nodeLabel)
      : 0;
    const isAppend = !!meta && numExistingNodes > 0;

    if (isAppend) {
      this.logger.log(
        `====== APPEND MODE — meta.jobId=${meta!.jobId}, ` +
          `nodeLabel=${meta!.nodeLabel}, existingNodes=${numExistingNodes} ======`,
      );
      return this.appendBuild(fileBuffer, originalFileName, dto, meta!, database);

    }

    this.logger.log('====== FULL BUILD MODE (DB rỗng) ======');
    return this.fullBuild(fileBuffer, originalFileName, dto, database);
  }

  // ============================================================
  // FULL BUILD — DB rỗng, chạy đầy đủ pipeline + LLM classify
  // ============================================================

  private async fullBuild(
    fileBuffer: Buffer,
    originalFileName: string,
    dto: Csv2GraphRunDto,
    database: string | null,
  ): Promise<Csv2GraphResult> {
    const trainMode = dto.trainMode ?? false; // Default: chỉ ingest, không train
    const pretrainedMode = dto.pretrainedMode ?? false;
    if (trainMode && pretrainedMode) {
      throw new HttpException(
        'Không thể vừa train model vừa dùng model demo có sẵn.',
        HttpStatus.BAD_REQUEST,
      );
    }

    // targetLabel bắt buộc khi muốn build data.pt (cần nhãn cho GNN)
    // trainMode vẫn giữ nhưng không gate data.pt nữa — data.pt luôn cần có
    const requestedTargetLabel = dto.targetLabel?.trim() ?? '';
    const targetLabel = pretrainedMode
      ? 'is_fraud'
      : trainMode
        ? requestedTargetLabel
        : '';
    if (trainMode && !targetLabel) {
      throw new HttpException(
        'targetLabel là bắt buộc khi chọn train model.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (pretrainedMode && !this.gnnTrain.hasActiveModel()) {
      throw new HttpException(
        `Không tìm thấy model demo: ${this.gnnTrain.getActiveModelPath()}`,
        HttpStatus.BAD_REQUEST,
      );
    }
    const jobId = this.makeJobId(originalFileName);
    const outputRoot =
      this.config.get<string>('CSV2GRAPH_OUTPUT_DIR') ?? 'data/csv2graph';
    const jobDir = this.csvOutput.ensureJobDir(outputRoot, jobId);

    const maxGroupSize =
      dto.maxGroupSize ??
      Number(this.config.get<string>('CSV2GRAPH_MAX_GROUP_SIZE')) ??
      500;
    const trainRatio = dto.trainRatio ?? 0.4;
    const valRatio = dto.valRatio ?? 0.2;
    const seed = dto.seed ?? 42;
    const nodeLabel = dto.nodeLabel ?? 'Transaction';
    const ingestNeo4j = dto.ingestNeo4j ?? true;
    this.logger.log(`====== JOB ${jobId} ======`);
    this.logger.log(`  target_label   : ${targetLabel || '(none — ingest only)'}`);
    this.logger.log(`  max_group_size : ${maxGroupSize}`);
    this.logger.log(`  node_label     : ${nodeLabel}`);
    this.logger.log(`  ingestNeo4j    : ${ingestNeo4j}`);
    this.logger.log(`  trainMode      : ${trainMode}`);
    this.logger.log(`  pretrainedMode : ${pretrainedMode}`);
    if (dto.transactionIdCol) {
      this.logger.log(`  transactionIdCol override: ${dto.transactionIdCol}`);
    }

    const inputCsvPath = this.csvOutput.saveInputCsv(
      jobDir,
      originalFileName,
      fileBuffer,
    );

    this.logger.log('[1/8] Parsing CSV...');
    const { rows, headers } = this.parseCsv(fileBuffer);
    this.assertNonEmpty(rows);
    if (targetLabel) {
      this.assertHeaderHasTarget(headers, targetLabel);
    }
    this.logger.log(`  parsed: ${rows.length} rows × ${headers.length} cols`);

    // Lưu headers gốc vào _raw_<database>.json NGAY SAU khi parse, TRƯỚC mọi xử lý.
    // originalIdCol sẽ được cập nhật sau bước [3/8] khi biết user chọn cột nào.
    // (Lưu tạm với headers, sẽ ghi đè sau bước ensureNodeId)

    this.logger.log('[2/8] LLM classify schema...');
    const classification = await this.schemaLlm.analyzeSchema(
      rows,
      headers,
      targetLabel,
    );

    this.logger.log('[3/8] Ensure node_id...');
    // Ghi lại cột ID gốc TRƯỚC khi rename — cần để lưu _raw_.json cho append
    // Thứ tự ưu tiên: user dropdown > LLM suggestion > auto-gen (null → 'node_id')
    const originalIdCol: string =
      dto.transactionIdCol && headers.includes(dto.transactionIdCol)
        ? dto.transactionIdCol
        : (classification.node_id ?? 'node_id');

    // Nếu user đã chọn transaction_id từ dropdown → override LLM suggestion
    if (
      dto.transactionIdCol &&
      headers.includes(dto.transactionIdCol) &&
      dto.transactionIdCol !== targetLabel
    ) {
      this.logger.log(
        `  -> transactionIdCol override: '${dto.transactionIdCol}' (user-selected)`,
      );
      classification.node_id = dto.transactionIdCol;
    }

    const ensured = this.feature.ensureNodeId(
      rows,
      classification.node_id,
      headers,
    );
    const rawRows = ensured.rows;
    const rawFeatureCols = classification.feature.filter(
      (c) => rawRows.length > 0 && c in rawRows[0],
    );

    // Lưu _raw_<database>.json — nguồn sự thật duy nhất cho append validation.
    // headers = tên cột GỐC (chưa rename), originalIdCol = cột user chọn làm ID.
    if (ingestNeo4j) {
      this.datasetMeta.saveRawInfo(database, {
        originalIdCol,
        rawColumns: headers,  // headers TRƯỚC ensureNodeId → vẫn có tên gốc
      });
    }


    this.logger.log('[4/8] Preprocess features (Target Encoding + float) — encoded copy...');
    const { encodedRows, encodedFeatureCols, encodingMaps } = this.feature.preprocessFeatures(
      rawRows,
      classification.feature,
      targetLabel,
    );

    this.logger.log('[5/8] Build star edges (raw rows, raw relation_cols)...');
    const edges = this.starGraph.buildStarEdges(
      rawRows,
      ensured.nodeIdCol,
      classification.relation_cols,
      maxGroupSize,
    );

    this.logger.log('[6/8] Writing CSV outputs (raw nodes + edges + schema)...');
    // targetLabel đưa vào schema chỉ khi train (có nhãn)
    // Nếu ingest only: targetLabel = '' (không ghi vào schema)
    const fullSchema: FullSchema = {
      node_id: ensured.nodeIdCol,
      relation_cols: classification.relation_cols,
      feature_cols: rawFeatureCols,
      encoded_feature_cols: encodedFeatureCols,
      encoding_maps: encodingMaps,        // Target/Frequency Encoding maps
      target_label: targetLabel,  // '' ki ingest-only
      train_ratio: trainRatio,
      val_ratio: valRatio,
      seed,
      max_group_size: maxGroupSize,
    };

    const nodesCsvPath = this.csvOutput.writeNodesCsv(
      jobDir,
      rawRows,
      ensured.nodeIdCol,
      rawFeatureCols,
      targetLabel || null,  // null = không ghi cột target
    );
    const edgesCsvPath = this.csvOutput.writeEdgesCsv(jobDir, edges);
    const schemaJsonPath = this.csvOutput.writeSchemaJson(jobDir, fullSchema);

    const stats: Csv2GraphStats = {
      inputRows: rows.length,
      numNodes: rawRows.length,
      numEdges: edges.length,
      numFeatures: rawFeatureCols.length,
      numEncodedFeatures: encodedFeatureCols.length,
      numRelationTypes: classification.relation_cols.length,
    };

    const files: Csv2GraphFiles = {
      inputCsv: inputCsvPath,
      nodesCsv: nodesCsvPath,
      edgesCsv: edgesCsvPath,
      schemaJson: schemaJsonPath,
    };

    let training: Csv2GraphTrainingResult | undefined;
    const pretrained: Csv2GraphPretrainedResult | undefined = pretrainedMode
      ? {
          success: true,
          activeModelPath: this.gnnTrain.getActiveModelPath(),
          targetLabel: 'is_fraud',
        }
      : undefined;

    // Step 7: Build data.pt before Neo4j import.
    // If trainMode=true, training is a pre-ingest gate: any training error
    // stops the request before neo4jIngest.ingest() is called.
    if (targetLabel) {
      this.logger.log('[7/8] Build data.pt via Python sidecar (encoded rows)...');
      const preCsvPath = this.csvOutput.writePreprocessedCsv(
        jobDir,
        encodedRows,
        ensured.nodeIdCol,
        encodedFeatureCols,
        targetLabel,
      );
      files.preprocessedCsv = preCsvPath;

      const { dataPtPath } = await this.dataPt.buildDataPt(jobDir);
      files.dataPt = dataPtPath;
      if (trainMode) {
        this.logger.log('[7.5/8] Train F-GNN before Neo4j import...');
        training = await this.gnnTrain.train(jobDir, dataPtPath);
      }
    } else {
      this.logger.log('[7/8] Skip data.pt build (khong co targetLabel - ingest-only mode)');
    }

    if (ingestNeo4j) {
      this.logger.log('[8/8] Ingest Neo4j (raw rows, raw feature props) — CREATE mode (full build)...');
      const ingested = await this.neo4jIngest.ingest(
        rawRows,
        edges,
        ensured.nodeIdCol,
        rawFeatureCols,
        targetLabel,
        nodeLabel,
        false,  // isAppend=false → dùng CREATE (nhanh hơn MERGE khi DB rỗng)
      );
      stats.ingested = ingested;
      this.logger.log(
        `  ingested: ${ingested.nodes} nodes, ${ingested.relationships} relationships`,
      );
    } else {
      this.logger.log('[8/8] Skip Neo4j ingestion (ingestNeo4j=false)');
    }

    if (ingestNeo4j) {
      const canonicalColumns = [
        ensured.nodeIdCol,
        ...rawFeatureCols,
        ...(targetLabel ? [targetLabel] : []),
      ];
      const pretrainedModelPath = pretrained?.activeModelPath;
      const activeModelPath = training?.activeModelPath ?? pretrainedModelPath;
      this.datasetMeta.saveLatest(database, {
        jobId,
        nodeLabel,
        columns: canonicalColumns,
        targetLabel: targetLabel || '',
        schema: fullSchema,
        trainMode,
        hasModel: training?.success === true || pretrained?.success === true,
        modelPath: training?.modelPath ?? pretrainedModelPath,
        activeModelPath,
        trainedAt: training ? new Date().toISOString() : undefined,
        trainingMetrics: training?.metrics,
        builtAt: new Date().toISOString(),
      });
    }

    this.logger.log(`====== JOB ${jobId} DONE ======`);
    return {
      jobId,
      schema: fullSchema,
      stats,
      files,
      mode: 'full',
      training,
      pretrained,
    };
  }

  // ============================================================
  // APPEND BUILD — DB đã có data, dùng schema canonical từ metadata
  // ============================================================

  private async appendBuild(
    fileBuffer: Buffer,
    originalFileName: string,
    dto: Csv2GraphRunDto,
    meta: DatasetMeta,
    database: string | null,
  ): Promise<Csv2GraphResult> {
    const jobId = this.makeJobId(originalFileName);
    const outputRoot =
      this.config.get<string>('CSV2GRAPH_OUTPUT_DIR') ?? 'data/csv2graph';
    const jobDir = this.csvOutput.ensureJobDir(outputRoot, jobId);

    const maxGroupSize =
      dto.maxGroupSize ??
      meta.schema.max_group_size ??
      Number(this.config.get<string>('CSV2GRAPH_MAX_GROUP_SIZE')) ??
      500;
    const nodeLabel = meta.nodeLabel; // Append luôn dùng nodeLabel đã lưu
    const ingestNeo4j = dto.ingestNeo4j ?? true;
    const targetLabel = meta.targetLabel || meta.schema.target_label || '';
    const canInferAppend =
      !!targetLabel && this.datasetMeta.hasUsableModel(meta);

    this.logger.log(`====== APPEND JOB ${jobId} ======`);
    this.logger.log(`  canonical jobId  : ${meta.jobId}`);
    this.logger.log(`  node_label       : ${nodeLabel}`);

    const inputCsvPath = this.csvOutput.saveInputCsv(
      jobDir,
      originalFileName,
      fileBuffer,
    );

    // ── [1/6] Parse CSV ──
    this.logger.log('[1/6] Parsing CSV...');
    let { rows, headers } = this.parseCsv(fileBuffer);
    this.assertNonEmpty(rows);
    const targetHeaderPresent = !!targetLabel && headers.includes(targetLabel);
    const targetValueCount = targetHeaderPresent
      ? this.countPresentTargetValues(rows, targetLabel)
      : 0;
    const appendHasCompleteTarget =
      targetHeaderPresent && targetValueCount === rows.length;
    if (
      targetHeaderPresent &&
      targetValueCount > 0 &&
      targetValueCount < rows.length
    ) {
      throw new HttpException(
        `Cot target '${targetLabel}' chi co nhan o ${targetValueCount}/${rows.length} dong. ` +
          `Hay dien du nhan, hoac bo cot nay de he thong inference.`,
        HttpStatus.BAD_REQUEST,
      );
    }
    if (targetHeaderPresent && targetValueCount === 0 && !canInferAppend) {
      throw new HttpException(
        `Cot target '${targetLabel}' khong co gia tri nhan va dataset chua co model de inference.`,
        HttpStatus.BAD_REQUEST,
      );
    }
    const shouldInferAppend = canInferAppend && !appendHasCompleteTarget;

    // ── [2/6] Đọc _raw_<database>.json và validate columns ──
    this.logger.log('[2/6] Validate columns against _raw_ file...');
    const rawInfo = this.datasetMeta.loadRawInfo(database);
    if (!rawInfo) {
      throw new HttpException(
        `Không tìm thấy thông tin CSV gốc (_raw_${database ?? ''}.json). ` +
          `Cần thực hiện Full Build lại để tạo file này.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const refColumns = rawInfo.rawColumns;   // headers GỐC của CSV ban đầu
    const refSet = new Set(refColumns);

    // Cột THIẾU → lỗi
    const allowedMissingCols = new Set<string>();
    if (shouldInferAppend && targetLabel) {
      allowedMissingCols.add(targetLabel);
    }
    const missingCols = refColumns.filter(
      (c) => !headers.includes(c) && !allowedMissingCols.has(c),
    );
    if (missingCols.length > 0) {
      throw new HttpException(
        `CSV thiếu các cột bắt buộc: [${missingCols.join(', ')}]. ` +
          `Cần có: [${refColumns.join(', ')}]`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Cột THỪA → silent drop
    const extraCols = headers.filter((h) => !refSet.has(h));
    if (extraCols.length > 0) {
      this.logger.log(
        `  Silent drop ${extraCols.length} extra col(s): [${extraCols.join(', ')}]`,
      );
      headers = headers.filter((h) => refSet.has(h));
      rows = rows.map((row) => {
        const filtered: Record<string, unknown> = {};
        for (const col of headers) filtered[col] = (row as Record<string, unknown>)[col];
        return filtered;
      });
    }

    // ── [3/6] Ensure node_id dùng originalIdCol từ _raw_ file ──
    this.logger.log(
      `[3/6] Ensure node_id (originalIdCol='${rawInfo.originalIdCol}' từ _raw_ file)...`,
    );
    const ensured = this.feature.ensureNodeId(rows, rawInfo.originalIdCol, headers);
    const rawRows = ensured.rows;
    const rawFeatureCols = meta.schema.feature_cols.filter(
      (c) => rawRows.length > 0 && c in rawRows[0],
    );

    // ── [3.5/6] Kiểm tra ID trùng với dữ liệu đã có trên Neo4j ──
    this.logger.log('[3.5/6] Checking duplicate node_ids against Neo4j...');
    const newNodeIds = rawRows
      .map((r) => String((r as Record<string, unknown>)['node_id'] ?? ''))
      .filter(Boolean);
    const duplicates = await this.datasetMeta.findDuplicateNodeIds(
      meta.nodeLabel,
      newNodeIds,
    );
    if (duplicates.length > 0) {
      const preview = duplicates.slice(0, 10).join(', ');
      const suffix = duplicates.length > 10 ? ` ... (+${duplicates.length - 10} more)` : '';
      throw new HttpException(
        `CSV mới có ${duplicates.length} node_id đã tồn tại trong DB: [${preview}${suffix}]. ` +
          `Vui lòng kiểm tra lại dữ liệu.`,
        HttpStatus.CONFLICT,
      );
    }
    this.logger.log(`  No duplicates found (${newNodeIds.length} IDs checked)`);



    // ── [4/6] Build star edges (dùng relation_cols đã lưu) ──
    this.logger.log('[4/6] Build star edges (relation_cols từ canonical schema)...');
    const edges = this.starGraph.buildStarEdges(
      rawRows,
      ensured.nodeIdCol,
      meta.schema.relation_cols,
      maxGroupSize,
    );

    // ── [5/6] Write CSVs ──
    this.logger.log('[5/6] Writing CSV outputs (append job dir)...');
    const nodesCsvPath = this.csvOutput.writeNodesCsv(
      jobDir,
      rawRows,
      ensured.nodeIdCol,
      rawFeatureCols,
      targetLabel || null,
    );
    const edgesCsvPath = this.csvOutput.writeEdgesCsv(jobDir, edges);
    const schemaJsonPath = this.csvOutput.writeSchemaJson(jobDir, meta.schema);

    const stats: Csv2GraphStats = {
      inputRows: rows.length,
      numNodes: rawRows.length,
      numEdges: edges.length,
      numFeatures: rawFeatureCols.length,
      numEncodedFeatures: meta.schema.encoded_feature_cols.length,
      numRelationTypes: meta.schema.relation_cols.length,
    };

    const files: Csv2GraphFiles = {
      inputCsv: inputCsvPath,
      nodesCsv: nodesCsvPath,
      edgesCsv: edgesCsvPath,
      schemaJson: schemaJsonPath,
    };

    let inference: Csv2GraphInferenceResult | undefined;
    if (shouldInferAppend) {
      this.logger.log('[5.5/6] Run F-GNN inference before Neo4j import...');
      const { encodedRows, encodedFeatureCols } = this.feature.encodeWithSchema(
        rawRows,
        meta.schema,
      );
      files.preprocessedCsv = this.csvOutput.writePreprocessedCsv(
        jobDir,
        encodedRows,
        ensured.nodeIdCol,
        encodedFeatureCols,
        targetLabel,
      );

      const { dataPtPath } = await this.dataPt.buildDataPt(jobDir, 'inference');
      files.dataPt = dataPtPath;

      const prediction = await this.gnnInference.predictDataPt(dataPtPath);
      this.applyInferenceLabels(rawRows, prediction.scores, targetLabel);
      this.csvOutput.writeNodesCsv(
        jobDir,
        rawRows,
        ensured.nodeIdCol,
        rawFeatureCols,
        targetLabel,
      );

      stats.inference = {
        total: prediction.total,
        predictedFraud: prediction.predictedFraud,
        threshold: prediction.threshold,
        inferenceMs: prediction.inferenceMs,
      };
      inference = {
        success: prediction.success,
        dataPt: prediction.dataPt,
        total: prediction.total,
        predictedFraud: prediction.predictedFraud,
        threshold: prediction.threshold,
        gnnVersion: prediction.gnnVersion,
        inferenceMs: prediction.inferenceMs,
      };
    } else if (appendHasCompleteTarget) {
      this.logger.log('[5.5/6] Skip F-GNN inference (append CSV already has target labels)');
    } else {
      this.logger.log('[5.5/6] Skip F-GNN inference (no trained/pretrained model for this dataset)');
    }

    // ── [6/6] Ingest Neo4j ──
    if (ingestNeo4j) {
      this.logger.log('[6/6] Ingest Neo4j (MERGE upsert by node_id) — APPEND mode...');
      const ingested = await this.neo4jIngest.ingest(
        rawRows,
        edges,
        ensured.nodeIdCol,
        rawFeatureCols,
        targetLabel,
        nodeLabel,
        true,   // isAppend=true → dùng MERGE (upsert an toàn)
      );
      stats.ingested = ingested;
      this.logger.log(
        `  ingested: ${ingested.nodes} nodes, ${ingested.relationships} relationships`,
      );
    } else {
      this.logger.log('[6/6] Skip Neo4j ingestion (ingestNeo4j=false)');
    }

    this.logger.log(
      `====== APPEND JOB ${jobId} DONE ======`,
    );

    return {
      jobId,
      schema: meta.schema,
      stats,
      files,
      mode: 'append',
      canonicalJobId: meta.jobId,
      inference,
    };
  }

  // ============================================================
  // PRIVATE
  // ============================================================

  private applyInferenceLabels(
    rows: CsvRow[],
    scores: { nodeId: string; predictedLabel: number }[],
    targetLabel: string,
  ): void {
    const byNodeId = new Map(
      scores.map((s) => [String(s.nodeId), Number(s.predictedLabel)]),
    );
    let missing = 0;

    for (const row of rows) {
      const nodeId = String((row as Record<string, unknown>)['node_id'] ?? '');
      const predicted = byNodeId.get(nodeId);
      if (predicted === undefined) {
        missing++;
        continue;
      }
      row[targetLabel] = predicted === 1 ? 1 : 0;
    }

    if (missing > 0) {
      throw new HttpException(
        `Inference khong tra du nhan cho ${missing} node moi`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  private countPresentTargetValues(rows: CsvRow[], targetLabel: string): number {
    let count = 0;
    for (const row of rows) {
      const value = row[targetLabel];
      if (value !== null && value !== undefined && String(value).trim() !== '') {
        count++;
      }
    }
    return count;
  }

  private parseCsv(buffer: Buffer): { rows: CsvRow[]; headers: string[] } {
    let parsed: CsvRow[];
    try {
      parsed = parse(buffer, {
        columns: true,
        skip_empty_lines: true,
        bom: true,
        trim: true,
        relax_quotes: true,
        relax_column_count: true,
      }) as CsvRow[];
    } catch (e: any) {
      throw new HttpException(
        `Đọc CSV lỗi: ${e?.message ?? e}`,
        HttpStatus.BAD_REQUEST,
      );
    }
    const headers = parsed.length > 0 ? Object.keys(parsed[0]) : [];
    return { rows: parsed, headers };
  }

  private assertNonEmpty(rows: CsvRow[]): void {
    if (rows.length === 0) {
      throw new HttpException(
        'CSV không có dòng dữ liệu',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private assertHeaderHasTarget(headers: string[], targetLabel: string): void {
    if (!headers.includes(targetLabel)) {
      throw new HttpException(
        `targetLabel '${targetLabel}' không có trong CSV. Headers: ${headers.join(', ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private makeJobId(fileName: string): string {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const safeName = fileName
      .replace(/\.csv$/i, '')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 40);
    const short = randomUUID().split('-')[0];
    return `${ts}_${safeName}_${short}`;
  }
}
