import { Module, OnModuleInit } from '@nestjs/common';

import { MessageHandlerRegistry } from '../../shared/messaging/handlers/message-handler.registry';
import { MessagingModule } from '../../shared/messaging/messaging.module';
import { AuthModule } from '../auth/auth.module';
import { ConsultarExecucaoUseCase } from './application/consultar.use-case';
import { FalharUseCase } from './application/falhar.use-case';
import { FinalizarUseCase } from './application/finalizar.use-case';
import { IniciarUseCase } from './application/iniciar.use-case';
import { ExecucaoController } from './http/execucao.controller';
import { ExecucaoRepository } from './infrastructure/execucao.repository';
import { ExecucaoSolicitadaHandler } from './messaging/execucao-solicitada.handler';

@Module({
  imports: [MessagingModule, AuthModule],
  controllers: [ExecucaoController],
  providers: [
    ExecucaoSolicitadaHandler,
    ExecucaoRepository,
    ConsultarExecucaoUseCase,
    IniciarUseCase,
    FinalizarUseCase,
    FalharUseCase,
  ],
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
