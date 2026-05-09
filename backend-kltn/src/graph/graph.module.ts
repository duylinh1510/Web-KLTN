import { Module } from '@nestjs/common';
import { GraphController } from './graph.controller';
import { Neo4jModule } from '../neo4j/neo4j.module';
import { Text2CypherModule } from '../text2cypher/text2cypher.module';
import { Csv2GraphModule } from '../csv2graph/csv2graph.module';

@Module({
  imports: [Neo4jModule, Text2CypherModule, Csv2GraphModule],
  controllers: [GraphController],
})
export class GraphModule {}