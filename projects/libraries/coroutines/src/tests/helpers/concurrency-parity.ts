/**
 * Shared concurrency suite factories.
 *
 * The same channel/context/select behavior must hold for the main-thread
 * public API and for the string-based worker runtime
 * (`ACTOR_CONCURRENCY_RUNTIME`), which is a hand-maintained copy. Each
 * factory registers a `describe` block whose tests run against an injected
 * API, so the suites exercise both implementations.
 *
 * Tests here use only the public concurrency surface. Implementation-level
 * tests that poke `CHANNEL_INTERNALS` stay in `utils.spec.ts`.
 */
export interface ConcurrencyParityApi {
  channel: <T = any>(capacity?: number) => any;
  receive: <T = any>(ch: any, name?: string) => any;
  send: <T = any>(ch: any, value: T, name?: string) => any;
  otherwise: (name?: string) => any;
  operation: <T = any>(run: (signal: AbortSignal) => T | Promise<T>, name?: string) => any;
  select: <T = any>(cases: any[], ctx?: any) => Promise<any>;
  background: () => any;
  withCancel: (parent?: any) => [any, (reason?: unknown) => void];
  withTimeout: (parent: any, ms: number) => [any, (reason?: unknown) => void];
  withDeadline: (parent: any, deadline: Date | number) => [any, (reason?: unknown) => void];
  ChannelClosedError: new (message?: string) => Error;
  ContextCancelledError: new (message?: string) => Error;
  createAbortError: (signal?: AbortSignal) => Error;
}

export function defineChannelSuite(api: ConcurrencyParityApi): void {
  describe("channel", () => {
    it("should create an unbuffered channel by default", () => {
      const ch = api.channel<number>();
      expect(ch.capacity).toBe(0);
      expect(ch.size).toBe(0);
      expect(ch.closed).toBeFalse();
    });

    it("should create a buffered channel", () => {
      const ch = api.channel<string>(3);
      expect(ch.capacity).toBe(3);
      expect(ch.size).toBe(0);
    });

    it("should throw for negative capacity", () => {
      expect(() => api.channel(-1)).toThrowError(/non-negative integer/);
    });

    it("should throw for non-integer capacity", () => {
      expect(() => api.channel(1.5)).toThrowError(/non-negative integer/);
    });

    it("should hand off values on an unbuffered channel", async () => {
      const ch = api.channel<number>();

      const receive$ = ch.receive();
      await ch.send(42);
      const value = await receive$;

      expect(value).toEqual({ ok: true, value: 42 });
    });

    it("should buffer sends while space remains", async () => {
      const ch = api.channel<number>(2);

      await ch.send(1); // buffered
      await ch.send(2); // buffered

      expect(ch.size).toBe(2);
      expect(await ch.receive()).toEqual({ ok: true, value: 1 });
      expect(await ch.receive()).toEqual({ ok: true, value: 2 });
    });

    it("should block send when buffer is full", async () => {
      const ch = api.channel<number>(1);
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
      const ch = api.channel<number>(1);
      expect(ch.trySend(7)).toBeTrue();
      expect(ch.size).toBe(1);
    });

    it("trySend should fail on unbuffered channel with no receiver", () => {
      const ch = api.channel<number>();
      expect(ch.trySend(7)).toBeFalse();
    });

    it("trySend should fail when buffer is full", async () => {
      const ch = api.channel<number>(1);
      await ch.send(1);
      expect(ch.trySend(2)).toBeFalse();
    });

    it("tryReceive should return buffered values", async () => {
      const ch = api.channel<number>(1);
      await ch.send(99);

      const result = ch.tryReceive();
      expect(result).toEqual(jasmine.objectContaining({ ok: true, value: 99 }));
    });

    it("tryReceive should return undefined when empty", () => {
      const ch = api.channel<number>();
      expect(ch.tryReceive()).toBeUndefined();
    });

    it("tryReceive should return ok:false when closed and empty", () => {
      const ch = api.channel<number>();
      ch.close();
      expect(ch.tryReceive()).toEqual(jasmine.objectContaining({ ok: false }));
    });

    it("should close and reject pending senders", async () => {
      const ch = api.channel<number>();

      const pendingSend = ch.send(1);
      ch.close();

      await expectAsync(pendingSend).toBeRejectedWithError(api.ChannelClosedError);
    });

    it("should close and resolve pending receivers with ok:false", async () => {
      const ch = api.channel<number>();

      const pendingReceive = ch.receive();
      ch.close();

      expect(await pendingReceive).toEqual({ ok: false, value: undefined });
    });

    it("should reject send on a closed channel", async () => {
      const ch = api.channel<number>();
      ch.close();

      await expectAsync(ch.send(1)).toBeRejectedWithError(api.ChannelClosedError);
    });

    it("should return ok:false when receiving from closed empty channel", async () => {
      const ch = api.channel<number>();
      ch.close();

      expect(await ch.receive()).toEqual({ ok: false, value: undefined });
    });

    it("should carry undefined as a normal channel value", async () => {
      const ch = api.channel<undefined>(1);
      await ch.send(undefined);
      ch.close();

      expect(await ch.receive()).toEqual({ ok: true, value: undefined });
      expect(await ch.receive()).toEqual({ ok: false, value: undefined });
    });

    it("async iteration should not treat undefined as channel closure", async () => {
      const ch = api.channel<number | undefined>(2);
      await ch.send(undefined);
      await ch.send(1);
      ch.close();

      const values: Array<number | undefined> = [];
      for await (const value of ch) values.push(value);

      expect(values).toEqual([undefined, 1]);
    });

    it("should be async iterable", async () => {
      const ch = api.channel<number>(2);
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
      const ch = api.channel<number>();
      const controller = new AbortController();
      controller.abort(new api.ContextCancelledError("stopped"));

      await expectAsync(ch.send(1, controller.signal)).toBeRejectedWithError(/stopped/);
    });

    it("should reject receive when signal is already aborted", async () => {
      const ch = api.channel<number>();
      const controller = new AbortController();
      controller.abort(new api.ContextCancelledError("stopped"));

      await expectAsync(ch.receive(controller.signal)).toBeRejectedWithError(/stopped/);
    });

    it("should abort a blocked send via signal", async () => {
      const ch = api.channel<number>();
      const controller = new AbortController();

      const pending = ch.send(1, controller.signal);
      controller.abort(new api.ContextCancelledError("stopped"));

      await expectAsync(pending).toBeRejectedWithError(/stopped/);
    });

    it("should abort a blocked receive via signal", async () => {
      const ch = api.channel<number>();
      const controller = new AbortController();

      const pending = ch.receive(controller.signal);
      controller.abort(new api.ContextCancelledError("stopped"));

      await expectAsync(pending).toBeRejectedWithError(/stopped/);
    });
  });
}

export function defineContextSuite(api: ConcurrencyParityApi): void {
  describe("context", () => {
    it("background creates a non-aborted context", () => {
      const ctx = api.background();
      expect(ctx.signal.aborted).toBeFalse();
      expect(ctx.reason).toBeUndefined();
    });

    it("withCancel cancel aborts the child signal", () => {
      const [ctx, cancel] = api.withCancel();
      expect(ctx.signal.aborted).toBeFalse();

      cancel();
      expect(ctx.signal.aborted).toBeTrue();
      expect(ctx.reason).toBeInstanceOf(api.ContextCancelledError);
    });

    it("withCancel cancel accepts a custom reason", () => {
      const [ctx, cancel] = api.withCancel();
      const err = new Error("custom");
      cancel(err);
      expect(ctx.reason).toBe(err);
    });

    it("withCancel child is aborted when parent aborts", async () => {
      const [parent, cancelParent] = api.withCancel(api.background());
      const [child] = api.withCancel(parent);

      expect(child.signal.aborted).toBeFalse();
      cancelParent();
      expect(child.signal.aborted).toBeTrue();
    });

    it("withTimeout rejects invalid durations before deriving a live child context", () => {
      expect(() => api.withTimeout(api.background(), -1)).toThrowError(
        RangeError,
        "timer duration must be a finite non-negative number",
      );
      expect(() => api.withTimeout(api.background(), Number.POSITIVE_INFINITY)).toThrowError(
        RangeError,
        "timer duration must be a finite non-negative number",
      );
    });

    it("withTimeout aborts after the specified delay", async () => {
      const [ctx, cancel] = api.withTimeout(api.background(), 20);
      expect(ctx.signal.aborted).toBeFalse();

      await new Promise(r => setTimeout(r, 50));
      expect(ctx.signal.aborted).toBeTrue();
      expect(String(ctx.reason)).toContain("timeout");

      cancel(); // idempotent cleanup
    });

    it("withTimeout manual cancel clears the timer", () => {
      const [ctx, cancel] = api.withTimeout(api.background(), 10000);
      cancel();
      expect(ctx.signal.aborted).toBeTrue();
    });

    it("withDeadline aborts at the deadline", async () => {
      const [ctx] = api.withDeadline(api.background(), Date.now() + 20);
      expect(ctx.signal.aborted).toBeFalse();

      await new Promise(r => setTimeout(r, 50));
      expect(ctx.signal.aborted).toBeTrue();
    });

    it("withDeadline accepts a Date object", async () => {
      const [ctx] = api.withDeadline(api.background(), new Date(Date.now() + 20));
      await new Promise(r => setTimeout(r, 50));
      expect(ctx.signal.aborted).toBeTrue();
    });

    it("withDeadline with past deadline aborts soon after", async () => {
      const [ctx] = api.withDeadline(api.background(), Date.now() - 10);
      // setTimeout(0) schedules on next tick; wait a bit
      await new Promise(r => setTimeout(r, 10));
      expect(ctx.signal.aborted).toBeTrue();
    });

    it("done resolves when cancelled", async () => {
      const [ctx, cancel] = api.withCancel();
      let resolved = false;
      ctx.done.then(() => { resolved = true; });

      cancel();
      await ctx.done;
      expect(resolved).toBeTrue();
    });

    it("createAbortError returns the Error reason unchanged", () => {
      const err = new Error("boom");
      const ctrl = new AbortController();
      ctrl.abort(err);
      expect(api.createAbortError(ctrl.signal)).toBe(err);
    });

    it("createAbortError wraps string reason in ContextCancelledError", () => {
      const ctrl = new AbortController();
      ctrl.abort("stopped");
      const result = api.createAbortError(ctrl.signal);
      expect(result).toBeInstanceOf(api.ContextCancelledError);
      expect(result.message).toBe("stopped");
    });

    it("createAbortError with ContextCancelledError reason returns it", () => {
      const err = new api.ContextCancelledError("my cancel");
      const ctrl = new AbortController();
      ctrl.abort(err);
      expect(api.createAbortError(ctrl.signal)).toBe(err);
    });
  });
}

export function defineSelectionSuite(api: ConcurrencyParityApi): void {
  describe("selection", () => {
    it("receive builds a receive case", () => {
      const ch = api.channel<number>();
      const c = api.receive(ch, "myCase");
      expect(c.op).toBe("receive");
      expect(c.channel).toBe(ch);
      expect(c.name).toBe("myCase");
    });

    it("send builds a send case", () => {
      const ch = api.channel<number>();
      const c = api.send(ch, 42, "myCase");
      expect(c.op).toBe("send");
      expect(c.channel).toBe(ch);
      expect(c.value).toBe(42);
      expect(c.name).toBe("myCase");
    });

    it("otherwise builds a default case", () => {
      const c = api.otherwise("fallback");
      expect(c.op).toBe("default");
      expect(c.name).toBe("fallback");
    });

    it("select chooses a ready receive case", async () => {
      const ch = api.channel<number>(1);
      await ch.send(7);

      const result = await api.select([api.receive(ch, "r")]);
      expect(result.op).toBe("receive");
      expect(result.name).toBe("r");
      expect(result.value).toBe(7);
      expect(result.ok).toBeTrue();
    });

    it("select chooses a ready send case", async () => {
      const ch = api.channel<number>(1);

      const result = await api.select([api.send(ch, 8, "s")]);
      expect(result.op).toBe("send");
      expect(result.name).toBe("s");
      expect(result.ok).toBeTrue();
      expect(await ch.receive()).toEqual({ ok: true, value: 8 });
    });

    it("select falls back to default when nothing is ready", async () => {
      const ch = api.channel<number>();

      const result = await api.select([api.receive(ch, "r"), api.otherwise("def")]);
      expect(result.op).toBe("default");
      expect(result.name).toBe("def");
      expect(result.ok).toBeTrue();
    });

    it("select rejects multiple default branches", async () => {
      await expectAsync(
        api.select([api.otherwise("first"), api.otherwise("second")]),
      ).toBeRejectedWithError(
        RangeError,
        "select accepts at most one default case",
      );
    });

    it("select blocks until a case is ready", async () => {
      const ch = api.channel<number>();

      const pending = api.select([api.receive(ch, "r")]);
      setTimeout(() => ch.send(99), 10);

      const result = await pending;
      expect(result.value).toBe(99);
    });

    it("select receive on closed channel returns ok:false", async () => {
      const ch = api.channel<number>();
      ch.close();

      const result = await api.select([api.receive(ch, "r")]);
      expect(result.op).toBe("receive");
      expect(result.ok).toBeFalse();
    });

    it("select send on closed channel throws ChannelClosedError", async () => {
      const ch = api.channel<number>();
      ch.close();

      await expectAsync(api.select([api.send(ch, 1, "s")])).toBeRejectedWithError(api.ChannelClosedError);
    });

    it("select rejects channels that do not support select", async () => {
      const fake = {
        tryReceive: () => undefined,
        trySend: () => false,
        closed: false,
      };

      await expectAsync(
        api.select([api.receive(fake, "r")]),
      ).toBeRejectedWithError(RangeError, "channel does not support select");
    });

    it("select throws when context is already aborted", async () => {
      const ch = api.channel<number>();
      const err = new api.ContextCancelledError("pre-aborted");
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
      } as any;

      await expectAsync(api.select([api.receive(ch, "r")], fakeCtx)).toBeRejectedWithError(/pre-aborted/);
    });

    it("select aborts when context is cancelled while waiting", async () => {
      const ch = api.channel<number>();
      const [ctx, cancel] = api.withCancel();

      const pending = api.select([api.receive(ch, "r")], ctx);
      cancel();

      await expectAsync(pending).toBeRejectedWithError(api.ContextCancelledError);
    });

    it("select with multiple ready cases chooses exactly one", async () => {
      const a = api.channel<number>(1);
      const b = api.channel<number>(1);
      await a.send(1);
      await b.send(2);

      const result = await api.select([api.receive(a, "a"), api.receive(b, "b")]);
      expect(["a", "b"]).toContain(result.name!);
      expect(result.ok).toBeTrue();

      // Only one value should be consumed
      const remaining = [a.tryReceive(), b.tryReceive()].filter(r => r !== undefined);
      expect(remaining.length).toBe(1);
      expect(remaining[0]).toEqual(jasmine.objectContaining({ ok: true }));
    });

    it("select send case paired with waiting receiver", async () => {
      const ch = api.channel<number>();

      const pendingReceive = ch.receive();
      const result = await api.select([api.send(ch, 123, "s")]);

      expect(result.op).toBe("send");
      expect(await pendingReceive).toEqual({ ok: true, value: 123 });
    });

    it("select receive case paired with waiting sender", async () => {
      const ch = api.channel<number>();

      const pendingSend = ch.send(456);
      const result = await api.select([api.receive(ch, "r")]);

      expect(result.op).toBe("receive");
      expect(result.value).toBe(456);
      await pendingSend;
    });

    it("select cleans up registrations after resolution", async () => {
      const a = api.channel<number>();
      const b = api.channel<number>();

      const pending = api.select([api.receive(a, "a"), api.receive(b, "b")]);
      await a.send(1);

      const result = await pending;
      expect(result.name).toBe("a");

      // b should still be able to receive normally later
      setTimeout(() => b.send(2), 5);
      expect(await b.receive()).toEqual({ ok: true, value: 2 });
    });

    it("select resolves a pending receive with ok:false when the channel closes", async () => {
      const ch = api.channel<number>();

      const pending = api.select([api.receive(ch, "r")]);
      await new Promise((resolve) => setTimeout(resolve, 0));
      ch.close();

      const result = await pending;
      expect(result.op).toBe("receive");
      expect(result.name).toBe("r");
      expect(result.ok).toBeFalse();
      expect(result.value).toBeUndefined();
    });

    it("select resolves a pending send when a receiver arrives later", async () => {
      const ch = api.channel<number>();

      const pending = api.select([api.send(ch, 123, "s")]);
      await new Promise((resolve) => setTimeout(resolve, 0));

      const receive$ = ch.receive();
      const result = await pending;

      expect(result.op).toBe("send");
      expect(result.name).toBe("s");
      expect(result.ok).toBeTrue();
      expect(await receive$).toEqual({ ok: true, value: 123 });
    });

    it("select rejects a pending send when the channel closes", async () => {
      const ch = api.channel<number>();

      const pending = api.select([api.send(ch, 1, "s")]);
      await new Promise((resolve) => setTimeout(resolve, 0));
      ch.close();

      await expectAsync(pending).toBeRejectedWithError(api.ChannelClosedError);
    });

    it("select flushes a queued send into the buffer after space is freed", async () => {
      const ch = api.channel<number>(1);
      await ch.send(1);

      const pending = api.select([api.send(ch, 2, "s")]);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(await ch.receive()).toEqual({ ok: true, value: 1 });

      const result = await pending;
      expect(result.op).toBe("send");
      expect(result.name).toBe("s");
      expect(result.ok).toBeTrue();
      expect(await ch.receive()).toEqual({ ok: true, value: 2 });
    });

    it("same select send and receive cases never self-match on an unbuffered channel", async () => {
      const ch = api.channel<number>();
      const [ctx, cancel] = api.withCancel();

      const pending = api.select([
        api.receive(ch, "receive"),
        api.send(ch, 1, "send"),
      ], ctx);

      await Promise.resolve();
      cancel(new api.ContextCancelledError("stop self-select"));

      await expectAsync(pending).toBeRejectedWithError(
        api.ContextCancelledError,
        "stop self-select",
      );

      expect(ch.tryReceive()).toBeUndefined();
      expect(ch.trySend(2)).toBeFalse();
    });

    it("close and cancellation cannot settle one select twice", async () => {
      const ch = api.channel<number>();
      const [ctx, cancel] = api.withCancel();
      let settlements = 0;

      const pending = api.select([api.receive(ch, "r")], ctx);
      pending.then(
        () => settlements += 1,
        () => settlements += 1,
      );

      await Promise.resolve();
      ch.close();
      cancel(new api.ContextCancelledError("late cancel"));

      await expectAsync(pending).toBeResolvedTo(
        jasmine.objectContaining({
          op: "receive",
          ok: false,
        }),
      );
      await Promise.resolve();

      expect(settlements).toBe(1);
    });
  });
}

export function defineOperationSelectionSuite(api: ConcurrencyParityApi): void {
  describe("operation selection", () => {
    it("operation builds a cancellable operation case", () => {
      const run = (signal: AbortSignal) => signal.aborted;
      const c = api.operation(run, "work");

      expect(c.op).toBe("operation");
      expect(c.run).toBe(run);
      expect(c.name).toBe("work");
    });

    it("select resolves with the first completed operation", async () => {
      const result = await api.select([
        api.operation(async () => {
          await new Promise(r => setTimeout(r, 20));
          return "slow";
        }, "slow"),
        api.operation(async () => {
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

      const result = await api.select([
        api.operation(async (signal) => {
          await new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => {
              loserAborted = true;
              resolve();
            }, { once: true });
          });
          return "loser";
        }, "loser"),
        api.operation(() => "winner", "winner"),
      ]);

      await Promise.resolve();
      expect(result.name).toBe("winner");
      expect(loserAborted).toBeTrue();
    });

    it("select can coordinate an operation with a channel receive", async () => {
      const ch = api.channel<string>();
      setTimeout(() => ch.send("message"), 1);

      let operationAborted = false;
      const result = await api.select([
        api.receive(ch, "message"),
        api.operation(async (signal) => {
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

      const result = await api.select([
        api.operation(() => {
          started = true;
          return "work";
        }, "work"),
        api.otherwise("default"),
      ]);

      expect(result.name).toBe("default");
      expect(started).toBeFalse();
    });

    it("select does not start operations synchronously", () => {
      let started = false;

      const pending = api.select([
        api.operation(() => {
          started = true;
          return "work";
        }, "work"),
      ]);

      expect(started).toBeFalse();
      void pending;
    });

    it("context cancellation aborts active operations", async () => {
      const [ctx, cancel] = api.withCancel();
      let aborted = false;

      const pending = api.select([
        api.operation(async (signal) => {
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
      cancel(new api.ContextCancelledError("stop selection"));

      await expectAsync(pending).toBeRejectedWithError(/stop selection/);
      expect(aborted).toBeTrue();
    });

    it("context cancellation before operation start does not launch work", async () => {
      const [ctx, cancel] = api.withCancel();
      let started = false;

      const pending = api.select([
        api.operation(() => {
          started = true;
          return "work";
        }),
      ], ctx);

      cancel(new api.ContextCancelledError("stop before start"));

      await expectAsync(pending).toBeRejectedWithError(/stop before start/);
      await Promise.resolve();
      expect(started).toBeFalse();
    });

    it("operation failure rejects selection and aborts siblings", async () => {
      let siblingAborted = false;

      const pending = api.select([
        api.operation(async (signal) => {
          await new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => {
              siblingAborted = true;
              resolve();
            }, { once: true });
          });
          return "sibling";
        }),
        api.operation(() => {
          throw new Error("boom");
        }),
      ]);

      await expectAsync(pending).toBeRejectedWithError(/boom/);
      expect(siblingAborted).toBeTrue();
    });

    it("select rejects an empty case list", async () => {
      await expectAsync(api.select([])).toBeRejectedWithError(/at least one case/);
    });

    it("mass select cancellation leaves no channel registrations or active operations behind", async () => {
      for (let index = 0; index < 200; index++) {
        const ch = api.channel<number>();
        const [ctx, cancel] = api.withCancel();
        let operationAborted = false;

        const pending = api.select([
          api.receive(ch, "receive"),
          api.send(ch, index, "send"),
          api.operation(
            (signal) =>
              new Promise<number>((resolve) => {
                signal.addEventListener(
                  "abort",
                  () => {
                    operationAborted = true;
                    resolve(-1);
                  },
                  { once: true },
                );
              }),
            "operation",
          ),
        ], ctx);

        await Promise.resolve();
        cancel(new api.ContextCancelledError(`cancel-${index}`));

        await expectAsync(pending).toBeRejectedWithError(
          api.ContextCancelledError,
          `cancel-${index}`,
        );
        await Promise.resolve();

        expect(operationAborted).toBeTrue();
        expect(ch.tryReceive()).toBeUndefined();
        expect(ch.trySend(index + 1)).toBeFalse();
      }
    });
  });
}
