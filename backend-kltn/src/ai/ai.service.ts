import { Injectable } from '@nestjs/common';
import { IAiService } from './ai.interface'; // Import interface vào

@Injectable()
export class MockAiService implements IAiService {
  async generateCypher(prompt: string): Promise<string> {
    console.log(`[AI Mock] Đang phân tích câu hỏi: "${prompt}"...`);
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log('[AI Mock] Phân tích xong, trả về Cypher.');
    return 'MATCH (c:Card) RETURN c, count(*) AS total';
  }
}