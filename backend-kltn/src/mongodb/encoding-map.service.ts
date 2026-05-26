import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  EncodingMap,
  EncodingMapDocument,
} from './schemas/encoding-map.schema';

@Injectable()
export class EncodingMapService {
  private readonly logger = new Logger(EncodingMapService.name);

  constructor(
    @InjectModel(EncodingMap.name)
    private readonly model: Model<EncodingMapDocument>,
  ) {}

  async findByDatabase(
    database: string,
  ): Promise<EncodingMapDocument | null> {
    return this.model.findOne({ database }).exec();
  }

  async save(
    database: string,
    maps: Record<string, Record<string, number>>,
  ): Promise<EncodingMapDocument> {
    const doc = await this.model.findOneAndUpdate(
      { database },
      { database, maps },
      { upsert: true, new: true },
    );
    this.logger.log(`EncodingMaps saved for db=${database}`);
    return doc;
  }
}
