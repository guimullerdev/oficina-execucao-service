import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { ExecucaoModule } from './modules/execucao/execucao.module';
import { HealthModule } from './modules/health/health.module';
import { MessagingModule } from './shared/messaging/messaging.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    HealthModule,
    ExecucaoModule,
    MessagingModule,
  ],
})
export class AppModule {}
