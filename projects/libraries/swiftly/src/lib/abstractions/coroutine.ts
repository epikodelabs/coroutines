import { createTaskRunner } from "../worker/runner";
import { buildCoroutineWorkerRuntime } from "../worker/runtimes";
import { buildWorkerScript } from "../worker/script";
import type { Coroutine, CoroutineScript } from "../worker/types";
import type { WorkerTaskResult, WorkerTaskUtils } from "../utils/transfer";

/**
 * Task function executed inside a worker without actor utilities.
 */
export type CoroutineTask<T = any, R = any> = (data: T, utils: WorkerTaskUtils) =>
  | WorkerTaskResult<R>
  | Promise<WorkerTaskResult<R>>;

/**
 * Optional settings for plain one-way coroutine workers.
 */
export type CoroutineOptions = {
  /** Raw helper snippets injected into the worker before task code. */
  helpers?: string[];
};

type CoroutineDefinitionRest = Function[] | [...Function[], CoroutineOptions];

function createCoroutineImpl<T, R>(
  main: CoroutineTask<T, R>,
  functions: Function[],
  helpers: string[]
): Coroutine<T, R> & CoroutineScript<T, R> {
  const runner = createTaskRunner<T, R>({
    name: "coroutine",
    config: helpers.length > 0 ? { helpers } : undefined,
    main,
    functions,
    generateWorkerScript: (task, dependencies, workerConfig) =>
      buildWorkerScript({
        helpers: workerConfig?.helpers,
        main: task,
        functions: dependencies,
        runtime: buildCoroutineWorkerRuntime(),
      }),
  });

  return {
    run: runner.run,
    close: runner.close,
    dispose: runner.dispose,
    helpers,
    main,
    functions,
  } as Coroutine<T, R> & CoroutineScript<T, R>;
}

/**
 * Creates a reusable stateless worker-backed task runner.
 *
 * The task script is baked once. Concurrent `run()` calls reuse idle workers or
 * lazily create additional workers as demand requires. Coroutine itself does
 * not impose a concurrency policy; use `group()` or `semaphore()` when work
 * should be bounded. Call `.dispose()` when done to terminate all owned workers.
 * Raw helper snippets can be provided through an optional trailing options object.
 */
export function coroutine<T, R>(
  main: CoroutineTask<T, R>,
  ...rest: CoroutineDefinitionRest
): Coroutine<T, R> & CoroutineScript<T, R>;
export function coroutine<T, R>(
  main: CoroutineTask<T, R>,
  ...rest: CoroutineDefinitionRest
): Coroutine<T, R> & CoroutineScript<T, R> {
  const last = rest[rest.length - 1];
  const hasOptions =
    typeof last === "object" &&
    last !== null &&
    typeof last !== "function" &&
    !Array.isArray(last);

  const options = (hasOptions ? last : undefined) as CoroutineOptions | undefined;
  const functions = (hasOptions ? rest.slice(0, -1) : rest) as Function[];

  return createCoroutineImpl(main, functions, options?.helpers || []);
}

export type { CoroutineScript } from "../worker/types";