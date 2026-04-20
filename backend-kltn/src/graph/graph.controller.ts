import { Controller, Post, Body, Inject } from '@nestjs/common';
import { Neo4jService } from '../neo4j/neo4j.service';
import type { IAiService } from '../ai/ai.interface';
import { AI_SERVICE_TOKEN } from '../ai/ai.interface';
import { formatRecords } from './graph.formatter';
import { QueryDto } from './dto/query.dto';

@Controller('graph')
export class GraphController {
  constructor(
    private readonly neo4jService: Neo4jService,
    @Inject(AI_SERVICE_TOKEN) private readonly aiService: IAiService,
  ) {}

  @Post('query')
  async processNaturalLanguage(@Body() dto: QueryDto) {
    let cypherQuery: string;
    try {
      cypherQuery = await this.aiService.generateCypher(dto.prompt);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { status: 'Lỗi', message: `AI failed to generate Cypher: ${msg}` };
    }

    const session = this.neo4jService.getReadSession();
    try {
      const result = await session.run(cypherQuery);
      const { nodes, links, scalars } = formatRecords(result.records);

      return {
        status: 'Thành công',
        generatedCypher: cypherQuery,
        graphData: { nodes, links },
        scalars,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { status: 'Lỗi', message: msg };
    } finally {
      await session.close();
    }
  }
}
