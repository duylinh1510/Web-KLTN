import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import {
  ClassificationSchema,
  CsvRow,
  EncodingHint,
  EncodingType,
} from './interfaces/classification-schema.interface';

/**
 * Tương đương analyze_schema + get_schema_from_llm + enforce_schema_rules
 * + flatten_to_strings ở python-services/csvtograph/pipeline.py.
 *
 * NestJS chỉ gửi data thuần (validColumns, sampleValues, targetLabel) cho Colab,
 * Colab tự build prompt + chạy LLM + trả JSON.
 */
@Injectable()
export class SchemaLlmService {
  private readonly logger = new Logger(SchemaLlmService.name);
  private readonly encodingTypes = new Set<EncodingType>([
    'numeric',
    'binary',
    'ordinal',
    'cyclical',
    'datetime',
    'target',
  ]);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Phân tích schema từ rows.
   * 1. Loại các col hidden V1..Vn khỏi danh sách gửi LLM.
   * 2. Lấy 5 sample values unique non-null per col.
   * 3. Gọi Colab /classify-schema.
   * 4. Flatten + add hidden features + enforce rules.
   */
  async analyzeSchema(
    rows: CsvRow[],
    headers: string[],
    targetLabel: string,
  ): Promise<ClassificationSchema> {
    const hiddenFeatures = headers.filter((c) => /^V\d+$/i.test(c));
    const columnsForLlm = headers.filter((c) => !hiddenFeatures.includes(c));

    const sampleValues: Record<string, unknown[]> = {};
    for (const col of columnsForLlm) {
      const seen = new Set<string>();
      const samples: unknown[] = [];
      for (const row of rows) {
        const v = row[col];
        if (v === null || v === undefined || v === '') continue;
        const key = String(v);
        if (seen.has(key)) continue;
        seen.add(key);
        samples.push(v);
        if (samples.length >= 5) break;
      }
      sampleValues[col] = samples;
    }

    this.logger.log(
      `Calling Colab /classify-schema with ${columnsForLlm.length} columns ` +
        `(${hiddenFeatures.length} hidden V* cols skipped)`,
    );

    const raw = await this.callClassifyEndpoint(
      columnsForLlm,
      sampleValues,
      targetLabel,
    );

    const rawRelationCols = this.flattenToStrings(raw.relation_cols);
    raw.relation_cols = rawRelationCols;
    raw.rel_hetero =
      'rel_hetero' in raw
        ? this.flattenToStrings((raw as any).rel_hetero)
        : rawRelationCols;
    raw.feature = this.flattenToStrings(raw.feature);
    raw.encoding_hints = this.normalizeRawEncodingHints(raw.encoding_hints);

    raw.feature.push(...hiddenFeatures);
    raw.feature_hetero =
      'feature_hetero' in raw
        ? this.flattenToStrings((raw as any).feature_hetero)
        : raw.feature;

    const enforced = this.enforceRules(raw, headers, targetLabel, rows, true);

    this.logger.log(`Schema classified:`);
    this.logger.log(`  node_id      : ${enforced.node_id}`);
    this.logger.log(`  relation_cols: [${enforced.relation_cols.join(', ')}]`);
    this.logger.log(`  rel_hetero   : [${enforced.rel_hetero.join(', ')}]`);
    this.logger.log(
      `  feature (${enforced.feature.length}) : [${enforced.feature.slice(0, 10).join(', ')}${enforced.feature.length > 10 ? ', ...' : ''}]`,
    );
    this.logger.log(
      `  feature_hetero (${enforced.feature_hetero.length}) : [${enforced.feature_hetero.slice(0, 10).join(', ')}${enforced.feature_hetero.length > 10 ? ', ...' : ''}]`,
    );
    this.logger.log(
      `  encoding_hints : ${Object.keys(enforced.encoding_hints).length} column(s)`,
    );

    return enforced;
  }

  /**
   * Đảm bảo list chỉ chứa string. Nếu item là dict {name|column|col|field}
   * thì trích string từ key đó. Nếu là nested list thì flatten.
   * Port nguyên 1-1 từ flatten_to_strings ở pipeline.py.
   */
  flattenToStrings(input: unknown): string[] {
    if (!Array.isArray(input)) return [];
    const result: string[] = [];
    for (const item of input) {
      if (typeof item === 'string') {
        result.push(item);
      } else if (item && typeof item === 'object' && !Array.isArray(item)) {
        const obj = item as Record<string, unknown>;
        for (const key of ['name', 'column', 'col', 'field']) {
          if (key in obj) {
            result.push(String(obj[key]));
            break;
          }
        }
      } else if (Array.isArray(item)) {
        result.push(...this.flattenToStrings(item));
      }
    }
    return result;
  }

  /**
   * Áp luật độc quyền và lọc col không tồn tại trong CSV.
   * Tương đương enforce_schema_rules ở pipeline.py.
   */
  enforceRules(
    schema: Partial<ClassificationSchema>,
    headers: string[],
    targetLabel: string,
    rows: CsvRow[] = [],
    refineRelations = false,
  ): ClassificationSchema {
    const headerSet = new Set(headers);
    const exclude = new Set<string>([targetLabel]);

    let nodeId = schema.node_id ?? null;
    if (nodeId && !headerSet.has(nodeId)) {
      this.logger.warn(`node_id '${nodeId}' không có trong CSV, set null`);
      nodeId = null;
    }
    if (nodeId) exclude.add(nodeId);

    const relationColsInput = (schema.relation_cols ?? []).filter(
      (c) => typeof c === 'string' && headerSet.has(c) && !exclude.has(c),
    );
    const relSet = new Set(relationColsInput);

    const feature = (schema.feature ?? []).filter(
      (c) =>
        typeof c === 'string' &&
        headerSet.has(c) &&
        !exclude.has(c) &&
        !relSet.has(c),
    );

    const relationCols = refineRelations
      ? this.refineRelationCols(relationColsInput, feature, rows)
      : relationColsInput;

    const relHeteroSource = Array.isArray(schema.rel_hetero)
      ? schema.rel_hetero
      : relationCols;
    const relHetero = relHeteroSource.filter(
      (c) => typeof c === 'string' && headerSet.has(c) && !exclude.has(c),
    );
    const relHeteroSet = new Set(relHetero);

    const featureHeteroSource = Array.isArray(schema.feature_hetero)
      ? schema.feature_hetero
      : feature;
    const featureHetero = featureHeteroSource.filter(
      (c) =>
        typeof c === 'string' &&
        headerSet.has(c) &&
        !exclude.has(c) &&
        !relHeteroSet.has(c),
    );

    const encodingHints = this.sanitizeEncodingHints(
      schema.encoding_hints,
      feature,
      rows,
    );

    return {
      node_id: nodeId,
      relation_cols: relationCols,
      rel_hetero: relHetero,
      feature,
      feature_hetero: featureHetero,
      encoding_hints: encodingHints,
    };
  }

  private normalizeRawEncodingHints(
    input: unknown,
  ): Record<string, EncodingHint> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return {};
    }

    const out: Record<string, EncodingHint> = {};
    for (const [col, rawHint] of Object.entries(input)) {
      if (!rawHint || typeof rawHint !== 'object' || Array.isArray(rawHint)) {
        continue;
      }
      const obj = rawHint as Record<string, unknown>;
      const type = String(obj.type ?? '').toLowerCase() as EncodingType;
      if (!this.encodingTypes.has(type)) continue;

      const hint: EncodingHint = { type };
      if (type === 'cyclical') {
        const period = Number(obj.period);
        if (Number.isFinite(period) && period > 0) {
          hint.period = period;
        }
      }
      if (type === 'ordinal') {
        if (Array.isArray(obj.order)) {
          hint.order = obj.order
            .map((v) => String(v).trim())
            .filter((v) => v.length > 0);
        } else if (typeof obj.order === 'string') {
          hint.order = obj.order
            .split(',')
            .map((v) => v.trim())
            .filter((v) => v.length > 0);
        }
      }
      out[col] = hint;
    }
    return out;
  }

  private sanitizeEncodingHints(
    input: unknown,
    featureCols: string[],
    rows: CsvRow[],
  ): Record<string, EncodingHint> {
    const normalized = this.normalizeRawEncodingHints(input);
    const out: Record<string, EncodingHint> = {};

    for (const col of featureCols) {
      const hint = normalized[col] ?? this.inferEncodingHint(col, rows);
      if (hint.type === 'cyclical') {
        const period = Number(hint.period ?? this.defaultCyclePeriod(col));
        out[col] =
          Number.isFinite(period) && period > 0
            ? { type: 'cyclical', period }
            : this.inferEncodingHint(col, rows);
      } else if (hint.type === 'ordinal') {
        const order =
          hint.order && hint.order.length > 0
            ? hint.order
            : this.inferOrdinalOrder(col, rows);
        out[col] = { type: 'ordinal', order };
      } else {
        out[col] = { type: hint.type };
      }
    }

    return out;
  }

  private inferEncodingHint(col: string, rows: CsvRow[]): EncodingHint {
    const name = col.toLowerCase();
    const sample = this.sampleNonEmptyValues(col, rows, 50);

    if (/(date|time|datetime|timestamp)/i.test(name)) {
      const parsed = sample.filter((v) => !Number.isNaN(Date.parse(v)));
      if (sample.length === 0 || parsed.length / sample.length >= 0.7) {
        return { type: 'datetime' };
      }
    }

    const cyclePeriod = this.defaultCyclePeriod(col);
    if (cyclePeriod && /(day|month|week|hour|quarter)/i.test(name)) {
      return { type: 'cyclical', period: cyclePeriod };
    }

    if (sample.length > 0 && sample.every((v) => this.isBinaryLiteral(v))) {
      return { type: 'binary' };
    }

    const numericCount = sample.filter((v) => this.isNumericLiteral(v)).length;
    if (sample.length === 0 || numericCount / sample.length > 0.8) {
      return { type: 'numeric' };
    }

    return { type: 'target' };
  }

  private defaultCyclePeriod(col: string): number | undefined {
    const name = col.toLowerCase();
    if (/hour/.test(name)) return 24;
    if (/day|dow/.test(name)) return 7;
    if (/week_of_month/.test(name)) return 5;
    if (/week/.test(name)) return 52;
    if (/month/.test(name)) return 12;
    if (/quarter/.test(name)) return 4;
    return undefined;
  }

  private inferOrdinalOrder(col: string, rows: CsvRow[]): string[] {
    return this.sampleNonEmptyValues(col, rows, 30);
  }

  private sampleNonEmptyValues(
    col: string,
    rows: CsvRow[],
    limit: number,
  ): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const row of rows) {
      const value = row[col];
      if (value === null || value === undefined || value === '') continue;
      const key = String(value).trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(key);
      if (out.length >= limit) break;
    }
    return out;
  }

  private isBinaryLiteral(value: string): boolean {
    return ['yes', 'y', 'true', 't', '1', 'no', 'n', 'false', 'f', '0'].includes(
      String(value).trim().toLowerCase(),
    );
  }

  private isNumericLiteral(value: string): boolean {
    if (String(value).trim() === '') return false;
    return Number.isFinite(Number(value));
  }

  private refineRelationCols(
    relationCols: string[],
    featureCols: string[],
    rows: CsvRow[],
  ): string[] {
    const featureSet = new Set(featureCols);
    const weakNames = new Set([
      'gender',
      'sex',
      'state',
      'province',
      'country',
      'city',
      'zip',
      'zipcode',
      'postal_code',
    ]);
    const kept: string[] = [];

    for (const col of relationCols) {
      if (featureSet.has(col)) continue;
      if (weakNames.has(col.toLowerCase())) continue;
      const stats = this.columnGroupStats(col, rows);
      if (stats.unique <= 1) continue;
      if (stats.largestGroupRatio > 0.25) continue;
      kept.push(col);
    }

    return kept;
  }

  private columnGroupStats(
    col: string,
    rows: CsvRow[],
  ): { unique: number; largestGroupRatio: number } {
    if (rows.length === 0) return { unique: 0, largestGroupRatio: 0 };
    const counts = new Map<string, number>();
    for (const row of rows) {
      const value = row[col];
      const key =
        value === null || value === undefined || value === ''
          ? '__MISSING__'
          : String(value);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const largest = Math.max(0, ...counts.values());
    return {
      unique: counts.size,
      largestGroupRatio: largest / rows.length,
    };
  }

  // ============================================================
  // PUBLIC: Transaction ID suggestion
  // ============================================================

  /**
   * Gợi ý cột transaction_id bằng LLM.
   *
   * Logic:
   *   1. Tính các cột unique (số giá trị duy nhất = số rows) — phía FE
   *      đã filter nhưng để an toàn ta tính lại ở đây.
   *   2. Gửi headers + sampleValues + uniqueCols sang Colab.
   *   3. Trả về suggestion (null nếu không xác định được).
   */
  async suggestTransactionId(
    headers: string[],
    sampleValues: Record<string, unknown[]>,
    rows: CsvRow[],
  ): Promise<{ suggestion: string | null; uniqueCols: string[] }> {
    // Tính các cột có giá trị unique (distinct count = row count)
    const totalRows = rows.length;
    const uniqueCols: string[] = [];

    for (const col of headers) {
      const distinctValues = new Set<string>();
      let hasNull = false;
      for (const row of rows) {
        const v = row[col];
        if (v === null || v === undefined || v === '') {
          hasNull = true;
          break;
        }
        distinctValues.add(String(v));
      }
      // Cột unique: không null, tất cả giá trị khác nhau
      if (!hasNull && distinctValues.size === totalRows) {
        uniqueCols.push(col);
      }
    }

    if (uniqueCols.length === 0) {
      this.logger.log('No unique columns found, suggestion = null');
      return { suggestion: null, uniqueCols: [] };
    }

    // Gửi sang Colab để LLM chọn cột hợp lý nhất
    try {
      const baseUrl = this.getBaseUrl();
      const timeout = this.getTimeout();
      const { data } = await firstValueFrom(
        this.http.post<{ suggestion: string | null }>(
          `${baseUrl}/suggest-transaction-id`,
          { headers: uniqueCols, sampleValues, uniqueCols },
          { timeout },
        ),
      );
      return { suggestion: data?.suggestion ?? null, uniqueCols };
    } catch (error: any) {
      // Fallback: trả unique col đầu tiên nếu Colab không response
      this.logger.warn(
        `suggest-transaction-id Colab call failed, fallback to first unique col: ${error?.message}`,
      );
      return { suggestion: uniqueCols[0] ?? null, uniqueCols };
    }
  }

  // ============================================================
  // PRIVATE: HTTP call
  // ============================================================

  private async callClassifyEndpoint(
    validColumns: string[],
    sampleValues: Record<string, unknown[]>,
    targetLabel: string,
  ): Promise<Partial<ClassificationSchema>> {
    const baseUrl = this.getBaseUrl();
    const timeout = this.getTimeout();

    try {
      const { data } = await firstValueFrom(
        this.http.post<ClassificationSchema>(
          `${baseUrl}/classify-schema`,
          { validColumns, sampleValues, targetLabel },
          { timeout },
        ),
      );

      if (!data || typeof data !== 'object') {
        throw new Error('Response không phải JSON object');
      }
      const out: Partial<ClassificationSchema> = {
        node_id: (data.node_id as any) ?? null,
        relation_cols: Array.isArray(data.relation_cols)
          ? data.relation_cols
          : [],
        feature: Array.isArray(data.feature) ? data.feature : [],
        encoding_hints: this.normalizeRawEncodingHints(
          (data as any).encoding_hints,
        ),
      };
      if (Array.isArray((data as any).rel_hetero)) {
        out.rel_hetero = (data as any).rel_hetero;
      }
      if (Array.isArray((data as any).feature_hetero)) {
        out.feature_hetero = (data as any).feature_hetero;
      }
      return out;
    } catch (error: any) {
      const msg =
        error?.response?.data?.detail ??
        error?.response?.data?.message ??
        error?.message ??
        'Unknown error';
      this.logger.error(`/classify-schema lỗi: ${msg}`);
      throw new HttpException(
        `Colab classify-schema lỗi: ${msg}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  private getBaseUrl(): string {
    const url = this.config.get<string>('CSV2GRAPH_LLM_URL');
    if (!url) {
      throw new HttpException(
        'CSV2GRAPH_LLM_URL chưa cấu hình trong .env',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    return url.replace(/\/$/, '');
  }

  private getTimeout(): number {
    return Number(this.config.get<string>('CSV2GRAPH_TIMEOUT_MS')) || 300_000;
  }
}
