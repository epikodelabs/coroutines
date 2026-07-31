import { createTaskPool } from "../worker/pool";
import { buildCoroutineWorkerRuntime } from "../worker/runtimes";
import { buildWorkerScript } from "../worker/script";
import type { CoroutineScript } from "../worker/types";

/**
 * Callable pooled compute handle returned by `compute()`.
 */
export interface ComputeRunner<T = any, R = any> {
  /** Submits input to the compute pool and resolves with the worker result. */
  (params: T): Promise<R>;
  /** Terminates all workers in the pool and rejects queued work. */
  dispose: () => Promise<void>;
}

/**
 * Offloads a function to a dedicated worker pool.
 *
 * `compute` creates a specialized reusable pool: the task is baked into the
 * worker blob once and shared by every worker in the pool. There is no
 * runtime compilation overhead; workers are pre-initialized with the task.
 *
 * The returned async function submits params to that pool. The pool lives
 * for as long as the function exists. Call `.dispose()` when done to
 * terminate the underlying workers.
 *
 * @example
 * ```ts
 * const run = compute((x: number) => x * 2);
 * const result = await run(5); // 10
 * await run.dispose();
 * ```
 */
export function compute<T = any, R = any>(
  main: (data: T) => R | Promise<R>,
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

  const run = async (params: T): Promise<R> => {
    return pool.run(params);
  };

  run.dispose = () => pool.dispose();
  return run;
}

/**
 * Creates a compute runner from an existing `CoroutineScript`.
 *
 * This is useful when a script should be pooled for throughput instead of run
 * through `coroutine()`'s single dedicated worker.
 */
export function computeScript<T = any, R = any>(
  script: CoroutineScript<T, R>
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

  const run = async (params: T): Promise<R> => {
    return pool.run(params);
  };

  run.dispose = () => pool.dispose();
  return run;
}
