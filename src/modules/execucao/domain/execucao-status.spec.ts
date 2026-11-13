import { ExecucaoStatus } from './execucao-status';

describe('ExecucaoStatus', () => {
  it('has string values equal to the member names', () => {
    expect(Object.keys(ExecucaoStatus)).toEqual([
      'RECEBIDA',
      'EM_EXECUCAO',
      'FINALIZADA',
      'FALHOU',
    ]);
    for (const key of Object.keys(ExecucaoStatus)) {
      expect(ExecucaoStatus[key as keyof typeof ExecucaoStatus]).toBe(key);
    }
  });
});
