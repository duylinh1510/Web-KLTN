import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Connection,
  ConnectionDocument,
} from './schemas/connection.schema';

@Injectable()
export class ConnectionService {
  private readonly logger = new Logger(ConnectionService.name);

  constructor(
    @InjectModel(Connection.name)
    private readonly model: Model<ConnectionDocument>,
  ) {}

  /**
   * Lưu / cập nhật connection info. Upsert theo `database` (unique key).
   */
  async upsert(uri: string, database: string): Promise<ConnectionDocument> {
    const doc = await this.model.findOneAndUpdate(
      { database },
      { uri, database, lastUsedAt: new Date() },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    this.logger.log(`Connection saved: ${uri} / ${database}`);
    return doc;
  }

  /** Lấy connection gần nhất (theo lastUsedAt) */
  async getLatest(): Promise<ConnectionDocument | null> {
    return this.model.findOne().sort({ lastUsedAt: -1 }).exec();
  }

  /** Touch lastUsedAt */
  async touch(database: string): Promise<void> {
    await this.model.updateOne({ database }, { lastUsedAt: new Date() });
  }
}
