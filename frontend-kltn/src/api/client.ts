import axios, { AxiosError, type AxiosInstance } from "axios";
import type { ApiError, NormalizedApiError } from "../types";
import { useConnectionStore } from "../store/connectionStore";
import { useDatasetStore } from "../store/datasetStore";

const BASE_URL = import.meta.env.VITE_API_URL;

if (!BASE_URL) {
  throw new Error(
    "[api/client] VITE_API_URL chưa được set. Kiểm tra file .env ở gốc frontend-kltn/.",
  );
}

export const apiClient: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 200_000,
  headers: {
    "Content-Type": "application/json",
  },
});

// ==============================================================
// Helpers
// ==============================================================

function toMessages(msg: unknown): string[] {
  if (Array.isArray(msg)) return msg.map((m) => String(m));
  if (typeof msg === "string") return [msg];
  return ["Đã xảy ra lỗi không xác định"];
}

function isApiErrorPayload(data: unknown): data is ApiError {
  return (
    !!data &&
    typeof data === "object" &&
    (data as { status?: unknown }).status === "error"
  );
}

// ==============================================================
// AppApiError — class throw chung, implement NormalizedApiError
// ==============================================================

export class AppApiError extends Error implements NormalizedApiError {
  readonly status = "error" as const;
  readonly messages: string[];
  readonly statusCode: number;

  constructor(messages: string[], statusCode: number) {
    super(messages.join(" | "));
    this.name = "AppApiError";
    this.messages = messages;
    this.statusCode = statusCode;
  }
}

export function isAppApiError(e: unknown): e is AppApiError {
  return e instanceof AppApiError;
}

const DB_NOT_CONNECTED_MESSAGE = "Vui lòng kết nối Database trước!";
function buildAppError(messages: string[], statusCode: number): AppApiError {
  // Side effect: BE báo chưa connect → reset cả 2 store để FE sync.
  // Đồng nghĩa: BE đã mất driver (restart, disconnect ngoài ý muốn...).
  // Reset connectionStore → kéo theo isConnected=false → useDataset*
  // hook auto-disable (enabled=false) → tránh refetch lỗi liên tục.
  if (messages.includes(DB_NOT_CONNECTED_MESSAGE)) {
    useConnectionStore.getState().reset();
    useDatasetStore.getState().reset();
  }
  return new AppApiError(messages, statusCode);
}

// ==============================================================
// Response interceptor
// ==============================================================

apiClient.interceptors.response.use(
  (response) => {
    const data = response.data;
    if (isApiErrorPayload(data)) {
      throw buildAppError(
        toMessages(data.message),
        data.statusCode ?? response.status,
      );
    }
    return response;
  },
  (error: AxiosError) => {
    if (axios.isCancel(error) || error.code === "ERR_CANCELED") {
      return Promise.reject(error);
    }
    if (!error.response) {
      const isTimeout = error.code === "ECONNABORTED";
      return Promise.reject(
        buildAppError(
          [
            isTimeout
              ? "Request quá 200s, có thể AI đang self-correct. Thử lại hoặc kiểm tra BE."
              : "Không kết nối được tới server. Kiểm tra BE đang chạy?",
          ],
          0,
        ),
      );
    }
    const data = error.response.data;
    if (isApiErrorPayload(data)) {
      return Promise.reject(
        buildAppError(
          toMessages(data.message),
          data.statusCode ?? error.response.status,
        ),
      );
    }
    return Promise.reject(
      buildAppError(
        [error.message || "Lỗi không xác định"],
        error.response.status,
      ),
    );
  },
);
