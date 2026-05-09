import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

/**
 * Gọi Python sidecar local (FastAPI port 8001) để build data.pt.
 *
 * Sidecar đọc preprocessed.csv + schema.json từ jobDir (cùng máy NestJS),
 * build PyG Data + train/val/test masks, ghi data.pt xuống cùng folder.
 * Không upload binary qua HTTP — chỉ truyền absolute jobDir.
 */
export interface BuildDataPtStats {
  numNodes: number;
  numEdges: number;
  numFeatures: number;
  train: number;
  val: number;
  test: number;
}

export interface BuildDataPtResult {
  dataPtPath: string;
  stats: BuildDataPtStats;
}

@Injectable()
export class DataPtService {
  private readonly logger = new Logger(DataPtService.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  async buildDataPt(jobDir: string): Promise<BuildDataPtResult> {
    const baseUrl = this.getBaseUrl();
    const timeout = this.getTimeout();

    this.logger.log(`Calling sidecar /build-data-pt for jobDir=${jobDir}`);

    try {
      const { data } = await firstValueFrom(
        this.http.post<{
          success: boolean;
          dataPt: string;
          stats: BuildDataPtStats;
        }>(`${baseUrl}/build-data-pt`, { jobDir }, { timeout }),
      );

      if (!data?.success || !data.dataPt) {
        throw new Error('Sidecar trả response không hợp lệ');
      }

      this.logger.log(
        `data.pt built: ${data.dataPt} ` +
          `(nodes=${data.stats.numNodes}, edges=${data.stats.numEdges}, ` +
          `feats=${data.stats.numFeatures}, ` +
          `train/val/test=${data.stats.train}/${data.stats.val}/${data.stats.test})`,
      );

      return { dataPtPath: data.dataPt, stats: data.stats };
    } catch (error: any) {
      const msg =
        error?.response?.data?.detail ??
        error?.response?.data?.message ??
        error?.message ??
        'Unknown error';
      this.logger.error(`Sidecar /build-data-pt lỗi: ${msg}`);
      throw new HttpException(
        `Sidecar build-data-pt lỗi: ${msg}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  // ============================================================
  // PRIVATE
  // ============================================================

  private getBaseUrl(): string {
    const url =
      this.config.get<string>('CSV2GRAPH_SIDECAR_URL') ??
      'http://127.0.0.1:8001';
    return url.replace(/\/$/, '');
  }

  private getTimeout(): number {
    return (
      Number(this.config.get<string>('CSV2GRAPH_SIDECAR_TIMEOUT_MS')) ||
      600_000
    );
  }
}
