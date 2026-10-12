import {
  Actor,
  ActorExit,
  Barrier,
  Channel,
  ChannelClosedError,
  ConcurrencyEvent,
  ContextCancelledError,
  CoroutineTask,
  Semaphore,
  TaskGroup,
  WorkerTaskUtils,
  actor,
  background,
  barrier,
  channel,
  compose,
  coroutine,
  event,
  group,
  main,
  receive,
  registerActorRequestHandler,
  operation,
  otherwise,
  select,
  semaphore,
  sleep,
  supervisor,
  withCancel,
  withDeadline,
  withTimeout,
} from "../public-api";

describe("README samples", () => {
  const pause = (ms = 5) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const waitFor = async (
    predicate: () => boolean,
    timeoutMs = 1_000,
  ): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (Date.now() >= deadline) {
        throw new Error(`condition was not met within ${timeoutMs}ms`);
      }
      await pause();
    }
  };
  const capture = async (promise: Promise<unknown>): Promise<unknown> => {
    try {
      return await promise;
    } catch (error) {
      return error;
    }
  };

  let nameCounter = 0;
  const nextName = (prefix: string) => `${prefix}-readme-${++nameCounter}`;

  describe("coroutine", () => {
    it("defines and runs a coroutine with serialized helpers", async () => {
      function expensiveHash(value: string): string {
        return `${value}!`;
      }

      const hash = coroutine<string, string>(
        (value) => expensiveHash(value),
        expensiveHash,
      );

      const result = await hash.run("hello");
      expect(result).toBe("hello!");
      await hash.dispose();
    });

    it("accepts the documented CoroutineTask shape", async () => {
      const task: CoroutineTask<number, number> = async (
        data: number,
        _utils: WorkerTaskUtils,
      ) => data * 2;

      await expectAsync(
        task(2, undefined as unknown as WorkerTaskUtils),
      ).toBeResolvedTo(4);
    });

    it("caps owned workers with maxWorkers while all runs still complete", async () => {
      async function taskFn(value: number): Promise<number> {
        return value + 1;
      }
      const hash = coroutine(taskFn, { maxWorkers: 2 });

      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) => hash.run(i)),
      );

      expect(results).toEqual([1, 2, 3, 4, 5]);
      await hash.dispose();
    });

    it("cancels a submission by signal and by options", async () => {
      function parseLargeDocument(text: string): string {
        return text;
      }

      const parse = coroutine(parseLargeDocument);
      const never = () => new Promise(() => undefined);

      const controller = new AbortController();
      const throwaway = coroutine(never);
      const pending = throwaway.run("x", controller.signal);
      controller.abort();
      expect(await capture(pending)).toBeInstanceOf(Error);
      await throwaway.dispose();

      const otherController = new AbortController();
      const otherPending = parse.run("x", { signal: otherController.signal });
      otherController.abort();
      expect(await capture(otherPending)).toBeInstanceOf(Error);

      await parse.dispose();
    });

    it("lets close() drain admitted work and rejects new submissions", async () => {
      async function slowTask(value: number): Promise<number> {
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
        return value;
      }
      const slow = coroutine(slowTask);

      const admitted = slow.run(1);
      await slow.close();
      expect(await admitted).toBe(1);
      await expectAsync(slow.run(2)).toBeRejected();
      await slow.dispose();
    });

    it("supports absolute dynamic imports inside the module worker", async () => {
      const normalize = new Function(
        "value",
        'return import("data:text/javascript,export default v => v.toUpperCase()")' +
          ".then((module) => module.default(value));",
      ) as (value: string) => Promise<string>;
      const fix = coroutine(normalize);

      expect(await fix.run("readme")).toBe("README");
      await fix.dispose();
    });
  });

  describe("group", () => {
    it("runs the structured concurrent work sample", async () => {
      function expensiveHash(value: string): string {
        return `${value}!`;
      }

      const hash = coroutine<string, string>(
        (value) => expensiveHash(value),
        expensiveHash,
      );
      const work = group({ concurrency: 4 });

      const inputs = ["a", "b", "c", "d", "e", "f"];
      const results = inputs.map((input) =>
        work.spawn((signal) => hash.run(input, signal)),
      );

      try {
        await work.wait();
        expect(await Promise.all(results)).toEqual([
          "a!",
          "b!",
          "c!",
          "d!",
          "e!",
          "f!",
        ]);
      } finally {
        await hash.dispose();
      }
    });

    it("matches the documented TaskGroup surface", () => {
      const work: TaskGroup = group({ concurrency: 2 });
      expect(work.accepting).toBeTrue();
      expect(work.running).toBe(0);
      work.cancel();
    });

    it("reports settle() outcomes in spawn order", async () => {
      const work = group({ concurrency: 1 });

      work.spawn(async () => "first");
      work.spawn(async () => {
        throw new Error("boom");
      });
      work.spawn(async () => "never-starts");
      const spawned = work.spawn(async () => "also-queued");

      const report = await work.settle();

      expect(report.outcomes.map((o) => o.status)).toEqual([
        "fulfilled",
        "rejected",
        "cancelled",
        "cancelled",
      ]);
      expect((report.outcomes[0] as any).value).toBe("first");
      expect((report.outcomes[1] as any).error.message).toBe("boom");
      expect(report.error).toBeInstanceOf(Error);
      expect(await capture(work.wait())).toBe(report.error);
      expect(await capture(spawned)).toBeInstanceOf(Error);
    });
  });

  describe("channel", () => {
    it("matches the documented Channel surface", () => {
      const jobs: Channel<number> = channel<number>(8);
      expect(jobs.capacity).toBe(8);
      expect(jobs.size).toBe(0);
      expect(jobs.closed).toBeFalse();
      jobs.close();
    });

    it("sends, receives, and closes explicitly", async () => {
      const jobs = channel<string>(8);

      await jobs.send("a");
      await jobs.send("b");

      const next = await jobs.receive();
      expect(next.ok).toBeTrue();
      expect((next as any).value).toBe("a");

      // Non-blocking surface from the README's Channel snippet.
      expect(jobs.tryReceive()).toEqual({ ok: true, value: "b" });
      expect(jobs.tryReceive()).toBeUndefined();
      expect(jobs.trySend("c")).toBeTrue();

      jobs.close();
      expect(jobs.closed).toBeTrue();

      expect(await jobs.receive()).toEqual({ ok: true, value: "c" });
      const closed = await jobs.receive();
      expect(closed.ok).toBeFalse();
      expect(await capture(jobs.send("late"))).toBeInstanceOf(
        ChannelClosedError,
      );
    });

    it("stops async iteration only after the explicit closed result", async () => {
      const ch = channel<number>(4);
      for (const value of [1, 2, 3]) await ch.send(value);
      ch.close();

      const seen: number[] = [];
      for await (const value of ch) seen.push(value);

      expect(seen).toEqual([1, 2, 3]);
    });
  });

  describe("select", () => {
    it("races receive against operation and cancels the loser", async () => {
      const messages = channel<string>();
      const producer = messages.send("hello");

      let statusAborted = false;
      const selected = await select([
        receive(messages, "message"),
        operation(
          (signal) =>
            new Promise((_, reject) => {
              signal.addEventListener(
                "abort",
                () => {
                  statusAborted = true;
                  reject(signal.reason);
                },
                { once: true },
              );
            }),
          "status",
        ),
      ]);

      expect(selected.op).toBe("receive");
      expect(selected.name).toBe("message");
      expect(selected.value).toBe("hello");
      // A ready channel wins during select's non-starting fast path, so the
      // operation never starts and has nothing to abort.
      expect(statusAborted).toBeFalse();
      await producer;
    });

    it("returns the default branch without starting operations", async () => {
      let started = false;
      const result = await select([
        operation(() => {
          started = true;
          return 1;
        }, "op"),
        otherwise("idle"),
      ]);

      expect(result.op).toBe("default");
      expect(result.name).toBe("idle");
      expect(started).toBeFalse();
    });

    it("aborts selection when its context is cancelled", async () => {
      const [ctx, cancel] = withCancel();
      const empty = channel<number>();

      setTimeout(cancel, 5);
      const error = await capture(select([receive(empty)], ctx));

      expect(error).toBeInstanceOf(ContextCancelledError);
    });
  });

  describe("contexts", () => {
    it("derives cancellable children with withCancel", async () => {
      const [ctx, cancel] = withCancel();

      expect(ctx.signal.aborted).toBeFalse();
      cancel();
      expect(ctx.signal.aborted).toBeTrue();
      await ctx.done;
    });

    it("cancels withTimeout after the duration with the documented reason", async () => {
      const [tctx] = withTimeout(background(), 10);
      await tctx.done;
      expect((tctx.reason as Error).message).toBe("context timeout after 10ms");
    });

    it("cancels withDeadline in the past immediately", async () => {
      const [dctx] = withDeadline(background(), Date.now() - 1000);
      expect(dctx.signal.aborted).toBeTrue();
      expect((dctx.reason as Error).message).toBe("context deadline exceeded");
    });
  });

  describe("timing", () => {
    it("resolves sleep after the delay", async () => {
      await sleep(10);
    });

    it("cancels sleep through the signal", async () => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new ContextCancelledError()), 5);

      const error = await capture(sleep(10_000, controller.signal));
      expect(error).toBeInstanceOf(ContextCancelledError);
    });
  });

  describe("semaphore", () => {
    it("bounds concurrent sections, queues FIFO, and releases idempotently", async () => {
      const database: Semaphore = semaphore(2);
      let active = 0;
      let peak = 0;
      const order: number[] = [];

      const section = async () => {
        const release = await database.acquire();
        active += 1;
        peak = Math.max(peak, active);
        await pause(5);
        active -= 1;
        release();
      };

      const r1 = await database.acquire();
      const r2 = await database.acquire();
      expect(database.available).toBe(0);
      expect(database.tryAcquire()).toBeUndefined();

      const first = database.acquire().then((release) => {
        order.push(1);
        return release;
      });
      const second = database.acquire().then((release) => {
        order.push(2);
        return release;
      });
      expect(database.waiting).toBe(2);

      r1();
      (await first)();
      r2();
      (await second)();

      // Idempotent release: double-calling must not grow the budget.
      (await first)();
      expect(database.available).toBe(2);

      await Promise.all([section(), section(), section(), section(), section()]);
      expect(peak).toBe(2);
      expect(order).toEqual([1, 2]);
    });
  });

  describe("barrier", () => {
    it("releases generations of participants and is reusable", async () => {
      const phase: Barrier = barrier(3);
      const arrivals: number[] = [];

      const generation = () =>
        Promise.all(
          [1, 2, 3].map(async (n) => {
            await phase.wait();
            arrivals.push(n);
          }),
        );

      await generation();
      expect(phase.waiting).toBe(0);
      await generation();
      expect(arrivals.length).toBe(6);
    });
  });

  describe("event", () => {
    it("broadcasts readiness and resets manually", async () => {
      const ready: ConcurrencyEvent = event();
      let released = false;

      const waiter = ready.wait().then(() => {
        released = true;
      });
      await pause(5);
      expect(released).toBeFalse();

      ready.set();
      await waiter;
      expect(released).toBeTrue();
      await ready.wait(); // stays set for later waiters

      ready.clear();
      let second = false;
      const later = ready.wait().then(() => {
        second = true;
      });
      await pause(5);
      expect(second).toBeFalse();
      ready.set();
      await later;
      expect(ready.isSet).toBeTrue();
    });

    it("starts set when asked", async () => {
      expect(event(true).isSet).toBeTrue();
      await event(true).wait();
    });
  });

  describe("actor", () => {
    it("runs the counter sample", async () => {
      const counter = actor(
        nextName("counter"),
        (message, state: number) => {
          if (message.kind === "actor-bus" && message.topic === "inc")
            return state + 1;
          return state;
        },
        0,
      );

      const value = await main.outbox.request(counter, "inc", undefined);
      expect(value).toBe(1);

      const handle: Actor = counter;
      await main.outbox.stop(handle);
      const exit: ActorExit = await counter.done;
      expect(exit).toEqual({ reason: "stopped" });
    });

    it("exposes the documented main messaging surface", async () => {
      const seen: string[] = [];
      const unsubscribe = main.inbox.subscribe((message) => {
        seen.push(message.topic);
      });

      main.outbox.publish("broadcast", { ok: true }, { from: "main" });

      const name = nextName("by-name");
      const echo = actor(
        name,
        (message, state: string) => {
          if (message.kind === "actor-bus" && message.topic === "ping")
            return message.payload;
          return state;
        },
        "idle",
      );

      main.outbox.send(name, "ping", "pong", { from: "main" });
      await pause(20);
      expect(await main.outbox.request(echo, "state", undefined)).toBe("pong");

      unsubscribe();
      main.inbox.clear();
      await main.outbox.stop(echo);
      expect(seen).toContain("broadcast");

      await expectAsync(
        main.outbox.request("does-not-exist", "topic", undefined),
      ).toBeRejected();
    });

    it("uses worker-side concurrency, outbox, and inbox utilities", async () => {
      const unregister = registerActorRequestHandler(
        "main",
        (topic: string, payload: number) =>
          topic === "echo" ? payload * 2 : payload,
      );

      const peeked = new Promise<any>((resolve) => {
        const unsubscribe = main.inbox.subscribe((message) => {
          if (message.topic === "result" || message.topic === "peeked") {
            unsubscribe();
            resolve(message.payload);
          }
        });
      });

      async function utilsBehavior(message: any, state: number, utils: any) {
          if (message.kind === "actor-bus" && message.topic === "run-utils") {
            const ch = utils.concurrency.channel(2);
            await ch.send(41);
            await utils.concurrency.sleep(1);

            const picked = await utils.concurrency.select([
              utils.concurrency.receive(ch, "value"),
            ]);

            const doubled = await utils.outbox.request(
              "main",
              "echo",
              picked.value,
            );
            utils.outbox.send("main", "result", doubled + 1);
          }

          if (message.kind === "actor-bus" && message.topic === "listen-next") {
            await new Promise((resolve) => setTimeout(resolve, 20)); // let the main thread queue the next message first
            const next = await utils.inbox.listen();
            utils.outbox.send("main", "peeked", next?.payload ?? null);
          }

          return state;
      }

      const service = actor(
        nextName("utils"),
        utilsBehavior,
        0,
      );

      main.outbox.send(service, "run-utils", undefined);
      await pause(20);
      expect(await peeked).toBe(83); // 41 * 2 + 1

      const peekedNext = new Promise<any>((resolve) => {
        const unsubscribe = main.inbox.subscribe((message) => {
          if (message.topic === "peeked") {
            unsubscribe();
            resolve(message.payload);
          }
        });
      });
      main.outbox.send(service, "listen-next", undefined);
      await pause(20);
      main.outbox.send(service, "second", "from-main");
      expect(await peekedNext).toBe("from-main");

      unregister();
      await main.outbox.stop(service);
    });

    it("bounds the mailbox and reports pressure without terminating", async () => {
      async function mailboxBehavior(_message: any, state: number) {
          if (state === 0) {
            await new Promise<void>((resolve) => setTimeout(resolve, 100));
          }
          return state + 1;
      }

      const service = actor(
        nextName("mailbox"),
        mailboxBehavior,
        0,
        { capacity: 1 },
      );

      expect(service.mailboxCapacity).toBe(1);

      main.outbox.send(service, "m1", undefined); // occupies the behavior
      await pause(20);
      main.outbox.send(service, "m2", undefined); // fills capacity 1
      await pause(20);

      const rejected = await capture(
        main.outbox.request(service, "m3", undefined),
      );
      expect((rejected as Error).message).toBe(
        "Actor mailbox capacity exceeded",
      );

      main.outbox.send(service, "m4", undefined); // one-way overflow
      await pause(20);
      expect(service.dropped).toBe(1);

      await pause(150);
      expect(service.running).toBeTrue();
      expect(await main.outbox.request(service, "ping", undefined)).toBeDefined();

      await main.outbox.stop(service);
    });
  });

  describe("supervisor", () => {
    it("restarts failed generations behind one stable handle", async () => {
      const name = nextName("supervised");
      const factory = () =>
        actor(
          name,
          (message, state: number) => {
            if (message.kind === "actor-bus" && message.topic === "boom")
              throw new Error("boom");
            return state;
          },
          0,
        );

      const service = supervisor(factory, {
        maxRestarts: 2,
        restartDelay: 1,
        capacity: 8,
      });

      expect(service.capacity).toBe(8);
      expect(service.restarts).toBe(0);

      main.outbox.send(service, "boom", undefined);
      await waitFor(
        () => service.restarts === 1 && service.current?.running === true,
      );
      expect(service.restarts).toBe(1);
      expect(service.current?.running).toBeTrue();
      expect(await main.outbox.request(service, "ping", undefined)).toBe(0);

      main.outbox.send(service, "boom", undefined);
      await waitFor(
        () => service.restarts === 2 && service.current?.running === true,
      );
      main.outbox.send(service, "boom", undefined);

      const exit = await service.done;
      expect(exit.reason).toBe("error");
      expect((exit as any).error.message).toBe("boom");
      expect(service.restarts).toBe(2);
      expect(service.current).toBeUndefined();
      expect(service.pending).toBe(0);
    });

    it("never restarts a normal stop", async () => {
      const name = nextName("stopped");
      const service = supervisor(() =>
        actor(name, (message, state: number) => state, 0),
      );

      await main.outbox.stop(service);
      expect(await service.done).toEqual({ reason: "stopped" });
      expect(service.restarts).toBe(0);
    });
  });

  describe("compose", () => {
    it("runs the pipeline sample through one lifecycle", async () => {
      const parse = coroutine((input: string) => input.split(","));
      const transform = coroutine((values: string[]) =>
        values.map((value) => value.trim().toUpperCase()),
      );
      const encode = coroutine((values: string[]) => values.join("|"));

      const pipeline = compose(parse, transform, encode);
      const output = await pipeline.run("a, b, c");

      expect(output).toBe("A|B|C");
      await pipeline.dispose();
    });
  });

  describe("transferable ownership", () => {
    it("moves buffer ownership in and out of the worker", async () => {
      function mutate(bytes: Uint8Array): void {
        for (let i = 0; i < bytes.length; i++) bytes[i] ^= 0xff;
      }

      const transform = coroutine<ArrayBuffer, ArrayBuffer>(
        (buffer, { transfer }) => {
          mutate(new Uint8Array(buffer));
          return transfer(buffer, buffer);
        },
        mutate,
      );

      const input = new ArrayBuffer(16);
      new Uint8Array(input).fill(0);

      const output: ArrayBuffer = await transform.run(input, {
        transfer: [input],
      });

      // Callers receive the value, never the wrapper.
      expect(output).toBeInstanceOf(ArrayBuffer);
      expect((output as any).__transferResult).toBeUndefined();
      // Input ownership moved to the worker.
      expect(input.byteLength).toBe(0);
      // The result was transferred back and mutated in place.
      expect(new Uint8Array(output)[0]).toBe(0xff);

      await transform.dispose();
    });

    it("keeps transferables with the caller when cancelled before posting", async () => {
      const controller = new AbortController();
      const input = new ArrayBuffer(8);
      const runner = coroutine((_value: ArrayBuffer) => _value);
      const work = group({ concurrency: 1 });
      work.spawn(async () => {
        await pause(20);
      });
      const queued = work.spawn((signal) =>
        runner.run(input, { signal, transfer: [input] }),
      );
      controller.abort();
      work.cancel();

      expect(await capture(queued)).toBeInstanceOf(Error);
      expect(input.byteLength).toBe(8); // never posted, still owned
      await runner.dispose();
    });
  });

  describe("streaming by composition", () => {
    it("runs the bounded producer/consumer pipeline sample", async () => {
      type Job = { id: string; value: number };
      type Result = { id: string; value: number };

      const handleJob = coroutine<Job, Result>((job) => ({
        id: job.id,
        value: job.value * 2,
      }));

      const input = channel<Job>(8);
      const output = channel<Result>(8);
      const workers = group();

      const consume = (async () => {
        const results: Result[] = [];
        for await (const result of output) results.push(result);
        return results;
      })();

      for (let i = 0; i < 4; i++) {
        workers.spawn(async (signal) => {
          while (true) {
            const next = await input.receive(signal);
            if (!next.ok) return;

            const result = await handleJob.run(next.value, signal);
            await output.send(result, signal);
          }
        });
      }

      const inputs = Array.from({ length: 10 }, (_, i) => ({
        id: String(i),
        value: i,
      }));
      await Promise.all(inputs.map((job) => input.send(job)));
      input.close();

      await workers.wait();
      output.close();

      const results = await consume;
      expect(results.length).toBe(10);
      expect(results.map((r) => r.value).sort((a, b) => a - b)).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18]);
      await handleJob.dispose();
    });
  });
});
