/**
 * Worker-side concurrency runtime injected into actor worker scripts.
 *
 * This remains self-contained by design: each actor definition produces one
 * module-worker blob shared by its worker generation, while the runtime source
 * itself is authored and reviewed separately from actor lifecycle code.
 */
export const ACTOR_CONCURRENCY_RUNTIME = `
class __channelClosedError extends Error {
  constructor(message = "channel is closed") {
    super(message);
    this.name = "ChannelClosedError";
  }
}

class __contextCancelledError extends Error {
  constructor(message = "context cancelled") {
    super(message);
    this.name = "ContextCancelledError";
  }
}

const __createAbortError = (signal) => {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  return new __contextCancelledError(reason ? String(reason) : undefined);
};

const __channelInternals = Symbol("swinky.channelInternals");

const __channel = (capacity = 0) => {
  if (!Number.isInteger(capacity) || capacity < 0) {
    throw new RangeError("channel capacity must be a non-negative integer");
  }

  const buffer = [];
  const receivers = [];
  const senders = [];
  let isClosed = false;

  const cleanupReceiver = (receiver) => {
    if (receiver.signal && receiver.abort) {
      receiver.signal.removeEventListener("abort", receiver.abort);
    }
  };

  const cleanupSender = (sender) => {
    if (sender.signal && sender.abort) {
      sender.signal.removeEventListener("abort", sender.abort);
    }
  };

  const removeReceiver = (receiver) => {
    const index = receivers.indexOf(receiver);
    if (index >= 0) receivers.splice(index, 1);
    cleanupReceiver(receiver);
  };

  const removeSender = (sender) => {
    const index = senders.indexOf(sender);
    if (index >= 0) senders.splice(index, 1);
    cleanupSender(sender);
  };

  const settleSelectedReceive = (receiver, value, ok) =>
    receiver.select.registration.settle({
      index: receiver.select.meta.index,
      caseRef: receiver.select.meta.caseRef,
      op: "receive",
      name: receiver.select.meta.name,
      value,
      ok,
    });

  const settleSelectedSend = (sender) =>
    sender.select.registration.settle({
      index: sender.select.meta.index,
      caseRef: sender.select.meta.caseRef,
      op: "send",
      name: sender.select.meta.name,
      ok: true,
    });

  const rejectSelectedWaiter = (waiter, error) =>
    waiter.select.registration.reject(error);

  const tryDispatchToWaitingReceiver = (value, senderSelectId) => {
    for (let index = 0; index < receivers.length; index++) {
      const receiver = receivers[index];
      const receiverSelectId = receiver.select?.registration.id;

      if (receiver.select?.registration.isSettled()) {
        receivers.splice(index, 1);
        cleanupReceiver(receiver);
        index -= 1;
        continue;
      }

      if (senderSelectId && receiverSelectId === senderSelectId) {
        continue;
      }

      receivers.splice(index, 1);
      cleanupReceiver(receiver);

      if (receiver.select) {
        if (!settleSelectedReceive(receiver, value, true)) {
          index -= 1;
          continue;
        }
      } else {
        receiver.resolve({ ok: true, value });
      }

      return true;
    }

    return false;
  };

  const tryAcquireFromWaitingSender = (receiverSelectId) => {
    for (let index = 0; index < senders.length; index++) {
      const sender = senders[index];
      const senderSelectId = sender.select?.registration.id;

      if (sender.select?.registration.isSettled()) {
        senders.splice(index, 1);
        cleanupSender(sender);
        index -= 1;
        continue;
      }

      if (receiverSelectId && senderSelectId === receiverSelectId) {
        continue;
      }

      senders.splice(index, 1);
      cleanupSender(sender);

      if (sender.select) {
        if (!settleSelectedSend(sender)) {
          index -= 1;
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

  const tryBufferWaitingSender = () => {
    for (let index = 0; index < senders.length; index++) {
      const sender = senders[index];

      if (sender.select?.registration.isSettled()) {
        senders.splice(index, 1);
        cleanupSender(sender);
        index -= 1;
        continue;
      }

      senders.splice(index, 1);
      cleanupSender(sender);

      if (sender.select) {
        if (!settleSelectedSend(sender)) {
          index -= 1;
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

  const tryPairWaitingSenderToReceiver = () => {
    for (let index = 0; index < senders.length; index++) {
      const sender = senders[index];
      const senderSelectId = sender.select?.registration.id;

      if (sender.select?.registration.isSettled()) {
        senders.splice(index, 1);
        cleanupSender(sender);
        index -= 1;
        continue;
      }

      if (!tryDispatchToWaitingReceiver(sender.value, senderSelectId)) {
        continue;
      }

      senders.splice(index, 1);
      cleanupSender(sender);

      if (sender.select) {
        if (!settleSelectedSend(sender)) {
          index -= 1;
          continue;
        }
      } else {
        sender.resolve();
      }

      return true;
    }

    return false;
  };

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

  const sendValue = (value, signal) => {
    if (isClosed) return Promise.reject(new __channelClosedError());
    if (signal?.aborted) return Promise.reject(__createAbortError(signal));

    if (tryDispatchToWaitingReceiver(value)) {
      return Promise.resolve();
    }

    if (capacity > 0 && buffer.length < capacity) {
      buffer.push(value);
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const sender = { value, resolve, reject, signal };
      if (signal) {
        sender.abort = () => {
          removeSender(sender);
          reject(__createAbortError(signal));
        };
        signal.addEventListener("abort", sender.abort, { once: true });
      }
      senders.push(sender);
    });
  };

  const receiveValue = (signal) => {
    if (buffer.length > 0) {
      const value = buffer.shift();
      flushSenders();
      return Promise.resolve({ ok: true, value });
    }

    const matchedSender = tryAcquireFromWaitingSender();
    if (matchedSender) {
      return Promise.resolve(matchedSender);
    }

    if (isClosed) {
      return Promise.resolve({ ok: false, value: undefined });
    }

    if (signal?.aborted) return Promise.reject(__createAbortError(signal));

    return new Promise((resolve, reject) => {
      const receiver = { resolve, reject, signal };
      if (signal) {
        receiver.abort = () => {
          removeReceiver(receiver);
          reject(__createAbortError(signal));
        };
        signal.addEventListener("abort", receiver.abort, { once: true });
      }
      receivers.push(receiver);
    });
  };

  return {
    get capacity() {
      return capacity;
    },
    get size() {
      return buffer.length;
    },
    get closed() {
      return isClosed;
    },
    send: sendValue,
    async receive(signal) {
      return receiveValue(signal);
    },
    trySend(value) {
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
        const value = buffer.shift();
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
        const receiver = receivers.shift();
        cleanupReceiver(receiver);
        if (receiver.select) {
          settleSelectedReceive(receiver, undefined, false);
        } else {
          receiver.resolve({ ok: false, value: undefined });
        }
      }

      while (senders.length > 0) {
        const sender = senders.shift();
        cleanupSender(sender);
        const error = new __channelClosedError();
        if (sender.select) {
          rejectSelectedWaiter(sender, error);
        } else {
          sender.reject(error);
        }
      }
    },
    [__channelInternals]: {
      registerSelectReceive(registration, meta) {
        if (registration.isSettled()) {
          return () => {};
        }

        if (isClosed) {
          registration.settle({
            index: meta.index,
            caseRef: meta.caseRef,
            op: "receive",
            name: meta.name,
            ok: false,
          });
          return () => {};
        }

        const receiver = {
          resolve() {},
          reject() {},
          select: { registration, meta },
        };
        receivers.push(receiver);
        flushSenders();
        return () => removeReceiver(receiver);
      },
      registerSelectSend(value, registration, meta) {
        if (registration.isSettled()) {
          return () => {};
        }

        if (isClosed) {
          registration.reject(new __channelClosedError());
          return () => {};
        }

        const sender = {
          value,
          resolve() {},
          reject() {},
          select: { registration, meta },
        };
        senders.push(sender);
        flushSenders();
        return () => removeSender(sender);
      },
    },
    async *[Symbol.asyncIterator]() {
      while (true) {
        const item = await receiveValue();
        if (!item.ok) return;
        yield item.value;
      }
    },
  };
};

const __createContext = (controller) => {
  const signal = controller.signal;
  const done = new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
    } else {
      signal.addEventListener("abort", () => resolve(), { once: true });
    }
  });

  return {
    signal,
    done,
    get reason() {
      return signal.reason;
    },
  };
};

const __backgroundContext =
  __createContext(new AbortController());
const __background = () => __backgroundContext;

const __withCancel = (parent = __background()) => {
  const controller = new AbortController();
  const onParentAbort = () =>
    controller.abort(parent.reason ?? new __contextCancelledError());

  if (parent.signal.aborted) {
    onParentAbort();
  } else {
    parent.signal.addEventListener("abort", onParentAbort, { once: true });
  }

  const ctx = __createContext(controller);
  const cancel = (reason = new __contextCancelledError()) => {
    parent.signal.removeEventListener("abort", onParentAbort);
    if (!controller.signal.aborted) controller.abort(reason);
  };

  return [ctx, cancel];
};

const __withTimeout = (parent, ms) => {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new RangeError("timer duration must be a finite non-negative number");
  }

  const [ctx, cancel] = __withCancel(parent);
  const timer = setTimeout(() => cancel(new __contextCancelledError("context timeout after " + ms + "ms")), ms);
  ctx.done.finally(() => clearTimeout(timer));
  return [ctx, cancel];
};

const __withDeadline = (parent, deadline) => {
  const time = typeof deadline === "number" ? deadline : deadline.getTime();
  const remaining = time - Date.now();

  if (remaining <= 0) {
    const [ctx, cancel] = __withCancel(parent);
    cancel(new __contextCancelledError("context deadline exceeded"));
    return [ctx, cancel];
  }

  return __withTimeout(parent, remaining);
};

const __sleep = (ms, signal) => {
  if (!Number.isFinite(ms) || ms < 0) {
    return Promise.reject(new RangeError("timer duration must be a finite non-negative number"));
  }
  if (signal?.aborted) {
    return Promise.reject(__createAbortError(signal));
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const abort = () => {
      clearTimeout(timer);
      cleanup();
      reject(__createAbortError(signal));
    };

    const cleanup = () => signal?.removeEventListener("abort", abort);
    signal?.addEventListener("abort", abort, { once: true });
  });
};

const __recv = (ch, name) => ({ op: "receive", channel: ch, name });
const __send = (ch, value, name) => ({ op: "send", channel: ch, value, name });
const __otherwise = (name = "default") => ({ op: "default", name });
const __operation = (run, name) => ({ op: "operation", run, name });

const __shuffledIndices = (length) => {
  const indices = Array.from({ length }, (_, i) => i);
  for (let i = length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices;
};

const __select = async (cases, ctx = __background()) => {
  if (ctx.signal.aborted) throw __createAbortError(ctx.signal);
  if (cases.length === 0) {
    throw new RangeError("select requires at least one case");
  }

  const defaultIndices = cases
    .map((item, index) => item.op === "default" ? index : -1)
    .filter((index) => index >= 0);
  if (defaultIndices.length > 1) {
    throw new RangeError("select accepts at most one default case");
  }
  const defaultIndex = defaultIndices[0] ?? -1;
  const channelIndices = cases
    .map((item, i) => ({ item, i }))
    .filter(({ item }) => item.op === "receive" || item.op === "send")
    .map(({ i }) => i);
  const randomChannelOrder = __shuffledIndices(channelIndices.length).map((j) => channelIndices[j]);

  for (const index of randomChannelOrder) {
    const item = cases[index];
    if (item.op === "receive") {
      const result = item.channel.tryReceive();
      if (result) {
        return { index, case: item, op: item.op, name: item.name, value: result.value, ok: result.ok };
      }
    } else if (item.op === "send") {
      if (item.channel.closed) {
        throw new __channelClosedError();
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

  const contenders = cases
    .map((item, i) => ({ item, i }))
    .filter(({ item }) => item.op !== "default");
  const randomOrder = __shuffledIndices(contenders.length).map((j) => contenders[j].i);
  const selectId = Symbol("swinky.select");
  let settled = false;
  let winnerIndex = -1;
  const cleanupFns = [];
  const operationControllers = new Map();

  const abortLosingOperations = (reason) => {
    for (const [index, controller] of operationControllers) {
      if (index !== winnerIndex && !controller.signal.aborted) {
        controller.abort(reason);
      }
    }
  };

  try {
    return await new Promise((resolve, reject) => {
      const settle = (result) => {
        if (settled) return false;
        settled = true;
        winnerIndex = result.index;
        abortLosingOperations(new __contextCancelledError("select case lost"));
        resolve(result);
        return true;
      };

      const rejectSelection = (error, index = -1) => {
        if (settled) return false;
        settled = true;
        winnerIndex = index;
        abortLosingOperations(error);
        reject(error);
        return true;
      };

      const registration = {
        id: selectId,
        isSettled: () => settled,
        settle: (outcome) => settle({
          index: outcome.index,
          case: outcome.caseRef,
          op: outcome.op,
          name: outcome.name,
          value: outcome.value,
          ok: outcome.ok,
        }),
        reject: (error) => rejectSelection(error),
      };

      const onContextAbort = () => {
        rejectSelection(__createAbortError(ctx.signal));
      };

      ctx.signal.addEventListener("abort", onContextAbort, { once: true });
      cleanupFns.push(() => ctx.signal.removeEventListener("abort", onContextAbort));

      const operationStarts = [];

      for (const index of randomOrder) {
        if (settled) break;

        const item = cases[index];
        if (item.op === "operation") {
          const controller = new AbortController();
          operationControllers.set(index, controller);
          operationStarts.push({ index, item, controller });
          continue;
        }

        const internals = item.channel[__channelInternals];
        if (!internals) {
          rejectSelection(new __contextCancelledError("channel does not support select"));
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

      const startedOperations = operationStarts.map(({ index, item, controller }) => {
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
      });

      for (const { index, item, promise } of startedOperations) {
        promise.then(
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
              error instanceof Error ? error : new Error(error ? String(error) : "select operation failed"),
              index
            );
          }
        );
      }
    });
  } finally {
    while (cleanupFns.length > 0) {
      cleanupFns.pop()();
    }
    abortLosingOperations(new __contextCancelledError("select completed"));
  }
};

const __concurrency = Object.freeze({
  channel: __channel,
  receive: __recv,
  send: __send,
  otherwise: __otherwise,
  operation: __operation,
  select: __select,
  background: __background,
  withCancel: __withCancel,
  withTimeout: __withTimeout,
  withDeadline: __withDeadline,
  sleep: __sleep,
  ChannelClosedError: __channelClosedError,
  ContextCancelledError: __contextCancelledError,
});

`;