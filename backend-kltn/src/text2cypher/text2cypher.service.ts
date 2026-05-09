import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { Neo4jService } from '../neo4j/neo4j.service';
import { SchemaService } from './schema.service';
import { DatasetMetaService } from '../csv2graph/dataset-meta.service';
import { Text2CypherResult, CorrectionResult } from './dto/text2cypher-result.dto';

@Injectable()
export class Text2CypherService {
  private readonly maxRetries = 3;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly neo4jService: Neo4jService,
    private readonly schemaService: SchemaService,
    private readonly datasetMeta: DatasetMetaService,
  ) {}

  // ============================================================
  // PUBLIC: Hàm tổng — gọi Schema Linking + Self Correction
  // ============================================================

  async generateCypher(question: string): Promise<Text2CypherResult> {
    // Guard: chặn khi DB rỗng — Text2Cypher không có gì để query.
    const totalNodes = await this.datasetMeta.countAllNodes();
    if (totalNodes === 0) {
      throw new HttpException(
        'Database rỗng, vui lòng upload CSV trước',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Bước 1: Schema Linking → ra cypher_v2
    const schemaLinkingResult = await this.generateWithSchemaLinking(question);

    if (!schemaLinkingResult.cypherV2 || schemaLinkingResult.cypherV2 === 'error') {
      return {
        finalCypher: schemaLinkingResult.cypherV2 ?? 'error',
        success: false,
        retries: 0,
        errors: ['Schema linking failed to generate valid cypher'],
        schemaUsed: schemaLinkingResult.schemaUsed,
        cypherV1: schemaLinkingResult.cypherV1,
        cypherV2: schemaLinkingResult.cypherV2,
      };
    }

    // Bước 2: Self Correction Loop
    const correctionResult = await this.selfCorrectionLoop(
      schemaLinkingResult.cypherV2,
      schemaLinkingResult.schemaUsed,
      question,
    );

    return {
      finalCypher: correctionResult.finalCypher,
      success: correctionResult.success,
      retries: correctionResult.retries,
      errors: correctionResult.errors,
      schemaUsed: schemaLinkingResult.schemaUsed,
      cypherV1: schemaLinkingResult.cypherV1,
      cypherV2: schemaLinkingResult.cypherV2,
    };
  }

  // ============================================================
  // Schema Linking: chỉ gọi /generate 2 lần, KHÔNG có self-correction
  // ============================================================

  async generateWithSchemaLinking(
    question: string,
  ): Promise<{ cypherV1: string; cypherV2: string; schemaUsed: string }> {
    // 1. Lấy full schema (từ cache hoặc Neo4j)
    const fullSchema = await this.schemaService.getFullSchema();

    console.log('[Text2Cypher] --- SCHEMA LINKING ---');
    console.log('[Text2Cypher] Full schema length:', fullSchema.length, 'chars');

    // 2. Gọi /generate LẦN 1 (full schema)
    console.log('[Text2Cypher] Calling /generate LẦN 1 (full schema)...');
    const cypherV1 = await this.callColabGenerate(question, fullSchema);
    console.log('[Text2Cypher] Cypher V1:', cypherV1);

    if (!cypherV1 || cypherV1 === 'error') {
      return { cypherV1: cypherV1 ?? 'error', cypherV2: 'error', schemaUsed: fullSchema };
    }

    // 3. Schema Linking: filter schema theo cypher_v1
    const linkedSchema = this.schemaService.filterSchemaByQuery(cypherV1, fullSchema);
    console.log('[Text2Cypher] Linked schema length:', linkedSchema.length, 'chars');

    // 4. Gọi /generate LẦN 2 (linked schema)
    console.log('[Text2Cypher] Calling /generate LẦN 2 (linked schema)...');
    const cypherV2 = await this.callColabGenerate(question, linkedSchema);
    console.log('[Text2Cypher] Cypher V2:', cypherV2);

    return { cypherV1, cypherV2: cypherV2 ?? 'error', schemaUsed: linkedSchema };
  }

  // ============================================================
  // Self-Correction Loop: EXPLAIN → nếu lỗi → gọi /correct → retry
  // ============================================================

  async selfCorrectionLoop(
    initialCypher: string,
    schema: string,
    question: string,
  ): Promise<CorrectionResult> {
    let currentCypher = initialCypher;
    let retry = 0;
    const errors: string[] = [];

    console.log('[Text2Cypher] --- SELF-CORRECTION LOOP ---');

    while (retry < this.maxRetries) {
      // Execute EXPLAIN
      console.log(`[Text2Cypher] EXPLAIN attempt ${retry + 1}/${this.maxRetries}...`);
      const { success, error } = await this.neo4jService.executeCypherExplain(currentCypher);

      if (success) {
        console.log(`[Text2Cypher] EXPLAIN passed! (retries: ${retry})`);
        return { success: true, finalCypher: currentCypher, retries: retry, errors };
      }

      // Record error
      const errorMsg = `Retry ${retry}: ${error}`;
      errors.push(errorMsg);
      console.log(`[Text2Cypher] EXPLAIN failed: ${error}`);

      // Gọi /correct để sửa
      console.log('[Text2Cypher] Calling /correct...');
      const corrected = await this.callColabCorrect(question, schema, currentCypher, error!);

      if (!corrected || corrected === 'error') {
        console.log('[Text2Cypher] Correction failed, breaking loop');
        break;
      }

      console.log('[Text2Cypher] Corrected cypher:', corrected);
      currentCypher = corrected;
      retry++;
    }

    // Failure sau max retries
    console.log(`[Text2Cypher] Self-correction FAILED after ${retry} retries`);
    return { success: false, finalCypher: currentCypher, retries: retry, errors };
  }

  // ============================================================
  // PRIVATE: HTTP helpers gọi Colab API
  // ============================================================

  private async callColabGenerate(question: string, schema: string): Promise<string> {
    const baseUrl = this.getBaseUrl();
    const timeout = this.getTimeout();

    try {
      const { data } = await firstValueFrom(
        this.http.post(`${baseUrl}/generate`, { question, schema }, { timeout }),
      );

      const cypher = typeof data === 'string' ? data : data?.cypher;
      if (!cypher || typeof cypher !== 'string') {
        console.log('[Text2Cypher] /generate response missing cypher field');
        return 'error';
      }

      return cypher.replace(/\\n/g, '\n').trim();
    } catch (error: any) {
      const msg = error?.response?.data?.message ?? error?.message ?? 'Unknown error';
      console.log(`[Text2Cypher] /generate error: ${msg}`);
      throw new HttpException(`AI Engine lỗi: ${msg}`, HttpStatus.BAD_GATEWAY);
    }
  }

  private async callColabCorrect(
    question: string,
    schema: string,
    wrongCypher: string,
    errorLog: string,
  ): Promise<string> {
    const baseUrl = this.getBaseUrl();
    const timeout = this.getTimeout();

    try {
      const { data } = await firstValueFrom(
        this.http.post(
          `${baseUrl}/correct`,
          { question, schema, wrong_cypher: wrongCypher, error_log: errorLog },
          { timeout },
        ),
      );

      const cypher = typeof data === 'string' ? data : data?.cypher;
      if (!cypher || typeof cypher !== 'string') {
        return 'error';
      }

      return cypher.replace(/\\n/g, '\n').trim();
    } catch (error: any) {
      const msg = error?.response?.data?.message ?? error?.message ?? 'Unknown error';
      console.log(`[Text2Cypher] /correct error: ${msg}`);
      return 'error';
    }
  }

  private getBaseUrl(): string {
    const url = this.config.get<string>('TEXT2CYPHER_URL');
    if (!url) {
      throw new HttpException(
        'TEXT2CYPHER_URL chưa cấu hình trong .env',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    return url;
  }

  private getTimeout(): number {
    return Number(this.config.get<string>('AI_TIMEOUT_MS')) || 180_000;
  }
}
