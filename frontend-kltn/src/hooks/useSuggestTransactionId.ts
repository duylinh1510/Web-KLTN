import { useMutation } from "@tanstack/react-query";
import type { SuggestTransactionIdResponse } from "../types";

/**
 * Hook gợi ý transaction_id bằng LLM.
 *
 * Dùng mutation (không dùng query) vì cần truyền file CSV.
 * Call khi user chọn file xong và header đã được parse.
 *
 * Response:
 *   - suggestion: cột LLM gợi ý (null nếu không xác định)
 *   - uniqueCols: danh sách cột có giá trị unique → hiển thị trong dropdown
 */
export function useSuggestTransactionId() {
  return useMutation<SuggestTransactionIdResponse, Error, { file: File }>({
    mutationFn: async ({ file }) => {
      // Gửi file trực tiếp để BE parse CSV + tính unique cols
      const formData = new FormData();
      formData.append("file", file);

      // Dùng fetch trực tiếp vì endpoint trả ApiSuccess shape
      const resp = await fetch(
        `${import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000"}/csv2graph/suggest-transaction-id`,
        { method: "POST", body: formData },
      );
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err?.message ?? "Suggest transaction ID thất bại");
      }
      return resp.json() as Promise<SuggestTransactionIdResponse>;
    },
  });
}
