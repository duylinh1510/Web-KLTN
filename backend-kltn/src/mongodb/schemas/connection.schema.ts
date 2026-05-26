import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ConnectionDocument = HydratedDocument<Connection>;

@Schema({ collection: 'connections', timestamps: false })
export class Connection {
  @Prop({ required: true })
  uri!: string;

  @Prop({ required: true, unique: true })
  database!: string;

  @Prop({ default: () => new Date() })
  connectedAt!: Date;

  @Prop({ default: () => new Date() })
  lastUsedAt!: Date;
}

export const ConnectionSchema = SchemaFactory.createForClass(Connection);
