import { acquireBlobUrl, releaseBlobUrl } from "./blob";
import type { PendingTaskMap, WorkerProtocolMessage } from "./messages";
import { createDefaultMessageHandler } from "./messages";
import type { TaskRunner } from "./types";
import { generateTaskId } from "./utils";

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
  let isProcessing = false;
  let isFinalizing = false;
  let hasReleasedBlobUrl = false;

  const releaseWorkerScript = () => {
    if (hasReleasedBlobUrl) {
      return;
    }

    hasReleasedBlobUrl = true;
    releaseBlobUrl(workerScript);
  };

  const getWorker = (): Worker => {
    if (worker) {
      return worker;
    }

    const nextWorker = new Worker(blobUrl, { type: "module" });
    workerMessageHandler = createMessageHandler
      ? createMessageHandler(nextWorker, pendingMessages)
      : createDefaultMessageHandler(nextWorker, pendingMessages);
    nextWorker.addEventListener("message", workerMessageHandler);
    (nextWorker as any).__id = runnerWorkerId;
    worker = nextWorker;
    return nextWorker;
  };

  const submitTask = (worker: Worker, data: T): Promise<R> => {
    const taskId = generateTaskId() || runnerTaskId;
    return new Promise<R>((resolve, reject) => {
      pendingMessages.set(taskId, { workerId: runnerWorkerId, resolve, reject });
      try {
        worker.postMessage({ workerId: runnerWorkerId, taskId, payload: data, type: "task" });
      } catch (error) {
        pendingMessages.delete(taskId);
        reject(toError(error));
      }
    });
  };

  const drainQueue = async (): Promise<void> => {
    if (isProcessing || isFinalizing) {
      return;
    }

    const nextTask = queuedTasks.shift();
    if (!nextTask) {
      return;
    }

    isProcessing = true;

    try {
      const activeWorker = getWorker();
      const result = await submitTask(activeWorker, nextTask.value);
      nextTask.resolve(result);
    } catch (error) {
      nextTask.reject(toError(error));
    } finally {
      isProcessing = false;
      if (!isFinalizing) {
        void drainQueue();
      }
    }
  };

  const run = (value: T): Promise<R> => {
    if (isFinalizing) {
      return Promise.reject(new Error(`${name} finalized before a worker became available`));
    }

    return new Promise<R>((resolve, reject) => {
      queuedTasks.push({ value, resolve, reject });
      void drainQueue();
    });
  };

  const dispose = async () => {
    if (isFinalizing) {
      return;
    }

    isFinalizing = true;

    while (queuedTasks.length > 0) {
      queuedTasks.shift()!.reject(
        new Error(`${name} finalized before a worker became available`)
      );
    }

    pendingMessages.forEach(({ reject }) => {
      reject(new Error(`${name} finalized before the worker task completed`));
    });
    pendingMessages.clear();

    if (worker) {
      if (workerMessageHandler) {
        worker.removeEventListener("message", workerMessageHandler);
      }
      worker.terminate();
      worker = null;
    }

    workerMessageHandler = null;
    isProcessing = false;
    releaseWorkerScript();
  };

  return {
    dispose: dispose,
    run: run,
  };
}
