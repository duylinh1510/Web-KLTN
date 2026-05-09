import { Injectable } from '@nestjs/common';
import { IAiService } from './ai.interface';

@Injectable()
export class MockAiService implements IAiService {
  async generateCypher(prompt: string): Promise<string> {
    console.log(`[AI Mock] Đang phân tích câu hỏi: "${prompt}"...`);
    await new Promise((r) => setTimeout(r, 2000));

    const p = prompt.toLowerCase();

    if (p.includes('fraud') || p.includes('gian lận') || p.includes('đáng ngờ')) {
      return `
        MATCH (c:Client)-[:PERFORMED]->(t:Transaction)
        WHERE t.fraud = true
        RETURN c, t LIMIT 20
      `.trim();
    }

    if (p.includes('mule') || p.includes('trung gian')) {
      return `
        MATCH (c:Client:Mule)-[:PERFORMED]->(t:Transaction)
        RETURN c, t LIMIT 30
      `.trim();
    }

    if (p.includes('top') || p.includes('nhiều nhất')) {
      return `
        MATCH (c:Client)-[:PERFORMED]->(t:Transaction)
        WITH c, count(t) AS txCount
        RETURN c, txCount ORDER BY txCount DESC LIMIT 10
      `.trim();
    }

    if (p.includes('merchant') || p.includes('luồng')) {
      return `
        MATCH (c:Client)-[:PERFORMED]->(t:Payment)-[:TO]->(m:Merchant)
        RETURN c, t, m LIMIT 30
      `.trim();
    }

    if (p.includes('vòng') || p.includes('chain') || p.includes('chuỗi')) {
      return `
        MATCH (t1:Transaction)-[:NEXT]->(t2:Transaction)-[:NEXT]->(t3:Transaction)
        RETURN t1, t2, t3 LIMIT 15
      `.trim();
    }

    if (p.includes('đếm') || p.includes('loại')) {
      return 'MATCH (n) RETURN labels(n)[0] AS label, count(*) AS total';
    }

    if (p.includes('email') || p.includes('phone') || p.includes('chia sẻ') || p.includes('trùng')) {
      return `
        MATCH (c1:Client)-[:HAS_EMAIL]->(e:Email)<-[:HAS_EMAIL]-(c2:Client)
        WHERE c1.id < c2.id
        RETURN c1, e, c2 LIMIT 20
      `.trim();
    }

    return 'MATCH (c:Client)-[:PERFORMED]->(t:Transaction) RETURN c, t LIMIT 20';
  }
}