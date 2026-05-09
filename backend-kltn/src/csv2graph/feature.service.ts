import { Injectable, Logger } from '@nestjs/common';
import { CsvRow } from './interfaces/classification-schema.interface';

/**
 * Tương đương ensure_node_id + preprocess_features ở pipeline.py.
 *
 * NestJS port của:
 *   - ensure_node_id : auto-gen node_id 1..N hoặc rename col gốc thành 'node_id'
 *   - preprocess_features:
 *       1. detect categorical (object/string non-numeric)
 *       2. one-hot encode (giống pd.get_dummies)
 *       3. cast bool -> 0.0/1.0
 *       4. parseFloat + fillna(0)
 */
@Injectable()
export class FeatureService {
  private readonly logger = new Logger(FeatureService.name);
  private readonly cardinalityWarn = 50;

  ensureNodeId(
    rows: CsvRow[],
    schemaNodeId: string | null,
    headers: string[],
  ): {
    rows: CsvRow[];
    nodeIdCol: string;
    headers: string[];
  } {
    const headerSet = new Set(headers);

    if (!schemaNodeId || !headerSet.has(schemaNodeId)) {
      const newRows = rows.map((r, i) => ({ node_id: i + 1, ...r }));
      const newHeaders = ['node_id', ...headers.filter((h) => h !== 'node_id')];
      this.logger.log(`Auto-generated node_id (1..${rows.length})`);
      return { rows: newRows, nodeIdCol: 'node_id', headers: newHeaders };
    }

    if (schemaNodeId !== 'node_id') {
      const newRows = rows.map((r) => {
        const out: CsvRow = { ...r };
        out.node_id = r[schemaNodeId];
        delete out[schemaNodeId];
        return out;
      });
      const newHeaders = headers.map((h) => (h === schemaNodeId ? 'node_id' : h));
      this.logger.log(`Renamed '${schemaNodeId}' -> 'node_id'`);
      return { rows: newRows, nodeIdCol: 'node_id', headers: newHeaders };
    }

    return { rows, nodeIdCol: 'node_id', headers };
  }

  /**
   * One-hot encode categorical cols + cast all features sang float.
   * Tương đương pd.get_dummies + fillna(0) + astype(float).
   *
   * KHÔNG mutate input rows — clone từng row trước khi mutate. Caller có thể
   * tiếp tục dùng raw rows cho nodes.csv / Neo4j ingest mà không bị encode.
   *
   * Trả: { encodedRows, encodedFeatureCols }
   *   - encodedRows         : array mới, mỗi row là object mới (shallow copy
   *                           từ raw row + cols one-hot, đã drop col cat gốc).
   *   - encodedFeatureCols  : thứ tự ổn định các col feature SAU khi encode.
   */
  preprocessFeatures(
    rows: CsvRow[],
    featureCols: string[],
  ): { encodedRows: CsvRow[]; encodedFeatureCols: string[] } {
    const presentCols = featureCols.filter(
      (c) => rows.length > 0 && c in rows[0],
    );

    const numericCols: string[] = [];
    const boolCols: string[] = [];
    const catCols: string[] = [];

    for (const col of presentCols) {
      const kind = this.detectColKind(rows, col);
      if (kind === 'numeric') numericCols.push(col);
      else if (kind === 'bool') boolCols.push(col);
      else catCols.push(col);
    }

    if (catCols.length > 0) {
      this.logger.log(
        `Encoding categorical feature columns: [${catCols.join(', ')}]`,
      );
    }

    const catUniqueMap = new Map<string, string[]>();
    for (const col of catCols) {
      const seen = new Set<string>();
      for (const row of rows) {
        const v = row[col];
        if (v === null || v === undefined || v === '') continue;
        seen.add(String(v));
      }
      const sortedUniques = Array.from(seen).sort();
      if (sortedUniques.length > this.cardinalityWarn) {
        this.logger.warn(
          `Column '${col}' có ${sortedUniques.length} unique values — one-hot sẽ tạo nhiều cột, có thể tốn RAM`,
        );
      }
      catUniqueMap.set(col, sortedUniques);
    }

    const encodedCols: string[] = [];
    for (const col of numericCols) encodedCols.push(col);
    for (const col of boolCols) encodedCols.push(col);
    for (const col of catCols) {
      const uniques = catUniqueMap.get(col) ?? [];
      for (const u of uniques) {
        encodedCols.push(`${col}_${u}`);
      }
    }

    const encodedRows: CsvRow[] = new Array(rows.length);
    for (let i = 0; i < rows.length; i++) {
      const src = rows[i];
      const dst: CsvRow = { ...src };
      for (const col of numericCols) {
        dst[col] = this.toFloat(src[col]);
      }
      for (const col of boolCols) {
        dst[col] = this.boolToFloat(src[col]);
      }
      for (const col of catCols) {
        const uniques = catUniqueMap.get(col) ?? [];
        const value = src[col];
        const valueStr =
          value === null || value === undefined || value === ''
            ? null
            : String(value);
        for (const u of uniques) {
          dst[`${col}_${u}`] = valueStr === u ? 1.0 : 0.0;
        }
        delete dst[col];
      }
      encodedRows[i] = dst;
    }

    return { encodedRows, encodedFeatureCols: encodedCols };
  }

  // ============================================================
  // PRIVATE helpers
  // ============================================================

  /**
   * Detect kiểu của col: 'numeric' | 'bool' | 'categorical'.
   * - 'numeric'    : > 80% giá trị parse ra float thành công.
   * - 'bool'       : tất cả giá trị non-null là true/false (bool literal hoặc 'true'/'false').
   * - else         : 'categorical'.
   * Sample 200 rows đầu (đủ representative, tránh duyệt full).
   */
  private detectColKind(
    rows: CsvRow[],
    col: string,
  ): 'numeric' | 'bool' | 'categorical' {
    const sampleSize = Math.min(rows.length, 200);
    let total = 0;
    let numericCount = 0;
    let boolCount = 0;

    for (let i = 0; i < sampleSize; i++) {
      const v = rows[i][col];
      if (v === null || v === undefined || v === '') continue;
      total++;

      if (typeof v === 'boolean') {
        boolCount++;
        continue;
      }
      if (typeof v === 'number' && !Number.isNaN(v)) {
        numericCount++;
        continue;
      }
      const s = String(v).trim();
      if (s.toLowerCase() === 'true' || s.toLowerCase() === 'false') {
        boolCount++;
        continue;
      }
      const f = Number(s);
      if (!Number.isNaN(f) && s !== '') {
        numericCount++;
      }
    }

    if (total === 0) return 'numeric';
    if (boolCount === total) return 'bool';
    if (numericCount / total > 0.8) return 'numeric';
    return 'categorical';
  }

  private toFloat(v: unknown): number {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return Number.isNaN(v) ? 0 : v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    const f = Number(String(v));
    return Number.isNaN(f) ? 0 : f;
  }

  private boolToFloat(v: unknown): number {
    if (typeof v === 'boolean') return v ? 1.0 : 0.0;
    if (v === null || v === undefined || v === '') return 0.0;
    const s = String(v).trim().toLowerCase();
    if (s === 'true' || s === '1') return 1.0;
    if (s === 'false' || s === '0') return 0.0;
    return this.toFloat(v);
  }
}
