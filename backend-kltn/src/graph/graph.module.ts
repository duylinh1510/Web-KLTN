import { Module } from '@nestjs/common';
import { GraphController } from './graph.controller';
import { Neo4jModule } from '../neo4j/neo4j.module';
import { AiModule } from '../ai/ai.module';
@Module({
  imports: [Neo4jModule, AiModule],
  controllers: [GraphController],
})
export class GraphModule {}