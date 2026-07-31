import { acquireBlobUrl, releaseBlobUrl } from "./blob";
import type { PendingTaskMap, WorkerProtocolMessage } from "./messages";
import { createDefaultMessageHandler } from "./messages";
import type { WorkerScriptConfig } from "./runner";
import type { TaskRunner } from "./types";
import { generateTaskId } from "./utils";

type PoolOptions = {
  name: string;
  config?: WorkerScriptConfig;
  main: Function;
  functions: Function[];
  generateWorkerScript: (main: Function, functions: Function[], config?: WorkerScriptConfig) => string;
  createMessageHandler?: (worker: Worker, pendingTasks: PendingTaskMap) => (event: MessageEvent<WorkerProtocolMessage>) => void;
};

/**
 * Internal compute-only worker pool.
 *
 * Unlike `createTaskRunner()`, this abstraction can create multiple workers
 * for the same baked task and lend them to queued compute submissions.
 */
export function createTaskPool<T, R>({
  name,
  config,
  main,
  functions,
  generateWorkerScript,
  createMessageHandler,
}: PoolOptions): TaskRunner<T, R> {
  const maxWorkers =
    (typeof navigator !== "undefined" ? navigator.hardwareConcurrency : undefined) || 4;
  const idleWorkers: Worker[] = [];
  const waitingQueue: Array<{ resolve: (worker: Worker) => void; reject: (error: Error) => void }> = [];
  const activeWorkers = new Map<number, Worker>();
  const pendingMessages: PendingTaskMap = new Map();
  const workerScript = generateWorkerScript(main, functions, config);
  const blobUrl = acquireBlobUrl(workerScript);

  let createdWorkersCount = 0;
  let isFinalizing = false;
  let nextWorkerId = 0;

  const getWorkerId = (worker: Worker): number | undefined => {
    return (worker as any).__id;
  };

  const removeFromIdleWorkers = (worker: Worker) => {
    const idleIndex = idleWorkers.findIndex((entry) => entry === worker);
    if (idleIndex >= 0) {
      idleWorkers.splice(idleIndex, 1);
    }
  };

  const createWorker = async (): Promise<Worker> => {
    const workerId = ++nextWorkerId;
    const worker = new Worker(blobUrl, { type: "module" });
    const messageHandler = createMessageHandler
      ? createMessageHandler(worker, pendingMessages)
      : createDefaultMessageHandler(worker, pendingMessages);

    worker.addEventListener("message", messageHandler);
    (worker as any).__id = workerId;
    activeWorkers.set(workerId, worker);
    return worker;
  };

  const checkoutWorker = async (): Promise<Worker> => {
    if (isFinalizing) {
      throw new Error(`${name} is finalizing`);
    }

    if (idleWorkers.length > 0) {
      return idleWorkers.shift()!;
    }

    if (createdWorkersCount < maxWorkers) {
      createdWorkersCount++;
      try {
        return await createWorker();
      } catch (error) {
        createdWorkersCount--;
        throw error instanceof Error ? error : new Error(String(error));
      }
    }

    return new Promise((resolve, reject) => waitingQueue.push({ resolve, reject }));
  };

  const checkinWorker = (worker: Worker): void => {
    const workerId = getWorkerId(worker);
    if (workerId === undefined || !activeWorkers.has(workerId)) {
      console.warn("Worker not found.");
      return;
    }

    if (isFinalizing) {
      activeWorkers.delete(workerId);
      removeFromIdleWorkers(worker);
      worker.terminate();
      return;
    }

    if (waitingQueue.length > 0) {
      waitingQueue.shift()!.resolve(worker);
      return;
    }

    idleWorkers.push(worker);
  };

  const submitTask = (worker: Worker, data: T): Promise<R> => {
    const workerId = getWorkerId(worker);
    if (workerId === undefined || !activeWorkers.has(workerId)) {
      throw new Error("Worker not found or is not active");
    }

    const taskId = generateTaskId();
    return new Promise<R>((resolve, reject) => {
      pendingMessages.set(taskId, { workerId, resolve, reject });
      try {
        worker.postMessage({ workerId, taskId, payload: data, type: "task" });
      } catch (error) {
        pendingMessages.delete(taskId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };

  const run = async (value: T): Promise<R> => {
    const worker = await checkoutWorker();
    try {
      return await submitTask(worker, value);
    } finally {
      checkinWorker(worker);
    }
  };

  const dispose = async () => {
    if (isFinalizing) {
      return;
    }

    isFinalizing = true;

    pendingMessages.forEach(({ reject }) => {
      reject(new Error(`${name} finalized before the worker task completed`));
    });
    pendingMessages.clear();

    while (waitingQueue.length > 0) {
      waitingQueue.shift()!.reject(
        new Error(`${name} finalized before a worker became available`)
      );
    }

    const workersToTerminate = [...new Set(activeWorkers.values())];
    activeWorkers.clear();
    idleWorkers.length = 0;

    for (const worker of workersToTerminate) {
      worker.terminate();
      releaseBlobUrl(workerScript);
    }

    createdWorkersCount = 0;
    releaseBlobUrl(workerScript);
  };

  return {
    run: run,
    dispose: dispose,
  };
}
