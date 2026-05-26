import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PipelineRunDocument = HydratedDocument<PipelineRun>;

@Schema({ collection: 'pipeline_runs', timestamps: false })
export class PipelineRun {
  @Prop({ required: true })
  database!: string;

  @Prop({ required: true })
  jobId!: string;

  /** "full" = build từ đầu, "append" = thêm data */
  @Prop({ required: true, enum: ['full', 'append'] })
  mode!: string;

  /** Tên file CSV user upload */
  @Prop()
  fileName!: string;

  /** Thống kê: rows, nodes, edges, features */
  @Prop({ type: Object })
  stats!: Record<string, unknown>;

  /** Kết quả train GNN (null nếu không train) */
  @Prop({ type: Object })
  training!: Record<string, unknown> | null;

  /** Kết quả inference append (null nếu full build) */
  @Prop({ type: Object })
  inference!: Record<string, unknown> | null;

  /** Đường dẫn file data.pt */
  @Prop()
  dataPtPath!: string;

  @Prop({ default: () => new Date() })
  startedAt!: Date;

  @Prop()
  completedAt!: Date;
}

export const PipelineRunSchema = SchemaFactory.createForClass(PipelineRun);

PipelineRunSchema.index({ database: 1, startedAt: -1 });
