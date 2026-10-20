export function statusLabel(state: string): string {
  if (state === 'running') return 'Completed';
  if (state === 'succeeded') return 'Running';
  return 'Waiting';
}
