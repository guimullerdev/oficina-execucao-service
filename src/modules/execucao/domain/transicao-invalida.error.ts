import { ExecucaoStatus } from './execucao-status';

export class TransicaoInvalidaError extends Error {
  readonly de: ExecucaoStatus;
  readonly para: ExecucaoStatus;

  constructor(de: ExecucaoStatus, para: ExecucaoStatus) {
    super(`Transição inválida de ${de} para ${para}`);
    this.name = 'TransicaoInvalidaError';
    this.de = de;
    this.para = para;
  }
}
