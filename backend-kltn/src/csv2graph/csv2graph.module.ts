import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { Neo4jModule } from '../neo4j/neo4j.module';
import { Csv2GraphController } from './csv2graph.controller';
import { Csv2GraphService } from './csv2graph.service';
import { SchemaLlmService } from './schema-llm.service';
import { FeatureService } from './feature.service';
import { StarGraphService } from './star-graph.service';
import { CsvOutputService } from './csv-output.service';
import { Neo4jIngestService } from './neo4j-ingest.service';
import { DataPtService } from './data-pt.service';
import { DatasetMetaService } from './dataset-meta.service';

@Module({
  imports: [HttpModule, ConfigModule, Neo4jModule],
  controllers: [Csv2GraphController],
  providers: [
    Csv2GraphService,
    SchemaLlmService,
    FeatureService,
    StarGraphService,
    CsvOutputService,
    Neo4jIngestService,
    DataPtService,
    DatasetMetaService,
  ],
  exports: [Csv2GraphService, DatasetMetaService],
})
export class Csv2GraphModule {}
