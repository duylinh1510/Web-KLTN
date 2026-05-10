import {
  Injectable,
  OnModuleDestroy,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import neo4j, { Driver, Session } from 'neo4j-driver';
import axios from 'axios';

/**
 * Neo4jService — quản lý kết nối driver + database selection.
 *
 * Flow database selection:
 *   1. User connect (URI + user + password) → driver init
 *   2. listDatabases() → gọi SHOW DATABASES → trả danh sách
 *   3. User chọn database → switchDatabase() → cập nhật currentDatabase
 *   4. Mọi session sau đó dùng currentDatabase
 */
@Injectable()
export class Neo4jService implements OnModuleDestroy {
  private driver: Driver | null = null;
  private currentUri: string | null = null;
  private currentDbId: string | null = null;

  /**
   * Database đang active (từ SHOW DATABASES).
   * Null = dùng default database của Neo4j instance.
   */
  private currentDatabase: string | null = null;

  // ============================================================
  // Connect / Disconnect
  // ============================================================

  /**
   * Kết nối tới Neo4j DBMS.
   * dbId: cache key cho schema metadata (tuỳ chọn).
   * database: database name để dùng trong session (tuỳ chọn, null = default).
   */
  async connect(
    uri: string,
    user: string,
    pass: string,
    dbId?: string,
    database?: string,
  ): Promise<boolean> {
    try {
      // Đóng kết nối cũ nếu có
      if (this.driver) await this.driver.close();

      this.driver = neo4j.driver(uri, neo4j.auth.basic(user, pass));

      // Ping để xác nhận kết nối sống
      await this.driver.getServerInfo();

      this.currentUri = uri;
      this.currentDbId = dbId ?? null;
      this.currentDatabase = database ?? null;
      return true;
    } catch (error: any) {
      this.driver = null;
      this.currentUri = null;
      this.currentDbId = null;
      this.currentDatabase = null;
      console.error('[Neo4j connect failed]', error.code, error.message);

      const code = error?.code ?? '';
      if (code.includes('Unauthorized')) {
        throw new HttpException('Sai username/password', HttpStatus.UNAUTHORIZED);
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
      this.currentDatabase = null;
    }
  }

  // ============================================================
  // Status & Getters
  // ============================================================

  getStatus(): {
    connected: boolean;
    uri: string | null;
    dbId: string | null;
    database: string | null;
  } {
    return {
      connected: this.driver !== null,
      uri: this.currentUri,
      dbId: this.currentDbId,
      database: this.currentDatabase,
    };
  }

  getDbId(): string | null {
    return this.currentDbId;
  }

  getCurrentDatabase(): string | null {
    return this.currentDatabase;
  }

  // ============================================================
  // Database Selection
  // ============================================================

  /**
   * Lấy danh sách database từ SHOW DATABASES.
   * Lọc bỏ "system" database (internal).
   * Yêu cầu driver đã connect.
   */
  async listDatabases(): Promise<string[]> {
    const session = this.getReadSession();
    try {
      const result = await session.run('SHOW DATABASES YIELD name, currentStatus WHERE currentStatus = "online" RETURN name ORDER BY name');
      return result.records
        .map((r) => r.get('name') as string)
        .filter((name) => name !== 'system');
    } catch (error: any) {
      // Fallback: Neo4j Community edition không hỗ trợ SHOW DATABASES
      // → trả về ["neo4j"] (default database)
      console.warn(
        '[Neo4j] SHOW DATABASES failed, fallback to ["neo4j"]:', error.message,
      );
      return ['neo4j'];
    } finally {
      await session.close();
    }
  }

  /**
   * Switch sang database khác trong cùng DBMS.
   * Không cần reconnect driver, chỉ cập nhật currentDatabase.
   * Các session mới sẽ tự động dùng database này.
   *
   * @param database - Tên database (từ SHOW DATABASES)
   */
  switchDatabase(database: string): void {
    if (!this.driver) {
      throw new HttpException(
        'Vui lòng kết nối Database trước!',
        HttpStatus.BAD_REQUEST,
      );
    }
    this.currentDatabase = database;
  }

  // ============================================================
  // Session Factory
  // ============================================================

  getReadSession(): Session {
    if (!this.driver) {
      throw new HttpException(
        'Vui lòng kết nối Database trước!',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.driver.session({
      defaultAccessMode: neo4j.session.READ,
      // Nếu currentDatabase được set thì dùng, không thì Neo4j driver dùng default
      ...(this.currentDatabase ? { database: this.currentDatabase } : {}),
    });
  }

  getWriteSession(): Session {
    if (!this.driver) {
      throw new HttpException(
        'Vui lòng kết nối Database trước!',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.driver.session({
      defaultAccessMode: neo4j.session.WRITE,
      ...(this.currentDatabase ? { database: this.currentDatabase } : {}),
    });
  }

  // ============================================================
  // Utilities
  // ============================================================

  async hasApoc(): Promise<boolean> {
    const session = this.getReadSession();
    try {
      await session.run(
        "CALL apoc.help('apoc.create.relationship') YIELD name RETURN name LIMIT 1",
      );
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

      // 3. Relationship structure
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

      // Format relationship structure
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
    const currentSchema = await this.getDatabaseSchema();

    console.log('--- SCHEMA ĐƯỢC GỬI SANG COLAB ---');
    console.log(currentSchema);
    console.log('----------------------------------');

    const colabUrl = `${process.env.TEXT2CYPHER_URL}/generate`;

    try {
      const response = await axios.post(colabUrl, {
        question,
        schema: currentSchema,
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

  async executeCypherExplain(
    cypher: string,
  ): Promise<{ success: boolean; error?: string }> {
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
