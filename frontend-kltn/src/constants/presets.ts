import { NEO4J_URI_REGEX } from "../api/endpoint";

/**
 * URI mẫu để user click chọn — tránh gõ tay lúc demo.
 * Thêm/bớt tuỳ môi trường dev của bạn.
 */
export const NEO4J_URI_PRESETS: ReadonlyArray<{
  label: string;
  uri: string;
}> = [
  { label: "Local default", uri: "bolt://localhost:7687" },
  { label: "Local alt port", uri: "bolt://localhost:7688" },
  { label: "Docker host", uri: "bolt://host.docker.internal:7687" },
];

export const DEFAULT_NEO4J_USER = "neo4j";

/**
 * Validate URI trước khi gọi API. Trả về null nếu hợp lệ,
 * hoặc string message để form hiển thị.
 *
 * Regex match đúng DTO BE: /^(bolt|neo4j)(\+s|\+ssc)?:\/\/.+/
 */
export function validateNeo4jUri(uri: string): string | null {
  const trimmed = uri.trim();
  if (!trimmed) return "URI không được để trống";
  if (!NEO4J_URI_REGEX.test(trimmed)) {
    return "URI phải bắt đầu bằng bolt:// hoặc neo4j:// (VD: bolt://localhost:7687)";
  }
  return null;
}

/**
 * Validate user (khớp yêu cầu tối thiểu phía BE).
 */
export function validateNeo4jUser(user: string): string | null {
  if (!user.trim()) return "User không được để trống";
  return null;
}

/**
 * Validate password.
 */
export function validateNeo4jPassword(password: string): string | null {
  if (!password) return "Password không được để trống";
  return null;
}
