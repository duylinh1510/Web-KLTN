import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AI_SERVICE_TOKEN } from './ai.interface';
import { MockAiService } from './ai.service';
import { NgrokAiService } from './ngrok-ai.service';

//Cả 2 service đều được register, useFactory chọn instance runtime theo AI_PROVIDER.

@Module({
  imports: [HttpModule, ConfigModule],
  providers: [
    MockAiService,
    NgrokAiService,
    {
      provide: AI_SERVICE_TOKEN,
      inject: [ConfigService, MockAiService, NgrokAiService],
      useFactory: (
        config: ConfigService,
        mock: MockAiService,
        ngrok: NgrokAiService,
      ) => {
        const provider = config.get<string>('AI_PROVIDER');
        return provider === 'ngrok' ? ngrok : mock;
      },
    },
  ],
  exports: [AI_SERVICE_TOKEN],
})
export class AiModule {}
