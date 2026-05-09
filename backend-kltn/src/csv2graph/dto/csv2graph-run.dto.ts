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
import { Type } from 'class-transformer';

export class Csv2GraphRunDto {
  /**
   * Bắt buộc khi DB rỗng (full build) — LLM cần biết cột nhãn.
   * Khi append, BE tự lookup từ canonical schema; FE có thể bỏ trống.
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  targetLabel?: string;

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
  @Type(() => Boolean)
  @IsBoolean()
  ingestNeo4j?: boolean;
}
