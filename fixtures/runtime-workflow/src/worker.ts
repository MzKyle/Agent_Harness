import { parentPort, workerData } from 'node:worker_threads';
if (workerData.scenario === 'exception') throw new Error('Synthetic worker handler exception');
else if (workerData.scenario === 'timeout') setInterval(() => {}, 1000);
else parentPort.postMessage({ state: 'completed', step: 'seal_result' });
