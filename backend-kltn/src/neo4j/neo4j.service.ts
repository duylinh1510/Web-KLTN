import {
  Injectable,
  OnModuleDestroy,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import neo4j, { Driver, Session } from 'neo4j-driver';
import axios from 'axios';

@Injectable()
export class Neo4jService implements OnModuleDestroy {
  private driver: Driver | null = null; // Khởi tạo ban đầu là rỗng
  private currentUri: string | null = null;
  private currentDbId: string | null = null;

  // Hàm này sẽ được gọi từ Controller khi user nhập form trên web
  async connect(uri: string, user: string, pass: string, dbId?: string): Promise<boolean> {
    try {
      // Đóng kết nối cũ nếu có (để user có thể đổi DB khác)
      if (this.driver) await this.driver.close();

      this.driver = neo4j.driver(uri, neo4j.auth.basic(user, pass));

      // Chạy thử một lệnh ping để xác nhận kết nối sống
      await this.driver.getServerInfo();
      this.currentUri = uri;
      this.currentDbId = dbId ?? null;
      return true;
    } catch (error: any) {
      this.driver = null;
      this.currentUri = null;
      this.currentDbId = null;
      console.error('[Neo4j connect failed]', error.code, error.message);

      const code = error?.code ?? '';
      if (code.includes('Unauthorized')) {
        throw new HttpException(
          'Sai username/password',
          HttpStatus.UNAUTHORIZED,
        );
      }
      if (
        code.includes('ServiceUnavailable') ||
        error?.message?.includes('ECONNREFUSED')
      ) {
        throw new HttpException(
          'Neo4j không chạy hoặc sai port',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      throw new HttpException(
        `Lỗi Neo4j: ${error?.message ?? 'unknown'}`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async disconnect(): Promise<void> {
    if (this.driver) {
      await this.driver.close();
      this.driver = null;
      this.currentUri = null;
      this.currentDbId = null;
    }
  }

  getStatus(): { connected: boolean; uri: string | null; dbId: string | null } {
    return { connected: this.driver !== null, uri: this.currentUri, dbId: this.currentDbId };
  }

  getDbId(): string | null {
    return this.currentDbId;
  }

  getReadSession(): Session {
    if (!this.driver) {
      throw new HttpException(
        'Vui lòng kết nối Database trước!',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.driver.session({ defaultAccessMode: neo4j.session.READ });
  }

  getWriteSession(): Session {
    if (!this.driver) {
      throw new HttpException(
        'Vui lòng kết nối Database trước!',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.driver.session({ defaultAccessMode: neo4j.session.WRITE });
  }

  async hasApoc(): Promise<boolean> {
    const session = this.getReadSession();
    try {
      await session.run("CALL apoc.help('apoc.create.relationship') YIELD name RETURN name LIMIT 1");
      return true;
    } catch {
      return false;
    } finally {
      await session.close();
    }
  }

  async getDatabaseSchema(): Promise<string> {
    const session = this.getReadSession();
    try {
      // 1. Node properties
      const nodeRes = await session.run(`
      CALL db.schema.nodeTypeProperties() 
      YIELD nodeType, propertyName, propertyTypes
      RETURN nodeType, collect(propertyName + ': ' + propertyTypes[0]) AS properties
    `);

      // 2. Relationship properties
      const relRes = await session.run(`
      CALL db.schema.relTypeProperties() 
      YIELD relType, propertyName, propertyTypes
      RETURN relType, collect(propertyName + ': ' + propertyTypes[0]) AS properties
    `);

      // 3. Relationship structure (quan trọng - model cần biết A-[:REL]->B)
      const structRes = await session.run(`
      MATCH (a)-[r]->(b)
      RETURN DISTINCT 
        labels(a)[0] AS from,
        type(r) AS rel,
        labels(b)[0] AS to
    `);

      // Format nodes
      let schemaStr = 'Node properties:\n';
      nodeRes.records.forEach((record) => {
        const label = record.get('nodeType').replace(/[:`]/g, '');
        const props = record.get('properties').join(', ');
        schemaStr += `- ${label} {${props}}\n`;
      });

      // Format relationship properties
      schemaStr += '\nRelationship properties:\n';
      relRes.records.forEach((record) => {
        const type = record.get('relType').replace(/[:`]/g, '');
        const props = record.get('properties');
        schemaStr +=
          props.length > 0
            ? `- ${type} {${props.join(', ')}}\n`
            : `- ${type}\n`;
      });

      // Format relationship structure ← phần này model cần nhất
      schemaStr += '\nRelationship structure:\n';
      structRes.records.forEach((record) => {
        const from = record.get('from');
        const rel = record.get('rel');
        const to = record.get('to');
        schemaStr += `- (${from})-[:${rel}]->(${to})\n`;
      });

      return schemaStr;
    } finally {
      await session.close();
    }
  }

  async generateCypherFromText(question: string): Promise<string> {
    // 1. Tự động lấy Schema mới nhất (cover luôn trường hợp bạn mới import CSV)
    const currentSchema = await this.getDatabaseSchema();

    // In ra console để bạn kiểm chứng Schema đã được lấy thành công
    console.log('--- SCHEMA ĐƯỢC GỬI SANG COLAB ---');
    console.log(currentSchema);
    console.log('----------------------------------');

    const colabUrl = `${process.env.TEXT2CYPHER_URL}/generate`;

    try {
      const response = await axios.post(colabUrl, {
        question,
        schema: currentSchema, // Schema tự động được gửi đi!
      });

      const cypher = response.data.cypher.replace(/\\n/g, '\n');

      return cypher;
    } catch (error) {
      console.error('Lỗi khi gọi Colab API:', error.message);
      throw new HttpException(
        'Không thể kết nối đến AI Service',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async executeCypherExplain(cypher: string): Promise<{ success: boolean; error?: string }> {
    const session = this.getReadSession();
    try {
      await session.run(`EXPLAIN ${cypher}`);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error?.message ?? String(error) };
    } finally {
      await session.close();
    }
  }

  async onModuleDestroy() {
    if (this.driver) await this.driver.close();
  }
}
