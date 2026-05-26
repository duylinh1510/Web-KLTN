import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { HistoryService } from './history.service';

@Controller('history')
export class HistoryController {
  constructor(private readonly historyService: HistoryService) {}

  @Post()
  async save(
    @Body()
    body: {
      database: string;
      prompt: string;
      cypher?: string;
      graphData?: Record<string, unknown>;
      scalars?: Record<string, unknown>[];
      metadata?: Record<string, unknown>;
      error?: string;
    },
  ) {
    const doc = await this.historyService.save(body);
    return { status: 'ok', id: doc._id };
  }

  @Get()
  async list(
    @Query('database') database: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const result = await this.historyService.list(
      database || 'neo4j',
      limit ? parseInt(limit, 10) : 50,
      offset ? parseInt(offset, 10) : 0,
    );
    return result;
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const ok = await this.historyService.remove(id);
    return { status: ok ? 'ok' : 'not_found' };
  }

  @Delete()
  async clear(@Query('database') database: string) {
    const count = await this.historyService.clear(database || 'neo4j');
    return { status: 'ok', deleted: count };
  }
}
