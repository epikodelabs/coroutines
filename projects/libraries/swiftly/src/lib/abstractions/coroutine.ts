import { createTaskRunner } from "../worker/runner";
import { buildCoroutineWorkerRuntime } from "../worker/runtimes";
import { buildWorkerScript } from "../worker/script";
import type { Coroutine, CoroutineScript } from "../worker/types";

/**
 * Task function executed inside a worker without actor utilities.
 */
export type CoroutineTask<T = any, R = any> = (data: T) => Promise<R> | R;

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
    dispose: runner.dispose,
    helpers,
    main,
    functions,
  } as Coroutine<T, R> & CoroutineScript<T, R>;
}

/**
 * Creates a reusable coroutine task runner with its worker script baked once.
 *
 * A coroutine owns one dedicated worker, reuses it across calls, and queues
 * `run()` submissions on that worker. The returned `Coroutine` can be
 * used with `pipe()` in stream pipelines or called directly. Call
 * `.dispose()` when done to terminate the underlying worker. Raw helper
 * snippets can be provided through an optional trailing options object.
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

