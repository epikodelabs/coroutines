import { scheduleWorkerTimer } from "../worker/timer";
import { createAbortError } from "./context";

/**
 * Suspends for at least `ms` milliseconds using Swiftly's timer worker.
 *
 * The timeout itself is scheduled off the caller thread. Resolution is still
 * delivered through the caller's event loop, as with any worker message.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(createAbortError(signal));
  }

  return new Promise<void>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      signal?.removeEventListener("abort", abort);
    };

    const timer = scheduleWorkerTimer(
      ms,
      () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      },
      (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    );

    const abort = () => {
      if (settled) return;
      settled = true;
      timer.cancel();
      cleanup();
      reject(createAbortError(signal));
    };

    signal?.addEventListener("abort", abort, { once: true });
  });
}