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
import { parse } from 'csv-parse/sync';
import { Neo4jService } from '../neo4j/neo4j.service';
import { Csv2GraphService } from './csv2graph.service';
import { SchemaLlmService } from './schema-llm.service';
import { DatasetMetaService } from './dataset-meta.service';
import { Csv2GraphRunDto } from './dto/csv2graph-run.dto';
import type { CsvRow } from './interfaces/classification-schema.interface';

type UploadedCsvFile = {
  originalname: string;
  buffer?: Buffer;
};

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
        fileSize: 500 * 1024 * 1024,
      },
    }),
  )
  async run(
    @UploadedFile() file: UploadedCsvFile | undefined,
    @Body() dto: Csv2GraphRunDto,
  ) {
    if (!file) {
      throw new HttpException(
        'Thieu file CSV (field name: "file")',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!file.buffer || file.buffer.length === 0) {
      throw new HttpException('File CSV rong', HttpStatus.BAD_REQUEST);
    }

    const result = await this.csv2graphService.run(
      file.buffer,
      file.originalname,
      dto,
    );

    return { status: 'success', ...result };
  }

  @Post('preview-schema')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 500 * 1024 * 1024 } }),
  )
  async previewSchema(
    @UploadedFile() file: UploadedCsvFile | undefined,
    @Body('targetLabel') targetLabel?: string,
  ) {
    if (!file?.buffer || file.buffer.length === 0) {
      throw new HttpException('Thieu file CSV', HttpStatus.BAD_REQUEST);
    }

    const { rows, headers } = this.parseCsvBuffer(file.buffer);
    if (rows.length === 0 || headers.length === 0) {
      throw new HttpException('File CSV rong', HttpStatus.BAD_REQUEST);
    }

    const schema = await this.schemaLlm.analyzeSchema(
      rows,
      headers,
      targetLabel?.trim() ?? '',
    );

    return {
      status: 'success',
      schema,
      headers,
      sampleValues: this.buildSampleValues(rows, headers),
      uniqueCols: this.findUniqueColumns(rows, headers),
      encodingOptions: [
        'numeric',
        'binary',
        'ordinal',
        'cyclical',
        'datetime',
        'target',
      ],
    };
  }

  @Get('dataset-info')
  async datasetInfo() {
    if (!this.neo4j.getStatus().connected) {
      throw new HttpException(
        'Vui long ket noi Database truoc!',
        HttpStatus.BAD_REQUEST,
      );
    }
    const database = this.neo4j.getCurrentDatabase();
    const info = await this.datasetMeta.getDatasetInfo(database);
    return { status: 'success', ...info };
  }

  @Post('suggest-transaction-id')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 500 * 1024 * 1024 } }),
  )
  async suggestTransactionId(
    @UploadedFile() file: UploadedCsvFile | undefined,
  ) {
    if (!file?.buffer || file.buffer.length === 0) {
      throw new HttpException('Thieu file CSV', HttpStatus.BAD_REQUEST);
    }

    const { rows, headers } = this.parseCsvBuffer(file.buffer);
    if (rows.length === 0 || headers.length === 0) {
      return { status: 'success', suggestion: null, uniqueCols: [] };
    }

    const result = await this.schemaLlm.suggestTransactionId(
      headers,
      this.buildSampleValues(rows, headers),
      rows,
    );

    return { status: 'success', ...result };
  }

  private parseCsvBuffer(buffer: Buffer): { rows: CsvRow[]; headers: string[] } {
    try {
      const rows = parse(buffer, {
        columns: true,
        skip_empty_lines: true,
        bom: true,
        trim: true,
        relax_quotes: true,
        relax_column_count: true,
      }) as CsvRow[];
      return {
        rows,
        headers: rows.length > 0 ? Object.keys(rows[0]) : [],
      };
    } catch (e: any) {
      throw new HttpException(
        `Doc CSV loi: ${e?.message ?? e}`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private buildSampleValues(
    rows: CsvRow[],
    headers: string[],
  ): Record<string, unknown[]> {
    const sampleValues: Record<string, unknown[]> = {};
    for (const col of headers) {
      const seen = new Set<string>();
      const samples: unknown[] = [];
      for (const row of rows) {
        const value = row[col];
        if (value === null || value === undefined || value === '') continue;
        const key = String(value);
        if (seen.has(key)) continue;
        seen.add(key);
        samples.push(value);
        if (samples.length >= 5) break;
      }
      sampleValues[col] = samples;
    }
    return sampleValues;
  }

  private findUniqueColumns(rows: CsvRow[], headers: string[]): string[] {
    const uniqueCols: string[] = [];
    for (const col of headers) {
      const distinct = new Set<string>();
      let hasNull = false;
      for (const row of rows) {
        const value = row[col];
        if (value === null || value === undefined || value === '') {
          hasNull = true;
          break;
        }
        distinct.add(String(value));
      }
      if (!hasNull && distinct.size === rows.length) {
        uniqueCols.push(col);
      }
    }
    return uniqueCols;
  }
}
