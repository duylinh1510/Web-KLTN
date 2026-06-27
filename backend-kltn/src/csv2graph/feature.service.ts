import { Injectable, Logger } from '@nestjs/common';
import {
  CsvRow,
  EncodingHint,
  FullSchema,
} from './interfaces/classification-schema.interface';

@Injectable()
export class FeatureService {
  private readonly logger = new Logger(FeatureService.name);
  private readonly cardinalityInfo = 50;

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

  preprocessFeatures(
    rows: CsvRow[],
    featureCols: string[],
    targetLabel = '',
    encodingHints: Record<string, EncodingHint> = {},
  ): {
    encodedRows: CsvRow[];
    encodedFeatureCols: string[];
    encodingMaps: Record<string, Record<string, number>>;
  } {
    const presentCols = featureCols.filter(
      (c) => rows.length > 0 && c in rows[0],
    );
    const encodedRows = rows.map((row) => ({ ...row }));
    const encodedFeatureCols: string[] = [];
    const encodingMaps: Record<string, Record<string, number>> = {};
    const hasTarget = !!targetLabel.trim();
    const globalMean = hasTarget
      ? this.computeGlobalTargetMean(rows, targetLabel)
      : 0.5;

    for (const col of presentCols) {
      const hint = this.normalizeHint(
        encodingHints[col] ?? this.inferEncodingHint(rows, col),
        rows,
        col,
      );

      if (hint.type === 'datetime') {
        encodedFeatureCols.push(...this.encodeDatetimeFeature(encodedRows, col));
      } else if (hint.type === 'cyclical') {
        encodedFeatureCols.push(
          ...this.encodeCyclicalFeature(encodedRows, col, hint.period ?? 0),
        );
      } else if (hint.type === 'binary') {
        for (const row of encodedRows) row[col] = this.boolToFloat(row[col]);
        encodedFeatureCols.push(col);
      } else if (hint.type === 'ordinal') {
        const orderMap = this.buildOrdinalMap(hint.order ?? []);
        for (const row of encodedRows) {
          row[col] = this.ordinalToFloat(row[col], orderMap);
        }
        encodedFeatureCols.push(col);
      } else if (hint.type === 'numeric') {
        for (const row of encodedRows) row[col] = this.toFloat(row[col]);
        encodedFeatureCols.push(col);
      } else {
        encodingMaps[col] = hasTarget
          ? this.buildTargetEncodingMap(rows, col, targetLabel)
          : this.buildFrequencyEncodingMap(rows, col);
        for (const row of encodedRows) {
          row[col] = this.encodeCategory(
            row[col],
            encodingMaps[col],
            globalMean,
          );
        }
        encodedFeatureCols.push(col);

        const uniqueCount = Object.keys(encodingMaps[col]).length;
        if (uniqueCount > this.cardinalityInfo) {
          this.logger.log(
            `Column '${col}' - ${uniqueCount} unique values -> ` +
              (hasTarget ? 'Target Encoding' : 'Frequency Encoding'),
          );
        }
      }
    }

    return { encodedRows, encodedFeatureCols, encodingMaps };
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
    const encodingHints = schema.encoding_hints ?? {};
    const encodingMaps = schema.encoding_maps ?? {};
    const hasHints = Object.keys(encodingHints).length > 0;
    const encodedRows = rows.map((row) => ({ ...row }));

    if (!hasHints) {
      for (const row of encodedRows) {
        for (const col of encodedCols) {
          const map = encodingMaps[col];
          row[col] = map
            ? this.encodeCategory(row[col], map, 0.5)
            : this.boolToFloat(row[col]);
        }
      }
      return { encodedRows, encodedFeatureCols: encodedCols };
    }

    const generatedCols: string[] = [];
    for (const col of schema.feature_cols) {
      if (rows.length === 0 || !(col in rows[0])) continue;
      const hint = this.normalizeHint(
        encodingHints[col] ?? this.inferEncodingHint(rows, col),
        rows,
        col,
      );

      if (hint.type === 'datetime') {
        generatedCols.push(...this.encodeDatetimeFeature(encodedRows, col));
      } else if (hint.type === 'cyclical') {
        generatedCols.push(
          ...this.encodeCyclicalFeature(encodedRows, col, hint.period ?? 0),
        );
      } else if (hint.type === 'binary') {
        for (const row of encodedRows) row[col] = this.boolToFloat(row[col]);
        generatedCols.push(col);
      } else if (hint.type === 'ordinal') {
        const orderMap = this.buildOrdinalMap(hint.order ?? []);
        for (const row of encodedRows) {
          row[col] = this.ordinalToFloat(row[col], orderMap);
        }
        generatedCols.push(col);
      } else if (hint.type === 'numeric') {
        for (const row of encodedRows) row[col] = this.toFloat(row[col]);
        generatedCols.push(col);
      } else {
        const map = encodingMaps[col];
        for (const row of encodedRows) {
          row[col] = map
            ? this.encodeCategory(row[col], map, 0.5)
            : this.toFloat(row[col]);
        }
        generatedCols.push(col);
      }
    }

    return {
      encodedRows,
      encodedFeatureCols: encodedCols.length > 0 ? encodedCols : generatedCols,
    };
  }

  private normalizeHint(
    hint: EncodingHint,
    rows: CsvRow[],
    col: string,
  ): EncodingHint {
    const type = hint?.type;
    if (
      !['numeric', 'binary', 'ordinal', 'cyclical', 'datetime', 'target'].includes(
        type,
      )
    ) {
      return this.inferEncodingHint(rows, col);
    }
    if (type === 'cyclical') {
      const period = Number(hint.period ?? this.defaultCyclePeriod(col));
      return Number.isFinite(period) && period > 0
        ? { type, period }
        : this.inferEncodingHint(rows, col);
    }
    if (type === 'ordinal') {
      return { type, order: hint.order ?? [] };
    }
    return { type };
  }

  private inferEncodingHint(rows: CsvRow[], col: string): EncodingHint {
    const name = col.toLowerCase();
    const sample = this.sampleNonEmptyValues(rows, col, 50);

    if (/(date|time|datetime|timestamp)/.test(name)) {
      const parsed = sample.filter((v) => !Number.isNaN(Date.parse(v)));
      if (sample.length === 0 || parsed.length / sample.length >= 0.7) {
        return { type: 'datetime' };
      }
    }

    const cyclePeriod = this.defaultCyclePeriod(col);
    if (cyclePeriod && /(day|month|week|hour|quarter)/.test(name)) {
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

  private encodeDatetimeFeature(rows: CsvRow[], col: string): string[] {
    const newCols = [
      `${col}_hour_sin`,
      `${col}_hour_cos`,
      `${col}_dow_sin`,
      `${col}_dow_cos`,
      `${col}_month_sin`,
      `${col}_month_cos`,
      `${col}_year`,
    ];

    for (const row of rows) {
      const date = new Date(String(row[col] ?? ''));
      const valid = !Number.isNaN(date.getTime());
      const hour = valid ? date.getHours() : null;
      const dow = valid ? date.getDay() : null;
      const month = valid ? date.getMonth() + 1 : null;
      const [hourSin, hourCos] = this.cyclicalPair(hour, 24);
      const [dowSin, dowCos] = this.cyclicalPair(dow, 7);
      const [monthSin, monthCos] = this.cyclicalPair(month, 12, false);

      row[newCols[0]] = hourSin;
      row[newCols[1]] = hourCos;
      row[newCols[2]] = dowSin;
      row[newCols[3]] = dowCos;
      row[newCols[4]] = monthSin;
      row[newCols[5]] = monthCos;
      row[newCols[6]] = valid ? date.getFullYear() : 0;
    }

    return newCols;
  }

  private encodeCyclicalFeature(
    rows: CsvRow[],
    col: string,
    period: number,
  ): string[] {
    const sinCol = `${col}_sin`;
    const cosCol = `${col}_cos`;
    for (const row of rows) {
      const parsed = this.parseCycleValue(row[col], period, col);
      const [sin, cos] = this.cyclicalPair(
        parsed.value,
        period,
        parsed.zeroBased,
      );
      row[sinCol] = sin;
      row[cosCol] = cos;
    }
    return [sinCol, cosCol];
  }

  private cyclicalPair(
    raw: number | null,
    period: number,
    zeroBased = true,
  ): [number, number] {
    if (raw === null || !Number.isFinite(raw) || period <= 0) return [0, 0];
    const value = zeroBased ? raw : raw - 1;
    const angle = (2 * Math.PI * (((value % period) + period) % period)) / period;
    return [Math.sin(angle), Math.cos(angle)];
  }

  private parseCycleValue(
    raw: unknown,
    period: number,
    col: string,
  ): { value: number | null; zeroBased: boolean } {
    const lower = String(raw ?? '').trim().toLowerCase();
    const dayMap: Record<string, number> = {
      mon: 0,
      monday: 0,
      tue: 1,
      tuesday: 1,
      wed: 2,
      wednesday: 2,
      thu: 3,
      thursday: 3,
      fri: 4,
      friday: 4,
      sat: 5,
      saturday: 5,
      sun: 6,
      sunday: 6,
    };
    const monthMap: Record<string, number> = {
      jan: 1,
      january: 1,
      feb: 2,
      february: 2,
      mar: 3,
      march: 3,
      apr: 4,
      april: 4,
      may: 5,
      jun: 6,
      june: 6,
      jul: 7,
      july: 7,
      aug: 8,
      august: 8,
      sep: 9,
      sept: 9,
      september: 9,
      oct: 10,
      october: 10,
      nov: 11,
      november: 11,
      dec: 12,
      december: 12,
    };

    if (period === 7 && lower in dayMap) {
      return { value: dayMap[lower], zeroBased: true };
    }
    if (period === 12 && lower in monthMap) {
      return { value: monthMap[lower], zeroBased: false };
    }

    const numeric = Number(lower);
    if (!Number.isFinite(numeric)) return { value: null, zeroBased: true };
    return {
      value: numeric,
      zeroBased: !(period === 12 && /month/.test(col.toLowerCase())),
    };
  }

  private buildOrdinalMap(order: string[]): Map<string, number> {
    const map = new Map<string, number>();
    order.forEach((value, index) => {
      map.set(String(value).trim().toLowerCase(), index);
    });
    return map;
  }

  private ordinalToFloat(value: unknown, map: Map<string, number>): number {
    const key = String(value ?? '').trim().toLowerCase();
    return map.get(key) ?? -1;
  }

  private encodeCategory(
    raw: unknown,
    map: Record<string, number>,
    fallback: number,
  ): number {
    const key =
      raw === null || raw === undefined || raw === '' ? '__MISSING__' : String(raw);
    return map[key] ?? map['__MISSING__'] ?? fallback;
  }

  private buildTargetEncodingMap(
    rows: CsvRow[],
    col: string,
    targetLabel: string,
  ): Record<string, number> {
    const sumMap = new Map<string, number>();
    const countMap = new Map<string, number>();
    let globalSum = 0;
    let globalCount = 0;

    for (const row of rows) {
      const key =
        row[col] === null || row[col] === undefined || row[col] === ''
          ? '__MISSING__'
          : String(row[col]);
      const targetVal = this.toFloat(row[targetLabel]);
      sumMap.set(key, (sumMap.get(key) ?? 0) + targetVal);
      countMap.set(key, (countMap.get(key) ?? 0) + 1);
      globalSum += targetVal;
      globalCount++;
    }

    const globalMean = globalCount > 0 ? globalSum / globalCount : 0;
    const map: Record<string, number> = {};
    for (const [key, sum] of sumMap.entries()) {
      map[key] = sum / (countMap.get(key) ?? 1);
    }
    if (!('__MISSING__' in map)) map['__MISSING__'] = globalMean;
    return map;
  }

  private buildFrequencyEncodingMap(
    rows: CsvRow[],
    col: string,
  ): Record<string, number> {
    const countMap = new Map<string, number>();
    const n = rows.length;
    for (const row of rows) {
      const key =
        row[col] === null || row[col] === undefined || row[col] === ''
          ? '__MISSING__'
          : String(row[col]);
      countMap.set(key, (countMap.get(key) ?? 0) + 1);
    }

    const map: Record<string, number> = {};
    for (const [key, count] of countMap.entries()) {
      map[key] = n > 0 ? count / n : 0;
    }
    if (!('__MISSING__' in map)) map['__MISSING__'] = 0;
    return map;
  }

  private computeGlobalTargetMean(rows: CsvRow[], targetLabel: string): number {
    if (!targetLabel) return 0.5;
    let sum = 0;
    let count = 0;
    for (const row of rows) {
      const value = row[targetLabel];
      if (value !== null && value !== undefined && value !== '') {
        sum += this.toFloat(value);
        count++;
      }
    }
    return count > 0 ? sum / count : 0.5;
  }

  private sampleNonEmptyValues(
    rows: CsvRow[],
    col: string,
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
    return String(value).trim() !== '' && Number.isFinite(Number(value));
  }

  private toFloat(value: unknown): number {
    if (value === null || value === undefined || value === '') return 0;
    if (typeof value === 'number') return Number.isNaN(value) ? 0 : value;
    if (typeof value === 'boolean') return value ? 1 : 0;
    const parsed = Number(String(value));
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  private boolToFloat(value: unknown): number {
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (value === null || value === undefined || value === '') return 0;
    const lower = String(value).trim().toLowerCase();
    if (['yes', 'y', 'true', 't', '1'].includes(lower)) return 1;
    if (['no', 'n', 'false', 'f', '0'].includes(lower)) return 0;
    return this.toFloat(value);
  }
}
