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
};

export type ConnectNeo4jResponse = ApiSuccess<{ message: string }>;
export type DisconnectNeo4jResponse = ApiSuccess<{ message: string }>;

export type Neo4jStatusResponse = ApiSuccess<{
  connected: boolean;
  uri: string | null;
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

export type QueryResponse = ApiSuccess<{
  generatedCypher: string;
  graphData: GraphData;
  scalars: Scalar[];
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
};
