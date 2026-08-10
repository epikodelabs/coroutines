import { acquireBlobUrl, releaseBlobUrl } from "./blob";

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
  releaseBlobUrl(TIMER_WORKER_SCRIPT);
};

const failPendingTimers = (error: Error): void => {
  const timers = [...pending.values()];
  pending.clear();

  worker?.terminate();
  worker = undefined;
  releaseBlobUrl(TIMER_WORKER_SCRIPT);

  for (const timer of timers) {
    timer.failed(error);
  }
};

const ensureTimerWorker = (): Worker => {
  if (worker) return worker;
  if (typeof Worker === "undefined") {
    throw new Error("worker-backed timers require Web Worker support");
  }

  const blobUrl = acquireBlobUrl(TIMER_WORKER_SCRIPT);

  try {
    worker = new Worker(blobUrl);
  } catch (error) {
    releaseBlobUrl(TIMER_WORKER_SCRIPT);
    throw error;
  }

  worker.onmessage = ({ data }: MessageEvent<{ type?: string; id?: number }>) => {
    if (data?.type !== "elapsed" || typeof data.id !== "number") return;

    const timer = pending.get(data.id);
    if (!timer) return;

    pending.delete(data.id);
    timer.elapsed();
    releaseWorkerIfIdle();
  };

  worker.onerror = (event) => {
    failPendingTimers(normalizeWorkerError(event));
  };

  return worker;
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

      timerWorker.postMessage({ type: "clear", id });
      releaseWorkerIfIdle();
      return true;
    },
  };
}