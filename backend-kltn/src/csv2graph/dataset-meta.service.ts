import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { Neo4jService } from '../neo4j/neo4j.service';
import { FullSchema } from './interfaces/classification-schema.interface';

/**
 * Metadata snapshot của dataset đang nằm trong Neo4j.
 *
 * - Single dataset / dbId: mỗi lần build "from scratch" sẽ ghi đè file
 *   `<output_dir>/_latest_<dbId>.json`. Lần append KHÔNG ghi đè (giữ schema
 *   canonical từ build đầu).
 * - Khi dbId không có → fallback file `_latest.json`.
 */
export interface DatasetMeta {
  jobId: string;
  nodeLabel: string;
  /** Thứ tự col trong nodes.csv: [nodeIdCol, ...rawFeatureCols, targetLabel] */
  columns: string[];
  targetLabel: string;
  schema: FullSchema;
  builtAt: string;
}

export interface DatasetInfo {
  hasData: boolean;
  nodeLabel?: string;
  columns?: string[];
  targetLabel?: string;
  numNodes?: number;
  jobId?: string;
}

@Injectable()
export class DatasetMetaService {
  private readonly logger = new Logger(DatasetMetaService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly neo4jService: Neo4jService,
  ) {}

  // ============================================================
  // PUBLIC
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

  /**
   * Đếm node theo label hiện tại trên Neo4j. Nếu chưa connect hoặc lỗi
   * Cypher → trả 0 (caller sẽ coi là DB rỗng).
   */
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

  /**
   * Đếm tổng node bất kỳ label trên DB (dùng cho text2cypher guard).
   */
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
   * Tổng hợp dataset info cho FE: kết hợp metadata file + count Neo4j.
   *
   * - hasData = true ⇔ metadata tồn tại VÀ Neo4j còn ≥ 1 node theo nodeLabel.
   *   Nếu metadata mồ côi (file còn nhưng DB đã wipe tay) → coi như no data.
   */
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
    };
  }

  // ============================================================
  // PRIVATE
  // ============================================================

  private metaFilePath(dbId?: string | null): string {
    const root =
      this.config.get<string>('CSV2GRAPH_OUTPUT_DIR') ?? 'data/csv2graph';
    const safeDbId = dbId ? this.sanitizeDbId(dbId) : null;
    const filename = safeDbId ? `_latest_${safeDbId}.json` : '_latest.json';
    return path.resolve(process.cwd(), root, filename);
  }

  private sanitizeDbId(dbId: string): string {
    return dbId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
  }
}
