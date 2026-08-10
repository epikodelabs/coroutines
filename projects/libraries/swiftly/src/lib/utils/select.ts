import {
    CHANNEL_INTERNALS,
    ChannelClosedError,
    type Channel,
} from "./channel";
import { background, Context, ContextCancelledError, createAbortError } from "./context";

/**
 * Internal outcome payload used when a registered `select(...)` case wins.
 *
 * The outer `select(...)` call maps this low-level result back into the public
 * `SelectResult` shape.
 *
 * @internal
 */
export type SelectOutcome<T> = {
  index: number;
  caseRef: unknown;
  op: "receive" | "send";
  name?: string;
  value?: T;
  ok?: boolean;
};

/**
 * Internal select registration shared between `channel(...)` and `select(...)`.
 *
 * A registration owns the winner/loser state for one `select(...)` call so the
 * channel can settle exactly one branch atomically.
 *
 * @internal
 */
export type SelectRegistration<T> = {
  id: symbol;
  isSettled: () => boolean;
  settle: (outcome: SelectOutcome<T>) => boolean;
  reject: (error: Error) => boolean;
};

/**
 * Internal metadata carried with each registered channel case.
 *
 * @internal
 */
export type SelectCaseMeta = {
  index: number;
  caseRef: unknown;
  name?: string;
};

/**
 * Internal hooks exposed by a channel so `select(...)` can register atomic send
 * and receive contenders directly against the waiting queues.
 *
 * @internal
 */
export type ChannelSelectInternals<T> = {
  registerSelectReceive: (
    registration: SelectRegistration<T>,
    meta: SelectCaseMeta
  ) => () => void;
  registerSelectSend: (
    value: T,
    registration: SelectRegistration<T>,
    meta: SelectCaseMeta
  ) => () => void;
};

/**
 * Represents a `select` case that receives a value from a channel.
 *
 * @template T The type of value received from the channel.
 */
export type SelectReceiveCase<T = any> = {
  op: "receive";
  channel: Channel<T>;
  name?: string;
};

/**
 * Represents a `select` case that sends a value into a channel.
 *
 * @template T The type of value sent to the channel.
 */
export type SelectSendCase<T = any> = {
  op: "send";
  channel: Channel<T>;
  value: T;
  name?: string;
};

/**
 * Represents a default `select` case that fires when no other case is ready.
 */
export type SelectDefaultCase = {
  op: "default";
  name?: string;
};

/**
 * Represents a cancellable asynchronous operation that can participate in
 * `select(...)` alongside channel sends and receives.
 *
 * The operation receives an `AbortSignal`. When another case wins, Swiftly
 * aborts this signal so cooperative work can stop promptly.
 */
export type SelectOperationCase<T = any> = {
  op: "operation";
  run: (signal: AbortSignal) => T | Promise<T>;
  name?: string;
};

/**
 * A union of all possible `select` cases.
 *
 * @template T The selected value type.
 */
export type SelectCase<T = any> =
  | SelectReceiveCase<T>
  | SelectSendCase<T>
  | SelectOperationCase<T>
  | SelectDefaultCase;

/**
 * Result of a `select` operation indicating which case was chosen.
 *
 * @template T The channel value type.
 */
export type SelectResult<T = any> = {
  index: number;
  case: SelectCase<T>;
  op: SelectCase<T>["op"];
  name?: string;
  value?: T;
  ok?: boolean;
};

/**
 * Builds a receive case for use with `select(...)`.
 *
 * @template T The channel value type.
 * @param ch The channel to receive from.
 * @param name Optional identifier for this case.
 * @returns A `SelectReceiveCase`.
 */
export const receive = <T>(ch: Channel<T>, name?: string): SelectReceiveCase<T> => ({ op: "receive", channel: ch, name });

/**
 * Builds a send case for use with `select(...)`.
 *
 * @template T The channel value type.
 * @param ch The channel to send into.
 * @param value The value to send.
 * @param name Optional identifier for this case.
 * @returns A `SelectSendCase`.
 */
export const send = <T>(ch: Channel<T>, value: T, name?: string): SelectSendCase<T> => ({ op: "send", channel: ch, value, name });

/**
 * Builds a default case for use with `select(...)`.
 *
 * @param name Optional identifier for this case.
 * @returns A `SelectDefaultCase`.
 */
export const otherwise = (name = "default"): SelectDefaultCase => ({ op: "default", name });

/**
 * Builds a cancellable async operation for use with `select(...)`.
 *
 * The callback is started only when selection must block. If another case wins,
 * its signal is aborted. With an `otherwise(...)` case present, operations are
 * not started when no channel case is immediately ready.
 *
 * @template T The operation result type.
 * @param run Work to execute when the select blocks.
 * @param name Optional identifier for this case.
 * @returns A `SelectOperationCase`.
 */
export const operation = <T>(
  run: (signal: AbortSignal) => T | Promise<T>,
  name?: string
): SelectOperationCase<T> => ({ op: "operation", run, name });

/**
 * Waits on channel operations and cancellable async operations simultaneously,
 * returning the first contender that completes.
 *
 * Losing async operations are aborted through the signal passed to `operation(...)`.
 * If a default case is provided and no channel operation is immediately available,
 * the default case is selected without starting async operations.
 *
 * @template T The selected value type.
 * @param cases An array of receive, send, operation, or default cases.
 * @param ctx A cancellation context. Defaults to `background()`.
 * @returns A `SelectResult` describing which case was chosen and its value.
 */
/**
 * Fisher-Yates shuffle for randomizing select case evaluation order.
 */
function shuffledIndices(length: number): number[] {
  const indices = Array.from({ length }, (_, i) => i);
  for (let i = length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices;
}

export async function select<T = any>(cases: SelectCase<T>[], ctx: Context = background()): Promise<SelectResult<T>> {
  if (ctx.signal.aborted) throw createAbortError(ctx.signal);
  if (cases.length === 0) {
    throw new RangeError("select requires at least one case");
  }

  const defaultIndex = cases.findIndex((item) => item.op === "default");
  const channelIndices = cases
    .map((item, i) => ({ item, i }))
    .filter(({ item }) => item.op === "receive" || item.op === "send")
    .map(({ i }) => i);
  const randomChannelOrder = shuffledIndices(channelIndices.length).map((j) => channelIndices[j]);

  // Fast path: channel readiness can be observed without starting any work.
  for (const index of randomChannelOrder) {
    const item = cases[index];
    if (item.op === "receive") {
      const result = item.channel.tryReceive();
      if (result) {
        return { index, case: item, op: item.op, name: item.name, value: result.value, ok: result.ok };
      }
    } else if (item.op === "send") {
      if (item.channel.closed) {
        throw new ChannelClosedError();
      }
      if (item.channel.trySend(item.value)) {
        return { index, case: item, op: item.op, name: item.name, ok: true };
      }
    }
  }

  // A default branch is deliberately non-starting: arbitrary operations have
  // no side-effect-free readiness probe, so we must not launch them just to
  // discover that the default branch should win.
  if (defaultIndex >= 0) {
    const item = cases[defaultIndex];
    return { index: defaultIndex, case: item, op: item.op, name: item.name, ok: true };
  }

  const contenders = cases
    .map((item, i) => ({ item, i }))
    .filter(({ item }) => item.op !== "default");
  const randomOrder = shuffledIndices(contenders.length).map((j) => contenders[j].i);
  const selectId = Symbol("swiftly.select");
  let settled = false;
  let winnerIndex = -1;
  const cleanupFns: Array<() => void> = [];
  const operationControllers = new Map<number, AbortController>();

  const abortLosingOperations = (reason: unknown) => {
    for (const [index, controller] of operationControllers) {
      if (index !== winnerIndex && !controller.signal.aborted) {
        controller.abort(reason);
      }
    }
  };

  try {
    return await new Promise<SelectResult<T>>((resolve, reject) => {
      const settle = (result: SelectResult<T>): boolean => {
        if (settled) return false;
        settled = true;
        winnerIndex = result.index;
        abortLosingOperations(new ContextCancelledError("select case lost"));
        resolve(result);
        return true;
      };

      const rejectSelection = (error: Error, index = -1): boolean => {
        if (settled) return false;
        settled = true;
        winnerIndex = index;
        abortLosingOperations(error);
        reject(error);
        return true;
      };

      // One registration coordinates all channel contenders for this select call.
      const registration: SelectRegistration<T> = {
        id: selectId,
        isSettled: () => settled,
        settle: (outcome) =>
          settle({
            index: outcome.index,
            case: outcome.caseRef as SelectCase<T>,
            op: outcome.op,
            name: outcome.name,
            value: outcome.value,
            ok: outcome.ok,
          }),
        reject: (error) => rejectSelection(error),
      };

      const onContextAbort = () => {
        rejectSelection(createAbortError(ctx.signal));
      };

      ctx.signal.addEventListener("abort", onContextAbort, { once: true });
      cleanupFns.push(() => ctx.signal.removeEventListener("abort", onContextAbort));

      const operationStarts: Array<{
        index: number;
        item: SelectOperationCase<T>;
        controller: AbortController;
      }> = [];

      // Phase 1: register every channel contender and allocate every operation
      // controller before any operation result is allowed to settle selection.
      for (const index of randomOrder) {
        if (settled) break;

        const item = cases[index];
        if (item.op === "operation") {
          const controller = new AbortController();
          operationControllers.set(index, controller);
          operationStarts.push({ index, item, controller });
          continue;
        }

        if (item.op !== "receive" && item.op !== "send") continue;

        const internals = (item.channel as Channel<T> & {
          [CHANNEL_INTERNALS]?: ChannelSelectInternals<T>;
        })[CHANNEL_INTERNALS];

        if (!internals) {
          rejectSelection(new ContextCancelledError("channel does not support select"));
          break;
        }

        const meta = { index, caseRef: item, name: item.name };
        const unregister =
          item.op === "receive"
            ? internals.registerSelectReceive(registration, meta)
            : internals.registerSelectSend(item.value, registration, meta);
        cleanupFns.push(unregister);
      }

      if (settled) return;

      void Promise.resolve().then(() => {
        if (settled) {
          return;
        }
        if (ctx.signal.aborted) {
          rejectSelection(createAbortError(ctx.signal));
          return;
        }

        type StartedOperation = {
          index: number;
          item: SelectOperationCase<T>;
          promise: Promise<T>;
        };

        // Phase 2: invoke every operation before observing any completion. This
        // guarantees that a synchronous failure in one contender still has real
        // started siblings to cancel.
        const startedOperations: StartedOperation[] = operationStarts.map(
          ({ index, item, controller }) => {
            try {
              return {
                index,
                item,
                promise: Promise.resolve(item.run(controller.signal)),
              };
            } catch (error) {
              return {
                index,
                item,
                promise: Promise.reject(error),
              };
            }
          }
        );

        // Phase 3: observe operation completion/failure only after all contenders
        // have started.
        for (const { index, item, promise } of startedOperations) {
          void promise.then(
            (value) => {
              settle({
                index,
                case: item,
                op: item.op,
                name: item.name,
                value,
                ok: true,
              });
            },
            (error) => {
              rejectSelection(
                error instanceof Error
                  ? error
                  : new Error(error ? String(error) : "select operation failed"),
                index
              );
            }
          );
        }
      });
    });
  } finally {
    while (cleanupFns.length > 0) {
      cleanupFns.pop()!();
    }
    abortLosingOperations(new ContextCancelledError("select completed"));
  }
}
