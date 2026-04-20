import {
  Injectable,
  OnModuleDestroy,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import neo4j, { Driver, Session } from 'neo4j-driver';

@Injectable()
export class Neo4jService implements OnModuleDestroy {
  private driver: Driver | null = null; // Khởi tạo ban đầu là rỗng
  private currentUri: string | null = null;

  // Hàm này sẽ được gọi từ Controller khi user nhập form trên web
  async connect(uri: string, user: string, pass: string): Promise<boolean> {
    try {
      // Đóng kết nối cũ nếu có (để user có thể đổi DB khác)
      if (this.driver) await this.driver.close();

      this.driver = neo4j.driver(uri, neo4j.auth.basic(user, pass));

      // Chạy thử một lệnh ping để xác nhận kết nối sống
      await this.driver.getServerInfo();
      this.currentUri = uri;
      return true;
    } catch (error) {
      this.driver = null;
      this.currentUri = null;
      throw new HttpException(
        'Sai cấu hình hoặc không thể kết nối Neo4j',
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  async disconnect(): Promise<void> {
    if (this.driver) {
      await this.driver.close();
      this.driver = null;
      this.currentUri = null;
    }
  }

  getStatus(): { connected: boolean; uri: string | null } {
    return { connected: this.driver !== null, uri: this.currentUri };
  }

  getReadSession(): Session {
    if (!this.driver) {
      throw new HttpException(
        'Vui lòng kết nối Database trước!',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.driver.session({ defaultAccessMode: neo4j.session.READ });
  }

  async onModuleDestroy() {
    if (this.driver) await this.driver.close();
  }
}
