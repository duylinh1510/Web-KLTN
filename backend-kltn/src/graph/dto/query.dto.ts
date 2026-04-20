import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class QueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  prompt!: string;
}
