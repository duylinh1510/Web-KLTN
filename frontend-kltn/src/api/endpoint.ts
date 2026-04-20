import { apiClient } from "./client";
import type {
  ConnectNeo4jRequest,
  ConnectNeo4jResponse,
  DisconnectNeo4jResponse,
  Neo4jStatusResponse,
  QueryRequest,
  QueryResponse,
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
 * Regex validate URI Neo4j phía FE — khớp DTO ở BE.
 * Dùng ở ConnectPanel (M2) để validate trước khi gọi API.
 */
export const NEO4J_URI_REGEX = /^(bolt|neo4j)(\+s|\+ssc)?:\/\/.+/;
