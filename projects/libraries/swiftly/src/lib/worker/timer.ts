import { acquireBlobUrl, releaseBlobUrl } from "./blob";
import { createModuleWorker } from "./module";

const TIMER_WORKER_SCRIPT = `
const timers = new Map();

self.onmessage = ({ data }) => {
  if (!data || typeof data !== "object") return;

  if (data.type === "set") {
    const handle = setTimeout(() => {
      timers.delete(data.id);
      self.postMessage({ type: "elapsed", id: data.id });
    }, data.ms);

    timers.set(data.id, handle);
    return;
  }

  if (data.type === "clear") {
    const handle = timers.get(data.id);
    if (handle !== undefined) {
      clearTimeout(handle);
      timers.delete(data.id);
    }
  }
};
`;

type PendingTimer = {
  elapsed: () => void;
  failed: (error: Error) => void;
};

let worker: Worker | undefined;
let workerConstructor: typeof Worker | undefined;
let nextTimerId = 0;
const pending = new Map<number, PendingTimer>();

const normalizeWorkerError = (event: ErrorEvent): Error =>
  event.error instanceof Error
    ? event.error
    : new Error(event.message || "timer worker failed");

const releaseWorkerIfIdle = (): void => {
  if (!worker || pending.size !== 0) return;

  worker.terminate();
  worker = undefined;
  workerConstructor = undefined;
  releaseBlobUrl(TIMER_WORKER_SCRIPT);
};

const failPendingTimers = (error: Error): void => {
  const timers = [...pending.values()];
  pending.clear();

  worker?.terminate();
  worker = undefined;
  workerConstructor = undefined;
  releaseBlobUrl(TIMER_WORKER_SCRIPT);

  let callbackError: unknown;
  for (const timer of timers) {
    try {
      timer.failed(error);
    } catch (reason) {
      callbackError ??= reason;
    }
  }

  if (callbackError !== undefined) {
    throw callbackError;
  }
};

const ensureTimerWorker = (): Worker => {
  if (typeof Worker === "undefined") {
    throw new Error("worker-backed timers require Web Worker support");
  }

  if (worker) {
    if (workerConstructor === Worker) {
      return worker;
    }

    // The host Worker implementation changed (common in isolated browser tests).
    // Reusing a worker created by a previous host would cross environment
    // boundaries. Only an idle worker may be replaced safely.
    if (pending.size !== 0) {
      throw new Error("timer worker host changed while timers are pending");
    }

    worker.terminate();
    worker = undefined;
    workerConstructor = undefined;
    releaseBlobUrl(TIMER_WORKER_SCRIPT);
  }

  const blobUrl = acquireBlobUrl(TIMER_WORKER_SCRIPT);

  let createdWorker: Worker;
  try {
    createdWorker = createModuleWorker(blobUrl);
    worker = createdWorker;
    workerConstructor = Worker;
  } catch (error) {
    releaseBlobUrl(TIMER_WORKER_SCRIPT);
    throw error;
  }

  createdWorker.onmessage = ({ data }: MessageEvent<{ type?: string; id?: number }>) => {
    if (worker !== createdWorker) return;
    if (data?.type !== "elapsed" || typeof data.id !== "number") return;

    const timer = pending.get(data.id);
    if (!timer) return;

    pending.delete(data.id);
    try {
      timer.elapsed();
    } finally {
      releaseWorkerIfIdle();
    }
  };

  createdWorker.onerror = (event) => {
    if (worker !== createdWorker) return;
    failPendingTimers(normalizeWorkerError(event));
  };

  return createdWorker;
};

export type WorkerTimer = {
  /** Cancels the timer. Returns true only when it was still pending. */
  cancel(): boolean;
};

/**
 * Schedules one timeout on Swiftly's shared timer worker.
 *
 * Concurrent timers share one worker. The worker is terminated automatically
 * when the last outstanding timer settles or is cancelled.
 */
export function scheduleWorkerTimer(
  ms: number,
  elapsed: () => void,
  failed: (error: Error) => void = () => {},
): WorkerTimer {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new RangeError("timer duration must be a finite non-negative number");
  }

  const timerWorker = ensureTimerWorker();
  const id = ++nextTimerId;
  pending.set(id, { elapsed, failed });

  try {
    timerWorker.postMessage({ type: "set", id, ms });
  } catch (error) {
    pending.delete(id);
    releaseWorkerIfIdle();
    throw error;
  }

  return {
    cancel(): boolean {
      if (!pending.delete(id)) return false;

      try {
        timerWorker.postMessage({ type: "clear", id });
      } catch (error) {
        // A failed post means this worker can no longer be trusted for the
        // remaining timers. Fail them coherently instead of stranding them.
        if (worker === timerWorker) {
          failPendingTimers(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      } finally {
        releaseWorkerIfIdle();
      }
      return true;
    },
  };
}