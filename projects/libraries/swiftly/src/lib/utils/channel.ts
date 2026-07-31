import { createAbortError } from "./context";
import type {
    ChannelSelectInternals,
    SelectCaseMeta,
    SelectOutcome,
    SelectRegistration,
} from "./select";

/**
 * Thrown when sending to or receiving from a closed channel.
 */
export class ChannelClosedError extends Error {
  constructor(message = "channel is closed") {
    super(message);
    this.name = "ChannelClosedError";
  }
}

/**
 * Result of a channel receive operation.
 * `ok: true` when a value was available, `ok: false` when the channel is closed and empty.
 */
export type ReceiveResult<T> =
  | { ok: true; value: T }
  | { ok: false; value: undefined };

/**
 * Internal symbol used by `select(...)` to access atomic wait-list hooks on a channel.
 *
 * This is exported so `select.ts` can coordinate with the channel implementation,
 * but it is not part of the normal end-user API surface.
 *
 * @internal
 */
export const CHANNEL_INTERNALS = Symbol("streamix.channelInternals");

type WaitingReceiver<T> = {
  resolve: (result: ReceiveResult<T>) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  abort?: () => void;
  select?: {
    registration: SelectRegistration<T>;
    meta: SelectCaseMeta;
  };
};

type WaitingSender<T> = {
  value: T;
  resolve: () => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  abort?: () => void;
  select?: {
    registration: SelectRegistration<T>;
    meta: SelectCaseMeta;
  };
};

type SelectableChannel<T> = Channel<T> & {
  [CHANNEL_INTERNALS]: ChannelSelectInternals<T>;
};

/**
 * An async channel for passing values between concurrent operations.
 *
 * - `capacity = 0` creates an unbuffered channel (send blocks until receive is ready).
 * - `capacity > 0` creates a buffered channel (send succeeds while buffer has space).
 *
 * Channels are async iterables; use `for await...of` to consume values until closed.
 */
export type Channel<T> = AsyncIterable<T> & {
  /** Maximum number of values that can be buffered. */
  readonly capacity: number;
  /** Current number of buffered values. */
  readonly size: number;
  /** Whether the channel has been closed. */
  readonly closed: boolean;
  /** Sends a value. Blocks if the channel is unbuffered and no receiver is waiting, or if the buffer is full. Rejects if the channel is closed. */
  send(value: T, signal?: AbortSignal): Promise<void>;
  /** Receives a value. Returns the value directly, or `undefined` when the channel is closed. Blocks if the channel is empty. */
  receive(signal?: AbortSignal): Promise<T | undefined>;
  /** Non-blocking send. Returns `true` if the value was accepted immediately. */
  trySend(value: T): boolean;
  /** Non-blocking receive. Returns the result immediately, or `undefined` if nothing is available. */
  tryReceive(): ReceiveResult<T> | undefined;
  /** Closes the channel. Pending receivers resolve with `{ ok: false }`; pending senders reject. */
  close(): void;
};

/**
 * Creates a new async channel with the given buffer capacity.
 *
 * @param capacity - Buffer size. `0` means unbuffered (hand-off semantics). Must be a non-negative integer.
 * @returns A new channel.
 */
export function channel<T>(capacity = 0): Channel<T> {
  if (!Number.isInteger(capacity) || capacity < 0) {
    throw new RangeError("channel capacity must be a non-negative integer");
  }

  const buffer: T[] = [];
  const receivers: WaitingReceiver<T>[] = [];
  const senders: WaitingSender<T>[] = [];
  let isClosed = false;

  const cleanupReceiver = (receiver: WaitingReceiver<T>) => {
    if (receiver.signal && receiver.abort) {
      receiver.signal.removeEventListener("abort", receiver.abort);
    }
  };

  const cleanupSender = (sender: WaitingSender<T>) => {
    if (sender.signal && sender.abort) {
      sender.signal.removeEventListener("abort", sender.abort);
    }
  };

  const removeReceiver = (receiver: WaitingReceiver<T>) => {
    const index = receivers.indexOf(receiver);
    if (index >= 0) receivers.splice(index, 1);
    cleanupReceiver(receiver);
  };

  const removeSender = (sender: WaitingSender<T>) => {
    const index = senders.indexOf(sender);
    if (index >= 0) senders.splice(index, 1);
    cleanupSender(sender);
  };

  /**
   * Settles a waiting receive-side select case with the value it won.
   */
  const settleSelectedReceive = (
    receiver: WaitingReceiver<T>,
    result: ReceiveResult<T>
  ): boolean => {
    const outcome: SelectOutcome<T> = {
      index: receiver.select!.meta.index,
      caseRef: receiver.select!.meta.caseRef,
      op: "receive",
      name: receiver.select!.meta.name,
      ok: result.ok,
    };

    if (result.ok) {
      outcome.value = result.value;
    }

    return receiver.select!.registration.settle(outcome);
  };

  /**
   * Settles a waiting send-side select case after its value has been accepted.
   */
  const settleSelectedSend = (sender: WaitingSender<T>): boolean =>
    sender.select!.registration.settle({
      index: sender.select!.meta.index,
      caseRef: sender.select!.meta.caseRef,
      op: "send",
      name: sender.select!.meta.name,
      ok: true,
    } satisfies SelectOutcome<T>);

  /**
   * Rejects a select waiter when the channel is closed.
   */
  const rejectSelectedWaiter = (
    waiter: WaitingReceiver<T> | WaitingSender<T>,
    error: Error
  ): boolean => waiter.select!.registration.reject(error);

  /**
   * Tries to hand a value directly to the first compatible waiting receiver.
   *
   * When called from a select-managed sender we must avoid matching the sender
   * with a receiver owned by the same outer select registration.
   */
  const tryDispatchToWaitingReceiver = (
    value: T,
    senderSelectId?: symbol
  ): boolean => {
    for (let index = 0; index < receivers.length; index++) {
      const receiver = receivers[index];
      const receiverSelectId = receiver.select?.registration.id;

      if (receiver.select?.registration.isSettled()) {
        receivers.splice(index, 1);
        cleanupReceiver(receiver);
        index--;
        continue;
      }

      if (senderSelectId && receiverSelectId === senderSelectId) {
        continue;
      }

      receivers.splice(index, 1);
      cleanupReceiver(receiver);

      if (receiver.select) {
        if (!settleSelectedReceive(receiver, { ok: true, value })) {
          index--;
          continue;
        }
      } else {
        receiver.resolve({ ok: true, value });
      }

      return true;
    }

    return false;
  };

  /**
   * Tries to pull one waiting sender out of the queue and complete it.
   *
   * When called from a select-managed receiver we must avoid matching the
   * receiver with a sender owned by the same outer select registration.
   */
  const tryAcquireFromWaitingSender = (
    receiverSelectId?: symbol
  ): ReceiveResult<T> | undefined => {
    for (let index = 0; index < senders.length; index++) {
      const sender = senders[index];
      const senderSelectId = sender.select?.registration.id;

      if (sender.select?.registration.isSettled()) {
        senders.splice(index, 1);
        cleanupSender(sender);
        index--;
        continue;
      }

      if (receiverSelectId && senderSelectId === receiverSelectId) {
        continue;
      }

      senders.splice(index, 1);
      cleanupSender(sender);

      if (sender.select) {
        if (!settleSelectedSend(sender)) {
          index--;
          continue;
        }
      } else {
        sender.resolve();
      }

      return { ok: true, value: sender.value };
    }

    if (isClosed) {
      return { ok: false, value: undefined };
    }

    return undefined;
  };

  /**
   * Moves the next waiting sender into the channel buffer when space is available.
   */
  const tryBufferWaitingSender = (): boolean => {
    for (let index = 0; index < senders.length; index++) {
      const sender = senders[index];

      if (sender.select?.registration.isSettled()) {
        senders.splice(index, 1);
        cleanupSender(sender);
        index--;
        continue;
      }

      senders.splice(index, 1);
      cleanupSender(sender);

      if (sender.select) {
        if (!settleSelectedSend(sender)) {
          index--;
          continue;
        }
      } else {
        sender.resolve();
      }

      buffer.push(sender.value);
      return true;
    }

    return false;
  };

  /**
   * Pairs queued senders with queued receivers while preserving select atomicity.
   */
  const tryPairWaitingSenderToReceiver = (): boolean => {
    for (let index = 0; index < senders.length; index++) {
      const sender = senders[index];
      const senderSelectId = sender.select?.registration.id;

      if (sender.select?.registration.isSettled()) {
        senders.splice(index, 1);
        cleanupSender(sender);
        index--;
        continue;
      }

      if (!tryDispatchToWaitingReceiver(sender.value, senderSelectId)) {
        continue;
      }

      senders.splice(index, 1);
      cleanupSender(sender);

      if (sender.select) {
        if (!settleSelectedSend(sender)) {
          index--;
          continue;
        }
      } else {
        sender.resolve();
      }

      return true;
    }

    return false;
  };

  /**
   * Advances queued senders after a receive frees space or a receiver becomes available.
   */
  const flushSenders = () => {
    while (senders.length > 0) {
      if (receivers.length > 0) {
        if (!tryPairWaitingSenderToReceiver()) {
          break;
        }
        continue;
      }

      if (capacity > 0 && buffer.length < capacity) {
        if (!tryBufferWaitingSender()) {
          break;
        }
        continue;
      }

      break;
    }
  };

  const send = (value: T, signal?: AbortSignal): Promise<void> => {
    if (isClosed) return Promise.reject(new ChannelClosedError());
    if (signal?.aborted) return Promise.reject(createAbortError(signal));

    if (tryDispatchToWaitingReceiver(value)) {
      return Promise.resolve();
    }

    if (capacity > 0 && buffer.length < capacity) {
      buffer.push(value);
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const sender: WaitingSender<T> = { value, resolve, reject, signal };
      if (signal) {
        sender.abort = () => {
          removeSender(sender);
          reject(createAbortError(signal));
        };
        signal.addEventListener("abort", sender.abort, { once: true });
      }
      senders.push(sender);
    });
  };

  const instance: SelectableChannel<T> = {
    get capacity() {
      return capacity;
    },
    get size() {
      return buffer.length;
    },
    get closed() {
      return isClosed;
    },
    send,
    async receive(signal?: AbortSignal) {
      if (buffer.length > 0) {
        const value = buffer.shift()!;
        flushSenders();
        return value;
      }

      const matchedSender = tryAcquireFromWaitingSender();
      if (matchedSender) {
        return matchedSender.ok ? matchedSender.value : undefined;
      }

      if (isClosed) {
        return undefined;
      }

      if (signal?.aborted) return Promise.reject(createAbortError(signal));

      const result = await new Promise<ReceiveResult<T>>((resolve, reject) => {
        const receiver: WaitingReceiver<T> = { resolve, reject, signal };
        if (signal) {
          receiver.abort = () => {
            removeReceiver(receiver);
            reject(createAbortError(signal));
          };
          signal.addEventListener("abort", receiver.abort, { once: true });
        }
        receivers.push(receiver);
      });
      return result.ok ? result.value : undefined;
    },
    trySend(value: T) {
      if (isClosed) return false;
      if (tryDispatchToWaitingReceiver(value)) {
        return true;
      }
      if (capacity > 0 && buffer.length < capacity) {
        buffer.push(value);
        return true;
      }
      return false;
    },
    tryReceive() {
      if (buffer.length > 0) {
        const value = buffer.shift()!;
        flushSenders();
        return { ok: true, value };
      }
      const matchedSender = tryAcquireFromWaitingSender();
      if (matchedSender) {
        return matchedSender;
      }
      if (isClosed) return { ok: false, value: undefined };
      return undefined;
    },
    close() {
      if (isClosed) return;
      isClosed = true;

      while (receivers.length > 0) {
        const receiver = receivers.shift()!;
        cleanupReceiver(receiver);
        if (receiver.select) {
          settleSelectedReceive(receiver, { ok: false, value: undefined });
        } else {
          receiver.resolve({ ok: false, value: undefined });
        }
      }

      while (senders.length > 0) {
        const sender = senders.shift()!;
        cleanupSender(sender);
        const error = new ChannelClosedError();
        if (sender.select) {
          rejectSelectedWaiter(sender, error);
        } else {
          sender.reject(error);
        }
      }
    },
    [CHANNEL_INTERNALS]: {
      registerSelectReceive(
        registration: SelectRegistration<T>,
        meta: SelectCaseMeta
      ) {
        const receiver: WaitingReceiver<T> = {
          resolve: () => {},
          reject: () => {},
          select: { registration, meta },
        };
        receivers.push(receiver);
        return () => removeReceiver(receiver);
      },
      registerSelectSend(
        value: T,
        registration: SelectRegistration<T>,
        meta: SelectCaseMeta
      ) {
        if (isClosed) {
          registration.reject(new ChannelClosedError());
          return () => {};
        }

        const sender: WaitingSender<T> = {
          value,
          resolve: () => {},
          reject: () => {},
          select: { registration, meta },
        };
        senders.push(sender);
        return () => removeSender(sender);
      },
    } satisfies ChannelSelectInternals<T>,
    async *[Symbol.asyncIterator]() {
      while (true) {
        const item = await this.receive();
        if (item === undefined) return;
        yield item;
      }
    },
  };

  return instance;
}
