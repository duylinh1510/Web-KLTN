import { Injectable, Logger } from '@nestjs/common';
import { CsvRow, FullSchema } from './interfaces/classification-schema.interface';

/**
 * Tương đương ensure_node_id + preprocess_features ở pipeline.py.
 *
 * NestJS port của:
 *   - ensure_node_id        : auto-gen node_id 1..N hoặc rename col gốc thành 'node_id'
 *   - preprocessFeatures    :
 *       1. detect categorical (object/string non-numeric)
 *       2. Target Encoding  : categorical col → mean(targetLabel) per category
 *                             Fallback Frequency Encoding khi không có targetLabel
 *       3. cast bool        → 0.0/1.0
 *       4. parseFloat + fillna(0) cho numeric
 *
 * Tại sao Target Encoding thay vì One-Hot:
 *   - One-Hot biến 1 cột có k unique values thành k cột → phình chiều không kiểm soát được
 *     (city 1000 giá trị → 1000 cột, mỗi cột hầu hết là 0).
 *   - Target Encoding: 1 cột categorical → 1 cột float ∈ [0, 1], giữ nguyên số chiều.
 *   - Thông tin phân biệt gian lận được distill trực tiếp vào con số đó.
 */
@Injectable()
export class FeatureService {
  private readonly logger = new Logger(FeatureService.name);

  /** Ngưỡng cardinality để log INFO khi dùng Target Encoding */
  private readonly cardinalityInfo = 50;

  // ============================================================
  // PUBLIC API
  // ============================================================

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
   * Target Encoding cho categorical cols + cast float cho numeric/bool.
   *
   * KHÔNG mutate input rows — clone từng row trước khi encode. Caller có thể
   * tiếp tục dùng raw rows cho nodes.csv / Neo4j ingest mà không bị encode.
   *
   * @param rows        Raw rows (sau ensureNodeId)
   * @param featureCols Tên các cột cần encode (output của LLM classify)
   * @param targetLabel Tên cột nhãn nhị phân (0/1). Nếu rỗng → Frequency Encoding.
   *
   * @returns
   *   - encodedRows        : array mới, mỗi categorical col được thay bằng 1 float column.
   *   - encodedFeatureCols : danh sách tên cột sau encode (số lượng bằng featureCols.length).
   *
   * Encoding map được log để debug và lưu trong schema để sidecar Python tái hiện.
   */
  preprocessFeatures(
    rows: CsvRow[],
    featureCols: string[],
    targetLabel: string = '',
  ): {
    encodedRows: CsvRow[];
    encodedFeatureCols: string[];
    encodingMaps: Record<string, Record<string, number>>;
  } {
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

    // ── Build Target / Frequency encoding maps ──
    const hasTarget = !!(targetLabel && targetLabel.trim() !== '');
    const encodingMaps: Record<string, Record<string, number>> = {};

    for (const col of catCols) {
      if (hasTarget) {
        encodingMaps[col] = this.buildTargetEncodingMap(rows, col, targetLabel);
      } else {
        encodingMaps[col] = this.buildFrequencyEncodingMap(rows, col);
      }

      const uniqueCount = Object.keys(encodingMaps[col]).length;
      if (uniqueCount > this.cardinalityInfo) {
        this.logger.log(
          `Column '${col}' — ${uniqueCount} unique values → ` +
            (hasTarget ? 'Target Encoding' : 'Frequency Encoding') +
            ` (1 cột float, không phình chiều)`,
        );
      }
    }

    if (catCols.length > 0) {
      this.logger.log(
        `[TargetEnc] Encoded ${catCols.length} categorical col(s) via ` +
          (hasTarget
            ? `Target Encoding (target='${targetLabel}')`
            : 'Frequency Encoding (no targetLabel)') +
          `: [${catCols.join(', ')}]`,
      );
    }

    // ── Tên cột encoded: giữ nguyên tên gốc (không thêm hậu tố) ──
    // Điều này giúp schema.json dễ đọc và sidecar Python áp dụng cùng map.
    const encodedCols: string[] = [
      ...numericCols,
      ...boolCols,
      ...catCols, // giữ tên gốc — giá trị bên trong đã là float
    ];

    // ── Build encoded rows ──
    const encodedRows: CsvRow[] = new Array(rows.length);
    const globalMean = hasTarget ? this.computeGlobalTargetMean(rows, targetLabel) : 0.5;

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
        const map = encodingMaps[col];
        const raw = src[col];
        const key =
          raw === null || raw === undefined || raw === '' ? '__MISSING__' : String(raw);
        // Fallback về globalMean khi gặp category chưa thấy (unseen at inference)
        dst[col] = map[key] ?? map['__MISSING__'] ?? globalMean;
      }

      encodedRows[i] = dst;
    }

    return { encodedRows, encodedFeatureCols: encodedCols, encodingMaps };
  }

  encodeWithSchema(
    rows: CsvRow[],
    schema: FullSchema,
  ): {
    encodedRows: CsvRow[];
    encodedFeatureCols: string[];
  } {
    const encodedCols =
      schema.encoded_feature_cols?.length > 0
        ? schema.encoded_feature_cols
        : schema.feature_cols;
    const encodingMaps = schema.encoding_maps ?? {};
    const encodedRows: CsvRow[] = new Array(rows.length);

    for (let i = 0; i < rows.length; i++) {
      const src = rows[i];
      const dst: CsvRow = { ...src };

      for (const col of encodedCols) {
        const map = encodingMaps[col];
        if (map) {
          const raw = src[col];
          const key =
            raw === null || raw === undefined || raw === ''
              ? '__MISSING__'
              : String(raw);
          dst[col] = map[key] ?? map['__MISSING__'] ?? 0.5;
        } else {
          dst[col] = this.boolToFloat(src[col]);
        }
      }

      encodedRows[i] = dst;
    }

    return { encodedRows, encodedFeatureCols: encodedCols };
  }

  // ============================================================
  // PRIVATE — Encoding map builders
  // ============================================================

  /**
   * Target Encoding: mỗi giá trị category → mean(targetLabel) trong nhóm đó.
   *
   * Ví dụ: category='grocery_pos' xuất hiện 500 lần,
   *   trong đó 15 lần is_fraud=1 → encode value = 15/500 = 0.03.
   *
   * Key đặc biệt '__MISSING__' = mean của toàn bộ target (global mean).
   */
  private buildTargetEncodingMap(
    rows: CsvRow[],
    col: string,
    targetLabel: string,
  ): Record<string, number> {
    const sumMap = new Map<string, number>();   // tổng target per category
    const countMap = new Map<string, number>(); // số lần xuất hiện per category

    let globalSum = 0;
    let globalCount = 0;

    for (const row of rows) {
      const raw = row[col];
      const key =
        raw === null || raw === undefined || raw === '' ? '__MISSING__' : String(raw);
      const targetVal = this.toFloat(row[targetLabel]);

      sumMap.set(key, (sumMap.get(key) ?? 0) + targetVal);
      countMap.set(key, (countMap.get(key) ?? 0) + 1);
      globalSum += targetVal;
      globalCount++;
    }

    const globalMean = globalCount > 0 ? globalSum / globalCount : 0;

    const map: Record<string, number> = {};
    for (const [key, sum] of sumMap.entries()) {
      const cnt = countMap.get(key) ?? 1;
      map[key] = sum / cnt;
    }
    // __MISSING__ fallback = global mean
    if (!('__MISSING__' in map)) {
      map['__MISSING__'] = globalMean;
    }

    return map;
  }

  /**
   * Frequency Encoding (fallback khi không có targetLabel):
   * mỗi giá trị category → tần suất xuất hiện (count / N).
   *
   * Dùng khi người dùng chỉ muốn ingest graph mà không có nhãn.
   */
  private buildFrequencyEncodingMap(
    rows: CsvRow[],
    col: string,
  ): Record<string, number> {
    const countMap = new Map<string, number>();
    const n = rows.length;

    for (const row of rows) {
      const raw = row[col];
      const key =
        raw === null || raw === undefined || raw === '' ? '__MISSING__' : String(raw);
      countMap.set(key, (countMap.get(key) ?? 0) + 1);
    }

    const map: Record<string, number> = {};
    for (const [key, cnt] of countMap.entries()) {
      map[key] = n > 0 ? cnt / n : 0;
    }
    if (!('__MISSING__' in map)) {
      map['__MISSING__'] = 0;
    }

    return map;
  }

  /**
   * Tính global mean của target (dùng làm fallback cho unseen categories).
   */
  private computeGlobalTargetMean(rows: CsvRow[], targetLabel: string): number {
    if (!targetLabel) return 0.5;
    let sum = 0;
    let cnt = 0;
    for (const row of rows) {
      const v = row[targetLabel];
      if (v !== null && v !== undefined && v !== '') {
        sum += this.toFloat(v);
        cnt++;
      }
    }
    return cnt > 0 ? sum / cnt : 0.5;
  }

  // ============================================================
  // PRIVATE — Col type detection
  // ============================================================

  /**
   * Detect kiểu của col: 'numeric' | 'bool' | 'categorical'.
   * - 'numeric'    : >80% giá trị parse ra float thành công.
   * - 'bool'       : tất cả giá trị non-null là true/false (bool literal hoặc 'true'/'false').
   * - else         : 'categorical' → sẽ dùng Target/Frequency Encoding.
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

  // ============================================================
  // PRIVATE — Cast helpers
  // ============================================================

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
