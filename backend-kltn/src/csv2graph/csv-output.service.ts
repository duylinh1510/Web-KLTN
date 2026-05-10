import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import {
  CsvRow,
  EdgeRow,
  FullSchema,
} from './interfaces/classification-schema.interface';

/**
 * Tương đương phần build_neo4j_csvs (xuất nodes.csv + edges.csv) +
 * dump schema.json ở pipeline.py.
 *
 * nodes.csv : node_id + feature_cols + target_label
 * edges.csv : src_id, dst_id, relation_type
 * schema.json : full schema metadata để GNN training code đọc lại sau.
 */
@Injectable()
export class CsvOutputService {
  private readonly logger = new Logger(CsvOutputService.name);

  ensureJobDir(rootDir: string, jobId: string): string {
    const dir = path.resolve(process.cwd(), rootDir, jobId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  saveInputCsv(jobDir: string, fileName: string, buffer: Buffer): string {
    const dest = path.join(jobDir, this.sanitizeFileName(fileName));
    fs.writeFileSync(dest, buffer);
    this.logger.log(`Saved input CSV: ${dest} (${buffer.length} bytes)`);
    return dest;
  }

  writeNodesCsv(
    jobDir: string,
    rows: CsvRow[],
    nodeIdCol: string,
    featureCols: string[],
    targetLabel: string | null,
  ): string {
    const filePath = path.join(jobDir, 'nodes.csv');

    const headers: string[] = [nodeIdCol, ...featureCols];
    // Chỉ thêm cột target nếu có (ingest-only mode không có target)
    if (targetLabel && rows.length > 0 && targetLabel in rows[0]) {
      headers.push(targetLabel);
    }

    const lines: string[] = [headers.map(this.csvEscape).join(',')];
    for (const row of rows) {
      lines.push(headers.map((h) => this.csvEscape(row[h])).join(','));
    }
    fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');

    this.logger.log(
      `nodes.csv saved: ${rows.length} rows × ${headers.length} cols`,
    );
    return filePath;
  }

  writeEdgesCsv(jobDir: string, edges: EdgeRow[]): string {
    const filePath = path.join(jobDir, 'edges.csv');

    const headers = ['src_id', 'dst_id', 'relation_type'];
    const lines: string[] = [headers.join(',')];
    for (const e of edges) {
      lines.push(
        [
          this.csvEscape(e.src_id),
          this.csvEscape(e.dst_id),
          this.csvEscape(e.relation_type),
        ].join(','),
      );
    }
    fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');

    this.logger.log(`edges.csv saved: ${edges.length} edges`);
    return filePath;
  }

  writeSchemaJson(jobDir: string, schema: FullSchema): string {
    const filePath = path.join(jobDir, 'schema.json');
    fs.writeFileSync(filePath, JSON.stringify(schema, null, 2), 'utf-8');
    this.logger.log(`schema.json saved`);
    return filePath;
  }

  /**
   * Ghi CSV preprocessed (đã one-hot, đã có node_id) — dùng làm input
   * cho Colab /build-data-pt.
   */
  writePreprocessedCsv(
    jobDir: string,
    rows: CsvRow[],
    nodeIdCol: string,
    featureCols: string[],
    targetLabel: string,
  ): string {
    const filePath = path.join(jobDir, 'preprocessed.csv');

    const headers: string[] = [nodeIdCol, ...featureCols];
    if (rows.length > 0 && targetLabel in rows[0]) {
      headers.push(targetLabel);
    }

    const lines: string[] = [headers.map(this.csvEscape).join(',')];
    for (const row of rows) {
      lines.push(headers.map((h) => this.csvEscape(row[h])).join(','));
    }
    fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');

    this.logger.log(`preprocessed.csv saved`);
    return filePath;
  }

  // ============================================================
  // PRIVATE
  // ============================================================

  private csvEscape = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    let s: string;
    if (typeof value === 'number') {
      s = Number.isFinite(value) ? String(value) : '';
    } else if (typeof value === 'boolean') {
      s = value ? '1' : '0';
    } else {
      s = String(value);
    }
    if (/[",\n\r]/.test(s)) {
      s = '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };

  private sanitizeFileName(name: string): string {
    return name.replace(/[^a-zA-Z0-9._-]/g, '_');
  }
}
