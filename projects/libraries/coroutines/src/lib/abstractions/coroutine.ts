import { buildCoroutineWorkerRuntime } from "../worker/runtimes";
import { buildWorkerScript } from "../worker/script";
import { registerDefinition } from "../worker/definition";
import type { Coroutine } from "../worker/types";
import type { WorkerTaskResult, WorkerTaskUtils } from "../utils/transfer";

/**
 * Task function executed inside a worker without actor utilities.
 */
export type CoroutineTask<T = any, R = any> = (data: T, utils: WorkerTaskUtils) =>
  | WorkerTaskResult<R>
  | Promise<WorkerTaskResult<R>>;

/**
 * Optional settings for a coroutine definition.
 */
export type CoroutineOptions = {
  /** Raw helper snippets injected into the worker before task code. */
  helpers?: string[];
};

type CoroutineDefinitionRest = Function[] | [...Function[], CoroutineOptions];

function createCoroutineDefinition<T, R>(
  main: CoroutineTask<T, R>,
  functions: Function[],
  options: CoroutineOptions,
): Coroutine<T, R> {
  return registerDefinition<T, R>({
    main,
    helpers: options.helpers || [],
    functions,
    name: "coroutine",
    generateWorkerScript: (task, dependencies, workerConfig) =>
      buildWorkerScript({
        helpers: workerConfig?.helpers,
        main: task,
        functions: dependencies,
        runtime: buildCoroutineWorkerRuntime(),
      }),
  });
}

/**
 * Creates an immutable worker-task definition.
 *
 * A definition is pure executable code and metadata: it owns no workers and
 * has no lifecycle. Run it by creating a group-owned executor —
 * `group().executor(def)` — whose pool lifetime belongs to that group.
 *
 * Raw helper snippets can be provided through an optional trailing options
 * object; named helper functions are passed as trailing arguments and are
 * serialized into the worker alongside the task.
 */
export function coroutine<T, R>(
  main: CoroutineTask<T, R>,
  ...rest: CoroutineDefinitionRest
): Coroutine<T, R>;
export function coroutine<T, R>(
  main: CoroutineTask<T, R>,
  ...rest: CoroutineDefinitionRest
): Coroutine<T, R> {
  if (typeof main !== "function") {
    throw new TypeError("coroutine requires a task function");
  }

  const last = rest[rest.length - 1];
  const hasOptions =
    typeof last === "object" &&
    last !== null &&
    typeof last !== "function" &&
    !Array.isArray(last);

  const options = (hasOptions ? last : undefined) as CoroutineOptions | undefined;
  const functions = (hasOptions ? rest.slice(0, -1) : rest) as Function[];

  return createCoroutineDefinition(main, functions, options || {});
}

export { RunnerClosedError } from "../worker/types";
