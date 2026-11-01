/** "2 h 10 min", "45 min", or a dash when there is no order yet. */
export function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  const mins = Math.max(1, Math.round(ms / 60_000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
