import { NotFoundException } from '@nestjs/common';

import { Execucao } from '../domain/execucao';
import { ExecucaoStatus } from '../domain/execucao-status';
import { TransicaoInvalidaError } from '../domain/transicao-invalida.error';
import { ExecucaoRepository } from '../infrastructure/execucao.repository';
import { IniciarUseCase } from './iniciar.use-case';

const make = (status: ExecucaoStatus) =>
  Execucao.fromPersistence({
    osId: 'os-1',
    status,
    prioridade: 0,
    dataAbertura: new Date(),
    sagaId: 's',
    correlationId: 'c',
  });

describe('IniciarUseCase', () => {
  const repo = {
    findById: jest.fn(),
    salvarTransicao: jest.fn(),
  };
  const useCase = new IniciarUseCase(repo as unknown as ExecucaoRepository);

  beforeEach(() => jest.resetAllMocks());

  it('salva a transição válida', async () => {
    repo.findById.mockResolvedValue({
      execucao: make(ExecucaoStatus.RECEBIDA),
      linhaDoTempo: [],
    });
    await useCase.execute('os-1');
    expect(repo.salvarTransicao).toHaveBeenCalledWith(
      expect.objectContaining({ osId: 'os-1' }),
      ExecucaoStatus.RECEBIDA,
      'execucao.iniciada',
    );
  });

  it('404 quando não existe', async () => {
    repo.findById.mockResolvedValue({ execucao: null, linhaDoTempo: [] });
    await expect(useCase.execute('x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('propaga transição inválida', async () => {
    repo.findById.mockResolvedValue({
      execucao: make(ExecucaoStatus.FINALIZADA),
      linhaDoTempo: [],
    });
    await expect(useCase.execute('os-1')).rejects.toBeInstanceOf(
      TransicaoInvalidaError,
    );
    expect(repo.salvarTransicao).not.toHaveBeenCalled();
  });
});
