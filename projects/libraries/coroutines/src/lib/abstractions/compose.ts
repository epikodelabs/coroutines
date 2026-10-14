import { buildCoroutineWorkerRuntime } from "../worker/runtimes";
import { buildWorkerScript, serializeScript } from "../worker/script";
import { getDefinition, isCoroutineDefinition, registerDefinition } from "../worker/definition";
import type { DefinitionInternals } from "../worker/definition";
import type { Coroutine } from "../worker/types";

type Composable = Coroutine<any, any>;
type InputOf<T> = T extends Coroutine<infer I, any> ? I : never;
type OutputOf<T> = T extends Coroutine<any, infer O> ? O : never;
type Last<T extends readonly unknown[]> = T extends readonly [...unknown[], infer L] ? L : never;
type IsComposableChain<T extends readonly Composable[]> =
  T extends readonly [infer A extends Composable, infer B extends Composable, ...infer Rest extends Composable[]]
    ? [OutputOf<A>] extends [InputOf<B>]
      ? IsComposableChain<readonly [B, ...Rest]>
      : false
    : true;
type ValidComposableChain<T extends readonly [Composable, ...Composable[]]> =
  IsComposableChain<T> extends true ? T : never;

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
 * Merges multiple definitions into a single composed script suitable for
 * baking into a worker blob.
 *
 * Each stage is wrapped in an IIFE so that dependency function names
 * and internal variables do not collide across stages.
 */
function mergeCoroutineScripts(scripts: Coroutine[]): {
  main: Function;
  helpers: string[];
  generateScript: (main: Function, helpers?: string[]) => string;
} {
  // Nested composes are flattened into their leaf definitions: a composed
  // definition's main reads a `globalThis.__composeStages` registry that is
  // only meaningful for its own merge, so nesting one inside another would
  // otherwise recurse forever.
  const flatten = (definitions: Coroutine[]): DefinitionInternals[] => {
    const leaves: DefinitionInternals[] = [];
    for (const definition of definitions) {
      const record = getDefinition(definition);
      if (!record) {
        throw new TypeError("compose() accepts only definitions created by coroutine() or compose()");
      }
      if (record.stages && record.stages.length > 0) {
        leaves.push(...flatten(record.stages));
      } else {
        leaves.push(record);
      }
    }
    return leaves;
  };

  const internals = flatten(scripts);

  const helpers = Array.from(
    new Set(internals.flatMap((s) => s.helpers))
  );

  const stageBodies = internals
    .map((s, i) => {
      const { code, deps } = serializeScript(s);
      const depsSection = deps.length > 0 ? deps.join(";\n") + ";" : "";
      return `const __stage${i} = (() => {
${depsSection ? '  ' + depsSection.replace(/\n/g, '\n  ') + '\n' : ''}  return (${code});
})();`;
    })
    .reduce((acc, body, i) => `${acc}${i > 0 ? '\n\n' : ''}${body}`, '');
  const stageRegistry = `globalThis.__composeStages = [${internals
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
 * Fuses multiple coroutine definitions into a single immutable definition.
 *
 * The stages' input/output types are validated at compile time, and all
 * stages are merged into one worker script so the whole pipeline runs inside
 * a single worker task per invocation — intermediate results never cross a
 * worker boundary.
 *
 * `compose()` is pure code fusion: it owns no workers and has no lifecycle.
 * Run the result like any other definition — `group().executor(composed)`.
 * The input definitions are untouched and reusable.
 */
export function compose(): Coroutine<any, any>;
export function compose<const S extends readonly [Composable, ...Composable[]]>(
  ...scripts: ValidComposableChain<S>
): Coroutine<InputOf<S[0]>, OutputOf<Last<S>>>;

export function compose<T = any, R = any>(
  ...scripts: Coroutine[]
): Coroutine<T, R> {
  for (const script of scripts) {
    if (!isCoroutineDefinition(script)) {
      throw new TypeError(
        "compose() accepts only definitions created by coroutine() or compose()",
      );
    }
  }

  const merged = mergeCoroutineScripts(scripts);

  return registerDefinition<T, R>({
    main: merged.main,
    helpers: merged.helpers,
    functions: [],
    name: "compose",
    stages: scripts,
    generateWorkerScript: (task, _dependencies, workerConfig) =>
      merged.generateScript(task, workerConfig?.helpers),
  });
}
