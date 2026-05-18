// ============================================================
// Base API envelope (khớp global exception filter của BE)
// ============================================================

export type ApiSuccess<T = unknown> = { status: "success" } & T;

export type ApiError = {
  status: "error";
  message: string | string[];
  statusCode: number;
};

/**
 * Shape lỗi sau khi interceptor axios flatten `message: string | string[]`
 * về `messages: string[]` để UI consume đồng nhất.
 */
export type NormalizedApiError = {
  status: "error";
  messages: string[];
  statusCode: number;
};

// ============================================================
// Neo4j endpoints
// ============================================================

export type ConnectNeo4jRequest = {
  uri: string;
  user: string;
  password: string;
  /** Database name thật trong Neo4j instance. */
  database: string;
};

export type ConnectNeo4jResponse = ApiSuccess<{ message: string; database: string }>;
export type DisconnectNeo4jResponse = ApiSuccess<{ message: string }>;

export type Neo4jStatusResponse = ApiSuccess<{
  connected: boolean;
  uri: string | null;
  database: string | null;
}>;

/** GET /neo4j/databases — danh sách database online từ SHOW DATABASES */
export type DatabasesResponse = ApiSuccess<{ databases: string[] }>;

/** POST /neo4j/switch-database */
export type SwitchDatabaseResponse = ApiSuccess<{
  message: string;
  database: string;
}>;

// ============================================================
// Graph query
// ============================================================

export type GraphNode = {
  id: string;
  label: string;
  properties: Record<string, unknown>;
};

export type GraphLink = {
  source: string;
  target: string;
  type: string;
  properties: Record<string, unknown>;
};

export type GraphData = {
  nodes: GraphNode[];
  links: GraphLink[];
};

export type Scalar = Record<string, unknown>;

export type QueryRequest = {
  prompt: string;
};

export type QueryMetadata = {
  retries: number;
  cypherV1?: string;
  cypherV2?: string;
};

export type QueryResponse = ApiSuccess<{
  generatedCypher: string;
  graphData: GraphData;
  scalars: Scalar[];
  metadata?: QueryMetadata;
}>;

// ============================================================
// Query state machine (dùng từ M1, M3 sẽ consume)
// ============================================================

export const QueryStage = {
  IDLE: "IDLE",
  SENDING: "SENDING",
  SCHEMA_LINKING: "SCHEMA_LINKING",
  GENERATING: "GENERATING",
  VALIDATING: "VALIDATING",
  EXECUTING: "EXECUTING",
  DONE: "DONE",
  ERROR: "ERROR",
  CANCELLED: "CANCELLED",
} as const;
export type QueryStage = (typeof QueryStage)[keyof typeof QueryStage];

// ============================================================
// CSV2Graph endpoints
// ============================================================

export type DatasetInfoResponse = ApiSuccess<{
  hasData: boolean;
  nodeLabel?: string;
  columns?: string[];
  targetLabel?: string;
  numNodes?: number;
  jobId?: string;
  /** true nếu đã train GNN model — FE dùng để hiển thị "Có thể Inference Fraud" */
  hasModel?: boolean;
}>;

export type Csv2GraphFullSchema = {
  node_id: string;
  relation_cols: string[];
  feature_cols: string[];
  encoded_feature_cols: string[];
  target_label: string;
  train_ratio: number;
  val_ratio: number;
  seed: number;
  max_group_size: number;
};

export type Csv2GraphStats = {
  inputRows: number;
  numNodes: number;
  numEdges: number;
  numFeatures: number;
  numEncodedFeatures: number;
  numRelationTypes: number;
  ingested?: { nodes: number; relationships: number };
  inference?: {
    total: number;
    predictedFraud: number;
    threshold: number;
    inferenceMs?: number;
  };
};

export type Csv2GraphFiles = {
  inputCsv: string;
  nodesCsv: string;
  edgesCsv: string;
  schemaJson: string;
  preprocessedCsv?: string;
  dataPt?: string;
};

export type Csv2GraphTrainingResult = {
  success: boolean;
  modelPath: string;
  activeModelPath: string;
  epochsRun: number;
  bestMetric: number | null;
  threshold?: number | null;
  metrics?: {
    val?: Record<string, number | null>;
    test?: Record<string, number | null>;
  };
};

export type Csv2GraphInferenceResult = {
  success: boolean;
  dataPt: string;
  total: number;
  predictedFraud: number;
  threshold: number;
  gnnVersion?: string;
  inferenceMs?: number;
};

export type Csv2GraphPretrainedResult = {
  success: true;
  activeModelPath: string;
  targetLabel: "is_fraud";
};

export type Csv2GraphRunResponse = ApiSuccess<{
  jobId: string;
  mode: "full" | "append";
  canonicalJobId?: string;
  schema: Csv2GraphFullSchema;
  stats: Csv2GraphStats;
  files: Csv2GraphFiles;
  training?: Csv2GraphTrainingResult;
  pretrained?: Csv2GraphPretrainedResult;
  inference?: Csv2GraphInferenceResult;
}>;

export type GraphPreviewResponse = ApiSuccess<{
  nodeLabel: string;
  graphData: GraphData;
  scalars: Scalar[];
}>;

export type SuggestedPrompt = {
  label: string;
  prompt: string;
};

export type SuggestedPromptsResponse = ApiSuccess<{
  prompts: SuggestedPrompt[];
}>;

/** POST /csv2graph/suggest-transaction-id */
export type SuggestTransactionIdResponse = ApiSuccess<{
  /** Cột được LLM gợi ý, null nếu không xác định được */
  suggestion: string | null;
  /** Danh sách cột unique (số lượng giá trị duy nhất = số rows) */
  uniqueCols: string[];
}>;

// ============================================================
// History (persist qua F5)
// ============================================================

export type HistoryEntry = {
  id: string;
  prompt: string;
  createdAt: number;
  cypher?: string;
  graphData?: GraphData;
  scalars?: Scalar[];
  error?: string;
  metadata?: QueryMetadata;
};
