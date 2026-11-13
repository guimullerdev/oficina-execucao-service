import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ConflitoDeEstadoError } from '../domain/conflito-de-estado.error';
import { ExecucaoStatus } from '../domain/execucao-status';
import { TransicaoInvalidaError } from '../domain/transicao-invalida.error';
import { ExecucaoRepository } from '../infrastructure/execucao.repository';
import { FinalizarUseCase } from './finalizar.use-case';
import { IniciarUseCase } from './iniciar.use-case';

const MIN_DELAY_MS = 500;

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

const isConcurrencyError = (err: unknown): boolean =>
  err instanceof ConflictException ||
  err instanceof ConflitoDeEstadoError ||
  err instanceof TransicaoInvalidaError;

/**
 * Conclusão automática opcional (EXECUCAO_AUTO_CONCLUIR_MS; vazio/0 = desligada).
 * Poller que varre a fila e conclui execuções mais antigas que o atraso. Seguro
 * com várias réplicas: conflitos de estado são engolidos.
 */
@Injectable()
export class AutoConcluirService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutoConcluirService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly repository: ExecucaoRepository,
    private readonly iniciar: IniciarUseCase,
    private readonly finalizar: FinalizarUseCase,
    private readonly config: ConfigService,
  ) {}

  private delayMs(): number {
    const n = Number(this.config.get('EXECUCAO_AUTO_CONCLUIR_MS'));
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.max(MIN_DELAY_MS, Math.floor(n));
  }

  onModuleInit(): void {
    const delay = this.delayMs();
    if (delay === 0 || this.config.get('NODE_ENV') === 'test') return;
    this.timer = setInterval(() => void this.tick(delay), delay);
    this.timer.unref?.();
    this.logger.log(`Auto-conclusão habilitada a cada ${delay}ms`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(delay: number = this.delayMs()): Promise<void> {
    if (this.running || delay === 0) return;
    this.running = true;
    try {
      const fila = await this.repository.listFila();
      const limite = Date.now() - delay;
      for (const execucao of fila) {
        if (execucao.dataAbertura.getTime() > limite) continue;
        try {
          if (execucao.status === ExecucaoStatus.RECEBIDA) {
            await this.iniciar.execute(execucao.osId);
            await this.finalizar.execute(execucao.osId);
          } else if (execucao.status === ExecucaoStatus.EM_EXECUCAO) {
            await this.finalizar.execute(execucao.osId);
          }
        } catch (err) {
          if (isConcurrencyError(err)) {
            this.logger.log(
              `Execução ${execucao.osId} já tratada por outra réplica: ${errorMessage(err)}`,
            );
          } else {
            this.logger.error(
              `Falha na auto-conclusão de ${execucao.osId}: ${errorMessage(err)}`,
            );
          }
        }
      }
    } catch (err) {
      this.logger.error(`Falha ao listar a fila: ${errorMessage(err)}`);
    } finally {
      this.running = false;
    }
  }
}
