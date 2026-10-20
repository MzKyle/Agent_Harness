export function inconsistent(snapshot) {
  if (!Array.isArray(snapshot.sqlite) || !Array.isArray(snapshot.worker) || snapshot.sqlite.length > 100 || snapshot.worker.length > 100) throw new Error('SNAPSHOT_BOUND');
  return snapshot.sqlite.filter(db => snapshot.worker.some(worker => worker.workflowId === db.workflowId && worker.state !== db.state)).map(db => db.workflowId);
}
