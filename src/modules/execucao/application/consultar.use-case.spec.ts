import { NotFoundException } from '@nestjs/common';

import { ExecucaoRepository } from '../infrastructure/execucao.repository';
import { ConsultarExecucaoUseCase } from './consultar.use-case';

describe('ConsultarExecucaoUseCase', () => {
  const repo = { findById: jest.fn(), listFila: jest.fn() };
  const useCase = new ConsultarExecucaoUseCase(
    repo as unknown as ExecucaoRepository,
  );

  it('lista a fila', async () => {
    repo.listFila.mockResolvedValue([1]);
    await expect(useCase.fila()).resolves.toEqual([1]);
  });

  it('retorna execução e linha do tempo', async () => {
    repo.findById.mockResolvedValue({
      execucao: { osId: 'a' },
      linhaDoTempo: [],
    });
    await expect(useCase.porOsId('a')).resolves.toEqual({
      execucao: { osId: 'a' },
      linhaDoTempo: [],
    });
  });

  it('404 quando ausente', async () => {
    repo.findById.mockResolvedValue({ execucao: null, linhaDoTempo: [] });
    await expect(useCase.porOsId('a')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
