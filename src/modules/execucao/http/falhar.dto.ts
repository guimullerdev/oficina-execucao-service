import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class FalharDto {
  @ApiProperty({ description: 'Motivo da falha' })
  @IsString()
  @IsNotEmpty()
  motivo!: string;
}
