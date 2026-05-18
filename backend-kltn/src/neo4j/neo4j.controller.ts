import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Get,
  HttpException,
} from '@nestjs/common';
import { Neo4jService } from './neo4j.service';
import { ConnectNeo4jDto } from './dto/connect-neo4j.dto';

@Controller('neo4j')
export class Neo4jController {
  constructor(private readonly neo4jService: Neo4jService) {}

  @Post('connect')
  @HttpCode(HttpStatus.OK)
  async connect(@Body() dto: ConnectNeo4jDto) {
    const database = dto.database.trim();
    await this.neo4jService.connect(
      dto.uri,
      dto.user,
      dto.password,
      database,
    );
    return {
      status: 'success',
      message: `Đã kết nối tới ${dto.uri}, database: ${database}`,
      database,
    };
  }

  @Post('disconnect')
  @HttpCode(HttpStatus.OK)
  async disconnect() {
    await this.neo4jService.disconnect();
    return { status: 'success', message: 'Đã ngắt kết nối' };
  }

  @Get('status')
  status() {
    const { connected, uri, database } = this.neo4jService.getStatus();
    return { status: 'success', connected, uri, database };
  }

  /**
   * GET /neo4j/databases
   * Trả về danh sách database online từ SHOW DATABASES.
   * Lọc bỏ "system". Fallback trả ["neo4j"] nếu Community Edition.
   */
  @Get('databases')
  async listDatabases() {
    if (!this.neo4jService.getStatus().connected) {
      throw new HttpException(
        'Vui lòng kết nối Database trước!',
        HttpStatus.BAD_REQUEST,
      );
    }
    const databases = await this.neo4jService.listDatabases();
    return { status: 'success', databases };
  }

  /**
   * POST /neo4j/switch-database
   * Chuyển sang database khác trong cùng DBMS.
   * Không cần reconnect — chỉ cập nhật database active trong session.
   *
   * Body: { database: string }
   */
  @Post('switch-database')
  @HttpCode(HttpStatus.OK)
  async switchDatabase(@Body() body: { database: string }) {
    const database = body?.database?.trim();
    if (!database) {
      throw new HttpException(
        'Thiếu field "database"',
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.neo4jService.switchDatabase(database);
    return {
      status: 'success',
      message: `Đã chuyển sang database: ${database}`,
      database,
    };
  }
}
