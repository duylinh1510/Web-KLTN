import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Query, QueryDocument } from '../mongodb/schemas/query.schema';

@Injectable()
export class HistoryService {
  private readonly logger = new Logger(HistoryService.name);

  constructor(
    @InjectModel(Query.name)
    private readonly model: Model<QueryDocument>,
  ) {}

  async save(data: {
    database: string;
    prompt: string;
    cypher?: string;
    graphData?: Record<string, unknown>;
    scalars?: Record<string, unknown>[];
    metadata?: Record<string, unknown>;
    error?: string;
  }): Promise<QueryDocument> {
    const doc = await this.model.create(data);
    this.logger.log(`Query saved for db=${data.database}: "${data.prompt.slice(0, 50)}..."`);
    return doc;
  }

  async list(
    database: string,
    limit = 50,
    offset = 0,
  ): Promise<{ entries: QueryDocument[]; total: number }> {
    const [entries, total] = await Promise.all([
      this.model
        .find({ database })
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .exec(),
      this.model.countDocuments({ database }),
    ]);
    return { entries, total };
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.model.deleteOne({ _id: id });
    return result.deletedCount > 0;
  }

  async clear(database: string): Promise<number> {
    const result = await this.model.deleteMany({ database });
    this.logger.log(`Cleared ${result.deletedCount} queries for db=${database}`);
    return result.deletedCount;
  }
}
