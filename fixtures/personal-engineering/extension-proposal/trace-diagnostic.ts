type Event = { trace_id: string; component: string; severity: string };

// Pure, bounded diagnostic over explicitly sanitized input; no file/network/hardware access.
export function correlate(events: Event[], traceId: string) {
  if (!Array.isArray(events) || events.length > 1000 || !/^[a-zA-Z0-9-]{1,80}$/.test(traceId)) throw new Error('DIAGNOSTIC_INPUT_DENIED');
  const selected = events.filter(event => event && event.trace_id === traceId && typeof event.component === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(event.component));
  return {
    traceId,
    components: [...new Set(selected.map(event => event.component))],
    failureStage: selected.find(event => ['error', 'fatal'].includes(event.severity))?.component ?? null,
  };
}
