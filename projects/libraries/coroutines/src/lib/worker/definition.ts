import type { Coroutine, Executor, ExecutorOptions } from "./types";
import { createTaskRunner } from "./runner";

/**
 * Internal record backing a public `Coroutine` definition.
 *
 * The record is held in a module-private WeakMap so definitions stay opaque:
 * user code can hold and pass them around, but cannot read or forge their
 * script internals.
 */
export type DefinitionInternals = {
  /** Main task body executed inside the worker. */
  main: Function;
  /** Raw worker-side snippets injected before the serialized functions. */
  helpers: string[];
  /** Additional named helper functions serialized alongside `main`. */
  functions: Function[];
  /** Pool name used in executor error messages. */
  name: string;
  /**
   * For composed definitions: the definitions this one fused. Used to
   * flatten nested composes at merge time.
   */
  stages?: Coroutine[];
  /** Builds the worker script for this definition. */
  generateWorkerScript: (
    main: Function,
    functions: Function[],
    config?: { helpers?: string[] },
  ) => string;
};

const definitions = new WeakMap<object, DefinitionInternals>();

/**
 * Registers a new opaque definition and returns its public handle.
 */
export function registerDefinition<T = any, R = any>(
  internals: DefinitionInternals,
): Coroutine<T, R> {
  const definition = Object.freeze({});
  definitions.set(definition, internals);
  return definition as Coroutine<T, R>;
}

/**
 * Returns the internals of a registered definition, if any.
 */
export function getDefinition(definition: object): DefinitionInternals | undefined {
  return definitions.get(definition);
}

/**
 * Identifies registered definitions. Only objects produced by
 * `registerDefinition` pass — shape-based duck-typing cannot forge one.
 */
export function isCoroutineDefinition(value: unknown): value is Coroutine {
  return typeof value === "object" && value !== null && definitions.has(value);
}

/**
 * Builds a worker-pool executor for a registered definition.
 *
 * The pool carries the definition's name ("coroutine" or "compose") so
 * `RunnerClosedError` messages stay stable per definition kind.
 */
export function createDefinitionExecutor<T, R>(
  definition: Coroutine<T, R>,
  options: ExecutorOptions = {},
): Executor<T, R> {
  const internals = getDefinition(definition);
  if (!internals) {
    throw new TypeError(
      "executor requires a definition created by coroutine() or compose()",
    );
  }

  return createTaskRunner<T, R>({
    name: internals.name,
    maxWorkers: options.maxWorkers,
    idleTimeout: options.idleTimeout,
    config: internals.helpers.length > 0 ? { helpers: internals.helpers } : undefined,
    main: internals.main,
    functions: internals.functions,
    generateWorkerScript: internals.generateWorkerScript,
  });
}
