import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  PipelineConfig,
  PipelineConfigDocument,
} from './schemas/pipeline-config.schema';

@Injectable()
export class PipelineConfigService {
  private readonly logger = new Logger(PipelineConfigService.name);

  constructor(
    @InjectModel(PipelineConfig.name)
    private readonly model: Model<PipelineConfigDocument>,
  ) {}

  async findByDatabase(
    database: string,
  ): Promise<PipelineConfigDocument | null> {
    return this.model.findOne({ database }).exec();
  }

  async save(
    database: string,
    config: Partial<PipelineConfig>,
  ): Promise<PipelineConfigDocument> {
    const doc = await this.model.findOneAndUpdate(
      { database },
      { ...config, database },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    this.logger.log(`PipelineConfig saved for db=${database}`);
    return doc;
  }
}
