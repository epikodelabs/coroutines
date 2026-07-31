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
 * A union of all possible `select` cases.
 *
 * @template T The channel value type.
 */
export type SelectCase<T = any> = SelectReceiveCase<T> | SelectSendCase<T> | SelectDefaultCase;

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
 * Waits on multiple channel operations simultaneously and returns the first one that is ready.
 *
 * If a default case is provided and no channel operation is immediately available,
 * the default case is selected without blocking.
 *
 * @template T The channel value type.
 * @param cases An array of select cases (receive, send, or default).
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

  const defaultIndex = cases.findIndex((item) => item.op === "default");
  const channelIndices = cases
    .map((_, i) => i)
    .filter((i) => cases[i].op !== "default");
  const randomOrder = shuffledIndices(channelIndices.length).map((j) => channelIndices[j]);

  // Fast path: check ready cases in random order
  for (const index of randomOrder) {
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

  if (defaultIndex >= 0) {
    const item = cases[defaultIndex];
    return { index: defaultIndex, case: item, op: item.op, name: item.name, ok: true };
  }

  const selectId = Symbol("streamix.select");
  let settled = false;
  const cleanupFns: Array<() => void> = [];

  try {
    return await new Promise<SelectResult<T>>((resolve, reject) => {
      // One registration coordinates all channel contenders for this select call.
      const registration: SelectRegistration<T> = {
        id: selectId,
        isSettled: () => settled,
        settle: (outcome) => {
          if (settled) return false;
          settled = true;
          resolve({
            index: outcome.index,
            case: outcome.caseRef as SelectCase<T>,
            op: outcome.op,
            name: outcome.name,
            value: outcome.value,
            ok: outcome.ok,
          });
          return true;
        },
        reject: (error) => {
          if (settled) return false;
          settled = true;
          reject(error);
          return true;
        },
      };

      const onContextAbort = () => {
        registration.reject(createAbortError(ctx.signal));
      };

      ctx.signal.addEventListener("abort", onContextAbort, { once: true });
      cleanupFns.push(() => ctx.signal.removeEventListener("abort", onContextAbort));

      // Register waiters in random order so no channel starves when
      // multiple become ready in the same tick.
      for (const index of randomOrder) {
        if (settled) {
          break;
        }

        const item = cases[index];
        if (item.op === "default") {
          continue;
        }

        const internals = (item.channel as Channel<T> & {
          [CHANNEL_INTERNALS]?: ChannelSelectInternals<T>;
        })[CHANNEL_INTERNALS];

        if (!internals) {
          registration.reject(new ContextCancelledError("channel does not support select"));
          break;
        }

        // Register the case directly with the channel queues so only one branch
        // can win, even when multiple channels become ready in the same tick.
        const meta = { index, caseRef: item, name: item.name };
        const unregister =
          item.op === "receive"
            ? internals.registerSelectReceive(registration, meta)
            : internals.registerSelectSend(item.value, registration, meta);
        cleanupFns.push(unregister);
      }
    });
  } finally {
    while (cleanupFns.length > 0) {
      cleanupFns.pop()!();
    }
  }
}
