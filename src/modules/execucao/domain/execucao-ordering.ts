import { ExecucaoStatus } from './execucao-status';

/*
 * Ported from oficina-os-service service-orders-prisma.repository.ts (STATUS_PRIORITY).
 * The monolith ranks active work first (EM_EXECUCAO, then the pre-execution statuses)
 * and leaves terminal statuses unranked (fallback 99). Mapping to ExecucaoStatus:
 *   EM_EXECUCAO -> 1   (same as monolith EM_EXECUCAO: active work first)
 *   RECEBIDA    -> 2   (monolith RECEBIDA was 4; it is the only pre-execution status here)
 *   FALHOU      -> 3   (terminal, listed after active work)
 *   FINALIZADA  -> 4   (terminal, listed last)
 * Ties are broken by oldest dataAbertura first, as in the monolith.
 */
export const STATUS_PRIORITY: Record<ExecucaoStatus, number> = {
  [ExecucaoStatus.EM_EXECUCAO]: 1,
  [ExecucaoStatus.RECEBIDA]: 2,
  [ExecucaoStatus.FALHOU]: 3,
  [ExecucaoStatus.FINALIZADA]: 4,
};

export function byStatusPriorityThenOldest(
  a: { status: ExecucaoStatus; dataAbertura: Date },
  b: { status: ExecucaoStatus; dataAbertura: Date },
): number {
  const pa = STATUS_PRIORITY[a.status];
  const pb = STATUS_PRIORITY[b.status];
  if (pa !== pb) return pa - pb;
  return a.dataAbertura.getTime() - b.dataAbertura.getTime();
}
