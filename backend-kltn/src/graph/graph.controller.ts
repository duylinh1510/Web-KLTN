import {
  Controller,
  Post,
  Get,
  Body,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Neo4jService } from '../neo4j/neo4j.service';
import { Text2CypherService } from '../text2cypher/text2cypher.service';
import { DatasetMetaService } from '../csv2graph/dataset-meta.service';
import { formatRecords } from './graph.formatter';
import { QueryDto } from './dto/query.dto';

@Controller('graph')
export class GraphController {
  constructor(
    private readonly neo4jService: Neo4jService,
    private readonly text2CypherService: Text2CypherService,
    private readonly datasetMeta: DatasetMetaService,
  ) {}

  @Post('query')
  async processNaturalLanguage(@Body() dto: QueryDto) {
    // 1. Schema Linking + Self-Correction → lấy Cypher đã validated
    const result = await this.text2CypherService.generateCypher(dto.prompt);

    if (!result.success) {
      throw new HttpException(
        {
          status: 'error',
          message: 'Không thể tạo Cypher query hợp lệ sau khi tự sửa',
          generatedCypher: result.finalCypher,
          retries: result.retries,
          errors: result.errors,
          cypherV1: result.cypherV1,
          cypherV2: result.cypherV2,
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // 2. Execute Cypher đã validated
    const session = this.neo4jService.getReadSession();
    try {
      const queryResult = await session.run(result.finalCypher);
      const { nodes, links, scalars } = formatRecords(queryResult.records);

      return {
        status: 'success',
        generatedCypher: result.finalCypher,
        graphData: { nodes, links },
        scalars,
        metadata: {
          retries: result.retries,
          cypherV1: result.cypherV1,
          cypherV2: result.cypherV2,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new HttpException(
        `Cypher execution error: ${msg}`,
        HttpStatus.BAD_REQUEST,
      );
    } finally {
      await session.close();
    }
  }

  /**
   * GET /graph/preview
   *
   * Auto-render 10 transaction đầu + neighbors khi FE vừa connect / build xong.
   * Dùng nodeLabel canonical trong dataset metadata; nếu chưa có metadata
   * (DB rỗng) → 400 để FE biết hiển thị NoDatasetBlocker.
   */
  @Get('preview')
  async preview() {
    if (!this.neo4jService.getStatus().connected) {
      throw new HttpException(
        'Vui lòng kết nối Database trước!',
        HttpStatus.BAD_REQUEST,
      );
    }
    const dbId = this.neo4jService.getDbId();
    const meta = this.datasetMeta.loadLatest(dbId);
    if (!meta) {
      throw new HttpException(
        'Database rỗng, vui lòng upload CSV trước',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(meta.nodeLabel)) {
      throw new HttpException(
        `nodeLabel canonical '${meta.nodeLabel}' không hợp lệ`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const session = this.neo4jService.getReadSession();
    try {
      const cypher = `
        MATCH (n:${meta.nodeLabel})
        WITH n LIMIT 10
        OPTIONAL MATCH (n)-[r]-(m:${meta.nodeLabel})
        RETURN n, r, m
      `;
      const result = await session.run(cypher);
      const { nodes, links, scalars } = formatRecords(result.records);

      return {
        status: 'success',
        nodeLabel: meta.nodeLabel,
        graphData: { nodes, links },
        scalars,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new HttpException(
        `Preview Cypher execution error: ${msg}`,
        HttpStatus.BAD_REQUEST,
      );
    } finally {
      await session.close();
    }
  }
}
