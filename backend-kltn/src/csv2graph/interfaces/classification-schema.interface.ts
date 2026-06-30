export type EncodingType =
  | 'numeric'
  | 'binary'
  | 'ordinal'
  | 'cyclical'
  | 'datetime'
  | 'target';

export interface EncodingHint {
  type: EncodingType;
  period?: number;
  order?: string[];
}

export interface ClassificationSchema {
  node_id: string | null;
  relation_cols: string[];
  rel_hetero: string[];
  feature: string[];
  feature_hetero: string[];
  encoding_hints: Record<string, EncodingHint>;
}

export interface FullSchema {
  node_id: string;
  relation_cols: string[];
  rel_hetero: string[];
  /**
   * RAW feature column names (giống tên trong CSV input).
   * Dùng cho nodes.csv (raw values) và Neo4j ingest properties.
  */
  feature_cols: string[];
  feature_hetero: string[];
  /**
   * ENCODED feature column names sau Target/Frequency Encoding.
   * Số lượng cột bằng feature_cols.length (không phình chiều như one-hot).
   * Dùng cho preprocessed.csv → data.pt (sidecar build PyG x tensor).
   */
  encoded_feature_cols: string[];
  encoding_hints: Record<string, EncodingHint>;
  /**
   * Target Encoding maps cho từng categorical column.
   * Cấu trúc: { [colName]: { [categoryValue]: encodedFloat, '__MISSING__': globalMean } }
   * Dùng để sidecar Python tái hiện encoding khi inference mà không cần raw data.
   */
  encoding_maps: Record<string, Record<string, number>>;
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
