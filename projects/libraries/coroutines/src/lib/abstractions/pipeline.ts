import { normalizeTaskRunControl } from "../worker/control";
import type { Pipeline, Runnable } from "../worker/types";
import type { TaskRunControl } from "../utils/transfer";

type InputOf<T> = T extends Runnable<infer I, any> ? I : never;
type OutputOf<T> = T extends Runnable<any, infer O> ? O : never;
type Last<T extends readonly unknown[]> = T extends readonly [...unknown[], infer L] ? L : never;
type IsRunnableChain<T extends readonly Runnable[]> =
  T extends readonly [infer A extends Runnable, infer B extends Runnable, ...infer Rest extends Runnable[]]
    ? [OutputOf<A>] extends [InputOf<B>]
      ? IsRunnableChain<readonly [B, ...Rest]>
      : false
    : true;
type ValidRunnableChain<T extends readonly [Runnable, ...Runnable[]]> =
  IsRunnableChain<T> extends true ? T : never;

/**
 * Chains runnable steps sequentially on the main thread.
 *
 * A pipeline owns nothing and imposes no lifecycle: it only orders execution.
 * Each step's worker pool and lifetime belong to the group that created it,
 * so a step whose group has settled rejects the run with that group's error.
 *
 * The run signal is forwarded to every step; an input transfer list applies
 * only to the first step.
 */
export function pipeline(): Pipeline<any, any>;
export function pipeline<const S extends readonly [Runnable, ...Runnable[]]>(
  ...steps: ValidRunnableChain<S>
): Pipeline<InputOf<S[0]>, OutputOf<Last<S>>>;

export function pipeline<T = any, R = any>(
  ...steps: Runnable[]
): Pipeline<T, R> {
  const run = async (data: T, control?: TaskRunControl): Promise<R> => {
    let result: any = data;
    const { signal, transfer } = normalizeTaskRunControl(control);
    let transferPending = transfer.length > 0;

    for (const step of steps) {
      result = await step.run(
        result,
        transferPending
          ? { signal, transfer }
          : signal,
      );
      transferPending = false;
    }

    return result;
  };

  return { run };
}
