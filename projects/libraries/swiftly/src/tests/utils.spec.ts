import {
  background,
  channel,
  CHANNEL_INTERNALS,
  ChannelClosedError,
  ContextCancelledError,
  createAbortError,
  event,
  otherwise,
  operation,
  receive,
  select,
  semaphore,
  send,
  withCancel,
  waitGroup,
  withDeadline,
  withTimeout,
} from "../public-api";

describe("channel", () => {
  it("should create an unbuffered channel by default", () => {
    const ch = channel<number>();
    expect(ch.capacity).toBe(0);
    expect(ch.size).toBe(0);
    expect(ch.closed).toBeFalse();
  });

  it("should create a buffered channel", () => {
    const ch = channel<string>(3);
    expect(ch.capacity).toBe(3);
    expect(ch.size).toBe(0);
  });

  it("should throw for negative capacity", () => {
    expect(() => channel(-1)).toThrowError(/non-negative integer/);
  });

  it("should throw for non-integer capacity", () => {
    expect(() => channel(1.5)).toThrowError(/non-negative integer/);
  });

  it("should hand off values on an unbuffered channel", async () => {
    const ch = channel<number>();

    const receive$ = ch.receive();
    await ch.send(42);
    const value = await receive$;

    expect(value).toEqual({ ok: true, value: 42 });
  });

  it("should buffer sends while space remains", async () => {
    const ch = channel<number>(2);

    await ch.send(1); // buffered
    await ch.send(2); // buffered

    expect(ch.size).toBe(2);
    expect(await ch.receive()).toEqual({ ok: true, value: 1 });
    expect(await ch.receive()).toEqual({ ok: true, value: 2 });
  });

  it("should block send when buffer is full", async () => {
    const ch = channel<number>(1);
    await ch.send(1);

    let sent = false;
    const pending = ch.send(2).then(() => {
      sent = true;
    });

    await new Promise(r => setTimeout(r, 5));
    expect(sent).toBeFalse();

    await ch.receive();
    await pending;
    expect(sent).toBeTrue();
  });

  it("trySend should succeed when space is available", async () => {
    const ch = channel<number>(1);
    expect(ch.trySend(7)).toBeTrue();
    expect(ch.size).toBe(1);
  });

  it("trySend should fail on unbuffered channel with no receiver", () => {
    const ch = channel<number>();
    expect(ch.trySend(7)).toBeFalse();
  });

  it("trySend should fail when buffer is full", async () => {
    const ch = channel<number>(1);
    await ch.send(1);
    expect(ch.trySend(2)).toBeFalse();
  });

  it("tryReceive should return buffered values", async () => {
    const ch = channel<number>(1);
    await ch.send(99);

    const result = ch.tryReceive();
    expect(result).toEqual(jasmine.objectContaining({ ok: true, value: 99 }));
  });

  it("tryReceive should return undefined when empty", () => {
    const ch = channel<number>();
    expect(ch.tryReceive()).toBeUndefined();
  });

  it("tryReceive should return ok:false when closed and empty", () => {
    const ch = channel<number>();
    ch.close();
    expect(ch.tryReceive()).toEqual(jasmine.objectContaining({ ok: false }));
  });

  it("should close and reject pending senders", async () => {
    const ch = channel<number>();

    const pendingSend = ch.send(1);
    ch.close();

    await expectAsync(pendingSend).toBeRejectedWithError(ChannelClosedError);
  });

  it("should close and resolve pending receivers with ok:false", async () => {
    const ch = channel<number>();

    const pendingReceive = ch.receive();
    ch.close();

    expect(await pendingReceive).toEqual({ ok: false, value: undefined });
  });

  it("should reject send on a closed channel", async () => {
    const ch = channel<number>();
    ch.close();

    await expectAsync(ch.send(1)).toBeRejectedWithError(ChannelClosedError);
  });

  it("should return ok:false when receiving from closed empty channel", async () => {
    const ch = channel<number>();
    ch.close();

    expect(await ch.receive()).toEqual({ ok: false, value: undefined });
  });

  it("should carry undefined as a normal channel value", async () => {
    const ch = channel<undefined>(1);
    await ch.send(undefined);
    ch.close();

    expect(await ch.receive()).toEqual({ ok: true, value: undefined });
    expect(await ch.receive()).toEqual({ ok: false, value: undefined });
  });

  it("async iteration should not treat undefined as channel closure", async () => {
    const ch = channel<number | undefined>(2);
    await ch.send(undefined);
    await ch.send(1);
    ch.close();

    const values: Array<number | undefined> = [];
    for await (const value of ch) values.push(value);

    expect(values).toEqual([undefined, 1]);
  });

  it("should be async iterable", async () => {
    const ch = channel<number>(2);
    await ch.send(1);
    await ch.send(2);
    ch.close();

    const values: number[] = [];
    for await (const v of ch) {
      values.push(v);
    }

    expect(values).toEqual([1, 2]);
  });

  it("should reject send when signal is already aborted", async () => {
    const ch = channel<number>();
    const controller = new AbortController();
    controller.abort(new ContextCancelledError("stopped"));

    await expectAsync(ch.send(1, controller.signal)).toBeRejectedWithError(/stopped/);
  });

  it("should reject receive when signal is already aborted", async () => {
    const ch = channel<number>();
    const controller = new AbortController();
    controller.abort(new ContextCancelledError("stopped"));

    await expectAsync(ch.receive(controller.signal)).toBeRejectedWithError(/stopped/);
  });

  it("should abort a blocked send via signal", async () => {
    const ch = channel<number>();
    const controller = new AbortController();

    const pending = ch.send(1, controller.signal);
    controller.abort(new ContextCancelledError("stopped"));

    await expectAsync(pending).toBeRejectedWithError(/stopped/);
  });

  it("should abort a blocked receive via signal", async () => {
    const ch = channel<number>();
    const controller = new AbortController();

    const pending = ch.receive(controller.signal);
    controller.abort(new ContextCancelledError("stopped"));

    await expectAsync(pending).toBeRejectedWithError(/stopped/);
  });
});

describe("context", () => {
  it("background creates a non-aborted context", () => {
    const ctx = background();
    expect(ctx.signal.aborted).toBeFalse();
    expect(ctx.reason).toBeUndefined();
  });

  it("withCancel cancel aborts the child signal", () => {
    const [ctx, cancel] = withCancel();
    expect(ctx.signal.aborted).toBeFalse();

    cancel();
    expect(ctx.signal.aborted).toBeTrue();
    expect(ctx.reason).toBeInstanceOf(ContextCancelledError);
  });

  it("withCancel cancel accepts a custom reason", () => {
    const [ctx, cancel] = withCancel();
    const err = new Error("custom");
    cancel(err);
    expect(ctx.reason).toBe(err);
  });

  it("withCancel child is aborted when parent aborts", async () => {
    const [parent, cancelParent] = withCancel(background());
    const [child] = withCancel(parent);

    expect(child.signal.aborted).toBeFalse();
    cancelParent();
    expect(child.signal.aborted).toBeTrue();
  });


  it("withTimeout rejects invalid durations before deriving a live child context", () => {
    expect(() => withTimeout(background(), -1)).toThrowError(
      RangeError,
      "timer duration must be a finite non-negative number",
    );
    expect(() => withTimeout(background(), Number.POSITIVE_INFINITY)).toThrowError(
      RangeError,
      "timer duration must be a finite non-negative number",
    );
  });

  it("withTimeout aborts after the specified delay", async () => {
    const [ctx, cancel] = withTimeout(background(), 20);
    expect(ctx.signal.aborted).toBeFalse();

    await new Promise(r => setTimeout(r, 50));
    expect(ctx.signal.aborted).toBeTrue();
    expect(String(ctx.reason)).toContain("timeout");

    cancel(); // idempotent cleanup
  });

  it("withTimeout manual cancel clears the timer", () => {
    const [ctx, cancel] = withTimeout(background(), 10000);
    cancel();
    expect(ctx.signal.aborted).toBeTrue();
  });

  it("withDeadline aborts at the deadline", async () => {
    const [ctx] = withDeadline(background(), Date.now() + 20);
    expect(ctx.signal.aborted).toBeFalse();

    await new Promise(r => setTimeout(r, 50));
    expect(ctx.signal.aborted).toBeTrue();
  });

  it("withDeadline accepts a Date object", async () => {
    const [ctx] = withDeadline(background(), new Date(Date.now() + 20));
    await new Promise(r => setTimeout(r, 50));
    expect(ctx.signal.aborted).toBeTrue();
  });

  it("withDeadline with past deadline aborts soon after", async () => {
    const [ctx] = withDeadline(background(), Date.now() - 10);
    // setTimeout(0) schedules on next tick; wait a bit
    await new Promise(r => setTimeout(r, 10));
    expect(ctx.signal.aborted).toBeTrue();
  });

  it("done resolves when cancelled", async () => {
    const [ctx, cancel] = withCancel();
    let resolved = false;
    ctx.done.then(() => { resolved = true; });

    cancel();
    await ctx.done;
    expect(resolved).toBeTrue();
  });

  it("value and withValue form a chain", () => {
    const root = background();
    const child = root.withValue("key", 42);
    const grandchild = child.withValue("other", "x");

    expect(child.value("key")).toBe(42);
    expect(grandchild.value("key")).toBe(42);
    expect(grandchild.value("other")).toBe("x");
    expect(root.value("key")).toBeUndefined();
  });

  it("createAbortError returns the Error reason unchanged", () => {
    const err = new Error("boom");
    const ctrl = new AbortController();
    ctrl.abort(err);
    expect(createAbortError(ctrl.signal)).toBe(err);
  });

  it("createAbortError wraps string reason in ContextCancelledError", () => {
    const ctrl = new AbortController();
    ctrl.abort("stopped");
    const result = createAbortError(ctrl.signal);
    expect(result).toBeInstanceOf(ContextCancelledError);
    expect(result.message).toBe("stopped");
  });

  it("createAbortError with ContextCancelledError reason returns it", () => {
    const err = new ContextCancelledError("my cancel");
    const ctrl = new AbortController();
    ctrl.abort(err);
    expect(createAbortError(ctrl.signal)).toBe(err);
  });
});

describe("selection", () => {
  it("receive builds a receive case", () => {
    const ch = channel<number>();
    const c = receive(ch, "myCase");
    expect(c.op).toBe("receive");
    expect(c.channel).toBe(ch);
    expect(c.name).toBe("myCase");
  });

  it("send builds a send case", () => {
    const ch = channel<number>();
    const c = send(ch, 42, "myCase");
    expect(c.op).toBe("send");
    expect(c.channel).toBe(ch);
    expect(c.value).toBe(42);
    expect(c.name).toBe("myCase");
  });

  it("otherwise builds a default case", () => {
    const c = otherwise("fallback");
    expect(c.op).toBe("default");
    expect(c.name).toBe("fallback");
  });

  it("select chooses a ready receive case", async () => {
    const ch = channel<number>(1);
    await ch.send(7);

    const result = await select([receive(ch, "r")]);
    expect(result.op).toBe("receive");
    expect(result.name).toBe("r");
    expect(result.value).toBe(7);
    expect(result.ok).toBeTrue();
  });

  it("select chooses a ready send case", async () => {
    const ch = channel<number>(1);

    const result = await select([send(ch, 8, "s")]);
    expect(result.op).toBe("send");
    expect(result.name).toBe("s");
    expect(result.ok).toBeTrue();
    expect(await ch.receive()).toEqual({ ok: true, value: 8 });
  });

  it("select falls back to default when nothing is ready", async () => {
    const ch = channel<number>();

    const result = await select([receive(ch, "r"), otherwise("def")]);
    expect(result.op).toBe("default");
    expect(result.name).toBe("def");
    expect(result.ok).toBeTrue();
  });


  it("select rejects multiple default branches", async () => {
    await expectAsync(
      select([otherwise("first"), otherwise("second")]),
    ).toBeRejectedWithError(
      RangeError,
      "select accepts at most one default case",
    );
  });

  it("select blocks until a case is ready", async () => {
    const ch = channel<number>();

    const pending = select([receive(ch, "r")]);
    setTimeout(() => ch.send(99), 10);

    const result = await pending;
    expect(result.value).toBe(99);
  });

  it("select receive on closed channel returns ok:false", async () => {
    const ch = channel<number>();
    ch.close();

    const result = await select([receive(ch, "r")]);
    expect(result.op).toBe("receive");
    expect(result.ok).toBeFalse();
  });

  it("select send on closed channel throws ChannelClosedError", async () => {
    const ch = channel<number>();
    ch.close();

    await expectAsync(select([send(ch, 1, "s")])).toBeRejectedWithError(ChannelClosedError);
  });

  it("select throws when context is already aborted", async () => {
    const ch = channel<number>();
    const err = new ContextCancelledError("pre-aborted");
    const fakeSignal = {
      aborted: true,
      reason: err,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    } as unknown as AbortSignal;

    const fakeCtx = {
      signal: fakeSignal,
      done: Promise.resolve(),
      reason: err,
      value: () => undefined,
      withValue: () => fakeCtx,
    } as any;

    await expectAsync(select([receive(ch, "r")], fakeCtx)).toBeRejectedWithError(/pre-aborted/);
  });

  it("select aborts when context is cancelled while waiting", async () => {
    const ch = channel<number>();
    const [ctx, cancel] = withCancel();

    const pending = select([receive(ch, "r")], ctx);
    cancel();

    await expectAsync(pending).toBeRejectedWithError(ContextCancelledError);
  });

  it("select with multiple ready cases chooses exactly one", async () => {
    const a = channel<number>(1);
    const b = channel<number>(1);
    await a.send(1);
    await b.send(2);

    const result = await select([receive(a, "a"), receive(b, "b")]);
    expect(["a", "b"]).toContain(result.name!);
    expect(result.ok).toBeTrue();

    // Only one value should be consumed
    const remaining = [a.tryReceive(), b.tryReceive()].filter(r => r !== undefined);
    expect(remaining.length).toBe(1);
    expect(remaining[0]).toEqual(jasmine.objectContaining({ ok: true }));
  });

  it("select send case paired with waiting receiver", async () => {
    const ch = channel<number>();

    const pendingReceive = ch.receive();
    const result = await select([send(ch, 123, "s")]);

    expect(result.op).toBe("send");
    expect(await pendingReceive).toEqual({ ok: true, value: 123 });
  });

  it("select receive case paired with waiting sender", async () => {
    const ch = channel<number>();

    const pendingSend = ch.send(456);
    const result = await select([receive(ch, "r")]);

    expect(result.op).toBe("receive");
    expect(result.value).toBe(456);
    await pendingSend;
  });

  it("select cleans up registrations after resolution", async () => {
    const a = channel<number>();
    const b = channel<number>();

    const pending = select([receive(a, "a"), receive(b, "b")]);
    await a.send(1);

    const result = await pending;
    expect(result.name).toBe("a");

    // b should still be able to receive normally later
    setTimeout(() => b.send(2), 5);
    expect(await b.receive()).toEqual({ ok: true, value: 2 });
  });

  it("select resolves a pending receive with ok:false when the channel closes", async () => {
    const ch = channel<number>();

    const pending = select([receive(ch, "r")]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    ch.close();

    const result = await pending;
    expect(result.op).toBe("receive");
    expect(result.name).toBe("r");
    expect(result.ok).toBeFalse();
    expect(result.value).toBeUndefined();
  });

  it("select resolves a pending send when a receiver arrives later", async () => {
    const ch = channel<number>();

    const pending = select([send(ch, 123, "s")]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const receive$ = ch.receive();
    const result = await pending;

    expect(result.op).toBe("send");
    expect(result.name).toBe("s");
    expect(result.ok).toBeTrue();
    expect(await receive$).toEqual({ ok: true, value: 123 });
  });

  it("select rejects a pending send when the channel closes", async () => {
    const ch = channel<number>();

    const pending = select([send(ch, 1, "s")]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    ch.close();

    await expectAsync(pending).toBeRejectedWithError(ChannelClosedError);
  });

  it("select flushes a queued send into the buffer after space is freed", async () => {
    const ch = channel<number>(1);
    await ch.send(1);

    const pending = select([send(ch, 2, "s")]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(await ch.receive()).toEqual({ ok: true, value: 1 });

    const result = await pending;
    expect(result.op).toBe("send");
    expect(result.name).toBe("s");
    expect(result.ok).toBeTrue();
    expect(await ch.receive()).toEqual({ ok: true, value: 2 });
  });

  it("channel internals reject select sends registered after close", () => {
    const ch = channel<number>();
    ch.close();

    const registration = {
      id: Symbol("select"),
      isSettled: () => false,
      settle: () => false,
      reject: jasmine.createSpy("reject").and.returnValue(true),
    };

    const unregister = (ch as any)[CHANNEL_INTERNALS].registerSelectSend(1, registration, {
      index: 0,
      caseRef: send(ch, 1, "s"),
      name: "s",
    });

    expect(registration.reject).toHaveBeenCalledWith(jasmine.any(ChannelClosedError));
    unregister();
  });

  it("channel internals can unregister a pending select send more than once", () => {
    const ch = channel<number>();

    const unregister = (ch as any)[CHANNEL_INTERNALS].registerSelectSend(
      1,
      {
        id: Symbol("select"),
        isSettled: () => false,
        settle: () => false,
        reject: () => false,
      },
      {
        index: 0,
        caseRef: send(ch, 1, "s"),
        name: "s",
      }
    );

    unregister();
    unregister();

    expect(ch.tryReceive()).toBeUndefined();
  });

  it("channel internals discard settled select receivers before dispatch", () => {
    const ch = channel<number>();

    const unregister = (ch as any)[CHANNEL_INTERNALS].registerSelectReceive(
      {
        id: Symbol("receive"),
        isSettled: () => true,
        settle: () => true,
        reject: () => false,
      },
      {
        index: 0,
        caseRef: receive(ch, "r"),
        name: "r",
      }
    );

    expect(ch.trySend(1)).toBeFalse();

    unregister();
  });

  it("channel internals discard settled select senders before receiving", () => {
    const ch = channel<number>();

    const unregister = (ch as any)[CHANNEL_INTERNALS].registerSelectSend(
      1,
      {
        id: Symbol("send"),
        isSettled: () => true,
        settle: () => true,
        reject: () => false,
      },
      {
        index: 0,
        caseRef: send(ch, 1, "s"),
        name: "s",
      }
    );

    expect(ch.tryReceive()).toBeUndefined();

    unregister();
  });


  it("channel internals settle a select receive registered after close", () => {
    const ch = channel<number>();
    ch.close();

    const registration = {
      id: Symbol("closed-receive"),
      isSettled: () => false,
      settle: jasmine.createSpy("settleClosedReceive").and.returnValue(true),
      reject: jasmine.createSpy("rejectClosedReceive").and.returnValue(false),
    };

    const unregister = (ch as any)[CHANNEL_INTERNALS].registerSelectReceive(
      registration,
      {
        index: 0,
        caseRef: receive(ch, "closed"),
        name: "closed",
      },
    );

    expect(registration.settle).toHaveBeenCalledWith(
      jasmine.objectContaining({
        op: "receive",
        ok: false,
        name: "closed",
      }),
    );
    expect(registration.reject).not.toHaveBeenCalled();
    unregister();
  });

  it("channel internals ignore already-settled registrations", () => {
    const ch = channel<number>();
    const settle = jasmine.createSpy("settle");
    const reject = jasmine.createSpy("reject");
    const registration = {
      id: Symbol("settled"),
      isSettled: () => true,
      settle,
      reject,
    };

    const unregisterReceive = (ch as any)[CHANNEL_INTERNALS].registerSelectReceive(
      registration,
      {
        index: 0,
        caseRef: receive(ch, "r"),
        name: "r",
      },
    );
    const unregisterSend = (ch as any)[CHANNEL_INTERNALS].registerSelectSend(
      1,
      registration,
      {
        index: 1,
        caseRef: send(ch, 1, "s"),
        name: "s",
      },
    );

    expect(ch.tryReceive()).toBeUndefined();
    expect(ch.trySend(2)).toBeFalse();
    expect(settle).not.toHaveBeenCalled();
    expect(reject).not.toHaveBeenCalled();

    unregisterReceive();
    unregisterSend();
  });

  it("channel internals reconcile compatible select waiters immediately", () => {
    const ch = channel<number>();
    const receiveRegistration = {
      id: Symbol("receive"),
      isSettled: () => false,
      settle: jasmine.createSpy("receiveSettle").and.returnValue(true),
      reject: jasmine.createSpy("receiveReject").and.returnValue(false),
    };
    const sendRegistration = {
      id: Symbol("send"),
      isSettled: () => false,
      settle: jasmine.createSpy("sendSettle").and.returnValue(true),
      reject: jasmine.createSpy("sendReject").and.returnValue(false),
    };

    const unregisterReceive = (ch as any)[CHANNEL_INTERNALS].registerSelectReceive(
      receiveRegistration,
      {
        index: 0,
        caseRef: receive(ch, "r"),
        name: "r",
      },
    );

    const unregisterSend = (ch as any)[CHANNEL_INTERNALS].registerSelectSend(
      7,
      sendRegistration,
      {
        index: 1,
        caseRef: send(ch, 7, "s"),
        name: "s",
      },
    );

    expect(receiveRegistration.settle).toHaveBeenCalledWith(
      jasmine.objectContaining({
        op: "receive",
        value: 7,
        ok: true,
      }),
    );
    expect(sendRegistration.settle).toHaveBeenCalledWith(
      jasmine.objectContaining({
        op: "send",
        ok: true,
      }),
    );

    unregisterReceive();
    unregisterSend();
  });

  it("same select send and receive cases never self-match on an unbuffered channel", async () => {
    const ch = channel<number>();
    const [ctx, cancel] = withCancel();

    const pending = select([
      receive(ch, "receive"),
      send(ch, 1, "send"),
    ], ctx);

    await Promise.resolve();
    cancel(new ContextCancelledError("stop self-select"));

    await expectAsync(pending).toBeRejectedWithError(
      ContextCancelledError,
      "stop self-select",
    );

    expect(ch.tryReceive()).toBeUndefined();
    expect(ch.trySend(2)).toBeFalse();
  });

  it("close and cancellation cannot settle one select twice", async () => {
    const ch = channel<number>();
    const [ctx, cancel] = withCancel();
    let settlements = 0;

    const pending = select([receive(ch, "r")], ctx);
    pending.then(
      () => settlements += 1,
      () => settlements += 1,
    );

    await Promise.resolve();
    ch.close();
    cancel(new ContextCancelledError("late cancel"));

    await expectAsync(pending).toBeResolvedTo(
      jasmine.objectContaining({
        op: "receive",
        ok: false,
      }),
    );
    await Promise.resolve();

    expect(settlements).toBe(1);
  });

  it("channel internals pair queued select senders with queued select receivers during flush", async () => {
    const ch = channel<number>(1);
    const internals = (ch as any)[CHANNEL_INTERNALS];

    await ch.send(1);

    const receiverRegistration = {
      id: Symbol("receive"),
      isSettled: () => false,
      settle: jasmine.createSpy("settleReceive").and.returnValue(true),
      reject: jasmine.createSpy("rejectReceive").and.returnValue(false),
    };
    const senderRegistration = {
      id: Symbol("send"),
      isSettled: () => false,
      settle: jasmine.createSpy("settleSend").and.returnValue(true),
      reject: jasmine.createSpy("rejectSend").and.returnValue(false),
    };

    const unregisterReceive = internals.registerSelectReceive(receiverRegistration, {
      index: 0,
      caseRef: receive(ch, "r"),
      name: "r",
    });
    const unregisterSend = internals.registerSelectSend(2, senderRegistration, {
      index: 1,
      caseRef: send(ch, 2, "s"),
      name: "s",
    });

    expect(ch.tryReceive()).toEqual(jasmine.objectContaining({ ok: true, value: 1 }));
    expect(receiverRegistration.settle).toHaveBeenCalledWith(
      jasmine.objectContaining({ op: "receive", value: 2, ok: true, name: "r" })
    );
    expect(senderRegistration.settle).toHaveBeenCalledWith(
      jasmine.objectContaining({ op: "send", ok: true, name: "s" })
    );

    unregisterReceive();
    unregisterSend();
  });
});


describe("operation selection", () => {
  it("operation builds a cancellable operation case", () => {
    const run = (signal: AbortSignal) => signal.aborted;
    const c = operation(run, "work");

    expect(c.op).toBe("operation");
    expect(c.run).toBe(run);
    expect(c.name).toBe("work");
  });

  it("select resolves with the first completed operation", async () => {
    const result = await select([
      operation(async () => {
        await new Promise(r => setTimeout(r, 20));
        return "slow";
      }, "slow"),
      operation(async () => {
        await new Promise(r => setTimeout(r, 1));
        return "fast";
      }, "fast"),
    ]);

    expect(result.op).toBe("operation");
    expect(result.name).toBe("fast");
    expect(result.value).toBe("fast");
  });

  it("select aborts losing operations", async () => {
    let loserAborted = false;

    const result = await select([
      operation(async (signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => {
            loserAborted = true;
            resolve();
          }, { once: true });
        });
        return "loser";
      }, "loser"),
      operation(() => "winner", "winner"),
    ]);

    await Promise.resolve();
    expect(result.name).toBe("winner");
    expect(loserAborted).toBeTrue();
  });

  it("select can coordinate an operation with a channel receive", async () => {
    const ch = channel<string>();
    setTimeout(() => ch.send("message"), 1);

    let operationAborted = false;
    const result = await select([
      receive(ch, "message"),
      operation(async (signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => {
            operationAborted = true;
            resolve();
          }, { once: true });
        });
        return "timeout";
      }, "operation"),
    ]);

    await Promise.resolve();
    expect(result.name).toBe("message");
    expect(result.value).toBe("message");
    expect(operationAborted).toBeTrue();
  });

  it("default selection does not start operations", async () => {
    let started = false;

    const result = await select([
      operation(() => {
        started = true;
        return "work";
      }, "work"),
      otherwise("default"),
    ]);

    expect(result.name).toBe("default");
    expect(started).toBeFalse();
  });

  it("context cancellation aborts active operations", async () => {
    const [ctx, cancel] = withCancel();
    let aborted = false;

    const pending = select([
      operation(async (signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            resolve();
          }, { once: true });
        });
        return "never";
      }),
    ], ctx);

    await Promise.resolve();
    cancel(new ContextCancelledError("stop selection"));

    await expectAsync(pending).toBeRejectedWithError(/stop selection/);
    expect(aborted).toBeTrue();
  });

  it("context cancellation before operation start does not launch work", async () => {
    const [ctx, cancel] = withCancel();
    let started = false;

    const pending = select([
      operation(() => {
        started = true;
        return "work";
      }),
    ], ctx);

    cancel(new ContextCancelledError("stop before start"));

    await expectAsync(pending).toBeRejectedWithError(/stop before start/);
    await Promise.resolve();
    expect(started).toBeFalse();
  });

  it("operation failure rejects selection and aborts siblings", async () => {
    let siblingAborted = false;

    const pending = select([
      operation(async (signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => {
            siblingAborted = true;
            resolve();
          }, { once: true });
        });
        return "sibling";
      }),
      operation(() => {
        throw new Error("boom");
      }),
    ]);

    await expectAsync(pending).toBeRejectedWithError(/boom/);
    expect(siblingAborted).toBeTrue();
  });

  it("select rejects an empty case list", async () => {
    await expectAsync(select([])).toBeRejectedWithError(/at least one case/);
  });

  it("repeated cancellation leaves coordination primitives reusable", async () => {
    const ch = channel<number>();
    const gate = event();
    const sem = semaphore(1);
    const wg = waitGroup();

    for (let index = 0; index < 100; index++) {
      const controller = new AbortController();

      const receivePending = ch.receive(controller.signal);
      const eventPending = gate.wait(controller.signal);

      const held = await sem.acquire();
      const acquirePending = sem.acquire(controller.signal);

      wg.add();
      const waitPending = wg.wait(controller.signal);

      controller.abort(new ContextCancelledError("stress cancel"));

      await expectAsync(receivePending).toBeRejected();
      await expectAsync(eventPending).toBeRejected();
      await expectAsync(acquirePending).toBeRejected();
      await expectAsync(waitPending).toBeRejected();

      held();
      wg.done();

      expect(gate.waiting).toBe(0);
      expect(sem.waiting).toBe(0);
      expect(wg.waiting).toBe(0);
    }

    ch.close();
  });


});