import { Injectable, NotFoundException } from '@nestjs/common';

import { Execucao } from '../domain/execucao';
import {
  ExecucaoRepository,
  LinhaDoTempoItem,
} from '../infrastructure/execucao.repository';

@Injectable()
export class ConsultarExecucaoUseCase {
  constructor(private readonly repository: ExecucaoRepository) {}

  fila(): Promise<Execucao[]> {
    return this.repository.listFila();
  }

  async porOsId(
    osId: string,
  ): Promise<{ execucao: Execucao; linhaDoTempo: LinhaDoTempoItem[] }> {
    const { execucao, linhaDoTempo } = await this.repository.findById(osId);
    if (!execucao) {
      throw new NotFoundException(`Execução ${osId} não encontrada`);
    }
    return { execucao, linhaDoTempo };
  }
}
