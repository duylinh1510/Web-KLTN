import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

import { Connection, ConnectionSchema } from './schemas/connection.schema';
import { Dataset, DatasetSchema } from './schemas/dataset.schema';
import {
  PipelineConfig,
  PipelineConfigSchema,
} from './schemas/pipeline-config.schema';
import {
  EncodingMap,
  EncodingMapSchema,
} from './schemas/encoding-map.schema';
import {
  PipelineRun,
  PipelineRunSchema,
} from './schemas/pipeline-run.schema';
import { Query, QuerySchema } from './schemas/query.schema';

import { ConnectionService } from './connection.service';
import { DatasetService } from './dataset.service';
import { PipelineConfigService } from './pipeline-config.service';
import { EncodingMapService } from './encoding-map.service';
import { PipelineRunService } from './pipeline-run.service';

@Global()
@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGODB_URI'),
      }),
      inject: [ConfigService],
    }),
    MongooseModule.forFeature([
      { name: Connection.name, schema: ConnectionSchema },
      { name: Dataset.name, schema: DatasetSchema },
      { name: PipelineConfig.name, schema: PipelineConfigSchema },
      { name: EncodingMap.name, schema: EncodingMapSchema },
      { name: PipelineRun.name, schema: PipelineRunSchema },
      { name: Query.name, schema: QuerySchema },
    ]),
  ],
  providers: [
    ConnectionService,
    DatasetService,
    PipelineConfigService,
    EncodingMapService,
    PipelineRunService,
  ],
  exports: [
    ConnectionService,
    DatasetService,
    PipelineConfigService,
    EncodingMapService,
    PipelineRunService,
    MongooseModule,
  ],
})
export class MongoDbModule {}
