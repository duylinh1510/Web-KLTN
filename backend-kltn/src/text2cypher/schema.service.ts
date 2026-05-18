import { Injectable } from '@nestjs/common';
import { Neo4jService } from '../neo4j/neo4j.service';
import * as fs from 'fs';
import * as path from 'path';

export interface SuggestedPrompt {
  label: string;
  prompt: string;
}

@Injectable()
export class SchemaService {
  // Đường dẫn folder cache schema
  private readonly cacheDir = path.resolve(process.cwd(), 'data', 'schemas');

  constructor(private readonly neo4jService: Neo4jService) {}

  // ============================================================
  // PUBLIC: Lấy full schema (cache hoặc Neo4j)
  // ============================================================

  async getFullSchema(database?: string | null): Promise<string> {
    const id = database ?? this.neo4jService.getCurrentDatabase();

    // Nếu có database name → kiểm tra cache file
    if (id) {
      const cached = this.loadCachedSchema(id);
      if (cached) {
        console.log(`[SchemaService] Schema loaded from cache file: ${this.getCacheFileName(id)}`);
        return cached;
      }
    }

    // Cache miss → lấy từ Neo4j
    console.log('[SchemaService] Cache miss — fetching schema from Neo4j...');
    const schema = await this.getSchemaWithExamples();

    // Lưu cache nếu có database name
    if (id) {
      this.saveSchemaToDisk(id, schema);
      console.log(`[SchemaService] Schema saved to cache: ${this.getCacheFileName(id)}`);
    }

    return schema;
  }

  async getSuggestedFraudPrompts(database?: string | null): Promise<SuggestedPrompt[]> {
    const schema = await this.getFullSchema(database);
    return this.buildFraudPrompts(schema);
  }

  // ============================================================
  // Lấy schema + examples từ Neo4j (trả string trực tiếp)
  // ============================================================

  async getSchemaWithExamples(): Promise<string> {
    const session = this.neo4jService.getReadSession();
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

      // Lấy danh sách labels và properties để query examples
      const nodeLabelsProps: { label: string; props: string[] }[] = [];
      for (const record of nodeRes.records) {
        const label = record.get('nodeType').replace(/[:`]/g, '');
        const rawProps: string[] = record.get('properties');
        const propNames = rawProps.map((p) => p.split(':')[0].trim());
        nodeLabelsProps.push({ label, props: propNames });
      }

      const relTypesProps: { relType: string; props: string[] }[] = [];
      for (const record of relRes.records) {
        const relType = record.get('relType').replace(/[:`]/g, '');
        const rawProps: string[] = record.get('properties');
        const propNames = rawProps.map((p) => p.split(':')[0].trim());
        relTypesProps.push({ relType, props: propNames });
      }

      // Lấy examples cho node properties
      const nodeExamples: Map<string, Map<string, string>> = new Map();
      for (const { label, props } of nodeLabelsProps) {
        const propExamples = new Map<string, string>();
        for (const propName of props) {
          if (!propName) continue;
          const example = await this.getSampleValue(session, label, propName);
          if (example !== null) {
            propExamples.set(propName, String(example));
          }
        }
        nodeExamples.set(label, propExamples);
      }

      // Lấy examples cho relationship properties
      const relExamples: Map<string, Map<string, string>> = new Map();
      for (const { relType, props } of relTypesProps) {
        const propExamples = new Map<string, string>();
        for (const propName of props) {
          if (!propName) continue;
          const example = await this.getRelSampleValue(session, relType, propName);
          if (example !== null) {
            propExamples.set(propName, String(example));
          }
        }
        relExamples.set(relType, propExamples);
      }

      // Format output string (dùng format NestJS + examples)
      let schemaStr = 'Node properties:\n';
      for (const record of nodeRes.records) {
        const label = record.get('nodeType').replace(/[:`]/g, '');
        const rawProps: string[] = record.get('properties');
        const propsWithExamples = rawProps.map((p) => {
          const propName = p.split(':')[0].trim();
          const examples = nodeExamples.get(label);
          const example = examples?.get(propName);
          return example ? `${p} Example: "${example}"` : p;
        });
        schemaStr += `- ${label} {${propsWithExamples.join(', ')}}\n`;
      }

      schemaStr += '\nRelationship properties:\n';
      for (const record of relRes.records) {
        const relType = record.get('relType').replace(/[:`]/g, '');
        const rawProps: string[] = record.get('properties');
        if (rawProps.length > 0) {
          const propsWithExamples = rawProps.map((p) => {
            const propName = p.split(':')[0].trim();
            const examples = relExamples.get(relType);
            const example = examples?.get(propName);
            return example ? `${p} Example: "${example}"` : p;
          });
          schemaStr += `- ${relType} {${propsWithExamples.join(', ')}}\n`;
        } else {
          schemaStr += `- ${relType}\n`;
        }
      }

      schemaStr += '\nRelationship structure:\n';
      for (const record of structRes.records) {
        const from = record.get('from');
        const rel = record.get('rel');
        const to = record.get('to');
        schemaStr += `- (${from})-[:${rel}]->(${to})\n`;
      }

      return schemaStr;
    } finally {
      await session.close();
    }
  }

  // ============================================================
  // Schema Linking: filter schema theo cypher query
  // ============================================================

  filterSchemaByQuery(cypherQuery: string, fullSchema: string): string {
    // Parse node labels từ full schema
    const allLabels = this.extractNodeLabelsFromSchema(fullSchema);

    // Nếu ≤3 labels → trả full schema
    if (allLabels.length <= 3) {
      console.log(`[SchemaService] Schema linking: ≤3 labels (${allLabels.length}), returning full schema`);
      return fullSchema;
    }

    // Tìm mentioned labels trong cypher query
    const mentionedLabels = this.findMentionedLabels(cypherQuery, allLabels);

    // Không tìm thấy → trả full schema
    if (mentionedLabels.size === 0) {
      console.log('[SchemaService] Schema linking: no mentioned labels found, returning full schema');
      return fullSchema;
    }

    console.log(`[SchemaService] Schema linking: found labels [${[...mentionedLabels].join(', ')}]`);

    // Filter schema chỉ giữ labels liên quan
    return this.filterSchemaString(fullSchema, mentionedLabels);
  }

  private buildFraudPrompts(schema: string): SuggestedPrompt[] {
    const nodes = this.parseNodeProps(schema);
    const rels = this.parseRelationships(schema);
    const transactionNode =
      nodes.find((n) => /transaction|payment|order/i.test(n.label)) ??
      nodes[0] ?? { label: 'Transaction', props: [] };
    const fraudProp =
      this.findFraudProperty(transactionNode.props) ??
      this.findFraudProperty(nodes.flatMap((n) => n.props)) ??
      'is_fraud';
    const outgoing = rels.filter((r) => r.from === transactionNode.label);
    const firstRel = outgoing[0];
    const secondRel = outgoing[1] ?? outgoing[0];

    const prompts: SuggestedPrompt[] = [
      {
        label: 'Giao dịch fraud',
        prompt: `Liệt kê 20 ${transactionNode.label} có ${fraudProp} = 1`,
      },
      {
        label: 'Tỷ lệ fraud',
        prompt: `Đếm số ${transactionNode.label} theo ${fraudProp}`,
      },
    ];

    if (firstRel) {
      prompts.push({
        label: `Fraud theo ${this.humanizeLabel(firstRel.to)}`,
        prompt:
          `Tìm top 10 ${firstRel.to} liên quan đến nhiều ` +
          `${transactionNode.label} fraud nhất qua quan hệ ${firstRel.rel}`,
      });
    }

    if (secondRel) {
      prompts.push({
        label: 'Cụm nghi ngờ',
        prompt:
          `Tìm các ${transactionNode.label} fraud chia sẻ cùng ` +
          `${this.humanizeLabel(secondRel.to)} với nhiều giao dịch khác`,
      });
    }

    const numericProp =
      transactionNode.props.find((p) => /amt|amount|money|price|value|score/i.test(p)) ??
      transactionNode.props.find((p) => p !== fraudProp && p !== 'node_id');
    if (numericProp) {
      prompts.push({
        label: `Fraud theo ${numericProp}`,
        prompt:
          `Thống kê ${numericProp} trung bình của ${transactionNode.label} ` +
          `fraud và bình thường`,
      });
    }

    prompts.push({
      label: 'Mẫu quan hệ fraud',
      prompt: `Vẽ graph các ${transactionNode.label} fraud và node liên quan, giới hạn 50 node`,
    });

    return prompts.slice(0, 6);
  }

  private parseNodeProps(schema: string): { label: string; props: string[] }[] {
    const nodes: { label: string; props: string[] }[] = [];
    let inNodeSection = false;
    for (const line of schema.split('\n')) {
      if (line.startsWith('Node properties:')) {
        inNodeSection = true;
        continue;
      }
      if (line.startsWith('Relationship properties:') || line.startsWith('Relationship structure:')) {
        inNodeSection = false;
        continue;
      }
      if (!inNodeSection || !line.startsWith('- ')) continue;

      const match = line.match(/^- ([^{\s]+)\s*(?:\{(.*)\})?/);
      if (!match) continue;
      const propsRaw = match[2] ?? '';
      const props = propsRaw
        .split(',')
        .map((part) => part.split(':')[0]?.trim())
        .filter(Boolean);
      nodes.push({ label: match[1], props });
    }
    return nodes;
  }

  private parseRelationships(schema: string): { from: string; rel: string; to: string }[] {
    const rels: { from: string; rel: string; to: string }[] = [];
    for (const line of schema.split('\n')) {
      const match = line.match(/^- \(([^)]+)\)-\[:([^\]]+)\]->\(([^)]+)\)/);
      if (match) {
        rels.push({ from: match[1], rel: match[2], to: match[3] });
      }
    }
    return rels;
  }

  private findFraudProperty(props: string[]): string | null {
    return (
      props.find((p) => /^is_?fraud$/i.test(p)) ??
      props.find((p) => /fraud|risk|label|prediction|predicted/i.test(p)) ??
      null
    );
  }

  private humanizeLabel(label: string): string {
    return label.replace(/Node$/i, '').replace(/([a-z])([A-Z])/g, '$1 $2');
  }

  // ============================================================
  // PRIVATE: Cache helpers
  // ============================================================

  private loadCachedSchema(database: string): string | null {
    const filePath = this.getCacheFilePath(database);
    try {
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf-8');
      }
    } catch (err) {
      console.log(`[SchemaService] Error reading cache file: ${err}`);
    }
    return null;
  }

  private saveSchemaToDisk(database: string, schema: string): void {
    const filePath = this.getCacheFilePath(database);
    try {
      // Tạo folder nếu chưa tồn tại
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, schema, 'utf-8');
    } catch (err) {
      console.log(`[SchemaService] Error saving cache file: ${err}`);
    }
  }

  private getCacheFilePath(database: string): string {
    return path.join(this.cacheDir, this.getCacheFileName(database));
  }

  private getCacheFileName(database: string): string {
    return `schema_${this.sanitizeDatabaseName(database)}.txt`;
  }

  private sanitizeDatabaseName(database: string): string {
    return database.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
  }

  // ============================================================
  // PRIVATE: Example helpers
  // ============================================================

  private async getSampleValue(session: any, label: string, propName: string): Promise<string | null> {
    try {
      const result = await session.run(
        `MATCH (n:\`${label}\`) WHERE n.\`${propName}\` IS NOT NULL RETURN n.\`${propName}\` AS value LIMIT 1`,
      );
      if (result.records.length > 0) {
        const value = result.records[0].get('value');
        return this.isValidExample(value) ? String(value) : null;
      }
    } catch {
      // Ignore — property hoặc label không tồn tại
    }
    return null;
  }

  private async getRelSampleValue(session: any, relType: string, propName: string): Promise<string | null> {
    try {
      const result = await session.run(
        `MATCH ()-[r:\`${relType}\`]->() WHERE r.\`${propName}\` IS NOT NULL RETURN r.\`${propName}\` AS value LIMIT 1`,
      );
      if (result.records.length > 0) {
        const value = result.records[0].get('value');
        return this.isValidExample(value) ? String(value) : null;
      }
    } catch {
      // Ignore
    }
    return null;
  }

  private isValidExample(value: any, maxLength = 15): boolean {
    if (value === null || value === undefined) return false;

    const valueStr = String(value);
    if (valueStr.length > maxLength) return false;

    if (typeof value === 'string') {
      if (value.toLowerCase() === 'null') return false;
      // Chuỗi hex dài
      if (/^[0-9a-fA-F]+$/.test(value) && value.length > 30) return false;
      // Base64 dài
      if (/^[0-9A-Za-z+/=]+$/.test(value) && value.length > 40) return false;
    }

    return true;
  }

  // ============================================================
  // PRIVATE: Schema parsing & filtering helpers
  // ============================================================

  private extractNodeLabelsFromSchema(schema: string): string[] {
    const labels: string[] = [];
    const lines = schema.split('\n');
    let inNodeSection = false;

    for (const line of lines) {
      if (line.startsWith('Node properties:')) {
        inNodeSection = true;
        continue;
      }
      if (line.startsWith('Relationship properties:') || line.startsWith('Relationship structure:')) {
        inNodeSection = false;
        continue;
      }
      if (inNodeSection && line.startsWith('- ')) {
        // Format: "- LabelName {prop: Type, ...}"
        const match = line.match(/^- (\S+)/);
        if (match) {
          labels.push(match[1]);
        }
      }
    }

    return labels;
  }

  private findMentionedLabels(queryText: string, allLabels: string[]): Set<string> {
    const mentioned = new Set<string>();
    const queryLower = queryText.toLowerCase();

    for (const label of allLabels) {
      const pattern = new RegExp('\\b' + this.escapeRegex(label.toLowerCase()) + '\\b');
      if (pattern.test(queryLower)) {
        mentioned.add(label);
      }
    }

    return mentioned;
  }

  private filterSchemaString(fullSchema: string, mentionedLabels: Set<string>): string {
    const lines = fullSchema.split('\n');
    const filteredLines: string[] = [];
    let currentSection = '';

    for (const line of lines) {
      if (line.startsWith('Node properties:')) {
        currentSection = 'nodes';
        filteredLines.push(line);
        continue;
      }
      if (line.startsWith('Relationship properties:')) {
        currentSection = 'relprops';
        filteredLines.push(line);
        continue;
      }
      if (line.startsWith('Relationship structure:')) {
        currentSection = 'relstruct';
        filteredLines.push(line);
        continue;
      }

      if (currentSection === 'nodes' && line.startsWith('- ')) {
        // Giữ node nếu label nằm trong mentionedLabels
        const match = line.match(/^- (\S+)/);
        if (match && mentionedLabels.has(match[1])) {
          filteredLines.push(line);
        }
      } else if (currentSection === 'relstruct' && line.startsWith('- ')) {
        // Format: "- (From)-[:REL]->(To)" → giữ nếu cả from và to đều trong mentionedLabels
        const match = line.match(/^\- \((\w+)\)-\[:\w+\]->\((\w+)\)/);
        if (match) {
          const from = match[1];
          const to = match[2];
          if (mentionedLabels.has(from) && mentionedLabels.has(to)) {
            filteredLines.push(line);
          }
        } else {
          // Nếu không match pattern, giữ lại để an toàn
          filteredLines.push(line);
        }
      } else if (currentSection === 'relprops') {
        // Giữ tất cả relationship properties (khó filter vì rel có thể dùng cho nhiều nodes)
        filteredLines.push(line);
      } else if (line.trim() === '') {
        filteredLines.push(line);
      }
    }

    return filteredLines.join('\n');
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
