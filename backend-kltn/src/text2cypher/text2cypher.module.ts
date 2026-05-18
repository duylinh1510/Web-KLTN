import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { Neo4jModule } from '../neo4j/neo4j.module';
import { Text2CypherService } from './text2cypher.service';
import { SchemaService } from './schema.service';
import { Csv2GraphModule } from '../csv2graph/csv2graph.module';

@Module({
  imports: [HttpModule, ConfigModule, Neo4jModule, Csv2GraphModule],
  providers: [Text2CypherService, SchemaService],
  exports: [Text2CypherService, SchemaService],
})
export class Text2CypherModule {}
