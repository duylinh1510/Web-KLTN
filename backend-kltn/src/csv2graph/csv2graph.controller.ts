import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Neo4jService } from '../neo4j/neo4j.service';
import { Csv2GraphService } from './csv2graph.service';
import { DatasetMetaService } from './dataset-meta.service';
import { Csv2GraphRunDto } from './dto/csv2graph-run.dto';

@Controller('csv2graph')
export class Csv2GraphController {
  constructor(
    private readonly csv2graphService: Csv2GraphService,
    private readonly datasetMeta: DatasetMetaService,
    private readonly neo4j: Neo4jService,
  ) {}

  @Post('run')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 200 * 1024 * 1024,
      },
    }),
  )
  async run(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: Csv2GraphRunDto,
  ) {
    if (!file) {
      throw new HttpException(
        'Thiếu file CSV (field name: "file")',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!file.buffer || file.buffer.length === 0) {
      throw new HttpException('File CSV rỗng', HttpStatus.BAD_REQUEST);
    }

    const result = await this.csv2graphService.run(
      file.buffer,
      file.originalname,
      dto,
    );

    return { status: 'success', ...result };
  }

  /**
   * GET /csv2graph/dataset-info
   * Cho FE biết DB hiện tại đã có data chưa + canonical columns.
   * Yêu cầu connect Neo4j (Neo4jService.getReadSession sẽ throw 400 nếu chưa).
   */
  @Get('dataset-info')
  async datasetInfo() {
    if (!this.neo4j.getStatus().connected) {
      throw new HttpException(
        'Vui lòng kết nối Database trước!',
        HttpStatus.BAD_REQUEST,
      );
    }
    const dbId = this.neo4j.getDbId();
    const info = await this.datasetMeta.getDatasetInfo(dbId);
    return { status: 'success', ...info };
  }
}
