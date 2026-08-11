import { createTaskPool } from "../worker/pool";
import { buildCoroutineWorkerRuntime } from "../worker/runtimes";
import { buildWorkerScript } from "../worker/script";
import type { CoroutineScript } from "../worker/types";
import type {
  TaskRunControl,
  WorkerTaskResult,
  WorkerTaskUtils,
} from "../utils/transfer";

/**
 * Callable elastic compute handle returned by `compute()`.
 *
 * Unlike a coroutine, compute owns a reusable list of workers. Concurrent calls
 * reuse idle workers or lazily create additional workers as demand requires.
 * Compute deliberately does not impose a concurrency policy; use `group()` or
 * `semaphore()` to bound concurrent submissions.
 */
export interface ComputeRunner<T = any, R = any> {
  /** Submits input to an available worker and resolves with the worker result. */
  (params: T, control?: TaskRunControl): Promise<R>;
  /** Number of workers currently executing submissions. */
  readonly active: number;
  /** Stops accepting submissions, drains admitted work, then releases all workers. */
  close: () => Promise<void>;
  /** Immediately terminates all workers and rejects active work. */
  dispose: () => Promise<void>;
}

/**
 * Offloads a function to an elastic reusable worker list.
 *
 * `compute()` is the multi-worker counterpart of `coroutine()`: the task is
 * baked into one reusable worker script, but concurrent submissions may run on
 * different workers. An idle worker is reused when possible; otherwise another
 * worker is created lazily.
 *
 * Compute does not choose a worker-count limit. Structured concurrency belongs
 * to `group()`, while shared resource budgets can be expressed with
 * `semaphore()`.
 *
 * @example
 * ```ts
 * const hash = compute((value: string) => expensiveHash(value));
 * const work = group({ concurrency: 4 });
 *
 * const results = inputs.map(input =>
 *   work.spawn(signal => hash(input, signal)),
 * );
 * ```
 */
export function compute<T = any, R = any>(
  main: (
    data: T,
    utils: WorkerTaskUtils,
  ) => WorkerTaskResult<R> | Promise<WorkerTaskResult<R>>,
  ...functions: Function[]
): ComputeRunner<T, R> {
  const pool = createTaskPool<T, R>({
    name: "compute",
    main,
    functions,
    generateWorkerScript: (task, deps, workerConfig) =>
      buildWorkerScript({
        helpers: workerConfig?.helpers,
        main: task,
        functions: deps,
        runtime: buildCoroutineWorkerRuntime(),
      }),
  });

  const run = (async (
    params: T,
    control?: TaskRunControl,
  ): Promise<R> => pool.run(params, control)) as ComputeRunner<T, R>;

  Object.defineProperties(run, {
    active: { enumerable: true, get: () => pool.active },
  });

  run.close = () => pool.close();
  run.dispose = () => pool.dispose();
  return run;
}

/**
 * Creates an elastic compute runner from an existing `CoroutineScript`.
 */
export function computeScript<T = any, R = any>(
  script: CoroutineScript<T, R>,
): ComputeRunner<T, R> {
  const pool = createTaskPool<T, R>({
    name: "compute",
    config: script.helpers?.length ? { helpers: script.helpers } : undefined,
    main: script.main,
    functions: script.functions || [],
    generateWorkerScript: (task, deps, workerConfig) =>
      buildWorkerScript({
        helpers: workerConfig?.helpers,
        main: task,
        functions: deps,
        runtime: buildCoroutineWorkerRuntime(),
      }),
  });

  const run = (async (
    params: T,
    control?: TaskRunControl,
  ): Promise<R> => pool.run(params, control)) as ComputeRunner<T, R>;

  Object.defineProperties(run, {
    active: { enumerable: true, get: () => pool.active },
  });

  run.close = () => pool.close();
  run.dispose = () => pool.dispose();
  return run;
}
