import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Neo4jService } from '../neo4j/neo4j.service';
import {
  CsvRow,
  EdgeRow,
} from './interfaces/classification-schema.interface';

/**
 * Neo4j Ingest Service — Heterogeneous Graph
 *
 * Sơ đồ schema (heterogeneous):
 *   (:Transaction {node_id, ...features, <target_label>})
 *   -[:HAS_<RELATION_COL_UPPER>]->
 *   (:<RelationColTitle>Node {value: <raw_value>})
 *
 * Ví dụ với relation_cols = ["merchant", "category"]:
 *   (:Transaction)-[:HAS_MERCHANT]->(:MerchantNode {value: "amazon"})
 *   (:Transaction)-[:HAS_CATEGORY]->(:CategoryNode {value: "shopping"})
 *
 * Không dùng APOC. Không dùng SAME_RELATION.
 * Đây là heterogeneous graph — phân biệt rõ Transaction node và Auxiliary node.
 *
 * NOTE: data.pt (dùng cho GNN training) vẫn dùng homogeneous star topology riêng biệt.
 * Hai luồng này hoàn toàn độc lập.
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

    const nodeBatchSize = Number(
      this.config.get<string>('CSV2GRAPH_NODE_BATCH_SIZE') ?? 5000,
    );
    const edgeBatchSize = Number(
      this.config.get<string>('CSV2GRAPH_EDGE_BATCH_SIZE') ?? 10000,
    );

    // Bước 1: Ingest transaction nodes
    const ingestedNodes = await this.ingestTransactionNodes(
      rows,
      nodeIdCol,
      featureCols,
      targetLabel,
      nodeLabel,
      nodeBatchSize,
    );

    // Bước 2: Ingest auxiliary nodes + relationships (heterogeneous)
    const ingestedRels = await this.ingestHeterogeneousEdges(
      edges,
      rows,
      nodeIdCol,
      nodeLabel,
      edgeBatchSize,
    );

    return { nodes: ingestedNodes, relationships: ingestedRels };
  }

  // ============================================================
  // PRIVATE — Transaction Nodes
  // ============================================================

  /**
   * MERGE transaction nodes vào Neo4j.
   * Mỗi row là một node với node_id + feature props + target_label.
   */
  private async ingestTransactionNodes(
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
        this.logger.log(`  -> transaction nodes: ${total}/${rows.length}`);
      }
    } finally {
      await session.close();
    }

    return total;
  }

  // ============================================================
  // PRIVATE — Heterogeneous Edges + Auxiliary Nodes
  // ============================================================

  /**
   * Ingest heterogeneous edges theo từng relation_type.
   *
   * Với mỗi edge (src_id → dst_id, relation_type = "merchant"):
   *   1. Tìm auxiliary node label: "MerchantNode"
   *   2. MERGE auxiliary node: (:MerchantNode {value: dst_id})
   *   3. MERGE edge: (:Transaction {node_id: src_id})-[:HAS_MERCHANT]->(:MerchantNode {value: dst_id})
   *
   * Lý do:
   *   - Tránh lỗi SAME_RELATION (không cần APOC, không dùng dynamic rel type)
   *   - Heterogeneous graph rõ ràng, dễ query trong Neo4j Browser
   *   - Mỗi auxiliary entity (Merchant, Category...) là node riêng biệt
   */
  private async ingestHeterogeneousEdges(
    edges: EdgeRow[],
    rows: CsvRow[],
    nodeIdCol: string,
    nodeLabel: string,
    batchSize: number,
  ): Promise<number> {
    if (edges.length === 0) return 0;

    // Nhóm edges theo relation_type để xử lý từng loại riêng
    const groupedByType = new Map<string, EdgeRow[]>();
    for (const edge of edges) {
      const type = String(edge.relation_type);
      if (!groupedByType.has(type)) groupedByType.set(type, []);
      groupedByType.get(type)!.push(edge);
    }

    let totalRels = 0;

    for (const [relType, relEdges] of groupedByType) {
      // Tính auxiliary node label và relationship type
      const auxLabel = this.toAuxNodeLabel(relType);   // vd: "MerchantNode"
      const relTypeName = `HAS_${relType.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;

      this.logger.log(
        `  -> Ingesting ${relEdges.length} edges: ` +
        `(:${nodeLabel})-[:${relTypeName}]->(:${auxLabel})`,
      );

      // Bước 1: MERGE auxiliary nodes (unique values)
      const uniqueValues = [...new Set(relEdges.map((e) => String(e.dst_id)))];
      await this.mergeAuxiliaryNodes(auxLabel, uniqueValues, batchSize);

      // Bước 2: MERGE relationships Transaction → AuxiliaryNode
      const session = this.neo4jService.getWriteSession();
      try {
        const cypher = `
          UNWIND $batch AS r
          MATCH (src:${nodeLabel} {node_id: r.src_id})
          MATCH (dst:${auxLabel} {value: r.dst_id})
          MERGE (src)-[:${relTypeName}]->(dst)
        `;

        for (let i = 0; i < relEdges.length; i += batchSize) {
          const slice = relEdges.slice(i, i + batchSize);
          const batch = slice.map((e) => ({
            src_id: String(e.src_id),
            dst_id: String(e.dst_id),
          }));
          await session.run(cypher, { batch });
          totalRels += slice.length;
          this.logger.log(
            `  -> [${relTypeName}] edges: ${Math.min(i + batchSize, relEdges.length)}/${relEdges.length}`,
          );
        }
      } finally {
        await session.close();
      }
    }

    return totalRels;
  }

  /**
   * MERGE auxiliary nodes (giá trị unique của relation col).
   * Ví dụ: MERGE (:MerchantNode {value: "amazon"})
   */
  private async mergeAuxiliaryNodes(
    auxLabel: string,
    values: string[],
    batchSize: number,
  ): Promise<void> {
    if (values.length === 0) return;

    const session = this.neo4jService.getWriteSession();
    try {
      const cypher = `
        UNWIND $batch AS v
        MERGE (:${auxLabel} {value: v})
      `;

      for (let i = 0; i < values.length; i += batchSize) {
        const slice = values.slice(i, i + batchSize);
        await session.run(cypher, { batch: slice });
        this.logger.log(
          `  -> auxiliary (:${auxLabel}): ${Math.min(i + batchSize, values.length)}/${values.length}`,
        );
      }
    } finally {
      await session.close();
    }
  }

  // ============================================================
  // HELPERS
  // ============================================================

  /**
   * Chuyển relation_col name thành auxiliary node label.
   * Ví dụ: "merchant" → "MerchantNode", "card_type" → "CardTypeNode"
   */
  private toAuxNodeLabel(relType: string): string {
    const pascal = relType
      .split(/[_\s-]+/)
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
      .join('');
    return `${pascal}Node`;
  }
}
