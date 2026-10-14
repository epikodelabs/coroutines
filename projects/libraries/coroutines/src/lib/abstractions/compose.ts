import { buildCoroutineWorkerRuntime } from "../worker/runtimes";
import { buildWorkerScript, serializeScript } from "../worker/script";
import { createTaskRunner } from "../worker/runner";
import { normalizeTaskRunControl } from "../worker/control";
import type { TaskRunControl } from "../utils/transfer";
import type { Coroutine, CoroutineScript, TaskRunner } from "../worker/types";

type Composable<I = any, O = any> = CoroutineScript<I, O> | TaskRunner<I, O>;
type InputOf<T> = T extends CoroutineScript<infer I, any>
  ? I
  : T extends TaskRunner<infer I, any>
    ? I
    : never;
type OutputOf<T> = T extends CoroutineScript<any, infer O>
  ? O
  : T extends TaskRunner<any, infer O>
    ? O
    : never;
type Last<T extends readonly unknown[]> = T extends readonly [...unknown[], infer L] ? L : never;
type IsComposableChain<T extends readonly Composable[]> =
  T extends readonly [infer A extends Composable, infer B extends Composable, ...infer Rest extends Composable[]]
    ? [OutputOf<A>] extends [InputOf<B>]
      ? IsComposableChain<readonly [B, ...Rest]>
      : false
    : true;
type ValidComposableChain<T extends readonly [Composable, ...Composable[]]> =
  IsComposableChain<T> extends true ? T : never;

function isCoroutineScript(value: unknown): value is CoroutineScript {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as CoroutineScript).main === "function"
  );
}

async function composedCoroutineMain(data: any, utils: any): Promise<any> {
  const stages = (globalThis as typeof globalThis & {
    __composeStages?: Array<(value: any, utils: any) => any>;
  }).__composeStages;

  if (!Array.isArray(stages)) {
    throw new Error("compose stages are not initialized");
  }

  let result = data;
  for (let index = 0; index < stages.length; index += 1) {
    result = await stages[index](result, utils);
    if (
      index < stages.length - 1 &&
      result &&
      typeof result === "object" &&
      (result as { __transferResult?: boolean }).__transferResult === true
    ) {
      result = (result as { value: any }).value;
    }
  }

  return result;
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
  const stageRegistry = `globalThis.__composeStages = [${scripts
    .map((_, i) => `__stage${i}`)
    .join(", ")}];`;

  const generateScript = (task: Function, taskHelpers?: string[]) => {
    const allHelpers = Array.from(
      new Set([...(taskHelpers || []), ...helpers])
    );
    return buildWorkerScript({
      helpers: [stageBodies, stageRegistry, ...allHelpers],
      main: task,
      functions: [],
      runtime: buildCoroutineWorkerRuntime(),
    });
  };

  return { main: composedCoroutineMain, helpers, generateScript };
}

/**
 * Chains multiple coroutines sequentially into a single `Coroutine`.
 *
 * Consecutive `CoroutineScript` inputs (created by `coroutine()`) are fused
 * into one worker segment so the stages inside it run within a single worker
 * task per concurrent invocation. Segments and `TaskRunner` inputs are
 * executed strictly in the order they are passed, so interleaved chains such
 * as `compose(runnerA, coroutineB)` run `runnerA` before `coroutineB`.
 *
 * The input scripts and runners are not disposed by the composed coroutine —
 * callers remain responsible for their lifecycle.
 */
export function compose(): Coroutine<any, any>;
export function compose<const S extends readonly [Composable, ...Composable[]]>(
  ...scripts: ValidComposableChain<S>
): Coroutine<InputOf<S[0]>, OutputOf<Last<S>>>;

export function compose<T = any, R = any>(
  ...scripts: Array<CoroutineScript<any, any> | TaskRunner<any, any>>
): Coroutine<T, R> {
  const segments: Array<{ kind: "worker" | "task"; runner: TaskRunner<any, any> }> = [];
  let scriptBuffer: CoroutineScript<any, any>[] = [];

  const flushWorkerSegment = (): void => {
    if (scriptBuffer.length === 0) return;

    const merged = mergeCoroutineScripts(scriptBuffer);
    segments.push({
      kind: "worker",
      runner: createTaskRunner<any, any>({
        name: "compose",
        config: merged.helpers.length > 0 ? { helpers: merged.helpers } : undefined,
        main: merged.main,
        functions: [],
        generateWorkerScript: (task, _dependencies, workerConfig) =>
          merged.generateScript(task, workerConfig?.helpers),
      }),
    });
    scriptBuffer = [];
  };

  for (const s of scripts) {
    if (isCoroutineScript(s)) {
      scriptBuffer.push(s);
    } else if (s && typeof (s as TaskRunner).run === "function") {
      flushWorkerSegment();
      segments.push({ kind: "task", runner: s as TaskRunner });
    }
  }
  flushWorkerSegment();

  let lifecycle: "open" | "closing" | "finalizing" | "finalized" = "open";
  let activeRuns = 0;
  let gracefulCloseStarted = false;
  let closePromise: Promise<void> | null = null;
  let resolveClose: (() => void) | null = null;
  let rejectClose: ((error: Error) => void) | null = null;
  let disposePromise: Promise<void> | null = null;

  const ownedRunners = (): TaskRunner<any, any>[] =>
    segments.map((segment) => segment.runner);

  const closeOwnedRunners = async (): Promise<void> => {
    const errors: Error[] = [];

    for (const runner of ownedRunners()) {
      try {
        await runner.close();
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }

    if (errors.length > 0) throw errors[0];
  };

  const disposeOwnedRunners = async (): Promise<void> => {
    const errors: Error[] = [];

    for (const runner of ownedRunners()) {
      try {
        await runner.dispose();
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }

    if (errors.length > 0) throw errors[0];
  };

  const ensureClosePromise = (): Promise<void> => {
    if (closePromise) return closePromise;

    closePromise = new Promise<void>((resolve, reject) => {
      resolveClose = resolve;
      rejectClose = reject;
    });
    return closePromise;
  };

  const settleLifecycle = (outcome: "resolve" | "reject", error?: Error): void => {
    lifecycle = "finalized";
    if (outcome === "reject" && error) rejectClose?.(error);
    else resolveClose?.();
    resolveClose = null;
    rejectClose = null;
  };

  const maybeStartGracefulClose = (): void => {
    if (
      lifecycle !== "closing" ||
      activeRuns !== 0 ||
      gracefulCloseStarted
    ) {
      return;
    }

    gracefulCloseStarted = true;
    void closeOwnedRunners().then(
      () => settleLifecycle("resolve"),
      (error) =>
        settleLifecycle(
          "reject",
          error instanceof Error ? error : new Error(String(error)),
        ),
    );
  };

  const run = async (data: T, control?: TaskRunControl): Promise<R> => {
    if (lifecycle !== "open") {
      throw new Error("compose is closed");
    }

    activeRuns += 1;
    try {
      let result: any = data;
      const { signal, transfer } = normalizeTaskRunControl(control);
      let transferPending = transfer.length > 0;

      for (const segment of segments) {
        result = await segment.runner.run(
          result,
          transferPending
            ? { signal, transfer }
            : signal,
        );
        transferPending = false;
      }

      return result;
    } finally {
      activeRuns = Math.max(0, activeRuns - 1);
      maybeStartGracefulClose();
    }
  };

  const close = (): Promise<void> => {
    if (lifecycle === "finalized") {
      return closePromise ?? Promise.resolve();
    }
    if (lifecycle === "finalizing") {
      return ensureClosePromise();
    }

    if (lifecycle === "open") {
      lifecycle = "closing";
    }

    const pendingClose = ensureClosePromise();
    maybeStartGracefulClose();
    return pendingClose;
  };

  const dispose = (): Promise<void> => {
    if (disposePromise) return disposePromise;
    if (lifecycle === "finalized") {
      return Promise.resolve();
    }

    lifecycle = "finalizing";
    ensureClosePromise();

    disposePromise = disposeOwnedRunners().then(
      () => {
        settleLifecycle("resolve");
      },
      (error) => {
        const normalized =
          error instanceof Error ? error : new Error(String(error));
        settleLifecycle("resolve");
        throw normalized;
      },
    );

    return disposePromise;
  };

  return {
    run,
    close,
    dispose,
    get size(): number {
      return ownedRunners().reduce((sum, runner) => sum + (runner.size ?? 0), 0);
    },
  } as Coroutine<T, R>;
}