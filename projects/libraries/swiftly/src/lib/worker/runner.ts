import { acquireBlobUrl, releaseBlobUrl } from "./blob";
import type { PendingTaskMap, WorkerProtocolMessage } from "./messages";
import { createDefaultMessageHandler } from "./messages";
import type { TaskRunner } from "./types";
import { generateTaskId } from "./utils";
import { createAbortError } from "../utils/context";

/**
 * Shared worker-script configuration for task runners.
 */
export type WorkerScriptConfig = {
  /**
   * Raw worker-side snippets injected before serialized helper/task functions.
   */
  helpers?: string[];
};

type QueuedTask<T, R> = {
  value: T;
  resolve: (value: R) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  abort?: () => void;
};

type TaskRunnerOptions = {
  name: string;
  config?: WorkerScriptConfig;
  main: Function;
  functions: Function[];
  generateWorkerScript: (main: Function, functions: Function[], config?: WorkerScriptConfig) => string;
  createMessageHandler?: (worker: Worker, pendingTasks: PendingTaskMap) => (event: MessageEvent<WorkerProtocolMessage>) => void;
};

let workerIdentifierCounter = 0;

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

/**
 * Internal dedicated-worker task executor used by `coroutine()` and `compose()`.
 *
 * A runner owns one reusable worker instance, queues calls to `run()`,
 * and exposes only the high-level `TaskRunner` contract.
 */
export function createTaskRunner<T, R>({
  name,
  config,
  main,
  functions,
  generateWorkerScript,
  createMessageHandler,
}: TaskRunnerOptions): TaskRunner<T, R> {
  const queuedTasks: Array<QueuedTask<T, R>> = [];
  const pendingMessages: PendingTaskMap = new Map();
  const runnerWorkerId = ++workerIdentifierCounter;
  const runnerTaskId = String(runnerWorkerId);
  const workerScript = generateWorkerScript(main, functions, config);
  const blobUrl = acquireBlobUrl(workerScript);

  let worker: Worker | null = null;
  let workerMessageHandler: ((event: MessageEvent<WorkerProtocolMessage>) => void) | null = null;
  let workerErrorHandler: ((event: ErrorEvent) => void) | null = null;
  let isProcessing = false;
  let lifecycle: "open" | "closing" | "finalizing" = "open";
  let isFinalized = false;
  let closePromise: Promise<void> | null = null;
  let resolveClose: (() => void) | null = null;
  let hasReleasedBlobUrl = false;

  const releaseWorkerScript = () => {
    if (hasReleasedBlobUrl) {
      return;
    }

    hasReleasedBlobUrl = true;
    releaseBlobUrl(workerScript);
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

  const detachWorker = (target: Worker) => {
    if (workerMessageHandler) {
      target.removeEventListener("message", workerMessageHandler);
    }
    if (workerErrorHandler) {
      target.removeEventListener("error", workerErrorHandler);
    }
  };

  const createFinalizedQueuedError = () =>
    new Error(`${name} finalized before a worker became available because it was disposed`);
  const createFinalizedActiveError = () =>
    new Error(`${name} finalized before the worker task completed because it was disposed`);

  const getWorker = (): Worker => {
    if (worker) {
      return worker;
    }

    const nextWorker = new Worker(blobUrl, { type: "module" });
    workerMessageHandler = createMessageHandler
      ? createMessageHandler(nextWorker, pendingMessages)
      : createDefaultMessageHandler(nextWorker, pendingMessages);
    workerErrorHandler = (event: ErrorEvent) => {
      if (worker !== nextWorker) {
        return;
      }

      const error =
        event.error instanceof Error
          ? event.error
          : new Error(event.message || `${name} worker failed`);

      rejectWorkerTasks(runnerWorkerId, error);
      detachWorker(nextWorker);
      nextWorker.terminate();
      worker = null;
      workerMessageHandler = null;
      workerErrorHandler = null;
    };

    nextWorker.addEventListener("message", workerMessageHandler);
    nextWorker.addEventListener("error", workerErrorHandler);
    (nextWorker as any).__id = runnerWorkerId;
    worker = nextWorker;
    return nextWorker;
  };

  const submitTask = (targetWorker: Worker, data: T, signal?: AbortSignal): Promise<R> => {
    if (signal?.aborted) {
      return Promise.reject(createAbortError(signal));
    }

    const taskId = generateTaskId() || runnerTaskId;
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

        if (worker === targetWorker) {
          detachWorker(targetWorker);
          targetWorker.terminate();
          worker = null;
          workerMessageHandler = null;
          workerErrorHandler = null;
        }

        finishReject(createAbortError(signal));
      };

      pendingMessages.set(taskId, {
        workerId: runnerWorkerId,
        resolve: finishResolve,
        reject: finishReject,
      });
      signal?.addEventListener("abort", onAbort, { once: true });

      try {
        targetWorker.postMessage({ workerId: runnerWorkerId, taskId, payload: data, type: "task" });
      } catch (error) {
        pendingMessages.delete(taskId);
        finishReject(toError(error));
      }
    });
  };

  const finalizeGracefulClose = (): void => {
    if (
      lifecycle !== "closing" ||
      isFinalized ||
      isProcessing ||
      queuedTasks.length > 0 ||
      pendingMessages.size > 0
    ) {
      return;
    }

    isFinalized = true;

    if (worker) {
      detachWorker(worker);
      worker.terminate();
      worker = null;
    }

    workerMessageHandler = null;
    workerErrorHandler = null;
    releaseWorkerScript();
    resolveClose?.();
    resolveClose = null;
  };

  const drainQueue = async (): Promise<void> => {
    if (isProcessing || lifecycle === "finalizing" || isFinalized) {
      return;
    }

    let nextTask = queuedTasks.shift();
    while (nextTask?.signal?.aborted) {
      nextTask.signal.removeEventListener("abort", nextTask.abort!);
      nextTask.reject(createAbortError(nextTask.signal));
      nextTask = queuedTasks.shift();
    }
    if (!nextTask) {
      finalizeGracefulClose();
      return;
    }

    if (nextTask.signal && nextTask.abort) {
      nextTask.signal.removeEventListener("abort", nextTask.abort);
      nextTask.abort = undefined;
    }

    isProcessing = true;

    try {
      const activeWorker = getWorker();
      const result = await submitTask(activeWorker, nextTask.value, nextTask.signal);
      nextTask.resolve(result);
    } catch (error) {
      nextTask.reject(toError(error));
    } finally {
      isProcessing = false;
      void drainQueue();
      finalizeGracefulClose();
    }
  };

  const run = (value: T, signal?: AbortSignal): Promise<R> => {
    if (lifecycle === "closing") {
      return Promise.reject(new Error(`${name} is closed`));
    }
    if (lifecycle === "finalizing" || isFinalized) {
      return Promise.reject(createFinalizedQueuedError());
    }
    if (signal?.aborted) {
      return Promise.reject(createAbortError(signal));
    }

    return new Promise<R>((resolve, reject) => {
      const task: QueuedTask<T, R> = { value, resolve, reject, signal };

      if (signal) {
        task.abort = () => {
          const index = queuedTasks.indexOf(task);
          if (index < 0) return;
          queuedTasks.splice(index, 1);
          signal.removeEventListener("abort", task.abort!);
          reject(createAbortError(signal));
        };
        signal.addEventListener("abort", task.abort, { once: true });
      }

      queuedTasks.push(task);
      void drainQueue();
    });
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

    void drainQueue();
    finalizeGracefulClose();
    return closePromise;
  };

  const dispose = async () => {
    if (isFinalized || lifecycle === "finalizing") {
      return;
    }

    lifecycle = "finalizing";
    isFinalized = true;

    while (queuedTasks.length > 0) {
      const task = queuedTasks.shift()!;
      if (task.signal && task.abort) task.signal.removeEventListener("abort", task.abort);
      task.reject(createFinalizedQueuedError());
    }

    pendingMessages.forEach(({ reject }) => {
      reject(createFinalizedActiveError());
    });
    pendingMessages.clear();

    if (worker) {
      detachWorker(worker);
      worker.terminate();
      worker = null;
    }

    workerMessageHandler = null;
    workerErrorHandler = null;
    isProcessing = false;
    releaseWorkerScript();

    resolveClose?.();
    resolveClose = null;
  };

  return {
    close,
    dispose,
    run,
  };
}
