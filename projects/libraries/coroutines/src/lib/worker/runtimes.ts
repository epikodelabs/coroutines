/**
 * Serializes a thrown worker error for the worker protocol.
 *
 * The hint text (parameterized with `__MISSING__` for the missing function
 * name) is baked in per runtime: `coroutine(...)` for coroutine workers and
 * `actor(...)` for actor workers.
 */
const workerErrorSerializerSnippet = (helperHint: string): string => `
const __serializeWorkerError = (error) => {
  if (error instanceof ReferenceError) {
    const missing = /^([A-Za-z_$][\\w$]*) is not defined/.exec(error.message);
    if (missing) {
      return (
        error.message +
        " — referenced functions are not captured automatically; pass them as helper arguments so they are serialized into the worker (e.g. ${helperHint.replace(
          "__MISSING__",
          '" + missing[1] + "',
        )})"
      );
    }
  }
  if (error instanceof Error) return error.message || error.name || "Error";
  if (error === undefined) return "Worker task threw undefined";
  if (error === null) return "Worker task threw null";
  return String(error);
};`;

/**
 * Standard coroutine worker runtime.
 *
 * Used by `coroutine()` and `compose()`.
 */
export const buildCoroutineWorkerRuntime = (): string => `
${workerErrorSerializerSnippet("coroutine(task, __MISSING__)")}

onmessage = async (event) => {
  const { workerId, taskId, payload, type } = event.data;

  if (type !== 'task') {
    return;
  }

  try {
    const result = await __mainTask(payload, __workerUtils);
    if (
      result &&
      result.__transferResult === true &&
      Array.isArray(result.transfer)
    ) {
      postMessage(
        { workerId, taskId, payload: result.value, type: 'response' },
        result.transfer,
      );
    } else {
      postMessage({ workerId, taskId, payload: result, type: 'response' });
    }
  } catch (error) {
    const message = __serializeWorkerError(error);
    postMessage({ workerId, taskId, error: message, type: 'error' });
  }
};`;

/**
 * Actor worker runtime.
 *
 * Supports persistent behavior loop via `init`, `notify`, `request`,
 * and `stop` messages. Uses `__concurrency` helpers injected
 * by the build script.
 */
export const buildActorWorkerRuntime = (mailboxCapacity?: number): string => `
${workerErrorSerializerSnippet("actor(name, behavior, initialState, __MISSING__)")}

const __pendingWorkerRequests = new Map();
let __requestCounter = 0;

const __rejectPendingWorkerRequests = (error) => {
  const pending = [...__pendingWorkerRequests.values()];
  __pendingWorkerRequests.clear();
  for (const request of pending) {
    request.reject(error);
  }
};

const __postToMain = (message) => {
  postMessage(message);
};

const __createRequestId = (taskId) => {
  __requestCounter += 1;
  return taskId + ':request:' + __requestCounter;
};

const __requestMain = (workerId, taskId, to, topic, payload) => {
  if (__actorStopping || !__actorRunning) {
    return Promise.reject(new Error("Actor stopped"));
  }

  return new Promise((resolve, reject) => {
    const requestId = __createRequestId(taskId);
    __pendingWorkerRequests.set(requestId, { resolve, reject });
    __postToMain({ workerId, taskId, requestId, to, topic, type: 'request', payload });
  });
};

let __hasReply = false;
let __replyValue = undefined;

const __createWorkerUtils = (workerId, taskId) => {
  const outbox = {
    request: (to, topic, requestPayload) => __requestMain(workerId, taskId, to, topic, requestPayload),
    send: (to, topic, messagePayload) => {
      __postToMain({
        workerId,
        taskId,
        payload: { kind: 'actor-bus', to, topic, payload: messagePayload },
        type: 'notify',
      });
    },
  };
  return {
    outbox,
    inbox: {
      listen: async (signal) => {
        const result = await __actorInbox.receive(signal);
        return result.ok ? result.value : undefined;
      },
    },
    // Overrides the response payload for the current request. Without it the
    // response is the new state returned by the behavior.
    reply: (value) => {
      __hasReply = true;
      __replyValue = value;
    },
    concurrency: __concurrency,
  };
};

const __actorMailboxCapacity = ${mailboxCapacity === undefined ? "undefined" : mailboxCapacity};
const __actorMailbox = __actorMailboxCapacity === undefined
  ? __concurrency.channel()
  : __concurrency.channel(__actorMailboxCapacity);

// Bus notifications live in their own stream so the behavior loop can always
// answer request envelopes from the mailbox, while a suspended behavior's
// listen() consumes notifications directly. A message is delivered exactly
// once: either to a waiting listen() or as the next behavior invocation.
const __actorInbox = __actorMailboxCapacity === undefined
  ? __concurrency.channel()
  : __concurrency.channel(__actorMailboxCapacity);

const __enqueueActorInboxMessage = (value) => {
  if (__actorStopping) {
    // Once stopping begins, the inbox is an admission boundary: drain runs
    // refuse new traffic and one-way sends drop.
    return false;
  }

  if (__actorMailboxCapacity === undefined) {
    __actorInbox.send(value).catch((error) => {
      console.warn("Actor worker failed to enqueue inbox message", error);
    });
    return true;
  }

  if (__actorInbox.trySend(value)) {
    return true;
  }

  __postToMain({
    workerId: __workerId,
    taskId: __actorId,
    type: "overflow",
  });
  return false;
};

const __enqueueActorRequest = (value, requestId) => {
  if (__actorStopping) {
    // Once stopping begins, the mailbox is an admission boundary: drain runs
    // refuse new traffic and requests get a typed rejection.
    __postToMain({
      workerId: __workerId,
      taskId: __actorId,
      requestId,
      type: "error",
      error: "Actor stopped",
      errorName: "ActorStoppedError",
    });
    return;
  }

  if (__actorMailboxCapacity === undefined) {
    __actorMailbox.send(value).catch((error) => {
      console.warn("Actor worker failed to enqueue message", error);
    });
    return;
  }

  if (__actorMailbox.trySend(value)) {
    return;
  }

  __postToMain({
    workerId: __workerId,
    taskId: __actorId,
    requestId,
    type: "error",
    error: "Actor mailbox capacity exceeded",
    errorName: "ActorMailboxOverflowError",
  });
};

let __actorState = undefined;
let __actorRunning = false;
let __actorStopping = false;
let __actorId = null;
let __workerId = null;

const __runBehaviorLoop = async (workerId, taskId) => {
  const utils = __createWorkerUtils(workerId, taskId);

  while (__actorRunning) {
    // Mailbox priority: request envelopes are answered before the next bus
    // notification is considered, so requests can never be starved by bus
    // traffic or stolen by a suspended behavior's listen().
    let received = __actorMailbox.tryReceive();
    if (received === undefined || !received.ok) {
      received = __actorInbox.tryReceive();
    }

    if (received === undefined || !received.ok) {
      if (__actorMailbox.closed && __actorInbox.closed) break;

      // Select only on open channels: a receive case on a closed channel
      // settles the whole selection immediately, which would spin the loop.
      const cases = [];
      if (!__actorMailbox.closed) cases.push(__concurrency.receive(__actorMailbox, "mailbox"));
      if (!__actorInbox.closed) cases.push(__concurrency.receive(__actorInbox, "inbox"));
      const selected = await __concurrency.select(cases);
      if (!selected.ok) continue;
      received = { ok: true, value: selected.value };
    }

    const envelope = received.value;

    let msg = envelope;
    let replyId = null;

    if (envelope && typeof envelope === "object" && "requestId" in envelope) {
      replyId = envelope.requestId;
      msg = envelope.msg;
    }

    __hasReply = false;
    __replyValue = undefined;

    try {
      const result = await __mainTask(msg, __actorState, utils);
      __actorState = result;

      if (replyId) {
        __postToMain({
          workerId,
          taskId,
          type: "response",
          requestId: replyId,
          payload: __hasReply ? __replyValue : result,
        });
      }
    } catch (error) {
      if (__actorStopping) {
        break;
      }

      const message = __serializeWorkerError(error);
      if (replyId) {
        __postToMain({ workerId, taskId, type: "error", requestId: replyId, error: message });
      }

      // An unhandled behavior exception terminates this actor generation.
      // Supervision can then make the restart decision at the ownership boundary.
      __actorRunning = false;
      __rejectPendingWorkerRequests(new Error(message));
      __postToMain({ workerId, taskId, type: "error", error: message });
      break;
    }
  }

  __actorMailbox.close();
  __actorInbox.close();
  __postToMain({ workerId, taskId, type: "stopped" });
};

onmessage = async (event) => {
  const { workerId, taskId, payload, type, requestId, error, topic, drain } = event.data;

  if (
    type !== "init" &&
    (__workerId !== workerId || __actorId !== taskId)
  ) {
    return;
  }

  if (type === "notify") {
    if (__actorRunning) {
      __enqueueActorInboxMessage(payload);
    } else {
      console.warn("Actor worker received main message before init", event.data);
    }
    return;
  }

  if (type === "response" || (type === "error" && !!requestId)) {
    if (!requestId) {
      console.warn("Actor worker received request response without requestId", event.data);
      return;
    }

    const pendingRequest = __pendingWorkerRequests.get(requestId);
    if (pendingRequest) {
      __pendingWorkerRequests.delete(requestId);
      if (type === "response") {
        pendingRequest.resolve(payload);
      } else {
        pendingRequest.reject(new Error(error || payload?.error || payload?.message || "Actor request failed"));
      }
    }
    return;
  }

  if (type === "init") {
    if (__actorId !== null || __workerId !== null) {
      return;
    }

    __workerId = workerId;
    __actorId = taskId;
    __actorState = payload;
    __actorStopping = false;
    __actorRunning = true;
    __runBehaviorLoop(workerId, taskId);
    return;
  }

  if (type === "stop") {
    __actorStopping = true;
    if (drain) {
      // Admission is refused once __actorStopping is set, and closing the
      // streams still yields buffered values to the loop before resolving
      // with { ok: false } — so the loop drains what was admitted and then
      // wakes up to exit.
      __actorMailbox.close();
      __actorInbox.close();
    } else {
      __actorRunning = false;
      __rejectPendingWorkerRequests(new Error("Actor stopped"));
      __actorMailbox.close();
      __actorInbox.close();
    }
    return;
  }

  if (type === "request" && !!requestId) {
    __enqueueActorRequest({ msg: payload, requestId, topic }, requestId);
    return;
  }
};`;
