import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';

import { ConflitoDeEstadoError } from '../domain/conflito-de-estado.error';
import { TransicaoInvalidaError } from '../domain/transicao-invalida.error';

@Catch(TransicaoInvalidaError, ConflitoDeEstadoError)
export class ConflictFilter implements ExceptionFilter {
  catch(error: Error, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    response.status(HttpStatus.CONFLICT).json({
      statusCode: HttpStatus.CONFLICT,
      error: 'Conflict',
      message: error.message,
    });
  }
}
