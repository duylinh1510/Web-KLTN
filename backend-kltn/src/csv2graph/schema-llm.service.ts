import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import {
  ClassificationSchema,
  CsvRow,
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

    raw.relation_cols = this.flattenToStrings(raw.relation_cols);
    raw.feature = this.flattenToStrings(raw.feature);

    raw.feature.push(...hiddenFeatures);

    const enforced = this.enforceRules(raw, headers, targetLabel);

    this.logger.log(`Schema classified:`);
    this.logger.log(`  node_id      : ${enforced.node_id}`);
    this.logger.log(
      `  relation_cols: [${enforced.relation_cols.join(', ')}]`,
    );
    this.logger.log(
      `  feature (${enforced.feature.length}) : [${enforced.feature.slice(0, 10).join(', ')}${enforced.feature.length > 10 ? ', ...' : ''}]`,
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
    schema: ClassificationSchema,
    headers: string[],
    targetLabel: string,
  ): ClassificationSchema {
    const headerSet = new Set(headers);
    const exclude = new Set<string>([targetLabel]);

    let nodeId = schema.node_id ?? null;
    if (nodeId && !headerSet.has(nodeId)) {
      this.logger.warn(`node_id '${nodeId}' không có trong CSV, set null`);
      nodeId = null;
    }
    if (nodeId) exclude.add(nodeId);

    const relationCols = (schema.relation_cols ?? []).filter(
      (c) => typeof c === 'string' && headerSet.has(c) && !exclude.has(c),
    );
    const relSet = new Set(relationCols);

    const feature = (schema.feature ?? []).filter(
      (c) =>
        typeof c === 'string' &&
        headerSet.has(c) &&
        !exclude.has(c) &&
        !relSet.has(c),
    );

    return { node_id: nodeId, relation_cols: relationCols, feature };
  }

  // ============================================================
  // PRIVATE: HTTP call
  // ============================================================

  private async callClassifyEndpoint(
    validColumns: string[],
    sampleValues: Record<string, unknown[]>,
    targetLabel: string,
  ): Promise<ClassificationSchema> {
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
      return {
        node_id: (data.node_id as any) ?? null,
        relation_cols: Array.isArray(data.relation_cols)
          ? data.relation_cols
          : [],
        feature: Array.isArray(data.feature) ? data.feature : [],
      };
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
