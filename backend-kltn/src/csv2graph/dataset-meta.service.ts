import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import { Neo4jService } from '../neo4j/neo4j.service';
import { DatasetService } from '../mongodb/dataset.service';
import { PipelineConfigService } from '../mongodb/pipeline-config.service';
import { EncodingMapService } from '../mongodb/encoding-map.service';
import { FullSchema } from './interfaces/classification-schema.interface';

/**
 * Metadata snapshot của dataset đang nằm trong Neo4j.
 * Trước: lưu file `_latest_<database>.json`. Giờ: MongoDB collection `datasets`.
 */
export interface DatasetMeta {
  jobId: string;
  nodeLabel: string;
  /** Post-rename columns (node_id, ...featureCols, targetLabel) */
  columns: string[];
  targetLabel: string;
  schema: FullSchema;
  /** true = user requested training during full build */
  trainMode?: boolean;
  /** true = model training completed and a weights file exists */
  hasModel?: boolean;
  modelPath?: string;
  activeModelPath?: string;
  trainedAt?: string;
  trainingMetrics?: Record<string, unknown>;
  builtAt: string;
}

/**
 * Thông tin CSV gốc — nguồn sự thật duy nhất cho append validation.
 * Trước: file `_raw_<database>.json`. Giờ: MongoDB collection `pipeline_configs`.
 */
export interface RawInfo {
  /** Cột user chọn làm ID (tên GỐC trong CSV, chưa rename). VD: 'trans_num' */
  originalIdCol: string;
  /** Headers gốc của CSV (chưa rename, chưa encode). Dùng để so sánh khi append. */
  rawColumns: string[];
}

export interface DatasetInfo {
  hasData: boolean;
  nodeLabel?: string;
  columns?: string[];
  targetLabel?: string;
  numNodes?: number;
  totalGraphNodes?: number;
  totalGraphRelationships?: number;
  jobId?: string;
  /** true nếu đã train GNN model — FE dùng để hiển thị "Có thể Inference" */
  hasModel?: boolean;
}

@Injectable()
export class DatasetMetaService {
  private readonly logger = new Logger(DatasetMetaService.name);

  constructor(
    private readonly neo4jService: Neo4jService,
    private readonly datasetService: DatasetService,
    private readonly pipelineConfigService: PipelineConfigService,
    private readonly encodingMapService: EncodingMapService,
  ) {}

  // ============================================================
  // Meta (MongoDB: datasets + pipeline_configs + encoding_maps)
  // ============================================================

  async loadLatest(database?: string | null): Promise<DatasetMeta | null> {
    const db = database || 'neo4j';
    const [dataset, config, encodingMap] = await Promise.all([
      this.datasetService.findByDatabase(db),
      this.pipelineConfigService.findByDatabase(db),
      this.encodingMapService.findByDatabase(db),
    ]);

    if (!dataset?.nodeLabel || !Array.isArray(dataset?.columns)) {
      return null;
    }

    // Reconstruct DatasetMeta from 3 collections
    const schema: FullSchema = {
      node_id: 'node_id',
      relation_cols: config?.relationCols ?? [],
      feature_cols: config?.featureCols ?? [],
      encoded_feature_cols: config?.encodedFeatureCols ?? [],
      encoding_maps: encodingMap?.maps ?? {},
      target_label: dataset.targetLabel,
      train_ratio: config?.trainRatio ?? 0.4,
      val_ratio: config?.valRatio ?? 0.2,
      seed: config?.seed ?? 42,
      max_group_size: config?.maxGroupSize ?? 500,
    };

    return {
      jobId: '', // jobId is tracked in pipeline_runs now
      nodeLabel: dataset.nodeLabel,
      columns: dataset.columns,
      targetLabel: dataset.targetLabel,
      schema,
      hasModel: dataset.hasModel,
      activeModelPath: dataset.activeModelPath,
      trainingMetrics: dataset.trainingMetrics,
      builtAt: (dataset as any).createdAt?.toISOString?.() ?? new Date().toISOString(),
    };
  }

  async saveLatest(
    database: string | null | undefined,
    meta: DatasetMeta,
  ): Promise<void> {
    const db = database || 'neo4j';

    // 1. Save dataset state
    await this.datasetService.upsert(db, {
      nodeLabel: meta.nodeLabel,
      targetLabel: meta.targetLabel,
      columns: meta.columns,
      hasModel: meta.hasModel ?? false,
      activeModelPath: meta.activeModelPath,
      trainingMetrics: meta.trainingMetrics,
    });

    // 2. Save pipeline config (without encoding_maps)
    await this.pipelineConfigService.save(db, {
      relationCols: meta.schema.relation_cols,
      featureCols: meta.schema.feature_cols,
      encodedFeatureCols: meta.schema.encoded_feature_cols,
      trainRatio: meta.schema.train_ratio,
      valRatio: meta.schema.val_ratio,
      seed: meta.schema.seed,
      maxGroupSize: meta.schema.max_group_size,
    });

    // 3. Save encoding_maps separately (can be very large)
    if (
      meta.schema.encoding_maps &&
      Object.keys(meta.schema.encoding_maps).length > 0
    ) {
      await this.encodingMapService.save(db, meta.schema.encoding_maps);
    }

    this.logger.log(`Saved dataset metadata → MongoDB (db=${db})`);
  }

  // ============================================================
  // RawInfo (MongoDB: pipeline_configs)
  // ============================================================

  async saveRawInfo(
    database: string | null | undefined,
    info: RawInfo,
  ): Promise<void> {
    const db = database || 'neo4j';
    await this.pipelineConfigService.save(db, {
      originalIdCol: info.originalIdCol,
      rawColumns: info.rawColumns,
    });
    this.logger.log(
      `Saved raw info → MongoDB (db=${db})` +
        ` (originalIdCol=${info.originalIdCol}, cols=${info.rawColumns.length})`,
    );
  }

  async loadRawInfo(database?: string | null): Promise<RawInfo | null> {
    const db = database || 'neo4j';
    const config = await this.pipelineConfigService.findByDatabase(db);
    if (!config?.originalIdCol || !Array.isArray(config?.rawColumns)) {
      return null;
    }
    return {
      originalIdCol: config.originalIdCol,
      rawColumns: config.rawColumns,
    };
  }

  // ============================================================
  // Neo4j helpers (unchanged — these query Neo4j directly)
  // ============================================================

  async countNodes(nodeLabel: string): Promise<number> {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(nodeLabel)) return 0;
    const session = this.neo4jService.getReadSession();
    try {
      const res = await session.run(
        `MATCH (n:${nodeLabel}) RETURN count(n) AS c`,
      );
      const c = res.records[0]?.get('c');
      return typeof c === 'number' ? c : Number(c?.toNumber?.() ?? c ?? 0);
    } catch (e: any) {
      this.logger.warn(`countNodes lỗi: ${e?.message ?? e}`);
      return 0;
    } finally {
      await session.close();
    }
  }

  async countAllNodes(): Promise<number> {
    const session = this.neo4jService.getReadSession();
    try {
      const res = await session.run('MATCH (n) RETURN count(n) AS c');
      const c = res.records[0]?.get('c');
      return typeof c === 'number' ? c : Number(c?.toNumber?.() ?? c ?? 0);
    } catch (e: any) {
      this.logger.warn(`countAllNodes lỗi: ${e?.message ?? e}`);
      return 0;
    } finally {
      await session.close();
    }
  }

  async countAllRelationships(): Promise<number> {
    const session = this.neo4jService.getReadSession();
    try {
      const res = await session.run('MATCH ()-[r]->() RETURN count(r) AS c');
      const c = res.records[0]?.get('c');
      return typeof c === 'number' ? c : Number(c?.toNumber?.() ?? c ?? 0);
    } catch (e: any) {
      this.logger.warn(`countAllRelationships loi: ${e?.message ?? e}`);
      return 0;
    } finally {
      await session.close();
    }
  }

  /**
   * Kiểm tra ID trùng: trả về danh sách node_id đã tồn tại trong Neo4j.
   * Query theo batch 500 ID để tránh vượt giới hạn Cypher.
   */
  async findDuplicateNodeIds(
    nodeLabel: string,
    nodeIds: string[],
    batchSize = 500,
  ): Promise<string[]> {
    if (!nodeIds.length) return [];
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(nodeLabel)) return [];

    const duplicates: string[] = [];
    const session = this.neo4jService.getReadSession();
    try {
      for (let i = 0; i < nodeIds.length; i += batchSize) {
        const batch = nodeIds.slice(i, i + batchSize);
        const res = await session.run(
          `MATCH (n:${nodeLabel}) WHERE n.node_id IN $ids RETURN n.node_id AS id`,
          { ids: batch },
        );
        for (const rec of res.records) {
          const id = rec.get('id');
          if (id !== null && id !== undefined) duplicates.push(String(id));
        }
      }
    } catch (e: any) {
      this.logger.warn(`findDuplicateNodeIds lỗi: ${e?.message ?? e}`);
    } finally {
      await session.close();
    }
    return duplicates;
  }

  async getDatasetInfo(database?: string | null): Promise<DatasetInfo> {
    const meta = await this.loadLatest(database);
    if (!meta) return { hasData: false };

    const [numNodes, totalGraphNodes, totalGraphRelationships] =
      await Promise.all([
        this.countNodes(meta.nodeLabel),
        this.countAllNodes(),
        this.countAllRelationships(),
      ]);
    if (numNodes === 0) return { hasData: false };

    return {
      hasData: true,
      nodeLabel: meta.nodeLabel,
      columns: meta.columns,
      targetLabel: meta.targetLabel,
      numNodes,
      totalGraphNodes,
      totalGraphRelationships,
      jobId: meta.jobId,
      hasModel: this.modelExists(meta),
    };
  }

  hasUsableModel(meta: DatasetMeta): boolean {
    return this.modelExists(meta);
  }

  // ============================================================
  // Private
  // ============================================================

  private modelExists(meta: DatasetMeta): boolean {
    if (meta.hasModel !== true) return false;
    const modelPath = meta.activeModelPath || meta.modelPath;
    if (!modelPath) return false;
    try {
      return fs.existsSync(modelPath);
    } catch {
      return false;
    }
  }
}
