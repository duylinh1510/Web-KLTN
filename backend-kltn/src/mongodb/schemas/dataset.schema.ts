import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type DatasetDocument = HydratedDocument<Dataset>;

@Schema({ collection: 'datasets', timestamps: true })
export class Dataset {
  @Prop({ required: true, unique: true })
  database!: string;

  /** Label node chính trên Neo4j (VD: "Transaction") */
  @Prop()
  nodeLabel!: string;

  /** Cột nhãn fraud (VD: "is_fraud") */
  @Prop()
  targetLabel!: string;

  /** Danh sách cột trên node (sau rename) */
  @Prop({ type: [String], default: [] })
  columns!: string[];

  /** Schema text cho Text2Cypher — cache nội dung schema_<db>.txt */
  @Prop()
  graphSchema!: string;

  /** GNN model đã train xong chưa */
  @Prop({ default: false })
  hasModel!: boolean;

  /** Đường dẫn model đang dùng cho inference */
  @Prop()
  activeModelPath!: string;

  /** Threshold đã tune khi train, dùng lại cho append inference */
  @Prop({ type: Number, default: null })
  inferenceThreshold!: number | null;

  /** Kết quả training (F1, AUC...) */
  @Prop({ type: Object })
  trainingMetrics!: Record<string, unknown>;
}

export const DatasetSchema = SchemaFactory.createForClass(Dataset);
