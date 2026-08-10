import { acquireBlobUrl, releaseBlobUrl } from "./blob";
import type { PendingTaskMap, WorkerProtocolMessage } from "./messages";
import { createDefaultMessageHandler } from "./messages";
import type { WorkerScriptConfig } from "./runner";
import type { TaskRunner } from "./types";
import { generateTaskId } from "./utils";
import { createAbortError } from "../utils/context";
import type { TaskRunControl } from "../utils/transfer";
import { normalizeTaskRunControl } from "./control";

export type PoolOptions = {
  name: string;
  concurrency?: number;
  maxQueued?: number;
  config?: WorkerScriptConfig;
  main: Function;
  functions: Function[];
  generateWorkerScript: (main: Function, functions: Function[], config?: WorkerScriptConfig) => string;
  createMessageHandler?: (worker: Worker, pendingTasks: PendingTaskMap) => (event: MessageEvent<WorkerProtocolMessage>) => void;
};

type WaitingWorker = {
  resolve: (worker: Worker) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  priority: number;
  sequence: number;
  abort?: () => void;
};

const toError = (error: unknown, fallback: string): Error =>
  error instanceof Error ? error : new Error(error ? String(error) : fallback);

/**
 * Internal compute-only worker pool.
 *
 * Unlike `createTaskRunner()`, this abstraction can create multiple workers
 * for the same baked task and lend them to queued compute submissions.
 */
export interface TaskPool<T = any, R = any> extends TaskRunner<T, R> {
  readonly concurrency: number;
  readonly queued: number;
  readonly active: number;
}

export function createTaskPool<T, R>({
  name,
  concurrency,
  maxQueued,
  config,
  main,
  functions,
  generateWorkerScript,
  createMessageHandler,
}: PoolOptions): TaskPool<T, R> {
  const maxWorkers =
    concurrency ??
    ((typeof navigator !== "undefined" ? navigator.hardwareConcurrency : undefined) || 4);
  const maxWaiting = maxQueued ?? Number.POSITIVE_INFINITY;

  if (!Number.isInteger(maxWorkers) || maxWorkers <= 0) {
    throw new RangeError(`${name} concurrency must be a positive integer`);
  }
  if (
    maxWaiting !== Number.POSITIVE_INFINITY &&
    (!Number.isInteger(maxWaiting) || maxWaiting < 0)
  ) {
    throw new RangeError(`${name} maxQueued must be a non-negative integer`);
  }
  const idleWorkers: Worker[] = [];
  const waitingQueue: WaitingWorker[] = [];
  const activeWorkers = new Map<number, Worker>();
  const workerMessageHandlers = new Map<number, (event: MessageEvent<WorkerProtocolMessage>) => void>();
  const workerErrorHandlers = new Map<number, (event: ErrorEvent) => void>();
  const pendingMessages: PendingTaskMap = new Map();
  const workerScript = generateWorkerScript(main, functions, config);
  let blobUrl: string | null = null;

  let createdWorkersCount = 0;
  let lifecycle: "open" | "closing" | "finalizing" = "open";
  let isFinalized = false;
  const isFinalizing = () => lifecycle === "finalizing" || isFinalized;
  let admittedRuns = 0;
  let closePromise: Promise<void> | null = null;
  let resolveClose: (() => void) | null = null;
  let nextWorkerId = 0;
  let hasReleasedBlobUrl = false;
  let nextWaiterSequence = 0;

  const getWorkerScriptUrl = (): string => {
    if (blobUrl) return blobUrl;
    blobUrl = acquireBlobUrl(workerScript);
    return blobUrl;
  };

  const releaseWorkerScript = () => {
    if (hasReleasedBlobUrl || !blobUrl) {
      return;
    }

    hasReleasedBlobUrl = true;
    releaseBlobUrl(workerScript);
    blobUrl = null;
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

  const createFinalizedActiveError = () =>
    new Error(`${name} finalized before the worker task completed`);
  const createFinalizedQueuedError = () =>
    new Error(`${name} finalized before a worker became available`);
  const createRunClosedError = () => {
    if (lifecycle === "closing") {
      return new Error(`${name} is closed`);
    }
    return new Error(`${name} is finalizing`);
  };

  const terminateWorkerNow = (worker: Worker) => {
    const workerId = getWorkerId(worker);
    detachWorker(worker);
    if (workerId !== undefined) {
      activeWorkers.delete(workerId);
    }

    removeFromIdleWorkers(worker);
    worker.terminate();
    createdWorkersCount = Math.max(0, createdWorkersCount - 1);
  };

  const finalizeGracefulClose = (): void => {
    if (lifecycle !== "closing" || isFinalized || admittedRuns > 0) {
      return;
    }

    isFinalized = true;

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
    resolveClose?.();
    resolveClose = null;
  };

  const retireWorker = (worker: Worker, error?: Error) => {
    const workerId = getWorkerId(worker);
    if (
      workerId === undefined ||
      (!activeWorkers.has(workerId) &&
        !workerMessageHandlers.has(workerId) &&
        !workerErrorHandlers.has(workerId))
    ) {
      return;
    }

    terminateWorkerNow(worker);

    if (error) {
      rejectWorkerTasks(workerId, error);
    }

    if (!isFinalized && lifecycle !== "finalizing") {
      satisfyWaitingQueue();
      finalizeGracefulClose();
    }
  };

  const createWorker = async (): Promise<Worker> => {
    const workerId = ++nextWorkerId;
    const worker = new Worker(getWorkerScriptUrl(), { type: "module" });
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

  const takeNextWaiter = (): WaitingWorker | undefined => {
    if (waitingQueue.length === 0) return undefined;

    let bestIndex = 0;
    for (let index = 1; index < waitingQueue.length; index++) {
      const candidate = waitingQueue[index];
      const best = waitingQueue[bestIndex];
      if (
        candidate.priority > best.priority ||
        (candidate.priority === best.priority && candidate.sequence < best.sequence)
      ) {
        bestIndex = index;
      }
    }

    return waitingQueue.splice(bestIndex, 1)[0];
  };

  satisfyWaitingQueue = () => {
    while (lifecycle !== "finalizing" && !isFinalized && waitingQueue.length > 0 && createdWorkersCount < maxWorkers) {
      const waiter = takeNextWaiter()!;
      if (waiter.signal?.aborted) {
        waiter.reject(createAbortError(waiter.signal));
        continue;
      }
      if (waiter.signal && waiter.abort) {
        waiter.signal.removeEventListener("abort", waiter.abort);
      }
      createdWorkersCount++;
      void createWorker().then((worker) => {
        if (lifecycle === "finalizing" || isFinalized) {
          terminateWorkerNow(worker);
          waiter.reject(createFinalizedQueuedError());
          return;
        }
        waiter.resolve(worker);
      }, (error) => {
        createdWorkersCount = Math.max(0, createdWorkersCount - 1);
        waiter.reject(toError(error, `${name} worker creation failed`));
        satisfyWaitingQueue();
      });
    }
  };

  const checkoutWorker = async (signal?: AbortSignal, priority = 0): Promise<Worker> => {
    if (signal?.aborted) {
      throw createAbortError(signal);
    }
    if (isFinalizing()) {
      throw createFinalizedQueuedError();
    }

    if (idleWorkers.length > 0) {
      return idleWorkers.shift()!;
    }

    if (createdWorkersCount < maxWorkers) {
      createdWorkersCount++;
      try {
        const worker = await createWorker();
        if (isFinalizing()) {
          terminateWorkerNow(worker);
          throw createFinalizedQueuedError();
        }
        return worker;
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === createFinalizedQueuedError().message
        ) {
          throw error;
        }
        createdWorkersCount = Math.max(0, createdWorkersCount - 1);
        throw toError(error, `${name} worker creation failed`);
      }
    }

    if (waitingQueue.length >= maxWaiting) {
      throw new Error(`${name} queue capacity exceeded`);
    }

    return new Promise((resolve, reject) => {
      const waiter: WaitingWorker = {
        resolve,
        reject,
        signal,
        priority,
        sequence: nextWaiterSequence++,
      };
      if (signal) {
        waiter.abort = () => {
          const index = waitingQueue.indexOf(waiter);
          if (index < 0) return;
          waitingQueue.splice(index, 1);
          signal.removeEventListener("abort", waiter.abort!);
          reject(createAbortError(signal));
        };
        signal.addEventListener("abort", waiter.abort, { once: true });
      }
      waitingQueue.push(waiter);
    });
  };

  const checkinWorker = (worker: Worker): void => {
    const workerId = getWorkerId(worker);
    if (workerId === undefined || !activeWorkers.has(workerId)) {
      return;
    }

    if (lifecycle === "finalizing" || isFinalized) {
      retireWorker(worker);
      return;
    }

    if (waitingQueue.length > 0) {
      const waiter = takeNextWaiter()!;
      if (waiter.signal && waiter.abort) {
        waiter.signal.removeEventListener("abort", waiter.abort);
      }
      waiter.resolve(worker);
      return;
    }

    idleWorkers.push(worker);
  };

  const submitTask = (
    worker: Worker,
    data: T,
    signal?: AbortSignal,
    transferables: Transferable[] = [],
  ): Promise<R> => {
    if (signal?.aborted) {
      return Promise.reject(createAbortError(signal));
    }

    const workerId = getWorkerId(worker);
    if (workerId === undefined || !activeWorkers.has(workerId)) {
      throw new Error("Worker not found or is not active");
    }

    const taskId = generateTaskId();
    return new Promise<R>((resolve, reject) => {
      let settled = false;
      const cleanupAbort = () => signal?.removeEventListener("abort", onAbort);
      const finishResolve = (value: R) => {
        if (settled) return;
        settled = true;
        cleanupAbort();
        resolve(value);
      };
      const finishReject = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanupAbort();
        reject(error);
      };
      const onAbort = () => {
        if (settled) return;
        pendingMessages.delete(taskId);
        const error = createAbortError(signal);
        finishReject(error);
        retireWorker(worker);
      };

      pendingMessages.set(taskId, { workerId, resolve: finishResolve, reject: finishReject });
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        worker.postMessage(
          { workerId, taskId, payload: data, type: "task" },
          transferables,
        );
      } catch (error) {
        pendingMessages.delete(taskId);
        finishReject(toError(error, `${name} worker postMessage failed`));
      }
    });
  };

  const run = async (value: T, control?: TaskRunControl): Promise<R> => {
    const { signal, transfer, priority } = normalizeTaskRunControl(control);

    if (lifecycle !== "open") {
      throw createRunClosedError();
    }

    admittedRuns += 1;
    try {
      const worker = await checkoutWorker(signal, priority);
      try {
        return await submitTask(worker, value, signal, transfer);
      } finally {
        checkinWorker(worker);
      }
    } finally {
      admittedRuns = Math.max(0, admittedRuns - 1);
      finalizeGracefulClose();
    }
  };

  const close = (): Promise<void> => {
    if (isFinalized || lifecycle === "finalizing") {
      return Promise.resolve();
    }

    if (closePromise) {
      return closePromise;
    }

    lifecycle = "closing";
    closePromise = new Promise<void>((resolve) => {
      resolveClose = resolve;
    });

    satisfyWaitingQueue();
    finalizeGracefulClose();
    return closePromise;
  };

  const dispose = async () => {
    if (isFinalized || lifecycle === "finalizing") {
      return;
    }

    lifecycle = "finalizing";
    isFinalized = true;

    pendingMessages.forEach(({ reject }) => {
      reject(createFinalizedActiveError());
    });
    pendingMessages.clear();

    while (waitingQueue.length > 0) {
      const waiter = waitingQueue.shift()!;
      if (waiter.signal && waiter.abort) waiter.signal.removeEventListener("abort", waiter.abort);
      waiter.reject(createFinalizedQueuedError());
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

    resolveClose?.();
    resolveClose = null;
  };

  return {
    get concurrency() {
      return maxWorkers;
    },
    get queued() {
      return waitingQueue.length;
    },
    get active() {
      return Math.max(0, createdWorkersCount - idleWorkers.length);
    },
    run,
    close,
    dispose,
  };
}