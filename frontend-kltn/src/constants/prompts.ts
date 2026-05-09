export type PresetPrompt = {
  label: string;
  prompt: string;
};

/**
 * 5 preset prompt cho demo fraud detection.
 * Label ngắn để hiện chip, prompt dài là câu thật gửi lên BE.
 *
 * Khi BE dùng AI_PROVIDER=mock: mọi prompt đều trả Cypher cố định,
 * nhưng UI vẫn hoạt động đúng để demo flow. Khi BE sang ngrok thật,
 * các câu này có ý nghĩa nghiệp vụ rõ ràng cho LLM sinh Cypher hợp lý.
 */
export const PRESET_PROMPTS: ReadonlyArray<PresetPrompt> = [
  {
    label: "Giao dịch fraud",
    prompt: "Tìm các giao dịch được đánh dấu là gian lận và client thực hiện chúng",
  },
  {
    label: "Money mule",
    prompt: "Tìm các tài khoản Mule (trung gian nghi ngờ) và các giao dịch của chúng",
  },
  {
    label: "Top client giao dịch",
    prompt: "Liệt kê 10 client có số giao dịch nhiều nhất",
  },
  {
    label: "Luồng Client → Merchant",
    prompt: "Vẽ luồng Payment từ Client qua Merchant, giới hạn 30 node",
  },
  {
    label: "Chuỗi giao dịch NEXT",
    prompt: "Tìm chuỗi giao dịch liên tiếp 3 bước (chain pattern)",
  },
  {
    label: "Client chia sẻ Email",
    prompt: "Tìm các client chia sẻ chung email (identity fraud)",
  },
  {
    label: "Đếm node theo loại",
    prompt: "Đếm số lượng node theo từng loại trong database",
  },
];
