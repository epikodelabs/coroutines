import { acquireBlobUrl, releaseBlobUrl } from "./blob";
import type { PendingTaskMap, WorkerProtocolMessage } from "./messages";
import { createDefaultMessageHandler } from "./messages";
import { createModuleWorker } from "./module";
import type { TaskRunner } from "./types";
import { generateTaskId } from "./utils";
import { createAbortError } from "../utils/context";
import type { TaskRunControl } from "../utils/transfer";
import { normalizeTaskRunControl } from "./control";

export type WorkerScriptConfig = {
  helpers?: string[];
};

export type TaskRunnerOptions = {
  name: string;
  config?: WorkerScriptConfig;
  main: Function;
  functions: Function[];
  generateWorkerScript: (
    main: Function,
    functions: Function[],
    config?: WorkerScriptConfig,
  ) => string;
  createMessageHandler?: (
    worker: Worker,
    pendingTasks: PendingTaskMap,
  ) => (event: MessageEvent<WorkerProtocolMessage>) => void;
};

const toError = (error: unknown, fallback: string): Error =>
  error instanceof Error ? error : new Error(error ? String(error) : fallback);

/**
 * Internal elastic worker executor used by `coroutine()` and fused `compose()` stages.
 *
 * The executor owns worker reuse, not concurrency policy. Each concurrently
 * admitted run either reuses an idle worker or lazily creates another one.
 * Callers bound concurrency structurally with `group()` or `semaphore()`.
 */
export function createTaskRunner<T, R>({
  name,
  config,
  main,
  functions,
  generateWorkerScript,
  createMessageHandler,
}: TaskRunnerOptions): TaskRunner<T, R> {
  const idleWorkers: Worker[] = [];
  const workers = new Map<number, Worker>();
  const workerMessageHandlers = new Map<
    number,
    (event: MessageEvent<WorkerProtocolMessage>) => void
  >();
  const workerErrorHandlers = new Map<number, (event: ErrorEvent) => void>();
  const pendingMessages: PendingTaskMap = new Map();

  const workerScript = generateWorkerScript(main, functions, config);
  let blobUrl: string | null = null;
  let lifecycle: "open" | "closing" | "finalizing" = "open";
  let isFinalized = false;
  let admittedRuns = 0;
  let closePromise: Promise<void> | null = null;
  let resolveClose: (() => void) | null = null;
  let nextWorkerId = 0;
  let hasReleasedBlobUrl = false;

  const getWorkerScriptUrl = (): string => {
    if (blobUrl) return blobUrl;
    blobUrl = acquireBlobUrl(workerScript);
    return blobUrl;
  };

  const releaseWorkerScript = (): void => {
    if (hasReleasedBlobUrl || !blobUrl) return;
    hasReleasedBlobUrl = true;
    releaseBlobUrl(workerScript);
    blobUrl = null;
  };

  const getWorkerId = (worker: Worker): number | undefined =>
    (worker as any).__id;

  const removeFromIdleWorkers = (worker: Worker): void => {
    const index = idleWorkers.indexOf(worker);
    if (index >= 0) idleWorkers.splice(index, 1);
  };

  const rejectWorkerTasks = (workerId: number, error: Error): void => {
    for (const [taskId, pending] of pendingMessages) {
      if (pending.workerId !== workerId) continue;
      pendingMessages.delete(taskId);
      pending.reject(error);
    }
  };

  const detachWorker = (worker: Worker): void => {
    const workerId = getWorkerId(worker);
    if (workerId === undefined) return;

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

  const terminateWorkerNow = (worker: Worker): void => {
    const workerId = getWorkerId(worker);
    detachWorker(worker);
    removeFromIdleWorkers(worker);
    if (workerId !== undefined) workers.delete(workerId);
    worker.terminate();
  };

  const createFinalizedActiveError = () =>
    new Error(`${name} finalized before the worker task completed`);
  const createFinalizedQueuedError = () =>
    new Error(`${name} finalized before a worker became available`);
  const createRunClosedError = () => new Error(`${name} is closed`);

  const finalizeGracefulClose = (): void => {
    if (lifecycle !== "closing" || isFinalized || admittedRuns > 0) return;

    isFinalized = true;
    const owned = [...workers.values()];
    workers.clear();
    idleWorkers.length = 0;

    for (const worker of owned) {
      detachWorker(worker);
      worker.terminate();
    }

    workerMessageHandlers.clear();
    workerErrorHandlers.clear();
    releaseWorkerScript();
    resolveClose?.();
    resolveClose = null;
  };

  const retireWorker = (worker: Worker, error?: Error): void => {
    const workerId = getWorkerId(worker);
    if (
      workerId === undefined ||
      (!workers.has(workerId) &&
        !workerMessageHandlers.has(workerId) &&
        !workerErrorHandlers.has(workerId))
    ) {
      return;
    }

    terminateWorkerNow(worker);
    if (error) rejectWorkerTasks(workerId, error);
    finalizeGracefulClose();
  };

  const createWorker = (): Worker => {
    const workerId = ++nextWorkerId;
    const worker = createModuleWorker(getWorkerScriptUrl());
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
    workers.set(workerId, worker);
    return worker;
  };

  const checkoutWorker = (signal?: AbortSignal): Worker => {
    if (signal?.aborted) throw createAbortError(signal);
    if (lifecycle === "finalizing" || isFinalized) {
      throw createFinalizedQueuedError();
    }

    return idleWorkers.shift() ?? createWorker();
  };

  const checkinWorker = (worker: Worker): void => {
    const workerId = getWorkerId(worker);
    if (workerId === undefined || !workers.has(workerId)) return;

    if (lifecycle === "finalizing" || isFinalized) {
      retireWorker(worker);
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
    if (signal?.aborted) return Promise.reject(createAbortError(signal));

    const workerId = getWorkerId(worker);
    if (workerId === undefined || !workers.has(workerId)) {
      return Promise.reject(new Error("Worker not found or is not active"));
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
        finishReject(createAbortError(signal));
        retireWorker(worker);
      };

      pendingMessages.set(taskId, {
        workerId,
        resolve: finishResolve,
        reject: finishReject,
      });
      signal?.addEventListener("abort", onAbort, { once: true });

      try {
        worker.postMessage(
          { workerId, taskId, payload: data, type: "task" },
          transferables,
        );
      } catch (error) {
        pendingMessages.delete(taskId);
        finishReject(toError(error, `${name} worker postMessage failed`));
        retireWorker(worker);
      }
    });
  };

  const run = async (value: T, control?: TaskRunControl): Promise<R> => {
    const { signal, transfer } = normalizeTaskRunControl(control);

    if (lifecycle === "closing") throw createRunClosedError();
    if (lifecycle === "finalizing" || isFinalized) {
      throw createFinalizedQueuedError();
    }

    admittedRuns += 1;
    try {
      const worker = checkoutWorker(signal);
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
    if (isFinalized || lifecycle === "finalizing") return Promise.resolve();
    if (closePromise) return closePromise;

    lifecycle = "closing";
    closePromise = new Promise<void>((resolve) => {
      resolveClose = resolve;
    });
    finalizeGracefulClose();
    return closePromise;
  };

  const dispose = async (): Promise<void> => {
    if (isFinalized || lifecycle === "finalizing") return;

    lifecycle = "finalizing";
    isFinalized = true;

    pendingMessages.forEach(({ reject }) => {
      reject(createFinalizedActiveError());
    });
    pendingMessages.clear();

    const owned = [...workers.values()];
    workers.clear();
    idleWorkers.length = 0;

    for (const worker of owned) {
      detachWorker(worker);
      worker.terminate();
    }

    workerMessageHandlers.clear();
    workerErrorHandlers.clear();
    releaseWorkerScript();

    resolveClose?.();
    resolveClose = null;
  };

  return {
    run,
    close,
    dispose,
  };
}