import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type EncodingMapDocument = HydratedDocument<EncodingMap>;

/**
 * Bảng mã hóa categorical (Target Encoding).
 * Tách riêng vì rất lớn (7MB+ cho 500k rows).
 * Chỉ cần khi chạy Append mode.
 */
@Schema({ collection: 'encoding_maps', timestamps: false })
export class EncodingMap {
  @Prop({ required: true, unique: true })
  database!: string;

  /** { [colName]: { [categoryValue]: encodedFloat, "__MISSING__": globalMean } } */
  @Prop({ type: Object, required: true })
  maps!: Record<string, Record<string, number>>;
}

export const EncodingMapSchema = SchemaFactory.createForClass(EncodingMap);
