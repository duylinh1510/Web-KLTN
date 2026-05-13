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
 * ─── Tối ưu hiệu năng (so với bản cũ) ───────────────────────────────────────
 *
 *  1. CONSTRAINT + INDEX trước khi ingest
 *     Tạo UNIQUE CONSTRAINT trên node_id cho Transaction và value cho Aux nodes.
 *     Neo4j bắt buộc đánh index trước khi MERGE → MERGE tra cứu O(1) thay vì O(N).
 *
 *  2. CREATE thay MERGE cho Full Build (DB rỗng)
 *     MERGE = lookup + create (2 ops). CREATE = 1 op.
 *     Khi DB đang rỗng (full build) → dùng CREATE trực tiếp.
 *     Append mode vẫn dùng MERGE (upsert an toàn).
 *
 *  3. executeWrite() — tự động retry + explicit transaction
 *     Neo4j driver quản lý transaction scope rõ ràng + tự retry khi leader failover.
 *     Tốt hơn session.run() (implicit auto-commit) về throughput.
 *
 *  4. Batch size lớn hơn: nodes 50k, edges 20k (cũ: 5k / 10k)
 *     Giảm số roundtrip TCP + số lần commit transaction.
 *     Có thể điều chỉnh qua env CSV2GRAPH_NODE_BATCH_SIZE / CSV2GRAPH_EDGE_BATCH_SIZE.
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
    isAppend: boolean = false,
  ): Promise<{ nodes: number; relationships: number }> {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(nodeLabel)) {
      throw new HttpException(
        `nodeLabel '${nodeLabel}' chứa ký tự không hợp lệ`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const nodeBatchSize = Number(
      this.config.get<string>('CSV2GRAPH_NODE_BATCH_SIZE') ?? 50000,
    );
    const edgeBatchSize = Number(
      this.config.get<string>('CSV2GRAPH_EDGE_BATCH_SIZE') ?? 20000,
    );

    // Bước 0: Đảm bảo index / constraint tồn tại (idempotent)
    await this.ensureConstraints(nodeLabel, edges);

    // Bước 1: Ingest transaction nodes
    const ingestedNodes = await this.ingestTransactionNodes(
      rows,
      nodeIdCol,
      featureCols,
      targetLabel,
      nodeLabel,
      nodeBatchSize,
      isAppend,
    );

    // Bước 2: Ingest auxiliary nodes + relationships (heterogeneous)
    const ingestedRels = await this.ingestHeterogeneousEdges(
      edges,
      rows,
      nodeIdCol,
      nodeLabel,
      edgeBatchSize,
      isAppend,
    );

    return { nodes: ingestedNodes, relationships: ingestedRels };
  }

  // ============================================================
  // STEP 0 — Constraints & Indexes
  // ============================================================

  /**
   * Tạo UNIQUE CONSTRAINT cho Transaction.node_id và mỗi AuxNode.value.
   * Neo4j tự động tạo backing index khi constraint được tạo.
   * Dùng IF NOT EXISTS (idempotent — chạy nhiều lần không lỗi).
   *
   * Tại sao quan trọng:
   *   MERGE (n:Transaction {node_id: x}) không có index → full node scan O(N).
   *   Với index → O(1) lookup. Với 1M nodes, khác biệt là hàng chục phút.
   */
  private async ensureConstraints(
    nodeLabel: string,
    edges: EdgeRow[],
  ): Promise<void> {
    const session = this.neo4jService.getWriteSession();
    try {
      // Constraint cho Transaction node
      const txConstraint = `constraint_${nodeLabel.toLowerCase()}_node_id`;
      await session.run(
        `CREATE CONSTRAINT ${txConstraint} IF NOT EXISTS
         FOR (n:${nodeLabel}) REQUIRE n.node_id IS UNIQUE`,
      );
      this.logger.log(`  [idx] UNIQUE constraint on :${nodeLabel}(node_id) — OK`);

      // Constraints cho mỗi loại Auxiliary node
      const relTypes = [...new Set(edges.map((e) => String(e.relation_type)))];
      for (const relType of relTypes) {
        const auxLabel = this.toAuxNodeLabel(relType);
        const auxConstraint = `constraint_${auxLabel.toLowerCase()}_value`;
        await session.run(
          `CREATE CONSTRAINT ${auxConstraint} IF NOT EXISTS
           FOR (n:${auxLabel}) REQUIRE n.value IS UNIQUE`,
        );
        this.logger.log(`  [idx] UNIQUE constraint on :${auxLabel}(value) — OK`);
      }
    } catch (err: any) {
      // Log cảnh báo nhưng không fail — constraint có thể đã tồn tại với tên khác
      this.logger.warn(`  [idx] Constraint creation warning (non-fatal): ${err?.message}`);
    } finally {
      await session.close();
    }
  }

  // ============================================================
  // STEP 1 — Transaction Nodes
  // ============================================================

  /**
   * Ingest transaction nodes vào Neo4j.
   *
   * Full Build (isAppend=false): dùng CREATE — nhanh hơn MERGE vì không cần lookup.
   * Append Build (isAppend=true): dùng MERGE — upsert an toàn, tránh duplicate.
   *
   * Dùng executeWrite() để có explicit managed transaction thay vì auto-commit.
   */
  private async ingestTransactionNodes(
    rows: CsvRow[],
    nodeIdCol: string,
    featureCols: string[],
    targetLabel: string,
    nodeLabel: string,
    batchSize: number,
    isAppend: boolean,
  ): Promise<number> {
    if (rows.length === 0) return 0;

    // Full build → CREATE (không cần lookup, DB đang rỗng)
    // Append   → MERGE  (upsert: update nếu đã có, create nếu chưa có)
    const cypher = isAppend
      ? `UNWIND $batch AS row
         MERGE (n:${nodeLabel} {node_id: row.node_id})
         SET n += row.props`
      : `UNWIND $batch AS row
         CREATE (n:${nodeLabel})
         SET n.node_id = row.node_id, n += row.props`;

    const session = this.neo4jService.getWriteSession();
    let total = 0;
    const startTime = Date.now();

    try {
      for (let i = 0; i < rows.length; i += batchSize) {
        const slice = rows.slice(i, i + batchSize);
        const batch = slice.map((r) => {
          const props: Record<string, unknown> = {};
          for (const c of featureCols) {
            if (c in r) props[c] = r[c];
          }
          if (targetLabel && targetLabel in r) props[targetLabel] = r[targetLabel];
          return { node_id: String(r[nodeIdCol]), props };
        });

        await session.executeWrite((tx) => tx.run(cypher, { batch }));

        total += slice.length;
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const rate = Math.round(total / ((Date.now() - startTime) / 1000));
        this.logger.log(
          `  -> nodes: ${total}/${rows.length}` +
          ` | ${elapsed}s | ~${rate.toLocaleString()} nodes/s`,
        );
      }
    } finally {
      await session.close();
    }

    const totalSec = ((Date.now() - startTime) / 1000).toFixed(1);
    this.logger.log(
      `  [nodes done] ${total.toLocaleString()} nodes in ${totalSec}s` +
      ` (${isAppend ? 'MERGE' : 'CREATE'})`,
    );
    return total;
  }

  // ============================================================
  // STEP 2 — Heterogeneous Edges + Auxiliary Nodes
  // ============================================================

  /**
   * Ingest heterogeneous edges theo từng relation_type.
   *
   * Với mỗi edge (src_id → dst_id, relation_type = "merchant"):
   *   1. Tìm auxiliary node label: "MerchantNode"
   *   2. MERGE auxiliary node: (:MerchantNode {value: dst_id})
   *   3. MERGE edge: (:Transaction {node_id: src_id})-[:HAS_MERCHANT]->(:MerchantNode {value: dst_id})
   *
   * Auxiliary nodes và edges luôn dùng MERGE (tập unique values nhỏ, cần idempotent).
   */
  private async ingestHeterogeneousEdges(
    edges: EdgeRow[],
    rows: CsvRow[],
    nodeIdCol: string,
    nodeLabel: string,
    batchSize: number,
    isAppend: boolean,
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
      const auxLabel = this.toAuxNodeLabel(relType);
      const relTypeName = `HAS_${relType.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;

      this.logger.log(
        `  -> Ingesting ${relEdges.length.toLocaleString()} edges: ` +
        `(:${nodeLabel})-[:${relTypeName}]->(:${auxLabel})`,
      );

      // Bước 2a: MERGE auxiliary nodes (unique values — tập nhỏ)
      const uniqueValues = [...new Set(relEdges.map((e) => String(e.dst_id)))];
      await this.mergeAuxiliaryNodes(auxLabel, uniqueValues, batchSize);

      // Bước 2b: MERGE relationships Transaction → AuxiliaryNode
      // Dùng MERGE luôn vì rel có thể bị duplicate khi append
      const relCypher = `
        UNWIND $batch AS r
        MATCH (src:${nodeLabel} {node_id: r.src_id})
        MATCH (dst:${auxLabel} {value: r.dst_id})
        MERGE (src)-[:${relTypeName}]->(dst)
      `;

      const relSession = this.neo4jService.getWriteSession();
      const relStart = Date.now();
      try {
        for (let i = 0; i < relEdges.length; i += batchSize) {
          const slice = relEdges.slice(i, i + batchSize);
          const batch = slice.map((e) => ({
            src_id: String(e.src_id),
            dst_id: String(e.dst_id),
          }));
          await relSession.executeWrite((tx) => tx.run(relCypher, { batch }));
          totalRels += slice.length;
          this.logger.log(
            `  -> [${relTypeName}] ${Math.min(i + batchSize, relEdges.length)}/${relEdges.length}`,
          );
        }
      } finally {
        await relSession.close();
      }

      const relSec = ((Date.now() - relStart) / 1000).toFixed(1);
      this.logger.log(`  [${relTypeName} done] in ${relSec}s`);
    }

    return totalRels;
  }

  /**
   * MERGE auxiliary nodes (giá trị unique của relation col).
   * Tập này thường nhỏ (vài nghìn merchants, categories...) → MERGE OK.
   */
  private async mergeAuxiliaryNodes(
    auxLabel: string,
    values: string[],
    batchSize: number,
  ): Promise<void> {
    if (values.length === 0) return;

    const session = this.neo4jService.getWriteSession();
    const cypher = `
      UNWIND $batch AS v
      MERGE (:${auxLabel} {value: v})
    `;
    try {
      for (let i = 0; i < values.length; i += batchSize) {
        const slice = values.slice(i, i + batchSize);
        await session.executeWrite((tx) => tx.run(cypher, { batch: slice }));
        this.logger.log(
          `  -> aux (:${auxLabel}): ${Math.min(i + batchSize, values.length)}/${values.length}`,
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
