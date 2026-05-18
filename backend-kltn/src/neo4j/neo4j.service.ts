import {
  Injectable,
  OnModuleDestroy,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import neo4j, { Driver, Session } from 'neo4j-driver';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

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

  /**
   * Database đang active (từ SHOW DATABASES).
   * Null = dùng default database của Neo4j instance.
   */
  private currentDatabase: string | null = null;

  // ============================================================
  // Connect / Disconnect
  // ============================================================

  /**
   * Kết nối tới Neo4j DBMS bằng database name thật trong instance.
   * Database name này cũng là cache key cho schema/metadata local.
   */
  async connect(
    uri: string,
    user: string,
    pass: string,
    database: string,
  ): Promise<boolean> {
    const requestedDatabase = database.trim();
    if (!requestedDatabase) {
      throw new HttpException(
        'Vui lòng nhập Database Name',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      // Đóng kết nối cũ nếu có
      if (this.driver) await this.driver.close();

      this.driver = neo4j.driver(uri, neo4j.auth.basic(user, pass));

      // Ping để xác nhận kết nối sống
      await this.driver.getServerInfo();

      this.currentUri = uri;
      this.currentDatabase = null;

      const databases = await this.listDatabases();
      this.assertDatabaseExists(requestedDatabase, databases);

      this.currentDatabase = requestedDatabase;
      await this.assertDatabaseUsable(requestedDatabase);
      return true;
    } catch (error: any) {
      await this.clearConnection();

      if (error instanceof HttpException) {
        throw error;
      }

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
      this.currentDatabase = null;
    }
  }

  // ============================================================
  // Status & Getters
  // ============================================================

  getStatus(): {
    connected: boolean;
    uri: string | null;
    database: string | null;
  } {
    return {
      connected: this.driver !== null,
      uri: this.currentUri,
      database: this.currentDatabase,
    };
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
  async switchDatabase(database: string): Promise<void> {
    if (!this.driver) {
      throw new HttpException(
        'Vui lòng kết nối Database trước!',
        HttpStatus.BAD_REQUEST,
      );
    }
    const requestedDatabase = database.trim();
    if (!requestedDatabase) {
      throw new HttpException(
        'Thiếu field "database"',
        HttpStatus.BAD_REQUEST,
      );
    }

    const previousDatabase = this.currentDatabase;
    const databases = await this.listDatabases();
    this.assertDatabaseExists(requestedDatabase, databases);

    this.currentDatabase = requestedDatabase;
    try {
      await this.assertDatabaseUsable(requestedDatabase);
    } catch (error) {
      this.currentDatabase = previousDatabase;
      throw error;
    }
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

  private assertDatabaseExists(database: string, databases: string[]): void {
    if (databases.includes(database)) return;
    throw new HttpException(
      `Database '${database}' không tồn tại hoặc không online trong Neo4j instance hiện tại`,
      HttpStatus.BAD_REQUEST,
    );
  }

  private async assertDatabaseUsable(database: string): Promise<void> {
    const totalNodes = await this.countAllNodes();
    if (totalNodes === 0 || this.schemaCacheExists(database)) return;

    throw new HttpException(
      `Database '${database}' đã có dữ liệu nhưng hệ thống chưa có schema cache '${this.schemaCacheFileName(database)}'. Vui lòng chọn đúng database hoặc tạo/đổi tên schema tương ứng.`,
      HttpStatus.BAD_REQUEST,
    );
  }

  private async countAllNodes(): Promise<number> {
    const session = this.getReadSession();
    try {
      const res = await session.run('MATCH (n) RETURN count(n) AS c');
      const c = res.records[0]?.get('c');
      return typeof c === 'number' ? c : Number(c?.toNumber?.() ?? c ?? 0);
    } finally {
      await session.close();
    }
  }

  private schemaCacheExists(database: string): boolean {
    return fs.existsSync(this.schemaCacheFilePath(database));
  }

  private schemaCacheFilePath(database: string): string {
    return path.resolve(
      process.cwd(),
      'data',
      'schemas',
      this.schemaCacheFileName(database),
    );
  }

  private schemaCacheFileName(database: string): string {
    return `schema_${this.sanitizeDatabaseName(database)}.txt`;
  }

  private sanitizeDatabaseName(database: string): string {
    return database.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
  }

  private async clearConnection(): Promise<void> {
    if (this.driver) {
      await this.driver.close().catch(() => undefined);
    }
    this.driver = null;
    this.currentUri = null;
    this.currentDatabase = null;
  }

  async onModuleDestroy() {
    if (this.driver) await this.driver.close();
  }
}
