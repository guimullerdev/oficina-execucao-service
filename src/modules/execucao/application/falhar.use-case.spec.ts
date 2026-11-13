import { BadRequestException, NotFoundException } from '@nestjs/common';

import { Execucao } from '../domain/execucao';
import { ExecucaoStatus } from '../domain/execucao-status';
import { TransicaoInvalidaError } from '../domain/transicao-invalida.error';
import { ExecucaoRepository } from '../infrastructure/execucao.repository';
import { FalharUseCase } from './falhar.use-case';

const make = (status: ExecucaoStatus) =>
  Execucao.fromPersistence({
    osId: 'os-1',
    status,
    prioridade: 0,
    dataAbertura: new Date(),
    sagaId: 's',
    correlationId: 'c',
  });

describe('FalharUseCase', () => {
  const repo = { findById: jest.fn(), salvarTransicao: jest.fn() };
  const useCase = new FalharUseCase(repo as unknown as ExecucaoRepository);

  beforeEach(() => jest.resetAllMocks());

  it('salva falha com motivo', async () => {
    repo.findById.mockResolvedValue({
      execucao: make(ExecucaoStatus.EM_EXECUCAO),
      linhaDoTempo: [],
    });
    await useCase.execute('os-1', 'quebrou');
    expect(repo.salvarTransicao).toHaveBeenCalledWith(
      expect.objectContaining({ status: ExecucaoStatus.FALHOU }),
      ExecucaoStatus.EM_EXECUCAO,
      'execucao.falhou',
      { motivo: 'quebrou' },
    );
  });

  it('400 sem motivo', async () => {
    await expect(useCase.execute('os-1', '  ')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.findById).not.toHaveBeenCalled();
  });

  it('404 quando não existe', async () => {
    repo.findById.mockResolvedValue({ execucao: null, linhaDoTempo: [] });
    await expect(useCase.execute('x', 'm')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('propaga transição inválida', async () => {
    repo.findById.mockResolvedValue({
      execucao: make(ExecucaoStatus.FINALIZADA),
      linhaDoTempo: [],
    });
    await expect(useCase.execute('os-1', 'm')).rejects.toBeInstanceOf(
      TransicaoInvalidaError,
    );
  });
});
