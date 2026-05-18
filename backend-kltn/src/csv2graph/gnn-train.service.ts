import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import * as path from 'path';
import * as fs from 'fs';

export interface GnnTrainingResult {
  success: boolean;
  modelPath: string;
  activeModelPath: string;
  epochsRun: number;
  bestMetric: number | null;
  threshold?: number | null;
  metrics?: {
    val?: Record<string, number | null>;
    test?: Record<string, number | null>;
  };
  params?: Record<string, unknown>;
  device?: string;
}

@Injectable()
export class GnnTrainService {
  private readonly logger = new Logger(GnnTrainService.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  async train(jobDir: string, dataPtPath: string): Promise<GnnTrainingResult> {
    const baseUrl = this.getBaseUrl();
    const timeout = this.getTimeout();
    const savePath = path.join(jobDir, 'best_model.pt');
    const activeModelPath = this.resolveActiveModelPath();

    this.logger.log(
      `Calling sidecar /train-fgnn dataPt=${dataPtPath}, savePath=${savePath}`,
    );

    try {
      const { data } = await firstValueFrom(
        this.http.post<GnnTrainingResult>(
          `${baseUrl}/train-fgnn`,
          {
            jobDir,
            dataPt: dataPtPath,
            savePath,
            activeModelPath,
            params: this.getTrainParams(),
          },
          { timeout },
        ),
      );

      if (!data?.success || !data.modelPath) {
        throw new Error('Sidecar trả response train không hợp lệ');
      }

      this.logger.log(
        `F-GNN trained: ${data.modelPath} ` +
          `(epochs=${data.epochsRun}, bestMetric=${data.bestMetric})`,
      );
      return data;
    } catch (error: any) {
      const msg =
        error?.response?.data?.detail ??
        error?.response?.data?.message ??
        error?.message ??
        'Unknown error';
      this.logger.error(`Sidecar /train-fgnn lỗi: ${msg}`);
      throw new HttpException(`Train F-GNN lỗi: ${msg}`, HttpStatus.BAD_GATEWAY);
    }
  }

  getActiveModelPath(): string {
    return this.resolveActiveModelPath();
  }

  hasActiveModel(): boolean {
    try {
      return fs.existsSync(this.resolveActiveModelPath());
    } catch {
      return false;
    }
  }

  private getBaseUrl(): string {
    const url =
      this.config.get<string>('GNN_TRAIN_URL') ?? 'http://127.0.0.1:8002';
    return url.replace(/\/$/, '');
  }

  private getTimeout(): number {
    return Number(this.config.get<string>('GNN_TRAIN_TIMEOUT_MS')) || 3_600_000;
  }

  private resolveActiveModelPath(): string {
    const configured =
      this.config.get<string>('GNN_ACTIVE_MODEL_PATH') ??
      '../python-services/models/fgnn_star.pt';
    return path.resolve(process.cwd(), configured);
  }

  private getTrainParams(): Record<string, number | string> {
    return {
      epochs: Number(this.config.get<string>('GNN_TRAIN_EPOCHS')) || 200,
      hiddenDim: Number(this.config.get<string>('GNN_HIDDEN_DIM')) || 64,
      numLayers: Number(this.config.get<string>('GNN_NUM_LAYERS')) || 2,
      K: Number(this.config.get<string>('GNN_K')) || 3,
      dropout: Number(this.config.get<string>('GNN_DROPOUT')) || 0.4,
      lr: Number(this.config.get<string>('GNN_LR')) || 0.01,
      patience: Number(this.config.get<string>('GNN_PATIENCE')) || 30,
      batchSize: Number(this.config.get<string>('GNN_BATCH_SIZE')) || 2048,
      evalBatchSize:
        Number(this.config.get<string>('GNN_EVAL_BATCH_SIZE')) || 4096,
      fanout1: Number(this.config.get<string>('GNN_FANOUT1')) || 20,
      fanout2: Number(this.config.get<string>('GNN_FANOUT2')) || 15,
      monitor: this.config.get<string>('GNN_MONITOR') || 'f1',
    };
  }
}
