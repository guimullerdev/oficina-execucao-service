import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { ExecucaoRepository } from '../infrastructure/execucao.repository';

@Injectable()
export class FalharUseCase {
  constructor(private readonly repository: ExecucaoRepository) {}

  async execute(osId: string, motivo: string): Promise<void> {
    if (!motivo || motivo.trim().length === 0) {
      throw new BadRequestException('Motivo da falha é obrigatório');
    }
    const { execucao } = await this.repository.findById(osId);
    if (!execucao) {
      throw new NotFoundException(`Execução ${osId} não encontrada`);
    }
    const anterior = execucao.falhar(motivo);
    await this.repository.salvarTransicao(
      execucao,
      anterior,
      'execucao.falhou',
      { motivo },
    );
  }
}
