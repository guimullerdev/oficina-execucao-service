import { ArgumentsHost, HttpStatus } from '@nestjs/common';

import { ConflitoDeEstadoError } from '../domain/conflito-de-estado.error';
import { ExecucaoStatus } from '../domain/execucao-status';
import { TransicaoInvalidaError } from '../domain/transicao-invalida.error';
import { ConflictFilter } from './conflict.filter';

describe('ConflictFilter', () => {
  it.each([
    new TransicaoInvalidaError(
      ExecucaoStatus.RECEBIDA,
      ExecucaoStatus.FINALIZADA,
    ),
    new ConflitoDeEstadoError('os-1'),
  ])('mapeia %p para 409', (error) => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({ getResponse: () => ({ status }) }),
    } as unknown as ArgumentsHost;

    new ConflictFilter().catch(error, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 409,
        message: error.message,
      }),
    );
  });
});
