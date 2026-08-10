/**
 * Per-submission worker execution controls.
 *
 * `transfer` moves ownership of transferable values to the worker instead of
 * cloning them. Existing `AbortSignal` call sites remain supported directly.
 */
export type TaskRunOptions = {
  signal?: AbortSignal;
  transfer?: readonly Transferable[];
  /**
   * Scheduling priority for work that has not started yet. Higher values run
   * first; equal priorities preserve submission order. Defaults to `0`.
   * Running work is never preempted.
   */
  priority?: number;
};

/** Accepted second argument for worker-backed task execution. */
export type TaskRunControl = AbortSignal | TaskRunOptions | undefined;

/** Marker returned by worker task utilities when a result should be transferred. */
export type TransferResult<T> = {
  readonly __swiftlyTransferResult: true;
  readonly value: T;
  readonly transfer: readonly Transferable[];
};

/** A worker task may return a normal value or explicitly transfer its result. */
export type WorkerTaskResult<T> = T | TransferResult<T>;

/** Utilities injected as the second argument of coroutine/compute task functions. */
export interface WorkerTaskUtils {
  /**
   * Transfers ownership of one or more transferable objects with the task result.
   * The caller receives `value`; the transfer wrapper itself never leaves the worker.
   */
  transfer<T>(value: T, ...transferables: Transferable[]): TransferResult<T>;
}
