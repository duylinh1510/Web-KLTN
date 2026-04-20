import { IsString, IsNotEmpty, Matches } from 'class-validator';

export class ConnectNeo4jDto {
  @Matches(/^(bolt|neo4j)(\+s|\+ssc)?:\/\/.+/, {
    message: 'URI phải bắt đầu bằng bolt:// hoặc neo4j://',
  })
  uri!: string;

  @IsString()
  @IsNotEmpty()
  user!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}
