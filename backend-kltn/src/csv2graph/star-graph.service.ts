import { Injectable, Logger } from '@nestjs/common';
import {
  CsvRow,
  EdgeRow,
} from './interfaces/classification-schema.interface';

/**
 * Tương đương _group_indices_by_value + _star_edges_from_group +
 * build_edges_from_column + build_neo4j_csvs (phần edges) ở
 * graph_utils.py + pipeline.py.
 *
 * Star topology: trong mỗi group có cùng giá trị relation_col,
 * node đầu tiên (center) nối với mọi node khác (leaf), cả 2 chiều.
 * Group quá lớn → sample down về maxGroupSize trước khi build star.
 *
 * Complexity: O(n) edges per group thay vì O(n^2) nếu full mesh.
 */
@Injectable()
export class StarGraphService {
  private readonly logger = new Logger(StarGraphService.name);

  buildStarEdges(
    rows: CsvRow[],
    nodeIdCol: string,
    relationCols: string[],
    maxGroupSize: number,
  ): EdgeRow[] {
    const edges: EdgeRow[] = [];

    for (const col of relationCols) {
      if (rows.length === 0 || !(col in rows[0])) {
        this.logger.warn(`relation col '${col}' không có trong rows, bỏ qua`);
        continue;
      }
      const before = edges.length;
      this.appendStarEdgesFromColumn(rows, nodeIdCol, col, maxGroupSize, edges);
      this.logger.log(
        `relation '${col}': +${edges.length - before} edges (cumulative ${edges.length})`,
      );
    }

    return edges;
  }

  // ============================================================
  // PRIVATE
  // ============================================================

  private appendStarEdgesFromColumn(
    rows: CsvRow[],
    nodeIdCol: string,
    relCol: string,
    maxGroupSize: number,
    out: EdgeRow[],
  ): void {
    const groups = this.groupNodeIdsByValue(rows, nodeIdCol, relCol);

    for (const members of groups.values()) {
      if (members.length < 2) continue;
      const sampled =
        members.length > maxGroupSize
          ? this.randomSample(members, maxGroupSize)
          : members;

      const center = sampled[0];
      for (let i = 1; i < sampled.length; i++) {
        const other = sampled[i];
        out.push({ src_id: center, dst_id: other, relation_type: relCol });
        out.push({ src_id: other, dst_id: center, relation_type: relCol });
      }
    }
  }

  private groupNodeIdsByValue(
    rows: CsvRow[],
    nodeIdCol: string,
    relCol: string,
  ): Map<string, Array<string | number>> {
    const groups = new Map<string, Array<string | number>>();
    for (const row of rows) {
      const v = row[relCol];
      if (v === null || v === undefined || v === '') continue;
      const key = String(v);
      const nodeId = row[nodeIdCol];
      const arr = groups.get(key);
      if (arr) arr.push(nodeId);
      else groups.set(key, [nodeId]);
    }
    return groups;
  }

  /**
   * Fisher-Yates partial shuffle để lấy k phần tử ngẫu nhiên,
   * tương đương random.sample(arr, k) trong Python.
   */
  private randomSample<T>(arr: T[], k: number): T[] {
    const copy = arr.slice();
    const n = copy.length;
    const limit = Math.min(k, n);
    for (let i = 0; i < limit; i++) {
      const j = i + Math.floor(Math.random() * (n - i));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, limit);
  }
}
