import { buildCoroutineWorkerRuntime, buildWorkerScript, createTaskRunner, serializeScript } from "../worker";
import type { Coroutine, CoroutineScript, TaskRunner } from "../worker/types";
import type { TaskRunControl } from "./transfer";
import { normalizeTaskRunControl } from "../worker/control";

function isCoroutineScript(value: unknown): value is CoroutineScript {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as CoroutineScript).main === "function"
  );
}

/**
 * Merges multiple `CoroutineScript`s into a single composed script suitable for
 * baking into a worker blob via `createTaskRunner`.
 *
 * Each stage is wrapped in an IIFE so that dependency function names
 * and internal variables do not collide across stages.
 */
function mergeCoroutineScripts(scripts: CoroutineScript[]): {
  main: Function;
  helpers: string[];
  generateScript: (main: Function, helpers?: string[]) => string;
} {
  const helpers = Array.from(
    new Set(scripts.flatMap((s) => s.helpers || []))
  );

  const stageBodies = scripts
    .map((s, i) => {
      const { code, deps } = serializeScript(s);
      const depsSection = deps.length > 0 ? deps.join(";\n") + ";" : "";
      return `const __stage${i} = (() => {
${depsSection ? '  ' + depsSection.replace(/\n/g, '\n  ') + '\n' : ''}  return (${code});
})();`;
    })
    .reduce((acc, body, i) => `${acc}${i > 0 ? '\n\n' : ''}${body}`, '');

  const composedMain = new Function(
    `return async function(data, utils) {
      let result = data;
      ${scripts
        .map((_, i) =>
          i === scripts.length - 1
            ? `result = await __stage${i}(result, utils);`
            : `result = await __stage${i}(result, utils);\n      if (result && result.__swiftlyTransferResult === true) result = result.value;`
        )
        .reduce((acc, line, i) => `${acc}${i > 0 ? "\n      " : ""}${line}`, "")}
      return result;
    };`
  )() as (data: any) => Promise<any>;

  const generateScript = (task: Function, taskHelpers?: string[]) => {
    const allHelpers = Array.from(
      new Set([...(taskHelpers || []), ...helpers])
    );
    return buildWorkerScript({
      helpers: [stageBodies, ...allHelpers],
      main: task,
      functions: [],
      runtime: buildCoroutineWorkerRuntime(),
    });
  };

  return { main: composedMain, helpers, generateScript };
}

/**
 * Chains multiple coroutines sequentially into a single `Coroutine`.
 *
 * `CoroutineScript` inputs (created by `coroutine()`) are merged into one
 * worker script so the entire pipeline runs inside one dedicated worker task.
 *
 * `TaskRunner` inputs are chained in the main thread after the worker
 * stage completes.
 */
export function compose<A, B>(...scripts: [CoroutineScript<A, B>]): Coroutine<A, B>;
export function compose<A, B, C>(...scripts: [CoroutineScript<A, B>, CoroutineScript<B, C>]): Coroutine<A, C>;
export function compose<A, B, C, D>(...scripts: [CoroutineScript<A, B>, CoroutineScript<B, C>, CoroutineScript<C, D>]): Coroutine<A, D>;
export function compose<T = any, R = any>(...scripts: Array<CoroutineScript<any, any> | TaskRunner<any, any>>): Coroutine<T, R>;

export function compose<T = any, R = any>(
  ...scripts: Array<CoroutineScript<any, any> | TaskRunner<any, any>>
): Coroutine<T, R> {
  const workerScripts: CoroutineScript<any, any>[] = [];
  const taskRunners: TaskRunner<any, any>[] = [];

  for (const s of scripts) {
    if (isCoroutineScript(s)) {
      workerScripts.push(s);
    } else if (s && typeof (s as TaskRunner).run === "function") {
      taskRunners.push(s as TaskRunner);
    }
  }

  let workerRunner: TaskRunner<T, R> | null = null;

  if (workerScripts.length > 0) {
    const merged = mergeCoroutineScripts(workerScripts);
    workerRunner = createTaskRunner<T, R>({
      name: "compose",
      config: merged.helpers.length > 0 ? { helpers: merged.helpers } : undefined,
      main: merged.main,
      functions: [],
      generateWorkerScript: (task, _dependencies, workerConfig) =>
        merged.generateScript(task, workerConfig?.helpers),
    });
  }

  const run = async (data: T, control?: TaskRunControl): Promise<R> => {
    let result: any = data;
    const { signal, transfer } = normalizeTaskRunControl(control);
    let transferPending = transfer.length > 0;

    if (workerRunner) {
      result = await workerRunner.run(
        result,
        transferPending ? { signal, transfer } : signal,
      );
      transferPending = false;
    }

    for (const runner of taskRunners) {
      result = await runner.run(
        result,
        transferPending ? { signal, transfer } : signal,
      );
      transferPending = false;
    }

    return result;
  };

  const close = async (): Promise<void> => {
    const errors: Error[] = [];

    if (workerRunner) {
      try {
        await workerRunner.close();
      } catch (e) {
        errors.push(e instanceof Error ? e : new Error(String(e)));
      }
    }

    for (const runner of taskRunners) {
      try {
        await runner.close();
      } catch (e) {
        errors.push(e instanceof Error ? e : new Error(String(e)));
      }
    }

    if (errors.length > 0) {
      throw errors[0];
    }
  };

  const dispose = async (): Promise<void> => {
    const errors: Error[] = [];

    if (workerRunner) {
      try {
        await workerRunner.dispose();
      } catch (e) {
        errors.push(e instanceof Error ? e : new Error(String(e)));
      }
    }

    for (const runner of taskRunners) {
      try {
        await runner.dispose();
      } catch (e) {
        errors.push(e instanceof Error ? e : new Error(String(e)));
      }
    }

    if (errors.length > 0) {
      throw errors[0];
    }
  };

  return {
    run,
    close,
    dispose,
  } as Coroutine<T, R>;
}