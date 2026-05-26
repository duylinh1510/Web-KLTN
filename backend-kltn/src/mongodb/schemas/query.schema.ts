import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type QueryDocument = HydratedDocument<Query>;

@Schema({ collection: 'queries', timestamps: false })
export class Query {
  @Prop({ required: true })
  database!: string;

  /** Câu hỏi NL user nhập */
  @Prop({ required: true })
  prompt!: string;

  /** Cypher query mà AI sinh ra */
  @Prop()
  cypher!: string;

  /** Kết quả graph (nodes + links) */
  @Prop({ type: Object })
  graphData!: Record<string, unknown>;

  /** Kết quả dạng bảng */
  @Prop({ type: [Object] })
  scalars!: Record<string, unknown>[];

  /** Thông tin debug: retries, cypherV1, cypherV2 */
  @Prop({ type: Object })
  metadata!: Record<string, unknown>;

  /** Error message nếu query fail */
  @Prop()
  error!: string;

  @Prop({ default: () => new Date() })
  createdAt!: Date;
}

export const QuerySchema = SchemaFactory.createForClass(Query);

QuerySchema.index({ database: 1, createdAt: -1 });
