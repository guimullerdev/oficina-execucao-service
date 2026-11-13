import { ExecucaoStatus } from './execucao-status';
import { TransicaoInvalidaError } from './transicao-invalida.error';

describe('TransicaoInvalidaError', () => {
  it('is an Error with de, para and a descriptive message', () => {
    const err = new TransicaoInvalidaError(
      ExecucaoStatus.FINALIZADA,
      ExecucaoStatus.EM_EXECUCAO,
    );

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(TransicaoInvalidaError);
    expect(err.name).toBe('TransicaoInvalidaError');
    expect(err.de).toBe(ExecucaoStatus.FINALIZADA);
    expect(err.para).toBe(ExecucaoStatus.EM_EXECUCAO);
    expect(err.message).toBe(
      'Transição inválida de FINALIZADA para EM_EXECUCAO',
    );
  });
});
