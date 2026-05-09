export interface ClassificationSchema {
  node_id: string | null;
  relation_cols: string[];
  feature: string[];
}

export interface FullSchema {
  node_id: string;
  relation_cols: string[];
  /**
   * RAW feature column names (giống tên trong CSV input).
   * Dùng cho nodes.csv (raw values) và Neo4j ingest properties.
   */
  feature_cols: string[];
  /**
   * ENCODED feature column names sau one-hot + cast float.
   * Dùng cho preprocessed.csv → data.pt (sidecar build PyG x tensor).
   */
  encoded_feature_cols: string[];
  target_label: string;
  train_ratio: number;
  val_ratio: number;
  seed: number;
  max_group_size: number;
}

export type CsvRow = Record<string, any>;

export interface EdgeRow {
  src_id: string | number;
  dst_id: string | number;
  relation_type: string;
}
