import { Module, OnModuleInit } from '@nestjs/common';

import { MessageHandlerRegistry } from '../../shared/messaging/handlers/message-handler.registry';
import { MessagingModule } from '../../shared/messaging/messaging.module';
import { ExecucaoSolicitadaHandler } from './messaging/execucao-solicitada.handler';

@Module({
  imports: [MessagingModule],
  providers: [ExecucaoSolicitadaHandler],
})
export class ExecucaoModule implements OnModuleInit {
  constructor(
    private readonly registry: MessageHandlerRegistry,
    private readonly solicitada: ExecucaoSolicitadaHandler,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.solicitada);
  }
}
