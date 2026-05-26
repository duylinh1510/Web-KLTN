import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  PipelineRun,
  PipelineRunDocument,
} from './schemas/pipeline-run.schema';

@Injectable()
export class PipelineRunService {
  private readonly logger = new Logger(PipelineRunService.name);

  constructor(
    @InjectModel(PipelineRun.name)
    private readonly model: Model<PipelineRunDocument>,
  ) {}

  async create(data: Partial<PipelineRun>): Promise<PipelineRunDocument> {
    const doc = await this.model.create(data);
    this.logger.log(
      `PipelineRun created: ${data.jobId} (${data.mode}) for db=${data.database}`,
    );
    return doc;
  }

  async list(
    database: string,
    limit = 20,
    offset = 0,
  ): Promise<PipelineRunDocument[]> {
    return this.model
      .find({ database })
      .sort({ startedAt: -1 })
      .skip(offset)
      .limit(limit)
      .exec();
  }

  async markCompleted(
    jobId: string,
    updates: Partial<PipelineRun>,
  ): Promise<void> {
    await this.model.updateOne(
      { jobId },
      { ...updates, completedAt: new Date() },
    );
  }
}
