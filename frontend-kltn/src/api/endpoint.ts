import { apiClient } from "./client";
import type {
  ConnectNeo4jRequest,
  ConnectNeo4jResponse,
  DisconnectNeo4jResponse,
  Neo4jStatusResponse,
  DatabasesResponse,
  SwitchDatabaseResponse,
  QueryRequest,
  QueryResponse,
  DatasetInfoResponse,
  Csv2GraphRunResponse,
  GraphPreviewResponse,
  SuggestTransactionIdResponse,
  SuggestedPromptsResponse,
} from "../types";

/**
 * POST /neo4j/connect
 * Mở kết nối tới Neo4j local. 401 nếu sai pass, 400 nếu DTO fail.
 */
export async function connectNeo4j(
  body: ConnectNeo4jRequest,
): Promise<ConnectNeo4jResponse> {
  const res = await apiClient.post<ConnectNeo4jResponse>(
    "/neo4j/connect",
    body,
  );
  return res.data;
}

/**
 * POST /neo4j/disconnect
 * Đóng driver hiện tại.
 */
export async function disconnectNeo4j(): Promise<DisconnectNeo4jResponse> {
  const res =
    await apiClient.post<DisconnectNeo4jResponse>("/neo4j/disconnect");
  return res.data;
}

/**
 * GET /neo4j/status
 * Bootstrap khi F5 để sync store với trạng thái driver ở BE.
 */
export async function getNeo4jStatus(): Promise<Neo4jStatusResponse> {
  const res = await apiClient.get<Neo4jStatusResponse>("/neo4j/status");
  return res.data;
}

/**
 * GET /neo4j/databases
 * Lấy danh sách database online từ SHOW DATABASES.
 * Fallback ["neo4j"] nếu Community Edition.
 */
export async function listDatabases(): Promise<DatabasesResponse> {
  const res = await apiClient.get<DatabasesResponse>("/neo4j/databases");
  return res.data;
}

/**
 * POST /neo4j/switch-database
 * Chuyển sang database khác trong cùng DBMS (không cần reconnect).
 */
export async function switchDatabase(
  database: string,
): Promise<SwitchDatabaseResponse> {
  const res = await apiClient.post<SwitchDatabaseResponse>(
    "/neo4j/switch-database",
    { database },
  );
  return res.data;
}

/**
 * POST /graph/query
 * Prompt NL → Cypher → graph data. Có thể tốn 1-3 phút.
 * Truyền AbortSignal để cho phép user cancel.
 */
export async function queryGraph(
  body: QueryRequest,
  signal?: AbortSignal,
): Promise<QueryResponse> {
  const res = await apiClient.post<QueryResponse>("/graph/query", body, {
    signal,
  });
  return res.data;
}

/**
 * GET /csv2graph/dataset-info
 * Cho FE biết DB hiện tại đã có data chưa + canonical columns.
 * Yêu cầu connect Neo4j (BE trả 400 nếu chưa).
 */
export async function getDatasetInfo(): Promise<DatasetInfoResponse> {
  const res = await apiClient.get<DatasetInfoResponse>("/csv2graph/dataset-info");
  return res.data;
}

/**
 * POST /csv2graph/run (multipart)
 * BE auto-detect mode:
 *   - DB rỗng → full build (LLM classify, ghi data.pt).
 *   - DB đã có data → append (skip LLM, MERGE upsert).
 *
 * Truyền AbortSignal để cho phép user cancel; build có thể tốn vài phút.
 */
export async function runCsv2Graph(
  formData: FormData,
  signal?: AbortSignal,
): Promise<Csv2GraphRunResponse> {
  const res = await apiClient.post<Csv2GraphRunResponse>(
    "/csv2graph/run",
    formData,
    {
      signal,
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 3_600_000,
    },
  );
  return res.data;
}

/**
 * GET /graph/preview
 * Auto-render 10 transaction đầu + neighbors. BE trả 400 nếu DB rỗng
 * hoặc chưa có metadata (caller dùng `enabled: hasData` để tránh).
 */
export async function getGraphPreview(): Promise<GraphPreviewResponse> {
  const res = await apiClient.get<GraphPreviewResponse>("/graph/preview");
  return res.data;
}

/**
 * GET /graph/suggested-prompts
 * Sinh câu hỏi gợi ý từ schema_<database>.txt/cache schema hiện tại.
 */
export async function getSuggestedPrompts(): Promise<SuggestedPromptsResponse> {
  const res = await apiClient.get<SuggestedPromptsResponse>(
    "/graph/suggested-prompts",
  );
  return res.data;
}

/**
 * POST /csv2graph/suggest-transaction-id
 * Gửi headers + sample values, nhận gợi ý cột transaction_id từ LLM.
 */
export async function suggestTransactionId(body: {
  headers: string[];
  sampleValues: Record<string, unknown[]>;
}): Promise<SuggestTransactionIdResponse> {
  const res = await apiClient.post<SuggestTransactionIdResponse>(
    "/csv2graph/suggest-transaction-id",
    body,
  );
  return res.data;
}

/**
 * Regex validate URI Neo4j phía FE — khớp DTO ở BE.
 * Dùng ở ConnectPanel (M2) để validate trước khi gọi API.
 */
export const NEO4J_URI_REGEX = /^(bolt|neo4j)(\+s|\+ssc)?:\/\/.+/;
