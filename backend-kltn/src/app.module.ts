import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { Neo4jModule } from './neo4j/neo4j.module';
import { GraphModule } from './graph/graph.module';
import { AiModule } from './ai/ai.module';
import { Text2CypherModule } from './text2cypher/text2cypher.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Csv2GraphModule } from './csv2graph/csv2graph.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    Neo4jModule,
    GraphModule,
    AiModule,
    Text2CypherModule,
    Csv2GraphModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
