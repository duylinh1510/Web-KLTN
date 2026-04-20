import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { Neo4jService } from './neo4j.service';
import { ConnectNeo4jDto } from './dto/connect-neo4j.dto';

@Controller('neo4j')
export class Neo4jController {
  constructor(private readonly neo4jService: Neo4jService) {}

  @Post('connect')
  @HttpCode(HttpStatus.OK)
  async connect(@Body() dto: ConnectNeo4jDto) {
    await this.neo4jService.connect(dto.uri, dto.user, dto.password);
    return { status: 'Thành công', message: `Đã kết nối tới ${dto.uri}` };
  }

  @Post('disconnect')
  @HttpCode(HttpStatus.OK)
  async disconnect() {
    await this.neo4jService.disconnect();
    return { status: 'Thành công', message: 'Đã ngắt kết nối' };
  }
}
