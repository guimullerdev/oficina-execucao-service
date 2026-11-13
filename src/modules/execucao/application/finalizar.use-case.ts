import { Injectable, NotFoundException } from '@nestjs/common';

import { ExecucaoRepository } from '../infrastructure/execucao.repository';

@Injectable()
export class FinalizarUseCase {
  constructor(private readonly repository: ExecucaoRepository) {}

  async execute(osId: string): Promise<void> {
    const { execucao } = await this.repository.findById(osId);
    if (!execucao) {
      throw new NotFoundException(`Execução ${osId} não encontrada`);
    }
    const anterior = execucao.finalizar();
    await this.repository.salvarTransicao(
      execucao,
      anterior,
      'execucao.concluida',
    );
  }
}
