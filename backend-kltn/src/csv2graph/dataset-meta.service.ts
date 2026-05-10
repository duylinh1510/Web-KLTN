import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { Neo4jService } from '../neo4j/neo4j.service';
import { FullSchema } from './interfaces/classification-schema.interface';

/**
 * Metadata snapshot của dataset đang nằm trong Neo4j.
 * File: `<output_dir>/_latest_<dbId>.json`
 */
export interface DatasetMeta {
  jobId: string;
  nodeLabel: string;
  /** Post-rename columns (node_id, ...featureCols, targetLabel) */
  columns: string[];
  targetLabel: string;
  schema: FullSchema;
  /** true = đã train model (data.pt tồn tại) */
  trainMode?: boolean;
  builtAt: string;
}

/**
 * Thông tin CSV gốc — nguồn sự thật duy nhất cho append validation.
 * File: `<output_dir>/_raw_<dbId>.json`
 * Ghi một lần trong fullBuild, KHÔNG ghi đè khi append.
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
  jobId?: string;
  /** true nếu đã train GNN model — FE dùng để hiển thị "Có thể Inference" */
  hasModel?: boolean;
}

@Injectable()
export class DatasetMetaService {
  private readonly logger = new Logger(DatasetMetaService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly neo4jService: Neo4jService,
  ) {}

  // ============================================================
  // Meta (_latest_<dbId>.json)
  // ============================================================

  loadLatest(dbId?: string | null): DatasetMeta | null {
    const filePath = this.metaFilePath(dbId);
    if (!fs.existsSync(filePath)) return null;
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as DatasetMeta;
      if (!parsed?.nodeLabel || !Array.isArray(parsed?.columns)) {
        this.logger.warn(`Metadata file corrupted: ${filePath}`);
        return null;
      }
      return parsed;
    } catch (e: any) {
      this.logger.warn(`Đọc metadata lỗi (${filePath}): ${e?.message ?? e}`);
      return null;
    }
  }

  saveLatest(dbId: string | null | undefined, meta: DatasetMeta): void {
    const filePath = this.metaFilePath(dbId);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(meta, null, 2), 'utf-8');
    this.logger.log(`Saved dataset metadata → ${filePath}`);
  }

  // ============================================================
  // RawInfo (_raw_<dbId>.json) — nguồn sự thật cho append
  // ============================================================

  /**
   * Lưu thông tin CSV gốc. Gọi một lần trong fullBuild, KHÔNG gọi lại khi append.
   */
  saveRawInfo(dbId: string | null | undefined, info: RawInfo): void {
    const filePath = this.rawInfoFilePath(dbId);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(info, null, 2), 'utf-8');
    this.logger.log(
      `Saved raw info → ${filePath}` +
        ` (originalIdCol=${info.originalIdCol}, cols=${info.rawColumns.length})`,
    );
  }

  /**
   * Đọc `_raw_<dbId>.json`. Trả null nếu file chưa tồn tại.
   */
  loadRawInfo(dbId?: string | null): RawInfo | null {
    const filePath = this.rawInfoFilePath(dbId);
    if (!fs.existsSync(filePath)) return null;
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as RawInfo;
      if (!parsed?.originalIdCol || !Array.isArray(parsed?.rawColumns)) {
        this.logger.warn(`RawInfo file corrupted: ${filePath}`);
        return null;
      }
      return parsed;
    } catch (e: any) {
      this.logger.warn(`Đọc rawInfo lỗi (${filePath}): ${e?.message ?? e}`);
      return null;
    }
  }

  // ============================================================
  // Neo4j helpers
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

  async getDatasetInfo(dbId?: string | null): Promise<DatasetInfo> {
    const meta = this.loadLatest(dbId);
    if (!meta) return { hasData: false };

    const numNodes = await this.countNodes(meta.nodeLabel);
    if (numNodes === 0) return { hasData: false };

    return {
      hasData: true,
      nodeLabel: meta.nodeLabel,
      columns: meta.columns,
      targetLabel: meta.targetLabel,
      numNodes,
      jobId: meta.jobId,
      hasModel: meta.trainMode === true,
    };
  }

  // ============================================================
  // Private
  // ============================================================

  private metaFilePath(dbId?: string | null): string {
    const root =
      this.config.get<string>('CSV2GRAPH_OUTPUT_DIR') ?? 'data/csv2graph';
    const safeDbId = dbId ? this.sanitizeDbId(dbId) : null;
    const filename = safeDbId ? `_latest_${safeDbId}.json` : '_latest.json';
    return path.resolve(process.cwd(), root, filename);
  }

  private rawInfoFilePath(dbId?: string | null): string {
    const root =
      this.config.get<string>('CSV2GRAPH_OUTPUT_DIR') ?? 'data/csv2graph';
    const safeDbId = dbId ? this.sanitizeDbId(dbId) : null;
    const filename = safeDbId ? `_raw_${safeDbId}.json` : '_raw.json';
    return path.resolve(process.cwd(), root, filename);
  }

  private sanitizeDbId(dbId: string): string {
    return dbId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
  }
}
