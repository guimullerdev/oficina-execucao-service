import { ExecucaoStatus } from './execucao-status';
import { TransicaoInvalidaError } from './transicao-invalida.error';

export interface ExecucaoProps {
  osId: string;
  status: ExecucaoStatus;
  prioridade: number;
  dataAbertura: Date;
  sagaId: string;
  correlationId: string;
}

export class Execucao {
  readonly osId: string;
  status: ExecucaoStatus;
  readonly prioridade: number;
  readonly dataAbertura: Date;
  readonly sagaId: string;
  readonly correlationId: string;

  private constructor(props: ExecucaoProps) {
    this.osId = props.osId;
    this.status = props.status;
    this.prioridade = props.prioridade;
    this.dataAbertura = props.dataAbertura;
    this.sagaId = props.sagaId;
    this.correlationId = props.correlationId;
  }

  static fromPersistence(props: ExecucaoProps): Execucao {
    return new Execucao(props);
  }

  /** RECEBIDA -> EM_EXECUCAO. Returns the status before the transition. */
  iniciar(): ExecucaoStatus {
    return this.transicionar(
      [ExecucaoStatus.RECEBIDA],
      ExecucaoStatus.EM_EXECUCAO,
    );
  }

  /** EM_EXECUCAO -> FINALIZADA. Returns the status before the transition. */
  finalizar(): ExecucaoStatus {
    return this.transicionar(
      [ExecucaoStatus.EM_EXECUCAO],
      ExecucaoStatus.FINALIZADA,
    );
  }

  /** RECEBIDA | EM_EXECUCAO -> FALHOU. Motivo is required. Returns the status before the transition. */
  falhar(motivo: string): ExecucaoStatus {
    if (motivo.trim().length === 0) {
      throw new Error('Motivo da falha é obrigatório');
    }
    return this.transicionar(
      [ExecucaoStatus.RECEBIDA, ExecucaoStatus.EM_EXECUCAO],
      ExecucaoStatus.FALHOU,
    );
  }

  private transicionar(
    origensPermitidas: readonly ExecucaoStatus[],
    para: ExecucaoStatus,
  ): ExecucaoStatus {
    const anterior = this.status;
    if (!origensPermitidas.includes(anterior)) {
      throw new TransicaoInvalidaError(anterior, para);
    }
    this.status = para;
    return anterior;
  }
}
