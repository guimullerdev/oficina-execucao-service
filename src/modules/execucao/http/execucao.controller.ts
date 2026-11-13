import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { Roles } from '../../auth/decorators/roles.decorator';
import { STAFF_ROLES } from '../../auth/domain/enums/user-role.enum';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { ConsultarExecucaoUseCase } from '../application/consultar.use-case';
import { FalharUseCase } from '../application/falhar.use-case';
import { FinalizarUseCase } from '../application/finalizar.use-case';
import { IniciarUseCase } from '../application/iniciar.use-case';
import { ConflictFilter } from './conflict.filter';
import { FalharDto } from './falhar.dto';

@ApiTags('execucao')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Token ausente ou inválido' })
@ApiForbiddenResponse({ description: 'Perfil sem permissão' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...STAFF_ROLES)
@UseFilters(ConflictFilter)
@Controller()
export class ExecucaoController {
  constructor(
    private readonly consultar: ConsultarExecucaoUseCase,
    private readonly iniciar: IniciarUseCase,
    private readonly finalizar: FinalizarUseCase,
    private readonly falhar: FalharUseCase,
  ) {}

  @Get('fila')
  @ApiOkResponse({ description: 'Fila de execuções ordenada' })
  fila() {
    return this.consultar.fila();
  }

  @Get(':osId')
  @ApiOkResponse({ description: 'Execução e linha do tempo' })
  @ApiNotFoundResponse({ description: 'Execução não encontrada' })
  porOsId(@Param('osId') osId: string) {
    return this.consultar.porOsId(osId);
  }

  @Patch(':osId/iniciar')
  @HttpCode(204)
  @ApiNotFoundResponse({ description: 'Execução não encontrada' })
  @ApiConflictResponse({ description: 'Transição inválida' })
  async iniciarExecucao(@Param('osId') osId: string): Promise<void> {
    await this.iniciar.execute(osId);
  }

  @Patch(':osId/finalizar')
  @HttpCode(204)
  @ApiNotFoundResponse({ description: 'Execução não encontrada' })
  @ApiConflictResponse({ description: 'Transição inválida' })
  async finalizarExecucao(@Param('osId') osId: string): Promise<void> {
    await this.finalizar.execute(osId);
  }

  @Patch(':osId/falhar')
  @HttpCode(204)
  @ApiNotFoundResponse({ description: 'Execução não encontrada' })
  @ApiConflictResponse({ description: 'Transição inválida' })
  async falharExecucao(
    @Param('osId') osId: string,
    @Body() dto: FalharDto,
  ): Promise<void> {
    await this.falhar.execute(osId, dto.motivo);
  }
}
