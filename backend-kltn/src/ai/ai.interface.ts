// Đây là cái chuôi cắm. Ai muốn làm AI Service thì phải tuân thủ khuôn mẫu này.
export interface IAiService {
    generateCypher(prompt: string): Promise<string>;
  }
  
  // Tạo một cái Token (nhãn dán) để NestJS biết đường mà tiêm (Inject) vào Controller
  export const AI_SERVICE_TOKEN = 'AI_SERVICE_TOKEN';