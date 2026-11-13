import 'reflect-metadata';

import { ConflictException, NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PATH_METADATA } from '@nestjs/common/constants';
import { ValidationPipe } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';

import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import { STAFF_ROLES } from '../../auth/domain/enums/user-role.enum';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { ConsultarExecucaoUseCase } from '../application/consultar.use-case';
import { FalharUseCase } from '../application/falhar.use-case';
import { FinalizarUseCase } from '../application/finalizar.use-case';
import { IniciarUseCase } from '../application/iniciar.use-case';
import { TransicaoInvalidaError } from '../domain/transicao-invalida.error';
import { ExecucaoStatus } from '../domain/execucao-status';
import { ExecucaoController } from './execucao.controller';
import { FalharDto } from './falhar.dto';

describe('ExecucaoController', () => {
  const consultar = { fila: jest.fn(), porOsId: jest.fn() };
  const iniciar = { execute: jest.fn() };
  const finalizar = { execute: jest.fn() };
  const falhar = { execute: jest.fn() };

  const controller = new ExecucaoController(
    consultar as unknown as ConsultarExecucaoUseCase,
    iniciar as unknown as IniciarUseCase,
    finalizar as unknown as FinalizarUseCase,
    falhar as unknown as FalharUseCase,
  );

  beforeEach(() => jest.resetAllMocks());

  it('tem guards e roles de staff', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, ExecucaoController)).toEqual([
      JwtAuthGuard,
      RolesGuard,
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, ExecucaoController)).toEqual(
      STAFF_ROLES,
    );
  });

  it('declara /fila antes de /:osId', () => {
    const proto = ExecucaoController.prototype;
    const paths = Object.getOwnPropertyNames(proto)
      .filter((n) => n !== 'constructor')
      .map(
        (n) =>
          Reflect.getMetadata(
            PATH_METADATA,
            proto[n as keyof typeof proto],
          ) as string,
      );
    expect(paths.indexOf('fila')).toBeLessThan(paths.indexOf(':osId'));
  });

  it('GET fila e :osId delegam', async () => {
    consultar.fila.mockResolvedValue([]);
    consultar.porOsId.mockResolvedValue({
      execucao: { osId: 'a' },
      linhaDoTempo: [],
    });
    await expect(controller.fila()).resolves.toEqual([]);
    await expect(controller.porOsId('a')).resolves.toEqual({
      execucao: { osId: 'a' },
      linhaDoTempo: [],
    });
  });

  it('GET :osId desconhecido -> 404', async () => {
    consultar.porOsId.mockRejectedValue(new NotFoundException());
    await expect(controller.porOsId('z')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('finalizar em RECEBIDA propaga erro de transição (filtro -> 409)', async () => {
    finalizar.execute.mockRejectedValue(
      new TransicaoInvalidaError(
        ExecucaoStatus.RECEBIDA,
        ExecucaoStatus.FINALIZADA,
      ),
    );
    await expect(controller.finalizarExecucao('a')).rejects.toBeInstanceOf(
      TransicaoInvalidaError,
    );
  });

  it('iniciar delega', async () => {
    iniciar.execute.mockResolvedValue(undefined);
    await controller.iniciarExecucao('a');
    expect(iniciar.execute).toHaveBeenCalledWith('a');
    expect(ConflictException).toBeDefined();
  });

  it('falhar sem motivo -> 400 na validação do DTO', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    const meta = { type: 'body' as const, metatype: FalharDto };
    await expect(pipe.transform({}, meta)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(pipe.transform({ motivo: '' }, meta)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('falhar com motivo delega', async () => {
    await controller.falharExecucao('a', { motivo: 'x' });
    expect(falhar.execute).toHaveBeenCalledWith('a', 'x');
  });
});
