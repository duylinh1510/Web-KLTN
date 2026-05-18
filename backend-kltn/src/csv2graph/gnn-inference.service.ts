import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

export interface GnnScore {
  nodeId: string;
  fraudScore: number;
  predictedLabel: number;
}

export interface GnnInferenceResult {
  success: boolean;
  dataPt: string;
  total: number;
  predictedFraud: number;
  threshold: number;
  scores: GnnScore[];
  gnnVersion?: string;
  inferenceMs?: number;
}

@Injectable()
export class GnnInferenceService {
  private readonly logger = new Logger(GnnInferenceService.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  async predictDataPt(
    dataPtPath: string,
    threshold?: number,
  ): Promise<GnnInferenceResult> {
    const baseUrl = this.getBaseUrl();
    const timeout = this.getTimeout();

    try {
      await firstValueFrom(
        this.http.post(`${baseUrl}/reload`, {}, { timeout: 60_000 }),
      );
    } catch (error: any) {
      const msg =
        error?.response?.data?.detail ??
        error?.response?.data?.message ??
        error?.message ??
        'Unknown error';
      this.logger.warn(`GNN /reload warning: ${msg}`);
    }

    this.logger.log(`Calling GNN /predict-data-pt dataPt=${dataPtPath}`);

    try {
      const { data } = await firstValueFrom(
        this.http.post<GnnInferenceResult>(
          `${baseUrl}/predict-data-pt`,
          { dataPt: dataPtPath, threshold },
          { timeout },
        ),
      );

      if (!data?.success || !Array.isArray(data.scores)) {
        throw new Error('GNN service tra response inference khong hop le');
      }

      this.logger.log(
        `GNN inference OK: ${data.total} nodes, ` +
          `${data.predictedFraud} fraud, threshold=${data.threshold}`,
      );

      return data;
    } catch (error: any) {
      const msg =
        error?.response?.data?.detail ??
        error?.response?.data?.message ??
        error?.message ??
        'Unknown error';
      this.logger.error(`GNN /predict-data-pt loi: ${msg}`);
      throw new HttpException(`Inference F-GNN loi: ${msg}`, HttpStatus.BAD_GATEWAY);
    }
  }

  private getBaseUrl(): string {
    const url =
      this.config.get<string>('GNN_INFERENCE_URL') ?? 'http://127.0.0.1:8001';
    return url.replace(/\/$/, '');
  }

  private getTimeout(): number {
    return (
      Number(this.config.get<string>('GNN_INFERENCE_TIMEOUT_MS')) || 600_000
    );
  }
}
