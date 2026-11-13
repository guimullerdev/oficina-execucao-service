export class ConflitoDeEstadoError extends Error {
  readonly osId: string;

  constructor(osId: string) {
    super(
      `Conflito de estado na execução ${osId}: status alterado por outra operação`,
    );
    this.name = 'ConflitoDeEstadoError';
    this.osId = osId;
  }
}
