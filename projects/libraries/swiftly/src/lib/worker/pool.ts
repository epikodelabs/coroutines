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

type WaitingWorker = {
  resolve: (worker: Worker) => void;
  reject: (error: Error) => void;
};

const toError = (error: unknown, fallback: string): Error =>
  error instanceof Error ? error : new Error(error ? String(error) : fallback);

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
  const waitingQueue: WaitingWorker[] = [];
  const activeWorkers = new Map<number, Worker>();
  const workerMessageHandlers = new Map<number, (event: MessageEvent<WorkerProtocolMessage>) => void>();
  const workerErrorHandlers = new Map<number, (event: ErrorEvent) => void>();
  const pendingMessages: PendingTaskMap = new Map();
  const workerScript = generateWorkerScript(main, functions, config);
  const blobUrl = acquireBlobUrl(workerScript);

  let createdWorkersCount = 0;
  let isFinalizing = false;
  let nextWorkerId = 0;
  let hasReleasedBlobUrl = false;

  const releaseWorkerScript = () => {
    if (hasReleasedBlobUrl) {
      return;
    }

    hasReleasedBlobUrl = true;
    releaseBlobUrl(workerScript);
  };

  const getWorkerId = (worker: Worker): number | undefined => {
    return (worker as any).__id;
  };

  const removeFromIdleWorkers = (worker: Worker) => {
    const idleIndex = idleWorkers.findIndex((entry) => entry === worker);
    if (idleIndex >= 0) {
      idleWorkers.splice(idleIndex, 1);
    }
  };

  const rejectWorkerTasks = (workerId: number, error: Error) => {
    for (const [taskId, pending] of pendingMessages) {
      if (pending.workerId !== workerId) {
        continue;
      }

      pendingMessages.delete(taskId);
      pending.reject(error);
    }
  };

  const detachWorker = (worker: Worker) => {
    const workerId = getWorkerId(worker);
    if (workerId === undefined) {
      return;
    }

    const messageHandler = workerMessageHandlers.get(workerId);
    if (messageHandler) {
      worker.removeEventListener("message", messageHandler);
      workerMessageHandlers.delete(workerId);
    }

    const errorHandler = workerErrorHandlers.get(workerId);
    if (errorHandler) {
      worker.removeEventListener("error", errorHandler);
      workerErrorHandlers.delete(workerId);
    }
  };

  let satisfyWaitingQueue: () => void;

  const retireWorker = (worker: Worker, error?: Error) => {
    const workerId = getWorkerId(worker);
    if (workerId === undefined || !activeWorkers.has(workerId)) {
      return;
    }

    activeWorkers.delete(workerId);
    removeFromIdleWorkers(worker);
    detachWorker(worker);
    worker.terminate();
    createdWorkersCount = Math.max(0, createdWorkersCount - 1);

    if (error) {
      rejectWorkerTasks(workerId, error);
    }

    if (!isFinalizing) {
      satisfyWaitingQueue();
    }
  };

  const createWorker = async (): Promise<Worker> => {
    const workerId = ++nextWorkerId;
    const worker = new Worker(blobUrl, { type: "module" });
    const messageHandler = createMessageHandler
      ? createMessageHandler(worker, pendingMessages)
      : createDefaultMessageHandler(worker, pendingMessages);
    const errorHandler = (event: ErrorEvent) => {
      const error =
        event.error instanceof Error
          ? event.error
          : new Error(event.message || `${name} worker failed`);
      retireWorker(worker, error);
    };

    worker.addEventListener("message", messageHandler);
    worker.addEventListener("error", errorHandler);
    (worker as any).__id = workerId;
    workerMessageHandlers.set(workerId, messageHandler);
    workerErrorHandlers.set(workerId, errorHandler);
    activeWorkers.set(workerId, worker);
    return worker;
  };

  satisfyWaitingQueue = () => {
    while (!isFinalizing && waitingQueue.length > 0 && createdWorkersCount < maxWorkers) {
      const waiter = waitingQueue.shift()!;
      createdWorkersCount++;
      void createWorker().then(waiter.resolve, (error) => {
        createdWorkersCount--;
        waiter.reject(toError(error, `${name} worker creation failed`));
        satisfyWaitingQueue();
      });
    }
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
        throw toError(error, `${name} worker creation failed`);
      }
    }

    return new Promise((resolve, reject) => waitingQueue.push({ resolve, reject }));
  };

  const checkinWorker = (worker: Worker): void => {
    const workerId = getWorkerId(worker);
    if (workerId === undefined || !activeWorkers.has(workerId)) {
      return;
    }

    if (isFinalizing) {
      retireWorker(worker);
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
        reject(toError(error, `${name} worker postMessage failed`));
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
      detachWorker(worker);
      worker.terminate();
    }

    workerMessageHandlers.clear();
    workerErrorHandlers.clear();
    createdWorkersCount = 0;
    releaseWorkerScript();
  };

  return {
    run,
    dispose,
  };
}
