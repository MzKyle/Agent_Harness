import { DatabaseSync } from 'node:sqlite';
export function createStore(file) {
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE workflows (workflow_id TEXT PRIMARY KEY, status TEXT, step TEXT, updated_at TEXT)');
  return {
    create(id) { db.prepare('INSERT INTO workflows VALUES (?, ?, ?, ?)').run(id, 'queued', 'dispatch', new Date().toISOString()); },
    update(id, state, step) { db.prepare('UPDATE workflows SET status=?, step=?, updated_at=? WHERE workflow_id=?').run(state, step, new Date().toISOString(), id); },
    read(id) { const row = db.prepare('SELECT * FROM workflows WHERE workflow_id=?').get(id); return { workflowId: row.workflow_id, state: row.status, step: row.step, updatedAt: row.updated_at }; },
    close() { db.close(); },
  };
}
