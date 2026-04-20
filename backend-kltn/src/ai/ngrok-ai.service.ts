import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { IAiService } from './ai.interface';

//Giao ước với Đạt (Colab side): endpoint POST {AI_BASE_URL}/generate,
//body { "prompt": "..." }, response { "cypher": "MATCH ..." } (hoặc trả string thô cũng được — code xử lý cả 2).
// Khi Đạt có endpoint khác, chỉ sửa file này.

@Injectable()
export class NgrokAiService implements IAiService {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  async generateCypher(prompt: string): Promise<string> {
    const baseUrl = this.config.get<string>('AI_BASE_URL');
    const timeout = Number(this.config.get<string>('AI_TIMEOUT_MS')) || 180_000;

    if (!baseUrl) {
      throw new HttpException(
        'AI_BASE_URL chưa cấu hình',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    try {
      const { data } = await firstValueFrom(
        this.http.post(`${baseUrl}/generate`, { prompt }, { timeout }),
      );

      const cypher = typeof data === 'string' ? data : data?.cypher;
      if (!cypher || typeof cypher !== 'string') {
        throw new Error('Response không có field `cypher`');
      }
      return cypher;
    } catch (error: any) {
      const msg =
        error?.response?.data?.message ?? error?.message ?? 'Unknown error';
      throw new HttpException(`AI Engine lỗi: ${msg}`, HttpStatus.BAD_GATEWAY);
    }
  }
}
