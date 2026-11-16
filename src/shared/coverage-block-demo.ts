// Arquivo de teste da branch protection (Phase 3): codigo sem spec para
// derrubar a cobertura de codigo novo no Sonar. Este PR nunca e mergeado.
export function classificarPrioridade(horas: number, urgente: boolean): string {
  if (urgente && horas > 8) return 'critica';
  if (urgente) return 'alta';
  if (horas > 24) return 'baixa';
  if (horas > 8) return 'media';
  return 'normal';
}

export function somarHoras(itens: { horas: number }[]): number {
  let total = 0;
  for (const item of itens) {
    if (item.horas < 0) throw new Error('horas negativas');
    total += item.horas;
  }
  return total;
}

export function formatarResumo(nome: string, horas: number): string {
  const prioridade = classificarPrioridade(horas, false);
  return `${nome}: ${horas}h (${prioridade})`;
}
