import type { RuntimeObservationAdapter } from '@devagent/core';
// Reviewed against ALS c2b759c: WorkflowEngine, ProductWorker and ProductStore.
// These paths are inspection candidates, not a runtime call graph or execution grant.
export const alsRuntimeAdapter: RuntimeObservationAdapter = {
  id: 'als-workflow-v1', description: 'Workflow/API/worker/SQLite observation correlation; explicit snapshots only',
  sourcePaths: ['src/auto_label_studio/application/workflow_engine.py', 'src/auto_label_studio/application/product_worker.py', 'src/auto_label_studio/infrastructure/product_store.py'],
  transitions: { queued: ['running', 'cancelled'], running: ['completed', 'failed', 'cancelled', 'waiting_cvat', 'waiting_user', 'queued'],
    failed: ['queued'], cancelled: ['queued'], waiting_cvat: ['queued', 'running', 'completed', 'failed', 'cancelled'], waiting_user: ['queued', 'running', 'completed', 'failed', 'cancelled'], completed: [], skipped: [] },
};
