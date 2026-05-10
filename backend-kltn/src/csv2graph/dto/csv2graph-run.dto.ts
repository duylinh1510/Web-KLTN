import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  IsNumber,
  IsBoolean,
  Min,
  Max,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

/**
 * Parse boolean từ FormData (multipart) hoặc JSON.
 *
 * Vấn đề: @Type(() => Boolean) dùng Boolean('false') === TRUE (string không rỗng).
 * Fix: @Transform xử lý tường minh 'true'/'false'/'1'/'0'.
 */
const toBooleanTransform = Transform(({ value }) => {
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return undefined;
});

export class Csv2GraphRunDto {
  /**
   * Bắt buộc khi DB rỗng (full build) VÀ trainMode=true.
   * Khi append hoặc trainMode=false, BE tự lookup hoặc bỏ qua.
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  targetLabel?: string;

  /**
   * Cột transaction_id do user chọn từ dropdown (ghi đè LLM suggestion).
   * Null/undefined → dùng LLM suggestion hoặc auto-generate.
   */
  @IsOptional()
  @IsString()
  transactionIdCol?: string;

  /**
   * Nếu true → build đầy đủ pipeline (LLM classify + data.pt + train-ready).
   * Nếu false → chỉ ingest Neo4j, không build data.pt.
   * Default: true (tương thích ngược).
   *
   * NOTE: Hiện tại chưa implement luồng train thực — field này được lưu
   * vào schema để dùng sau.
   */
  @IsOptional()
  @toBooleanTransform
  @IsBoolean()
  trainMode?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  maxGroupSize?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  @Max(0.99)
  trainRatio?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  @Max(0.99)
  valRatio?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  seed?: number;

  @IsOptional()
  @IsString()
  nodeLabel?: string;

  @IsOptional()
  @toBooleanTransform
  @IsBoolean()
  ingestNeo4j?: boolean;
}
