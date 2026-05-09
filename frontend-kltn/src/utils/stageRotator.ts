import { QueryStage } from "../types";

type QueryStageValue = (typeof QueryStage)[keyof typeof QueryStage];

/**
 * Map stage → mảng message. UI rotate text (nếu mảng >1 item) mỗi vài giây
 * để user biết app chưa treo (quan trọng khi EXECUTING stuck 30-120s).
 */
export const STAGE_MESSAGES: Record<QueryStageValue, string[]> = {
  [QueryStage.IDLE]: [""],
  [QueryStage.SENDING]: ["Đang gửi câu hỏi tới AI..."],
  [QueryStage.SCHEMA_LINKING]: ["AI đang phân tích schema đồ thị..."],
  [QueryStage.GENERATING]: ["AI đang sinh Cypher..."],
  [QueryStage.VALIDATING]: ["AI đang tự kiểm tra Cypher..."],
  [QueryStage.EXECUTING]: [
    "Đang chạy Cypher trên Neo4j...",
    "Đang tổng hợp kết quả đồ thị...",
    "Quá trình có thể tốn 1-3 phút khi AI self-correct, vui lòng chờ...",
  ],
  [QueryStage.DONE]: [""],
  [QueryStage.ERROR]: [""],
  [QueryStage.CANCELLED]: [""],
};

type StageSetter = (stage: QueryStageValue) => void;

/**
 * Bắt đầu rotator: tự động advance stage theo timeline cố định.
 * Gọi setStage ngay lập tức với SENDING, rồi schedule các stage tiếp theo.
 * Trả về cleanup function — hook/component gọi khi query kết thúc hoặc unmount.
 *
 * Timeline (tính từ lúc gọi):
 *   t=0s:  SENDING
 *   t=1s:  SCHEMA_LINKING
 *   t=3s:  GENERATING
 *   t=6s:  VALIDATING
 *   t=10s: EXECUTING (dừng ở đây; UI sẽ rotate text trong mảng)
 *
 * Khi response về, caller phải gọi cleanup() + setStage(DONE/ERROR/CANCELLED)
 * để ghi đè stage hiện tại.
 */
export function startStageRotator(setStage: StageSetter): () => void {
  setStage(QueryStage.SENDING);

  const timers: number[] = [
    window.setTimeout(() => setStage(QueryStage.SCHEMA_LINKING), 1_000),
    window.setTimeout(() => setStage(QueryStage.GENERATING), 3_000),
    window.setTimeout(() => setStage(QueryStage.VALIDATING), 6_000),
    window.setTimeout(() => setStage(QueryStage.EXECUTING), 10_000),
  ];

  return () => {
    timers.forEach((t) => window.clearTimeout(t));
  };
}
