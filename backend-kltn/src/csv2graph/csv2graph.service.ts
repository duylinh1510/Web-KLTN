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
import { DatasetMetaService, DatasetMeta } from './dataset-meta.service';
import { Csv2GraphRunDto } from './dto/csv2graph-run.dto';
import {
  Csv2GraphResult,
  Csv2GraphFiles,
  Csv2GraphStats,
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
 *     lưu _latest_<dbId>.json (canonical schema cho lần sau).
 *
 * - DB đã có data → appendBuild():
 *     KHÔNG LLM, dùng schema canonical từ _latest_<dbId>.json.
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
    private readonly datasetMeta: DatasetMetaService,
  ) {}

  async run(
    fileBuffer: Buffer,
    originalFileName: string,
    dto: Csv2GraphRunDto,
  ): Promise<Csv2GraphResult> {
    const dbId = this.neo4j.getDbId();
    const meta = this.datasetMeta.loadLatest(dbId);
    const numExistingNodes = meta
      ? await this.datasetMeta.countNodes(meta.nodeLabel)
      : 0;
    const isAppend = !!meta && numExistingNodes > 0;

    if (isAppend) {
      this.logger.log(
        `====== APPEND MODE — meta.jobId=${meta!.jobId}, ` +
          `nodeLabel=${meta!.nodeLabel}, existingNodes=${numExistingNodes} ======`,
      );
      return this.appendBuild(fileBuffer, originalFileName, dto, meta!);
    }

    this.logger.log('====== FULL BUILD MODE (DB rỗng) ======');
    return this.fullBuild(fileBuffer, originalFileName, dto, dbId);
  }

  // ============================================================
  // FULL BUILD — DB rỗng, chạy đầy đủ pipeline + LLM classify
  // ============================================================

  private async fullBuild(
    fileBuffer: Buffer,
    originalFileName: string,
    dto: Csv2GraphRunDto,
    dbId: string | null,
  ): Promise<Csv2GraphResult> {
    if (!dto.targetLabel || dto.targetLabel.trim() === '') {
      throw new HttpException(
        'targetLabel là bắt buộc khi DB rỗng (full build).',
        HttpStatus.BAD_REQUEST,
      );
    }
    const targetLabel = dto.targetLabel;
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
    this.logger.log(`  target_label   : ${targetLabel}`);
    this.logger.log(`  max_group_size : ${maxGroupSize}`);
    this.logger.log(`  node_label     : ${nodeLabel}`);
    this.logger.log(`  ingestNeo4j=${ingestNeo4j}`);

    const inputCsvPath = this.csvOutput.saveInputCsv(
      jobDir,
      originalFileName,
      fileBuffer,
    );

    this.logger.log('[1/8] Parsing CSV...');
    const { rows, headers } = this.parseCsv(fileBuffer);
    this.assertNonEmpty(rows);
    this.assertHeaderHasTarget(headers, targetLabel);
    this.logger.log(`  parsed: ${rows.length} rows × ${headers.length} cols`);

    this.logger.log('[2/8] LLM classify schema...');
    const classification = await this.schemaLlm.analyzeSchema(
      rows,
      headers,
      targetLabel,
    );

    this.logger.log('[3/8] Ensure node_id...');
    const ensured = this.feature.ensureNodeId(
      rows,
      classification.node_id,
      headers,
    );
    const rawRows = ensured.rows;
    const rawFeatureCols = classification.feature.filter(
      (c) => rawRows.length > 0 && c in rawRows[0],
    );

    this.logger.log('[4/8] Preprocess features (one-hot + float) — encoded copy...');
    const { encodedRows, encodedFeatureCols } = this.feature.preprocessFeatures(
      rawRows,
      classification.feature,
    );

    this.logger.log('[5/8] Build star edges (raw rows, raw relation_cols)...');
    const edges = this.starGraph.buildStarEdges(
      rawRows,
      ensured.nodeIdCol,
      classification.relation_cols,
      maxGroupSize,
    );

    this.logger.log('[6/8] Writing CSV outputs (raw nodes + edges + schema)...');
    const fullSchema: FullSchema = {
      node_id: ensured.nodeIdCol,
      relation_cols: classification.relation_cols,
      feature_cols: rawFeatureCols,
      encoded_feature_cols: encodedFeatureCols,
      target_label: targetLabel,
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
      targetLabel,
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

    if (ingestNeo4j) {
      this.logger.log('[7/8] Ingest Neo4j (raw rows, raw feature props)...');
      const ingested = await this.neo4jIngest.ingest(
        rawRows,
        edges,
        ensured.nodeIdCol,
        rawFeatureCols,
        targetLabel,
        nodeLabel,
      );
      stats.ingested = ingested;
      this.logger.log(
        `  ingested: ${ingested.nodes} nodes, ${ingested.relationships} relationships`,
      );
    } else {
      this.logger.log('[7/8] Skip Neo4j ingestion (ingestNeo4j=false)');
    }

    this.logger.log('[8/8] Build data.pt via Python sidecar (encoded rows)...');
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

    if (ingestNeo4j) {
      const canonicalColumns = [
        ensured.nodeIdCol,
        ...rawFeatureCols,
        targetLabel,
      ];
      this.datasetMeta.saveLatest(dbId, {
        jobId,
        nodeLabel,
        columns: canonicalColumns,
        targetLabel,
        schema: fullSchema,
        builtAt: new Date().toISOString(),
      });
    }

    this.logger.log(`====== JOB ${jobId} DONE ======`);
    return { jobId, schema: fullSchema, stats, files, mode: 'full' };
  }

  // ============================================================
  // APPEND BUILD — DB đã có data, dùng schema canonical từ metadata
  // ============================================================

  private async appendBuild(
    fileBuffer: Buffer,
    originalFileName: string,
    dto: Csv2GraphRunDto,
    meta: DatasetMeta,
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
    const nodeLabel = dto.nodeLabel ?? meta.nodeLabel;
    const ingestNeo4j = dto.ingestNeo4j ?? true;

    if (nodeLabel !== meta.nodeLabel) {
      throw new HttpException(
        `nodeLabel '${nodeLabel}' lệch với dataset hiện tại (${meta.nodeLabel}). ` +
          `Append phải dùng cùng nodeLabel.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    this.logger.log(`====== APPEND JOB ${jobId} ======`);
    this.logger.log(`  canonical jobId : ${meta.jobId}`);
    this.logger.log(`  target_label    : ${meta.targetLabel}`);
    this.logger.log(`  node_label      : ${nodeLabel}`);

    const inputCsvPath = this.csvOutput.saveInputCsv(
      jobDir,
      originalFileName,
      fileBuffer,
    );

    this.logger.log('[1/6] Parsing CSV...');
    const { rows, headers } = this.parseCsv(fileBuffer);
    this.assertNonEmpty(rows);

    this.logger.log('[2/6] Validate header subset of canonical columns...');
    const canonicalSet = new Set(meta.columns);
    const extraColumns = headers.filter((h) => !canonicalSet.has(h));
    if (extraColumns.length > 0) {
      throw new HttpException(
        `CSV có cột mới không thuộc dataset hiện tại: [${extraColumns.join(', ')}]. ` +
          `Cột canonical: [${meta.columns.join(', ')}]`,
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!headers.includes(meta.targetLabel)) {
      throw new HttpException(
        `CSV thiếu cột target_label '${meta.targetLabel}' (bắt buộc khi append).`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const missingColumns = meta.columns.filter((c) => !headers.includes(c));
    if (missingColumns.length > 0) {
      this.logger.warn(
        `Cột thiếu sẽ được fill null: [${missingColumns.join(', ')}]`,
      );
      for (const row of rows) {
        for (const col of missingColumns) {
          if (!(col in row)) row[col] = null;
        }
      }
    }

    this.logger.log('[3/6] Ensure node_id (theo schema canonical)...');
    const canonicalNodeId = meta.schema.node_id;
    const classification: ClassificationSchema = {
      node_id: canonicalNodeId in (rows[0] ?? {}) ? canonicalNodeId : null,
      relation_cols: meta.schema.relation_cols,
      feature: meta.schema.feature_cols,
    };
    const ensured = this.feature.ensureNodeId(
      rows,
      classification.node_id,
      headers,
    );
    const rawRows = ensured.rows;
    const rawFeatureCols = meta.schema.feature_cols.filter(
      (c) => rawRows.length > 0 && c in rawRows[0],
    );

    this.logger.log('[4/6] Build star edges...');
    const edges = this.starGraph.buildStarEdges(
      rawRows,
      ensured.nodeIdCol,
      meta.schema.relation_cols,
      maxGroupSize,
    );

    this.logger.log('[5/6] Writing CSV outputs (append job dir)...');
    const nodesCsvPath = this.csvOutput.writeNodesCsv(
      jobDir,
      rawRows,
      ensured.nodeIdCol,
      rawFeatureCols,
      meta.targetLabel,
    );
    const edgesCsvPath = this.csvOutput.writeEdgesCsv(jobDir, edges);
    const schemaJsonPath = this.csvOutput.writeSchemaJson(
      jobDir,
      meta.schema,
    );

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

    if (ingestNeo4j) {
      this.logger.log('[6/6] Ingest Neo4j (MERGE upsert by node_id)...');
      const ingested = await this.neo4jIngest.ingest(
        rawRows,
        edges,
        ensured.nodeIdCol,
        rawFeatureCols,
        meta.targetLabel,
        nodeLabel,
      );
      stats.ingested = ingested;
      this.logger.log(
        `  ingested: ${ingested.nodes} nodes, ${ingested.relationships} relationships`,
      );
    } else {
      this.logger.log('[6/6] Skip Neo4j ingestion (ingestNeo4j=false)');
    }

    this.logger.log(
      `====== APPEND JOB ${jobId} DONE — data.pt KHÔNG rebuild (giữ build đầu) ======`,
    );

    return {
      jobId,
      schema: meta.schema,
      stats,
      files,
      mode: 'append',
      canonicalJobId: meta.jobId,
    };
  }

  // ============================================================
  // PRIVATE
  // ============================================================

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
