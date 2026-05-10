import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Neo4jService } from '../neo4j/neo4j.service';
import { Csv2GraphService } from './csv2graph.service';
import { SchemaLlmService } from './schema-llm.service';
import { DatasetMetaService } from './dataset-meta.service';
import { Csv2GraphRunDto } from './dto/csv2graph-run.dto';
import { parse } from 'csv-parse/sync';
import type { CsvRow } from './interfaces/classification-schema.interface';

@Controller('csv2graph')
export class Csv2GraphController {
  constructor(
    private readonly csv2graphService: Csv2GraphService,
    private readonly schemaLlm: SchemaLlmService,
    private readonly datasetMeta: DatasetMetaService,
    private readonly neo4j: Neo4jService,
  ) {}

  @Post('run')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 200 * 1024 * 1024,
      },
    }),
  )
  async run(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: Csv2GraphRunDto,
  ) {
    if (!file) {
      throw new HttpException(
        'Thiếu file CSV (field name: "file")',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!file.buffer || file.buffer.length === 0) {
      throw new HttpException('File CSV rỗng', HttpStatus.BAD_REQUEST);
    }

    const result = await this.csv2graphService.run(
      file.buffer,
      file.originalname,
      dto,
    );

    return { status: 'success', ...result };
  }

  /**
   * GET /csv2graph/dataset-info
   * Cho FE biết DB hiện tại đã có data chưa + canonical columns.
   * Yêu cầu connect Neo4j (Neo4jService.getReadSession sẽ throw 400 nếu chưa).
   */
  @Get('dataset-info')
  async datasetInfo() {
    if (!this.neo4j.getStatus().connected) {
      throw new HttpException(
        'Vui lòng kết nối Database trước!',
        HttpStatus.BAD_REQUEST,
      );
    }
    const dbId = this.neo4j.getDbId();
    const info = await this.datasetMeta.getDatasetInfo(dbId);
    return { status: 'success', ...info };
  }

  /**
   * POST /csv2graph/suggest-transaction-id
   *
   * Nhận file CSV (multipart), phân tích cột unique, gửi sang Colab LLM
   * để gợi ý cột nào là transaction_id.
   *
   * Response:
   *   { suggestion: string | null, uniqueCols: string[] }
   *
   * uniqueCols: các cột mà mọi giá trị đều duy nhất (dùng cho dropdown).
   * suggestion: cột LLM cho là transaction_id khả năng nhất.
   */
  @Post('suggest-transaction-id')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 200 * 1024 * 1024 } }),
  )
  async suggestTransactionId(
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file?.buffer || file.buffer.length === 0) {
      throw new HttpException('Thiếu file CSV', HttpStatus.BAD_REQUEST);
    }

    // Parse CSV (giống csv2graph.service.ts)
    let rows: CsvRow[];
    let headers: string[];
    try {
      rows = parse(file.buffer, {
        columns: true,
        skip_empty_lines: true,
        bom: true,
        trim: true,
        relax_quotes: true,
        relax_column_count: true,
      }) as CsvRow[];
      headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    } catch (e: any) {
      throw new HttpException(
        `Đọc CSV lỗi: ${e?.message ?? e}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    if (rows.length === 0 || headers.length === 0) {
      return { status: 'success', suggestion: null, uniqueCols: [] };
    }

    // Lấy 5 sample values per column
    const sampleValues: Record<string, unknown[]> = {};
    for (const col of headers) {
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

    const result = await this.schemaLlm.suggestTransactionId(
      headers,
      sampleValues,
      rows,
    );

    return { status: 'success', ...result };
  }
}
