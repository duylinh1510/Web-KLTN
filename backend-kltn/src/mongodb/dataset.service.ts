import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Dataset, DatasetDocument } from './schemas/dataset.schema';

@Injectable()
export class DatasetService {
  private readonly logger = new Logger(DatasetService.name);

  constructor(
    @InjectModel(Dataset.name)
    private readonly model: Model<DatasetDocument>,
  ) {}

  async findByDatabase(database: string): Promise<DatasetDocument | null> {
    return this.model.findOne({ database }).exec();
  }

  async upsert(
    database: string,
    data: Partial<Dataset>,
  ): Promise<DatasetDocument> {
    const doc = await this.model.findOneAndUpdate(
      { database },
      { ...data, database },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    this.logger.log(`Dataset upserted for db=${database}`);
    return doc;
  }

  /** Cập nhật graphSchema (cache cho Text2Cypher) */
  async updateGraphSchema(
    database: string,
    schemaText: string,
  ): Promise<void> {
    await this.model.updateOne(
      { database },
      { graphSchema: schemaText, database },
      { upsert: true },
    );
    this.logger.log(`GraphSchema cached for db=${database}`);
  }

  /** Cập nhật model info sau khi train xong */
  async updateModelInfo(
    database: string,
    info: {
      hasModel: boolean;
      activeModelPath?: string;
      inferenceThreshold?: number | null;
      trainingMetrics?: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.model.updateOne({ database }, { ...info });
  }
}
