import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Neo4jService } from '../neo4j/neo4j.service';
import {
  CsvRow,
  EdgeRow,
} from './interfaces/classification-schema.interface';

/**
 * Auto-ingest nodes + relationships vào Neo4j đang connected.
 *
 * Schema:
 *   (:<NodeLabel> {node_id, ...features, <target_label>})
 *   -[:SAME_<RELATION_COL_UPPER>]->
 *   (:<NodeLabel>)
 *
 * Dùng APOC nếu có (apoc.create.relationship cho dynamic rel type),
 * fallback dùng 1 type chung 'SAME_RELATION' với property 'type'.
 */
@Injectable()
export class Neo4jIngestService {
  private readonly logger = new Logger(Neo4jIngestService.name);

  constructor(
    private readonly neo4jService: Neo4jService,
    private readonly config: ConfigService,
  ) {}

  async ingest(
    rows: CsvRow[],
    edges: EdgeRow[],
    nodeIdCol: string,
    featureCols: string[],
    targetLabel: string,
    nodeLabel: string,
  ): Promise<{ nodes: number; relationships: number }> {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(nodeLabel)) {
      throw new HttpException(
        `nodeLabel '${nodeLabel}' chứa ký tự không hợp lệ`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const useApoc = await this.shouldUseApoc();
    this.logger.log(
      `Ingest mode: ${useApoc ? 'APOC dynamic relationship type' : 'fallback SAME_RELATION + type prop'}`,
    );

    const nodeBatchSize = Number(
      this.config.get<string>('CSV2GRAPH_NODE_BATCH_SIZE') ?? 5000,
    );
    const edgeBatchSize = Number(
      this.config.get<string>('CSV2GRAPH_EDGE_BATCH_SIZE') ?? 10000,
    );

    const ingestedNodes = await this.ingestNodes(
      rows,
      nodeIdCol,
      featureCols,
      targetLabel,
      nodeLabel,
      nodeBatchSize,
    );

    const ingestedRels = await this.ingestEdges(
      edges,
      nodeLabel,
      useApoc,
      edgeBatchSize,
    );

    return { nodes: ingestedNodes, relationships: ingestedRels };
  }

  // ============================================================
  // PRIVATE
  // ============================================================

  private async shouldUseApoc(): Promise<boolean> {
    const flag = this.config.get<string>('CSV2GRAPH_USE_APOC');
    if (flag === 'false') return false;
    if (flag === 'true') return true;
    return await this.neo4jService.hasApoc();
  }

  private async ingestNodes(
    rows: CsvRow[],
    nodeIdCol: string,
    featureCols: string[],
    targetLabel: string,
    nodeLabel: string,
    batchSize: number,
  ): Promise<number> {
    if (rows.length === 0) return 0;

    const session = this.neo4jService.getWriteSession();
    let total = 0;
    try {
      const cypher = `
        UNWIND $batch AS row
        MERGE (n:${nodeLabel} {node_id: row.node_id})
        SET n += row.props
      `;

      for (let i = 0; i < rows.length; i += batchSize) {
        const slice = rows.slice(i, i + batchSize);
        const batch = slice.map((r) => {
          const props: Record<string, unknown> = {};
          for (const c of featureCols) {
            if (c in r) props[c] = r[c];
          }
          if (targetLabel in r) props[targetLabel] = r[targetLabel];
          return { node_id: r[nodeIdCol], props };
        });
        await session.run(cypher, { batch });
        total += slice.length;
        this.logger.log(`  -> nodes: ${total}/${rows.length}`);
      }
    } finally {
      await session.close();
    }

    return total;
  }

  private async ingestEdges(
    edges: EdgeRow[],
    nodeLabel: string,
    useApoc: boolean,
    batchSize: number,
  ): Promise<number> {
    if (edges.length === 0) return 0;

    const session = this.neo4jService.getWriteSession();
    let total = 0;
    try {
      const cypher = useApoc
        ? `
            UNWIND $batch AS r
            MATCH (a:${nodeLabel} {node_id: r.src_id})
            MATCH (b:${nodeLabel} {node_id: r.dst_id})
            CALL apoc.create.relationship(a, 'SAME_' + toUpper(r.relation_type), {}, b) YIELD rel
            RETURN count(rel) AS c
          `
        : `
            UNWIND $batch AS r
            MATCH (a:${nodeLabel} {node_id: r.src_id})
            MATCH (b:${nodeLabel} {node_id: r.dst_id})
            MERGE (a)-[rel:SAME_RELATION {type: r.relation_type}]->(b)
            RETURN count(rel) AS c
          `;

      for (let i = 0; i < edges.length; i += batchSize) {
        const slice = edges.slice(i, i + batchSize);
        await session.run(cypher, { batch: slice });
        total += slice.length;
        this.logger.log(`  -> edges: ${total}/${edges.length}`);
      }
    } finally {
      await session.close();
    }

    return total;
  }
}
