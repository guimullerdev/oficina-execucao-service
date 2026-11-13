import { Execucao } from './execucao';
import { ExecucaoStatus } from './execucao-status';
import { TransicaoInvalidaError } from './transicao-invalida.error';

function makeExecucao(status: ExecucaoStatus): Execucao {
  return Execucao.fromPersistence({
    osId: 'os-1',
    status,
    prioridade: 1,
    dataAbertura: new Date(2024, 0, 1),
    sagaId: 'saga-1',
    correlationId: 'corr-1',
  });
}

describe('Execucao aggregate', () => {
  describe('fromPersistence', () => {
    it('restores all fields as given', () => {
      const dataAbertura = new Date(2024, 2, 10);
      const execucao = Execucao.fromPersistence({
        osId: 'os-9',
        status: ExecucaoStatus.EM_EXECUCAO,
        prioridade: 3,
        dataAbertura,
        sagaId: 'saga-9',
        correlationId: 'corr-9',
      });

      expect(execucao.osId).toBe('os-9');
      expect(execucao.status).toBe(ExecucaoStatus.EM_EXECUCAO);
      expect(execucao.prioridade).toBe(3);
      expect(execucao.dataAbertura).toBe(dataAbertura);
      expect(execucao.sagaId).toBe('saga-9');
      expect(execucao.correlationId).toBe('corr-9');
    });
  });

  describe('iniciar', () => {
    it('RECEBIDA -> EM_EXECUCAO, returning the previous status', () => {
      const execucao = makeExecucao(ExecucaoStatus.RECEBIDA);

      const anterior = execucao.iniciar();

      expect(anterior).toBe(ExecucaoStatus.RECEBIDA);
      expect(execucao.status).toBe(ExecucaoStatus.EM_EXECUCAO);
    });

    it.each([
      ExecucaoStatus.EM_EXECUCAO,
      ExecucaoStatus.FINALIZADA,
      ExecucaoStatus.FALHOU,
    ])(
      'throws TransicaoInvalidaError from %s and keeps the status',
      (status) => {
        const execucao = makeExecucao(status);

        expect(() => execucao.iniciar()).toThrow(TransicaoInvalidaError);
        expect(execucao.status).toBe(status);
      },
    );

    it('error carries de and para', () => {
      const execucao = makeExecucao(ExecucaoStatus.FINALIZADA);

      expect.assertions(3);
      try {
        execucao.iniciar();
      } catch (err) {
        expect(err).toBeInstanceOf(TransicaoInvalidaError);
        expect((err as TransicaoInvalidaError).de).toBe(
          ExecucaoStatus.FINALIZADA,
        );
        expect((err as TransicaoInvalidaError).para).toBe(
          ExecucaoStatus.EM_EXECUCAO,
        );
      }
    });
  });

  describe('finalizar', () => {
    it('EM_EXECUCAO -> FINALIZADA, returning the previous status', () => {
      const execucao = makeExecucao(ExecucaoStatus.EM_EXECUCAO);

      const anterior = execucao.finalizar();

      expect(anterior).toBe(ExecucaoStatus.EM_EXECUCAO);
      expect(execucao.status).toBe(ExecucaoStatus.FINALIZADA);
    });

    it.each([
      ExecucaoStatus.RECEBIDA,
      ExecucaoStatus.FINALIZADA,
      ExecucaoStatus.FALHOU,
    ])(
      'throws TransicaoInvalidaError from %s and keeps the status',
      (status) => {
        const execucao = makeExecucao(status);

        expect(() => execucao.finalizar()).toThrow(TransicaoInvalidaError);
        expect(execucao.status).toBe(status);
      },
    );
  });

  describe('falhar', () => {
    it.each([ExecucaoStatus.RECEBIDA, ExecucaoStatus.EM_EXECUCAO])(
      '%s -> FALHOU, returning the previous status',
      (status) => {
        const execucao = makeExecucao(status);

        const anterior = execucao.falhar('motor fundido');

        expect(anterior).toBe(status);
        expect(execucao.status).toBe(ExecucaoStatus.FALHOU);
      },
    );

    it.each([ExecucaoStatus.FINALIZADA, ExecucaoStatus.FALHOU])(
      'throws TransicaoInvalidaError from %s and keeps the status',
      (status) => {
        const execucao = makeExecucao(status);

        expect(() => execucao.falhar('motivo')).toThrow(TransicaoInvalidaError);
        expect(execucao.status).toBe(status);
      },
    );

    it.each(['', '   ', '\t\n'])(
      'throws on empty motivo %j and keeps the status',
      (motivo) => {
        const execucao = makeExecucao(ExecucaoStatus.RECEBIDA);

        expect(() => execucao.falhar(motivo)).toThrow(
          'Motivo da falha é obrigatório',
        );
        expect(execucao.status).toBe(ExecucaoStatus.RECEBIDA);
      },
    );
  });
});
