import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ConflitoDeEstadoError } from '../domain/conflito-de-estado.error';
import { Execucao } from '../domain/execucao';
import { ExecucaoStatus } from '../domain/execucao-status';
import { TransicaoInvalidaError } from '../domain/transicao-invalida.error';
import { AutoConcluirService } from './auto-concluir.service';

const exec = (osId: string, status: ExecucaoStatus, ageMs: number) =>
  Execucao.fromPersistence({
    osId,
    status,
    prioridade: 1,
    dataAbertura: new Date(Date.now() - ageMs),
    sagaId: 's',
    correlationId: 'c',
  });

describe('AutoConcluirService', () => {
  const repository = { listFila: jest.fn() };
  const iniciar = { execute: jest.fn() };
  const finalizar = { execute: jest.fn() };

  const build = (env: Record<string, unknown>) =>
    new AutoConcluirService(
      repository as never,
      iniciar as never,
      finalizar as never,
      { get: (k: string) => env[k] } as unknown as ConfigService,
    );

  let service: AutoConcluirService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    iniciar.execute.mockResolvedValue(undefined);
    finalizar.execute.mockResolvedValue(undefined);
    repository.listFila.mockResolvedValue([]);
  });

  afterEach(() => {
    service?.onModuleDestroy();
    jest.useRealTimers();
  });

  it.each([undefined, '', '0', 'abc'])('is disabled for %p', async (v) => {
    service = build({ EXECUCAO_AUTO_CONCLUIR_MS: v });
    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(10_000);
    expect(repository.listFila).not.toHaveBeenCalled();
    await service.tick();
    expect(repository.listFila).not.toHaveBeenCalled();
  });

  it('is disabled under NODE_ENV=test', async () => {
    service = build({ EXECUCAO_AUTO_CONCLUIR_MS: '1000', NODE_ENV: 'test' });
    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(5000);
    expect(repository.listFila).not.toHaveBeenCalled();
  });

  it('polls, applies the floor, and stops on destroy', async () => {
    service = build({ EXECUCAO_AUTO_CONCLUIR_MS: '10' });
    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(499);
    expect(repository.listFila).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(repository.listFila).toHaveBeenCalledTimes(1);
    service.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(2000);
    expect(repository.listFila).toHaveBeenCalledTimes(1);
  });

  describe('tick', () => {
    beforeEach(() => {
      service = build({ EXECUCAO_AUTO_CONCLUIR_MS: '1000' });
    });

    it('starts and finishes old RECEBIDA, finishes old EM_EXECUCAO', async () => {
      repository.listFila.mockResolvedValue([
        exec('a', ExecucaoStatus.RECEBIDA, 5000),
        exec('b', ExecucaoStatus.EM_EXECUCAO, 5000),
      ]);
      await service.tick();
      expect(iniciar.execute).toHaveBeenCalledTimes(1);
      expect(iniciar.execute).toHaveBeenCalledWith('a');
      expect(finalizar.execute).toHaveBeenCalledWith('a');
      expect(finalizar.execute).toHaveBeenCalledWith('b');
    });

    it('ignores recent items', async () => {
      repository.listFila.mockResolvedValue([
        exec('a', ExecucaoStatus.RECEBIDA, 10),
        exec('b', ExecucaoStatus.EM_EXECUCAO, 10),
      ]);
      await service.tick();
      expect(iniciar.execute).not.toHaveBeenCalled();
      expect(finalizar.execute).not.toHaveBeenCalled();
    });

    it('ignores other statuses', async () => {
      repository.listFila.mockResolvedValue([
        exec('a', ExecucaoStatus.FINALIZADA, 5000),
      ]);
      await service.tick();
      expect(finalizar.execute).not.toHaveBeenCalled();
    });

    it.each([
      new ConflictException('x'),
      new ConflitoDeEstadoError('a'),
      new TransicaoInvalidaError(
        ExecucaoStatus.FINALIZADA,
        ExecucaoStatus.EM_EXECUCAO,
      ),
    ])('swallows concurrency error %#', async (err) => {
      repository.listFila.mockResolvedValue([
        exec('a', ExecucaoStatus.RECEBIDA, 5000),
        exec('b', ExecucaoStatus.EM_EXECUCAO, 5000),
      ]);
      iniciar.execute.mockRejectedValueOnce(err);
      const errorSpy = jest.spyOn(
        (service as never as { logger: { error: jest.Mock } }).logger,
        'error',
      );
      await service.tick();
      expect(errorSpy).not.toHaveBeenCalled();
      expect(finalizar.execute).toHaveBeenCalledWith('b');
    });

    it('logs other errors and continues', async () => {
      repository.listFila.mockResolvedValue([
        exec('a', ExecucaoStatus.RECEBIDA, 5000),
        exec('b', ExecucaoStatus.EM_EXECUCAO, 5000),
      ]);
      iniciar.execute.mockRejectedValueOnce(new Error('boom'));
      const errorSpy = jest
        .spyOn(
          (service as never as { logger: { error: jest.Mock } }).logger,
          'error',
        )
        .mockImplementation();
      await service.tick();
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(finalizar.execute).toHaveBeenCalledTimes(1);
      expect(finalizar.execute).toHaveBeenCalledWith('b');
    });

    it('logs listFila failures', async () => {
      repository.listFila.mockRejectedValue('down');
      const errorSpy = jest
        .spyOn(
          (service as never as { logger: { error: jest.Mock } }).logger,
          'error',
        )
        .mockImplementation();
      await service.tick();
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it('does not overlap runs', async () => {
      let release!: () => void;
      repository.listFila.mockImplementationOnce(
        () => new Promise<never[]>((r) => (release = () => r([]))),
      );
      const first = service.tick();
      await service.tick();
      expect(repository.listFila).toHaveBeenCalledTimes(1);
      release();
      await first;
      await service.tick();
      expect(repository.listFila).toHaveBeenCalledTimes(2);
    });
  });
});
