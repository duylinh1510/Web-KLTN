import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PipelineConfigDocument = HydratedDocument<PipelineConfig>;

@Schema({ collection: 'pipeline_configs', timestamps: false })
export class PipelineConfig {
  @Prop({ required: true, unique: true })
  database!: string;

  /** Cột nào tạo thành auxiliary nodes (merchant, category...) */
  @Prop({ type: [String], default: [] })
  relationCols!: string[];

  /** Cột nào là feature (amt, lat, long...) */
  @Prop({ type: [String], default: [] })
  featureCols!: string[];

  /** Tên cột sau encoding (dùng cho data.pt) */
  @Prop({ type: [String], default: [] })
  encodedFeatureCols!: string[];

  /** Headers CSV gốc (chưa rename) — validate khi append */
  @Prop({ type: [String], default: [] })
  rawColumns!: string[];

  /** Cột ID user chọn (VD: "transaction_id") — rename thành node_id */
  @Prop()
  originalIdCol!: string;

  @Prop({ default: 0.4 })
  trainRatio!: number;

  @Prop({ default: 0.2 })
  valRatio!: number;

  @Prop({ default: 42 })
  seed!: number;

  @Prop({ default: 500 })
  maxGroupSize!: number;
}

export const PipelineConfigSchema =
  SchemaFactory.createForClass(PipelineConfig);
