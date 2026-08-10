import {
  actor,
  ActorBusMessage,
  background,
  channel,
  ContextCancelledError,
  isActorBusMessage,
  main,
  otherwise,
  operation,
  receive,
  registerActorRequestHandler,
  select,
  send,
  supervisor,
  withCancel,
} from "../public-api";
import {
  idescribe
} from "./env.spec";

idescribe("actor", () => {
  let originalWorker: any;
  let _originalLog: typeof console.log;
  let _originalError: typeof console.error;
  let _originalWarn: typeof console.warn;
  let actorCounter = 0;

  const nextActorName = () => `actor-${++actorCounter}`;
  const pause = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitForMainMessage = (
    predicate: (message: ActorBusMessage<any>) => boolean,
    timeoutMs = 200
  ) =>
    new Promise<ActorBusMessage<any>>((resolve, reject) => {
      let unsubscribe = () => {};
      const timeoutId = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Timed out waiting for actor-bus message after ${timeoutMs}ms`));
      }, timeoutMs);

      unsubscribe = main.inbox.subscribe((message: ActorBusMessage<any>) => {
        if (!predicate(message)) {
          return;
        }

        clearTimeout(timeoutId);
        unsubscribe();
        resolve(message);
      });
    });

  beforeAll(() => {
    originalWorker = (globalThis as any).Worker;
    _originalLog = console.log;
    _originalError = console.error;
    _originalWarn = console.warn;
    (globalThis as any).currentMainTask = undefined;

    class MockWorker {
      onmessage: ((ev: any) => void) | null = null;
      listeners: Record<string, ((ev: any) => void)[]> = {};
      terminated = false;
      readonly sentMessages: any[] = [];
      private workerInbox = channel<any>();
      private busInbox = channel<any>();
      private mailboxCapacity: number | undefined;
      private actorState: any = undefined;
      private actorRunning = false;
      private actorStopping = false;
      private workerId = 1;
      private taskId = "";
      private pendingWorkerRequests = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }>();
      private requestCounter = 0;
      private timers = new Map<number, ReturnType<typeof setTimeout>>();

      constructor(_url: string, _options?: any) {
        this.workerId = Math.floor(Math.random() * 100000);
        (globalThis as any).lastMockWorker = this;
      }

      emitError(error: Error) {
        const event = { error, message: error.message } as ErrorEvent;
        this.listeners["error"]?.forEach(fn => fn(event));
      }

      emitMessage(message: any) {
        const event = { data: message } as any;
        this.onmessage?.(event);
        this.listeners["message"]?.forEach(fn => fn(event));
      }

      get protocolIdentity() {
        return { workerId: this.workerId, taskId: this.taskId };
      }

      get pendingWorkerRequestCount() {
        return this.pendingWorkerRequests.size;
      }

      private createWorkerUtils(message: { workerId: number; taskId: string }) {
        const post = (payload: any) => {
          const event = {
            data: { workerId: message.workerId, taskId: message.taskId, type: "notify", payload }
          } as any;
          this.onmessage?.(event);
          this.listeners["message"]?.forEach(fn => fn(event));
        };
        const outbox = {
          request: (to: string | string[], topic: string, requestPayload: any) => {
            if (this.actorStopping || !this.actorRunning) {
              return Promise.reject(new Error("Actor stopped"));
            }

            return new Promise((resolve, reject) => {
              this.requestCounter += 1;
              const requestId = message.taskId + ":request:" + this.requestCounter;
              this.pendingWorkerRequests.set(requestId, { resolve, reject });

              setTimeout(() => {
                const reqEvent = {
                  data: {
                    workerId: message.workerId,
                    taskId: message.taskId,
                    requestId,
                    to,
                    topic,
                    type: "request",
                    payload: requestPayload,
                  }
                } as any;
                this.onmessage?.(reqEvent);
                this.listeners["message"]?.forEach(fn => fn(reqEvent));
              }, 1);
            });
          },
          send: (to: string | string[], topic: string, payload: any) => {
            post({ kind: "actor-bus", to, topic, payload });
          },
        };
        return {
          outbox,
          inbox: {
            listen: async (signal?: AbortSignal) => {
              const result = await this.busInbox.receive(signal);
              return result.ok ? result.value : undefined;
            },
          },
          concurrency: {
            channel,
            receive,
            send,
            otherwise,
  operation,
            select,
            background,
            withCancel,
            ContextCancelledError,
          },
        };
      }

      private async runBehaviorLoop(_msg: any) {
        const utils = this.createWorkerUtils({ workerId: this.workerId, taskId: this.taskId });
        const mainTask = (globalThis as any).currentMainTask;
        if (!mainTask) return;

        while (this.actorRunning && !this.terminated) {
          const received = await this.workerInbox.receive();
          if (!received.ok) break;
          const envelope = received.value;

          let item = envelope;
          let requestId = null;

          if (envelope && typeof envelope === "object" && "requestId" in envelope) {
            requestId = envelope.requestId;
            item = envelope.msg;
          }

          try {
            const result = await Promise.resolve(mainTask(item, this.actorState, utils));
            this.actorState = result;

            if (requestId) {
              const event = {
                data: { workerId: this.workerId, taskId: this.taskId, requestId, type: "response", payload: result }
              } as any;
              this.onmessage?.(event);
              this.listeners["message"]?.forEach(fn => fn(event));
            }
          } catch (err: any) {
            if (this.actorStopping) {
              break;
            }

            if (requestId) {
              const requestError = {
                data: { workerId: this.workerId, taskId: this.taskId, requestId, type: "error", error: err.message }
              } as any;
              this.onmessage?.(requestError);
              this.listeners["message"]?.forEach(fn => fn(requestError));
            }

            this.actorRunning = false;
            const fatalError = {
              data: { workerId: this.workerId, taskId: this.taskId, type: "error", error: err.message }
            } as any;
            this.onmessage?.(fatalError);
            this.listeners["message"]?.forEach(fn => fn(fatalError));
            break;
          }
        }

        this.actorRunning = false;
        const stoppedEvent = { data: { workerId: this.workerId, taskId: this.taskId, type: "stopped" } } as any;
        this.onmessage?.(stoppedEvent);
        this.listeners["message"]?.forEach(fn => fn(stoppedEvent));
      }

      postMessage(msg: any) {
        this.sentMessages.push(msg);
        const injectedError = (globalThis as any).actorPostMessageError;
        if (typeof injectedError === "function") {
          const error = injectedError(msg);
          if (error) throw error;
        } else if (injectedError) {
          throw injectedError;
        }

        if (msg?.type === "set" && typeof msg.id === "number") {
          const handle = setTimeout(() => {
            this.timers.delete(msg.id);
            const event = { data: { type: "elapsed", id: msg.id } } as any;
            this.onmessage?.(event);
          }, msg.ms);
          this.timers.set(msg.id, handle);
          return;
        }

        if (msg?.type === "clear" && typeof msg.id === "number") {
          const handle = this.timers.get(msg.id);
          if (handle !== undefined) {
            clearTimeout(handle);
            this.timers.delete(msg.id);
          }
          return;
        }

        setTimeout(() => {
          if (this.terminated) return;

          if (msg.type === "init") {
            this.workerId = msg.workerId;
            this.taskId = msg.taskId;
            this.actorState = msg.payload;
            this.mailboxCapacity = msg.mailboxCapacity;
            if (this.mailboxCapacity !== undefined) {
              this.workerInbox = channel<any>(this.mailboxCapacity);
            }
            this.actorStopping = false;
            this.actorRunning = true;
            this.runBehaviorLoop(msg);
          } else if (msg.type === "stop") {
            this.actorStopping = true;
            this.actorRunning = false;
            for (const pending of this.pendingWorkerRequests.values()) {
              pending.reject(new Error("Actor stopped"));
            }
            this.pendingWorkerRequests.clear();
            this.workerInbox.close();
            this.busInbox.close();
          } else if (msg.type === "notify") {
            const accepted =
              this.mailboxCapacity === undefined
                ? (this.workerInbox.send(msg.payload).catch(() => {}), true)
                : this.workerInbox.trySend(msg.payload);

            if (!accepted) {
              const overflowEvent = {
                data: { workerId: this.workerId, taskId: this.taskId, type: "overflow" }
              } as any;
              this.onmessage?.(overflowEvent);
              this.listeners["message"]?.forEach(fn => fn(overflowEvent));
            } else if (
              msg.payload &&
              typeof msg.payload === "object" &&
              msg.payload.kind === "actor-bus"
            ) {
              this.busInbox.send(msg.payload).catch(() => {});
            }
          } else if (msg.type === "request" && msg.requestId) {
            const envelope = { msg: msg.payload, requestId: msg.requestId, topic: msg.topic };
            const accepted =
              this.mailboxCapacity === undefined
                ? (this.workerInbox.send(envelope).catch(() => {}), true)
                : this.workerInbox.trySend(envelope);

            if (!accepted) {
              const overflowEvent = {
                data: {
                  workerId: this.workerId,
                  taskId: this.taskId,
                  requestId: msg.requestId,
                  type: "error",
                  error: "Actor mailbox capacity exceeded",
                }
              } as any;
              this.onmessage?.(overflowEvent);
              this.listeners["message"]?.forEach(fn => fn(overflowEvent));
            }
          } else if ((msg.type === "response" || msg.type === "error") && msg.requestId) {
            const pending = this.pendingWorkerRequests.get(msg.requestId);
            if (pending) {
              this.pendingWorkerRequests.delete(msg.requestId);
              if (msg.type === "response") {
                pending.resolve(msg.payload);
              } else {
                pending.reject(new Error(msg.error || "Mock worker request failed"));
              }
            }
          }
        }, 1);
      }

      addEventListener(type: string, fn: (ev: any) => void) {
        this.listeners[type] ||= [];
        this.listeners[type].push(fn);
      }

      removeEventListener(type: string, fn: (ev: any) => void) {
        if (this.listeners[type]) {
          this.listeners[type] = this.listeners[type].filter(f => f !== fn);
        }
      }

      terminate() {
        this.terminated = true;
        this.actorRunning = false;
        for (const handle of this.timers.values()) clearTimeout(handle);
        this.timers.clear();
        this.workerInbox.close();
        this.listeners = {};
        this.onmessage = null;
      }
    }

    (globalThis as any).Worker = MockWorker;
  });

  afterAll(() => {
    (globalThis as any).Worker = originalWorker;
    console.log = _originalLog;
    console.error = _originalError;
    console.warn = _originalWarn;
    delete (globalThis as any).currentMainTask;
    delete (globalThis as any).lastMockWorker;
    delete (globalThis as any).actorPostMessageError;
  });

  beforeEach(() => {
    (globalThis as any).currentMainTask = undefined;
    delete (globalThis as any).actorPostMessageError;
    actorCounter = 0;
    main.inbox.clear();
  });

  it("should require a non-empty actor name", () => {
    expect(() => actor("", async (_msg: unknown, state: number) => state, 0)).toThrowError(
      "Actor name must be a non-empty string"
    );
  });



  it("cleans up actor construction when the init transport fails synchronously", () => {
    async function behavior(_msg: any, state: number) {
      return state;
    }

    (globalThis as any).currentMainTask = behavior;
    (globalThis as any).actorPostMessageError = new Error("init transport failed");

    expect(() =>
      actor(nextActorName(), behavior, 0)
    ).toThrowError("init transport failed");

    expect((globalThis as any).lastMockWorker.terminated).toBeTrue();
  });

  it("marks an actor failed when a request cannot be posted to its worker", async () => {
    async function behavior(_msg: any, state: number) {
      return state;
    }

    (globalThis as any).currentMainTask = behavior;
    const a = actor(nextActorName(), behavior, 0);

    (globalThis as any).actorPostMessageError = new Error("request transport failed");
    const pending = main.outbox.request(a, "state", undefined);

    await expectAsync(pending).toBeRejectedWithError("request transport failed");
    const exit = await a.done;
    expect(exit.reason).toBe("error");
    if (exit.reason === "error") {
      expect(exit.error.message).toBe("request transport failed");
    }
    expect(a.running).toBeFalse();
  });

  it("continues one-way bus delivery when one recipient transport fails", async () => {
    const received: string[] = [];

    async function behavior(msg: any, state: number, utils: any) {
      if (msg.kind === "actor-bus") {
        utils.outbox.send("main", "seen", msg.payload);
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;
    const first = actor(nextActorName(), behavior, 0);
    const firstWorker = (globalThis as any).lastMockWorker;
    const second = actor(nextActorName(), behavior, 0);

    const originalPost = firstWorker.postMessage.bind(firstWorker);
    firstWorker.postMessage = (msg: any) => {
      if (msg.type === "notify") throw new Error("first recipient failed");
      return originalPost(msg);
    };

    const seen$ = waitForMainMessage(
      (message) => message.to === "main" && message.topic === "seen" && message.payload === "broadcast",
    );

    main.outbox.publish("work", "broadcast");
    const seen = await seen$;

    expect(seen.payload).toBe("broadcast");
    await main.outbox.stop(second);
  });

  it("preserves stable name routing across supervisor restart construction", async () => {
    async function behavior(msg: any, state: number) {
      return msg === "state" ? state : state;
    }

    (globalThis as any).currentMainTask = behavior;
    const name = nextActorName();
    const supervised = supervisor(
      () => actor(name, behavior, 7),
      { maxRestarts: 1 },
    );

    (globalThis as any).lastMockWorker.emitError(new Error("restart generation"));
    await pause(25);

    expect(supervised.running).toBeTrue();
    expect(await main.outbox.request(name, "state", "state")).toBe(7);

    await main.outbox.stop(name);
  });


  it("actor worker select keeps same-registration send/receive cases from self-matching", async () => {
    async function behavior(msg: any, state: number, utils: any) {
      if (msg !== "check") return state;

      const ch = utils.concurrency.channel();
      const [ctx, cancel] = utils.concurrency.withCancel();

      const pending = utils.concurrency.select([
        utils.concurrency.receive(ch, "receive"),
        utils.concurrency.send(ch, 1, "send"),
      ], ctx);

      await Promise.resolve();
      cancel(new utils.concurrency.ContextCancelledError("worker select cancelled"));

      let rejected = false;
      try {
        await pending;
      } catch (error: any) {
        rejected = error?.message === "worker select cancelled";
      }

      return rejected && ch.tryReceive() === undefined && ch.trySend(2) === false
        ? 1
        : -1;
    }

    (globalThis as any).currentMainTask = behavior;
    const a = actor(nextActorName(), behavior, 0);

    expect(await main.outbox.request(a, "check", "check")).toBe(1);
    await main.outbox.stop(a);
  });

  it("should validate bounded actor mailbox capacity", () => {
    async function behavior(_msg: any, state: number) {
      return state;
    }

    expect(() =>
      actor(nextActorName(), behavior, 0, { capacity: -1 })
    ).toThrowError(/non-negative integer/);

    expect(() =>
      actor(nextActorName(), behavior, 0, { capacity: 1.5 })
    ).toThrowError(/non-negative integer/);
  });

  it("should bound queued actor requests without terminating the actor", async () => {
    async function behavior(msg: number, state: number) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return state + msg;
    }

    (globalThis as any).currentMainTask = behavior;
    const a = actor(nextActorName(), behavior, 0, { capacity: 1 });

    expect(a.mailboxCapacity).toBe(1);
    expect(a.dropped).toBe(0);

    const first = main.outbox.request(a, "add", 1);
    const second = main.outbox.request(a, "add", 2);
    const overflow = main.outbox.request(a, "add", 4);

    await expectAsync(overflow).toBeRejectedWithError(/mailbox capacity exceeded/);
    expect(await first).toBe(1);
    expect(await second).toBe(3);
    expect(a.running).toBeTrue();
    expect(a.dropped).toBe(0);

    await main.outbox.stop(a);
  });

  it("should count one-way messages dropped by a saturated bounded mailbox", async () => {
    async function behavior(_msg: any, state: number) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return state + 1;
    }

    (globalThis as any).currentMainTask = behavior;
    const a = actor(nextActorName(), behavior, 0, { capacity: 1 });

    main.outbox.send(a, "work", 1);
    main.outbox.send(a, "work", 2);
    main.outbox.send(a, "work", 3);

    await pause(10);

    expect(a.running).toBeTrue();
    expect(a.dropped).toBe(1);

    await pause(60);
    await main.outbox.stop(a);
  });

  it("capacity zero allows only direct handoff while behavior is ready", async () => {
    async function behavior(_msg: any, state: number) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return state + 1;
    }

    (globalThis as any).currentMainTask = behavior;
    const a = actor(nextActorName(), behavior, 0, { capacity: 0 });

    const first = main.outbox.request(a, "work", undefined);
    const second = main.outbox.request(a, "work", undefined);

    await expectAsync(second).toBeRejectedWithError(/mailbox capacity exceeded/);
    expect(await first).toBe(1);
    expect(a.running).toBeTrue();

    await main.outbox.stop(a);
  });

  it("should eagerly initialize behavior actor with state", async () => {
    async function behavior(msg: any, state: number) {
      if (msg.kind === "actor-bus" && msg.topic === "inc") return state + 1;
      if (msg.kind === "actor-bus" && msg.topic === "dec") return state - 1;
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(nextActorName(), behavior, 0);
    await new Promise(r => setTimeout(r, 10));
    expect(a.running).toBe(true);

    main.outbox.send(a, "inc", undefined);
    await new Promise(r => setTimeout(r, 10));
    expect(a.running).toBe(true);

    await main.outbox.stop(a);
  });

  it("should process multiple sends and update state", async () => {
    async function behavior(msg: any, state: number) {
      if (msg.kind === "actor-bus" && msg.topic === "add") return state + msg.payload.n;
      if (msg.kind === "actor-bus" && msg.topic === "sub") return state - msg.payload.n;
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(nextActorName(), behavior, 10);
    main.outbox.send(a, "add", { n: 5 });
    main.outbox.send(a, "sub", { n: 3 });
    main.outbox.send(a, "add", { n: 2 });

    const state = await main.outbox.request(a, "add", { n: 0 });
    expect(state).toBe(14);

    await main.outbox.stop(a);
  });

  it("should request and receive updated state", async () => {
    async function behavior(msg: number, state: number) {
      return state + msg;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(nextActorName(), behavior, 0);

    const s1 = await main.outbox.request(a, "add", 5);
    expect(s1).toBe(5);

    const s2 = await main.outbox.request(a, "add", 3);
    expect(s2).toBe(8);

    await main.outbox.stop(a);
  });

  it("should deliver direct bus messages to main listeners", async () => {
    const messages: Array<{ topic: string; payload: string; from?: string }> = [];

    async function behavior(msg: any, state: number, utils: any) {
      if (msg.kind === "actor-bus" && msg.topic === "ping") {
        utils.outbox.send("main", "reply", "pong");
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(nextActorName(), behavior, 0);
    const unsubscribe = main.inbox.subscribe((message: ActorBusMessage<any>) => {
      if (message.to === "main") {
        messages.push({ topic: message.topic, payload: message.payload, from: message.from });
      }
    });

    main.outbox.send(a, "ping", undefined);
    await new Promise(r => setTimeout(r, 20));

    expect(messages).toEqual([{ topic: "reply", payload: "pong", from: a.name }]);
    unsubscribe();
    await main.outbox.stop(a);
  });

  it("should allow unsubscribing from main bus listeners", async () => {
    const messages: string[] = [];

    async function behavior(msg: any, state: number, utils: any) {
      if (msg.kind === "actor-bus" && msg.topic === "ping") {
        utils.outbox.send("main", "reply", "pong");
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(nextActorName(), behavior, 0);
    const unsubscribe = main.inbox.subscribe((message: ActorBusMessage<any>) => {
      if (message.to === "main") {
        messages.push(message.payload);
      }
    });
    unsubscribe();

    main.outbox.send(a, "ping", undefined);
    await new Promise(r => setTimeout(r, 20));

    expect(messages).toEqual([]);
    await main.outbox.stop(a);
  });

  it("should stop behavior actor gracefully", async () => {
    async function behavior(_msg: any, state: number) {
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(nextActorName(), behavior, 0);
    main.outbox.send(a, "anything", undefined);
    await new Promise(r => setTimeout(r, 10));
    expect(a.running).toBe(true);

    await main.outbox.stop(a);
    expect(a.running).toBe(false);
  });

  it("should race cancellable operations inside behavior actor", async () => {
    async function behavior(msg: any, state: number, utils: any) {
      if (msg.kind !== "actor-bus" || msg.topic !== "run") return state;

      const { operation, select } = utils.concurrency;
      let loserAborted = false;

      const result = await select([
        operation(async (signal: AbortSignal) => {
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
      utils.outbox.send("main", "selected", {
        name: result.name,
        loserAborted,
      });
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(nextActorName(), behavior, 0);
    const selected$ = waitForMainMessage(
      (message) => message.to === "main" && message.topic === "selected"
    );

    main.outbox.send(a, "run", undefined);
    const selected = await selected$;

    expect(selected.payload).toEqual({ name: "winner", loserAborted: true });
    await main.outbox.stop(a);
  });

  it("should use concurrency utils inside behavior actor", async () => {
    async function behavior(_msg: any, state: number, utils: any) {
      const { channel: ch, receive, send, select, otherwise } = utils.concurrency;
      const c = ch(2);
      await c.send(1);
      await c.send(2);
      const r1 = await c.receive();
      const r2 = await c.receive();
      const s = send(c, 3, "s");
      const rc = receive(c, "r");
      const sel = await select([s, rc, otherwise("def")]);
      return {
        state,
        r1: r1.ok ? r1.value : undefined,
        r2: r2.ok ? r2.value : undefined,
        selName: sel.name,
      };
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(nextActorName(), behavior as any, 42);
    const result = await main.outbox.request(a, "go", undefined) as any;

    expect(result.state).toBe(42);
    expect(result.r1).toBe(1);
    expect(result.r2).toBe(2);
    expect(["s", "r", "def"]).toContain(result.selName);
    await main.outbox.stop(a);
  });

  it("should reject request after stop", async () => {
    async function behavior(_msg: any, state: number) {
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(nextActorName(), behavior, 0);
    main.outbox.send(a, "x", undefined);
    await new Promise(r => setTimeout(r, 10));

    await main.outbox.stop(a);
    await expectAsync(main.outbox.request(a, "y", undefined)).toBeRejectedWithError("Actor stopped");
  });

  it("should reject in-flight requests when stopped", async () => {
    async function behavior(msg: string, state: number) {
      if (msg === "wait") {
        return new Promise<number>(() => {});
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(nextActorName(), behavior, 0);
    const pending = main.outbox.request(a, "wait", "wait");
    pending.catch(() => {}); // prevent unhandled rejection warning

    await new Promise(r => setTimeout(r, 10));
    await main.outbox.stop(a);

    await expectAsync(pending).toBeRejectedWithError("Actor stopped");
  });

  it("should support direct messages and requests", async () => {
    async function behavior(msg: number, state: number) {
      return state + msg;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(nextActorName(), behavior, 5);

    const state = await main.outbox.request(a, "add", 10);
    expect(state).toBe(15);
    await main.outbox.stop(a);
  });

  it('should call the source actor request handler when worker requests "main"', async () => {
    const onRequest = jasmine.createSpy("onRequest").and.callFake((topic: string, payload: string) => {
      expect(topic).toBe("echo");
      return payload.toUpperCase();
    });

    async function behavior(msg: any, state: number, utils: any) {
      if (msg.kind === "actor-bus") {
        const response = await utils.outbox.request("main", "echo", msg.payload);
        utils.outbox.send("main", "response", response);
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(nextActorName(), behavior, 0);
    const unregister = registerActorRequestHandler("main", onRequest);
    const response$ = waitForMainMessage(
      (message) => message.to === "main" && message.topic === "response"
    );
    main.outbox.send(a, "hello", "hello");
    const response = await response$;

    expect(onRequest).toHaveBeenCalled();
    expect(response.payload).toBe("HELLO");
    unregister();
    await main.outbox.stop(a);
  });

  it("should keep multiple main bus listeners independent", async () => {
    const allMessages: string[] = [];
    const directMessages: string[] = [];

    async function behavior(msg: any, state: number, utils: any) {
      if (msg.kind === "actor-bus" && msg.topic === "go") {
        utils.outbox.send("main", "ping", "ping");
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(nextActorName(), behavior, 0);
    const unsubscribeAll = main.inbox.subscribe((message: ActorBusMessage<any>) => {
      if (message.to === "main" && message.topic === "ping") {
        allMessages.push(message.payload);
      }
    });
    const unsubscribeDirect = main.inbox.subscribe((message: ActorBusMessage<any>) => {
      if (message.to === "main" && message.topic === "ping") {
        directMessages.push(message.payload);
      }
    });

    main.outbox.send(a, "go", undefined);
    await new Promise(r => setTimeout(r, 20));

    expect(allMessages).toEqual(["ping"]);
    expect(directMessages).toEqual(["ping"]);
    unsubscribeAll();
    unsubscribeDirect();
    await main.outbox.stop(a);
  });

  it("should deliver multiple direct bus messages to main in order", async () => {
    const seen: string[] = [];

    async function behavior(msg: any, state: number, utils: any) {
      if (msg.kind === "actor-bus" && msg.topic === "double") {
        utils.outbox.send("main", "step", "first");
        utils.outbox.send("main", "step", "second");
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor("global-source", behavior, 0);
    const unsubscribe = main.inbox.subscribe((message: ActorBusMessage<any>) => {
      if (message.to === "main" && message.topic === "step") {
        seen.push(message.payload);
      }
    });

    main.outbox.send(a, "double", undefined);
    await new Promise(r => setTimeout(r, 20));

    expect(seen).toEqual(["first", "second"]);

    unsubscribe();
    await main.outbox.stop(a);
  });

  it("should route worker requests to named actor request handlers", async () => {
    async function requesterBehavior(msg: any, state: number, utils: any) {
      if (msg.kind === "actor-bus" && msg.topic === "ask") {
        const response = await utils.outbox.request("responder", "greet", "hello");
        utils.outbox.send("main", "response", response);
      }
      return state;
    }

    async function responderBehavior(_msg: unknown, state: number) {
      return state;
    }

    (globalThis as any).currentMainTask = requesterBehavior;

    const requester = actor("requester", requesterBehavior, 0);
    const responder = actor("responder", responderBehavior, 0);
    const unregister = registerActorRequestHandler("responder", (topic: string, payload: string) => {
      expect(topic).toBe("greet");
      return payload.toUpperCase();
    });
    const response$ = waitForMainMessage(
      (message) => message.to === "main" && message.topic === "response"
    );
    main.outbox.send(requester, "ask", undefined);
    const response = await response$;

    expect(response.payload).toBe("HELLO");

    unregister();
    await Promise.all([main.outbox.stop(requester), main.outbox.stop(responder)]);
  });

  it("should target explicit actors through utils.outbox.send", async () => {
    type State = { role: "sender" | "receiver"; hits: number[] };

    async function behavior(msg: unknown, state: State, utils: any) {
      if (state.role === "sender" && isActorBusMessage(msg) && msg.topic === "direct") {
        utils.outbox.send("beta", "direct", 7);
        return state;
      }

      if (state.role === "receiver" && isActorBusMessage<number>(msg) && msg.topic === "direct") {
        return {
          ...state,
          hits: [...state.hits, msg.payload],
        };
      }

      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const senderActor = actor("sender", behavior, { role: "sender", hits: [] });
    const alpha = actor("alpha", behavior, { role: "receiver", hits: [] });
    const beta = actor("beta", behavior, { role: "receiver", hits: [] });

    main.outbox.send(senderActor, "direct", undefined);
    await new Promise(r => setTimeout(r, 20));

    const [alphaState, betaState] = await Promise.all([
      main.outbox.request<unknown, State>(alpha, "read", undefined),
      main.outbox.request<unknown, State>(beta, "read", undefined),
    ]);

    expect(alphaState.hits).toEqual([]);
    expect(betaState.hits).toEqual([7]);

    await Promise.all([main.outbox.stop(senderActor), main.outbox.stop(alpha), main.outbox.stop(beta)]);
  });

  it("should publish from main.bus to every actor", async () => {
    type State = { hits: string[] };

    async function behavior(msg: unknown, state: State) {
      if (isActorBusMessage<string>(msg) && msg.topic === "announce") {
        return {
          hits: [...state.hits, msg.payload],
        };
      }

      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const alpha = actor("alpha", behavior, { hits: [] });
    const beta = actor("beta", behavior, { hits: [] });
    main.outbox.publish("announce", "yes");
    await new Promise(r => setTimeout(r, 20));

    const [alphaState, betaState] = await Promise.all([
      main.outbox.request<unknown, State>("alpha", "read", undefined),
      main.outbox.request<unknown, State>("beta", "read", undefined),
    ]);

    expect(alphaState.hits).toEqual(["yes"]);
    expect(betaState.hits).toEqual(["yes"]);

    await Promise.all([main.outbox.stop(alpha), main.outbox.stop(beta)]);
  });

  it("should deliver published bus messages to global main inbox listeners", async () => {
    const seen: Array<{ topic: string; payload: string; from?: string }> = [];

    async function behavior(_msg: unknown, state: number) {
      return state;
    }


    (globalThis as any).currentMainTask = behavior;

    const alpha = actor("alpha", behavior, 0);
    const unsubscribe = main.inbox.subscribe((message: ActorBusMessage<any>) => {
      seen.push({ topic: message.topic, payload: message.payload, from: message.from });
    });

    main.outbox.publish("announce", "yes");
    await new Promise(r => setTimeout(r, 20));

    expect(seen).toEqual([{ topic: "announce", payload: "yes", from: "main" }]);

    unsubscribe();
    await main.outbox.stop(alpha);
  });

  it("should publish from main.outbox to every actor", async () => {
    type State = { hits: string[] };

    async function behavior(msg: unknown, state: State) {
      if (isActorBusMessage<string>(msg) && msg.topic === "announce") {
        return {
          hits: [...state.hits, msg.payload],
        };
      }

      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const alpha = actor("alpha", behavior, { hits: [] });
    const beta = actor("beta", behavior, { hits: [] });
    main.outbox.publish<string>("announce", "yes");
    await new Promise(r => setTimeout(r, 20));

    const [alphaState, betaState] = await Promise.all([
      main.outbox.request<unknown, State>("alpha", "read", undefined),
      main.outbox.request<unknown, State>("beta", "read", undefined),
    ]);

    expect(alphaState.hits).toEqual(["yes"]);
    expect(betaState.hits).toEqual(["yes"]);

    await Promise.all([main.outbox.stop(alpha), main.outbox.stop(beta)]);
  });

  it("should deliver direct bus messages to main", async () => {
    const seen: Array<{ topic: string; payload: string; from?: string }> = [];

    async function behavior(msg: any, state: number, utils: any) {
      if (msg.kind === "actor-bus" && msg.topic === "report") {
        utils.outbox.send("main", "status", "ready");
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const reporter = actor("reporter", behavior, 0);
    const unsubscribe = main.inbox.subscribe((message: ActorBusMessage<any>) => {
      if (message.to === "main") {
        seen.push({ topic: message.topic, payload: message.payload, from: message.from });
      }
    });

    main.outbox.send("reporter", "report", undefined);
    await new Promise(r => setTimeout(r, 20));

    expect(seen).toEqual([{ topic: "status", payload: "ready", from: "reporter" }]);

    unsubscribe();
    await main.outbox.stop(reporter);
  });

  it("should send direct messages from main.outbox", async () => {
    type State = { hits: number[] };

    async function behavior(msg: unknown, state: State) {
      if (isActorBusMessage<number>(msg) && typeof msg.payload === "number") {
        return {
          hits: [...state.hits, msg.payload],
        };
      }

      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const alpha = actor("alpha", behavior, { hits: [] });
    const beta = actor("beta", behavior, { hits: [] });
    main.outbox.send<number>("beta", "hit", 7);
    await new Promise(r => setTimeout(r, 20));

    const [alphaState, betaState] = await Promise.all([
      main.outbox.request<unknown, State>("alpha", "read", undefined),
      main.outbox.request<unknown, State>("beta", "read", undefined),
    ]);

    expect(alphaState.hits).toEqual([]);
    expect(betaState.hits).toEqual([7]);

    await Promise.all([main.outbox.stop(alpha), main.outbox.stop(beta)]);
  });

  it("should reject requests and stops for unknown actor targets", async () => {
    await expectAsync(main.outbox.request("missing", "topic", 1)).toBeRejectedWithError(
      'Unknown actor target "missing"'
    );
    await expectAsync(main.outbox.stop("missing")).toBeRejectedWithError(
      'Unknown actor target "missing"'
    );
  });

  it("should deduplicate repeated direct send targets", async () => {
    type State = { hits: number[] };

    async function behavior(msg: unknown, state: State) {
      if (isActorBusMessage<number>(msg) && msg.topic === "hit") {
        return { hits: [...state.hits, msg.payload] };
      }

      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const alpha = actor("alpha", behavior, { hits: [] });
    const beta = actor("beta", behavior, { hits: [] });
    const gamma = actor("gamma", behavior, { hits: [] });

    main.outbox.send(["alpha", "beta", "alpha"], "hit", 7);
    await pause();

    const [alphaState, betaState, gammaState] = await Promise.all([
      main.outbox.request<unknown, State>("alpha", "read", undefined),
      main.outbox.request<unknown, State>("beta", "read", undefined),
      main.outbox.request<unknown, State>("gamma", "read", undefined),
    ]);

    expect(alphaState.hits).toEqual([7]);
    expect(betaState.hits).toEqual([7]);
    expect(gammaState.hits).toEqual([]);

    await Promise.all([main.outbox.stop(alpha), main.outbox.stop(beta), main.outbox.stop(gamma)]);
  });

  it("should exclude the sender during publish unless includeSelf is enabled", async () => {
    type State = { hits: string[] };

    async function behavior(msg: unknown, state: State) {
      if (isActorBusMessage<string>(msg) && msg.topic === "announce") {
        return { hits: [...state.hits, msg.payload] };
      }

      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const alpha = actor("alpha", behavior, { hits: [] });
    const beta = actor("beta", behavior, { hits: [] });

    main.outbox.publish("announce", "first", { from: "alpha" });
    main.outbox.publish("announce", "second", { from: "alpha", includeSelf: true });
    await pause();

    const [alphaState, betaState] = await Promise.all([
      main.outbox.request<unknown, State>("alpha", "read", undefined),
      main.outbox.request<unknown, State>("beta", "read", undefined),
    ]);

    expect(alphaState.hits).toEqual(["second"]);
    expect(betaState.hits).toEqual(["first", "second"]);

    await Promise.all([main.outbox.stop(alpha), main.outbox.stop(beta)]);
  });

  it("should swallow async main inbox subscriber failures", async () => {
    const seen: string[] = [];

    async function behavior(msg: any, state: number, utils: any) {
      if (msg.kind === "actor-bus" && msg.topic === "ping") {
        utils.outbox.send("main", "reply", "pong");
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const warn = spyOn(console, "warn");
    const a = actor(nextActorName(), behavior, 0);
    const unsubscribeFailing = main.inbox.subscribe(async (message: ActorBusMessage<any>) => {
      if (message.to === "main") {
        throw new Error("subscriber failed");
      }
    });
    const unsubscribeHealthy = main.inbox.subscribe((message: ActorBusMessage<any>) => {
      if (message.to === "main") {
        seen.push(message.payload);
      }
    });

    main.outbox.send(a, "ping", undefined);
    await pause();

    expect(seen).toEqual(["pong"]);
    expect(warn).toHaveBeenCalled();
    expect(warn.calls.mostRecent().args[0]).toBe("Actor bus subscriber failed:");

    unsubscribeFailing();
    unsubscribeHealthy();
    await main.outbox.stop(a);
  });

  it("should reject worker requests with multiple targets", async () => {
    async function behavior(msg: any, state: number, utils: any) {
      if (msg.kind === "actor-bus" && msg.topic === "go") {
        try {
          await utils.outbox.request(["main", "other"], "echo", "hello");
        } catch (error: any) {
          utils.outbox.send("main", "error", error.message);
        }
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(nextActorName(), behavior, 0);
    const error$ = waitForMainMessage(
      (message) => message.to === "main" && message.topic === "error"
    );
    main.outbox.send(a, "go", undefined);
    const errorMessage = await error$;

    expect(errorMessage.payload).toBe("Actor request requires exactly one target");

    await main.outbox.stop(a);
  });

  it("should reject worker requests without a registered target handler", async () => {
    async function behavior(msg: any, state: number, utils: any) {
      if (msg.kind === "actor-bus" && msg.topic === "go") {
        try {
          await utils.outbox.request("missing", "echo", "hello");
        } catch (error: any) {
          utils.outbox.send("main", "error", error.message);
        }
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(nextActorName(), behavior, 0);
    const error$ = waitForMainMessage(
      (message) => message.to === "main" && message.topic === "error"
    );
    main.outbox.send(a, "go", undefined);
    const errorMessage = await error$;

    expect(errorMessage.payload).toBe('No actor request handler registered for "missing"');

    await main.outbox.stop(a);
  });

  it("should reject worker requests without a topic", async () => {
    async function behavior(msg: any, state: number, utils: any) {
      if (msg.kind === "actor-bus" && msg.topic === "go") {
        try {
          await utils.outbox.request("main", "", "hello");
        } catch (error: any) {
          utils.outbox.send("main", "error", error.message);
        }
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(nextActorName(), behavior, 0);
    const error$ = waitForMainMessage(
      (message) => message.to === "main" && message.topic === "error"
    );
    const unregister = registerActorRequestHandler("main", () => "ok");

    main.outbox.send(a, "go", undefined);
    const errorMessage = await error$;

    expect(errorMessage.payload).toBe("Actor request requires a topic");

    unregister();
    await main.outbox.stop(a);
  });

  it("should convert async worker request handler rejections into error messages", async () => {
    async function behavior(msg: any, state: number, utils: any) {
      if (msg.kind === "actor-bus" && msg.topic === "go") {
        try {
          await utils.outbox.request("main", "echo", "hello");
        } catch (error: any) {
          utils.outbox.send("main", "error", error.message);
        }
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(nextActorName(), behavior, 0);
    const error$ = waitForMainMessage(
      (message) => message.to === "main" && message.topic === "error"
    );
    const unregister = registerActorRequestHandler("main", () => Promise.reject("bad request"));

    main.outbox.send(a, "go", undefined);
    const errorMessage = await error$;

    expect(errorMessage.payload).toBe("bad request");

    unregister();
    await main.outbox.stop(a);
  });

  it("should fall back to a default message for falsy worker request errors", async () => {
    async function behavior(msg: any, state: number, utils: any) {
      if (msg.kind === "actor-bus" && msg.topic === "go") {
        try {
          await utils.outbox.request("main", "echo", "hello");
        } catch (error: any) {
          utils.outbox.send("main", "error", error.message);
        }
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(nextActorName(), behavior, 0);
    const error$ = waitForMainMessage(
      (message) => message.to === "main" && message.topic === "error"
    );
    const unregister = registerActorRequestHandler("main", () => {
      throw undefined;
    });

    main.outbox.send(a, "go", undefined);
    const errorMessage = await error$;

    expect(errorMessage.payload).toBe("Actor request failed");

    unregister();
    await main.outbox.stop(a);
  });
  it("should expose normal actor termination through done", async () => {
    async function behavior(_msg: any, state: number) {
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(nextActorName(), behavior, 0);
    const done = a.done;

    await main.outbox.stop(a);

    expect(await done).toEqual({ reason: "stopped" });
    expect(a.running).toBe(false);
  });

  it("should surface worker failure through done and stop the actor", async () => {
    async function behavior(_msg: any, state: number) {
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(nextActorName(), behavior, 0);
    const failure = new Error("worker crashed");
    const worker = (globalThis as any).lastMockWorker;

    worker.emitError(failure);

    const exit = await a.done;
    expect(exit.reason).toBe("error");
    if (exit.reason === "error") {
      expect(exit.error).toBe(failure);
    }
    expect(a.running).toBe(false);
  });

  it("should settle actor done only once when stop is repeated", async () => {
    async function behavior(_msg: any, state: number) {
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(nextActorName(), behavior, 0);

    await Promise.all([main.outbox.stop(a), main.outbox.stop(a)]);

    expect(await a.done).toEqual({ reason: "stopped" });
  });



  it("cancels in-flight main-to-actor requests without stopping the actor", async () => {
    async function behavior(msg: any, state: number) {
      return typeof msg === "number" ? state + msg : state;
    }

    (globalThis as any).currentMainTask = behavior;
    const a = actor(nextActorName(), behavior, 0);
    const controller = new AbortController();

    const pending = main.outbox.request(a, "slow", 1, controller.signal);
    controller.abort(new ContextCancelledError("request cancelled"));

    await expectAsync(pending).toBeRejectedWithError(ContextCancelledError, "request cancelled");
    expect(a.running).toBe(true);

    await main.outbox.stop(a);
  });


  it("ignores a response correlated to the right request but the wrong actor generation", async () => {
    async function behavior(msg: number, state: number) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return state + msg;
    }

    (globalThis as any).currentMainTask = behavior;
    const a = actor(nextActorName(), behavior, 0);
    const worker = (globalThis as any).lastMockWorker;

    const pending = main.outbox.request<number, number>(a, "add", 5);
    let settled = false;
    pending.finally(() => {
      settled = true;
    });

    const requestMessage = worker.sentMessages.find((message: any) => message.type === "request");
    expect(requestMessage).toBeDefined();

    worker.emitMessage({
      ...requestMessage,
      workerId: requestMessage.workerId + 1000,
      type: "response",
      payload: 999,
    });

    await pause(5);
    expect(settled).toBeFalse();

    await expectAsync(pending).toBeResolvedTo(5);
    await main.outbox.stop(a);
  });

  it("uses a unique protocol identity for every actor generation", async () => {
    async function behavior(_msg: any, state: number) {
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const first = actor(nextActorName(), behavior, 0);
    const firstIdentity = {
      ...(globalThis as any).lastMockWorker.protocolIdentity,
    };

    const second = actor(nextActorName(), behavior, 0);
    const secondIdentity = {
      ...(globalThis as any).lastMockWorker.protocolIdentity,
    };

    expect(secondIdentity.workerId).not.toBe(firstIdentity.workerId);
    expect(secondIdentity.taskId).not.toBe(firstIdentity.taskId);

    await main.outbox.stop(first);
    await main.outbox.stop(second);
  });

  it("does not write an async worker request response into a generation that stopped meanwhile", async () => {
    let resolveHandler!: (value: string) => void;
    const handlerResult = new Promise<string>((resolve) => {
      resolveHandler = resolve;
    });
    const handler = jasmine.createSpy("lateHandler").and.returnValue(handlerResult);

    async function behavior(msg: any, state: number, utils: any) {
      if (msg.kind === "actor-bus" && msg.topic === "lookup") {
        await utils.outbox.request("main", "lookup", msg.payload);
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;
    const a = actor(nextActorName(), behavior, 0);
    const worker = (globalThis as any).lastMockWorker;
    const unregister = registerActorRequestHandler("main", handler);

    main.outbox.send(a, "lookup", "value");
    await pause(10);

    expect(handler).toHaveBeenCalled();
    expect(worker.pendingWorkerRequestCount).toBe(1);

    await main.outbox.stop(a);
    expect(worker.pendingWorkerRequestCount).toBe(0);

    const sentAtStop = worker.sentMessages.length;
    resolveHandler("late result");
    await pause(5);

    expect(worker.sentMessages.length).toBe(sentAtStop);

    unregister();
  });

  it("settles an in-flight main request exactly once when stop races a late response", async () => {
    async function behavior(msg: number, state: number) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return state + msg;
    }

    (globalThis as any).currentMainTask = behavior;
    const a = actor(nextActorName(), behavior, 0);

    let settlements = 0;
    const pending = main.outbox.request<number, number>(a, "add", 1);
    pending.then(
      () => settlements += 1,
      () => settlements += 1,
    );

    await pause(5);
    const stopping = main.outbox.stop(a);

    await expectAsync(pending).toBeRejectedWithError("Actor stopped");
    await stopping;
    await pause(30);

    expect(settlements).toBe(1);
    expect((await a.done).reason).toBe("stopped");
  });


  it("does not admit new worker-to-main requests after actor shutdown begins", async () => {
    const handler = jasmine.createSpy("shutdownHandler").and.returnValue("unexpected");

    async function behavior(msg: any, state: number, utils: any) {
      if (msg.kind === "actor-bus" && msg.topic === "late-request") {
        await new Promise((resolve) => setTimeout(resolve, 20));
        await utils.outbox.request("main", "late", msg.payload);
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;
    const unregister = registerActorRequestHandler("main", handler);
    const a = actor(nextActorName(), behavior, 0);

    main.outbox.send(a, "late-request", "value");
    await pause(5);
    await main.outbox.stop(a);
    await pause(25);

    expect(handler).not.toHaveBeenCalled();
    expect((await a.done).reason).toBe("stopped");

    unregister();
  });

  it("validates supervisor restart-window capacity", () => {
    async function behavior(_msg: any, state: number) {
      return state;
    }

    (globalThis as any).currentMainTask = behavior;
    expect(() => supervisor(
      () => actor(nextActorName(), behavior, 0),
      { capacity: -1 },
    )).toThrowError(/capacity/);
  });


  it("supervisor preserves mailbox drop accounting across generations", async () => {
    async function behavior(_msg: any, state: number) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return state;
    }

    (globalThis as any).currentMainTask = behavior;
    const name = nextActorName();
    const supervised = supervisor(
      () => actor(name, behavior, 0, { capacity: 1 }),
      { maxRestarts: 1 },
    );

    main.outbox.send(supervised, "work", 1);
    main.outbox.send(supervised, "work", 2);
    main.outbox.send(supervised, "work", 3);
    await pause(10);

    expect(supervised.mailboxCapacity).toBe(1);
    expect(supervised.dropped).toBe(1);

    (globalThis as any).lastMockWorker.emitError(new Error("restart"));
    await pause(20);

    expect(supervised.dropped).toBe(1);
    await main.outbox.stop(supervised);
  });

  it("supervisor restarts failed actors behind a stable handle", async () => {
    async function behavior(_msg: any, state: number) {
      return state;
    }

    (globalThis as any).currentMainTask = behavior;
    const name = nextActorName();
    const supervised = supervisor(
      () => actor(name, behavior, 0),
      { maxRestarts: 2 },
    );

    const first = supervised.current;
    expect(first).toBeDefined();
    expect(supervised.name).toBe(name);

    (globalThis as any).lastMockWorker.emitError(new Error("generation failed"));
    await pause(20);

    expect(supervised.restarts).toBe(1);
    expect(supervised.current).toBeDefined();
    expect(supervised.current).not.toBe(first);
    expect(supervised.running).toBe(true);

    await main.outbox.stop(supervised);
    expect((await supervised.done).reason).toBe("stopped");
  });

  it("supervisor stops after exhausting its restart budget", async () => {
    async function behavior(_msg: any, state: number) {
      return state;
    }

    (globalThis as any).currentMainTask = behavior;
    const name = nextActorName();
    const supervised = supervisor(
      () => actor(name, behavior, 0),
      { maxRestarts: 1 },
    );

    (globalThis as any).lastMockWorker.emitError(new Error("first failure"));
    await pause(20);
    expect(supervised.restarts).toBe(1);

    (globalThis as any).lastMockWorker.emitError(new Error("terminal failure"));
    const exit = await supervised.done;

    expect(exit.reason).toBe("error");
    if (exit.reason === "error") {
      expect(exit.error.message).toBe("terminal failure");
    }
    expect(supervised.running).toBe(false);
  });



  it("behavior failure terminates the actor generation", async () => {
    async function behavior(msg: any, state: number) {
      if (msg?.kind === "actor-bus" && msg.topic === "crash") {
        throw new Error("behavior crashed");
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;
    const a = actor(nextActorName(), behavior, 0);

    main.outbox.send(a, "crash", undefined);
    const exit = await a.done;

    expect(exit.reason).toBe("error");
    if (exit.reason === "error") {
      expect(exit.error.message).toBe("behavior crashed");
    }
    expect(a.running).toBeFalse();
  });

  it("supervisor restarts after an unhandled behavior failure", async () => {
    async function behavior(msg: any, state: number) {
      if (msg?.kind === "actor-bus" && msg.topic === "crash") {
        throw new Error("behavior crashed");
      }
      if (msg?.kind === "actor-bus" && msg.topic === "inc") return state + 1;
      return state;
    }

    (globalThis as any).currentMainTask = behavior;
    const name = nextActorName();
    const supervised = supervisor(
      () => actor(name, behavior, 0),
      { maxRestarts: 2 },
    );
    const first = supervised.current;

    main.outbox.send(supervised, "crash", undefined);
    await pause(30);

    expect(supervised.restarts).toBe(1);
    expect(supervised.current).not.toBe(first);
    expect(supervised.running).toBeTrue();

    await main.outbox.stop(supervised);
  });

  it("supervisor buffers bounded restart-window traffic when configured", async () => {
    async function behavior(msg: any, state: number) {
      if (msg?.kind === "actor-bus" && msg.topic === "crash") {
        throw new Error("behavior crashed");
      }
      if (msg?.kind === "actor-bus" && msg.topic === "inc") return state + 1;
      return state;
    }

    (globalThis as any).currentMainTask = behavior;
    const name = nextActorName();
    const supervised = supervisor(
      () => actor(name, behavior, 0),
      { maxRestarts: 2, restartDelay: 25, capacity: 2 },
    );

    main.outbox.send(supervised, "crash", undefined);
    await pause(5);
    expect(supervised.running).toBeFalse();

    main.outbox.send(supervised, "inc", undefined);
    const state$ = main.outbox.request<any, number>(supervised, "state", undefined);
    expect(supervised.pending).toBe(2);

    expect(await state$).toBe(1);
    expect(supervised.pending).toBe(0);
    expect(supervised.capacity).toBe(2);

    await main.outbox.stop(supervised);
  });

  it("supervisor rejects restart-window ingress beyond capacity", async () => {
    async function behavior(msg: any, state: number) {
      if (msg?.kind === "actor-bus" && msg.topic === "crash") {
        throw new Error("behavior crashed");
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;
    const name = nextActorName();
    const supervised = supervisor(
      () => actor(name, behavior, 0),
      { maxRestarts: 1, restartDelay: 25, capacity: 1 },
    );

    main.outbox.send(supervised, "crash", undefined);
    await pause(5);

    const first = main.outbox.request(supervised, "first", undefined);
    await expectAsync(
      main.outbox.request(supervised, "overflow", undefined)
    ).toBeRejectedWithError(/capacity exceeded/);

    await expectAsync(first).toBeResolved();
    await main.outbox.stop(supervised);
  });

  it("cancels a request while it is buffered for supervisor restart", async () => {
    async function behavior(msg: any, state: number) {
      if (msg?.kind === "actor-bus" && msg.topic === "crash") {
        throw new Error("behavior crashed");
      }
      if (typeof msg === "number") return state + msg;
      return state;
    }

    (globalThis as any).currentMainTask = behavior;
    const name = nextActorName();
    const supervised = supervisor(
      () => actor(name, behavior, 0),
      { maxRestarts: 1, restartDelay: 25, capacity: 2 },
    );

    main.outbox.send(supervised, "crash", undefined);
    await pause(5);

    const controller = new AbortController();
    const pending = main.outbox.request(supervised, "add", 5, controller.signal);
    expect(supervised.pending).toBe(1);
    controller.abort(new ContextCancelledError("cancel buffered request"));

    await expectAsync(pending).toBeRejectedWithError(ContextCancelledError, "cancel buffered request");
    expect(supervised.pending).toBe(0);

    await pause(35);
    expect(await main.outbox.request(supervised, "state", undefined)).toBe(0);
    await main.outbox.stop(supervised);
  });


  it("rejects replacement generations that change the supervised actor name", async () => {
    async function behavior(msg: any, state: number) {
      return msg === "state" ? state : state;
    }

    (globalThis as any).currentMainTask = behavior;
    const name = nextActorName();
    const wrongName = `${name}-wrong`;
    let generations = 0;

    const supervised = supervisor(
      () => {
        generations += 1;
        if (generations === 2) return actor(wrongName, behavior, 99);
        return actor(name, behavior, 7);
      },
      { maxRestarts: 2 },
    );

    (globalThis as any).lastMockWorker.emitError(new Error("restart"));
    await pause(35);

    expect(generations).toBe(3);
    expect(supervised.restarts).toBe(2);
    expect(supervised.running).toBeTrue();
    expect(await main.outbox.request(name, "state", "state")).toBe(7);
    await expectAsync(main.outbox.request(wrongName, "state", "state")).toBeRejectedWithError(
      /Unknown actor target/,
    );

    await main.outbox.stop(supervised);
  });

  it("keeps lifecycle observation attached when buffered ingress fails during restart flush", async () => {
    async function behavior(msg: any, state: number) {
      return msg === "state" ? state : state;
    }

    (globalThis as any).currentMainTask = behavior;
    const name = nextActorName();
    const supervised = supervisor(
      () => actor(name, behavior, 11),
      { maxRestarts: 2, restartDelay: 10, capacity: 1 },
    );

    (globalThis as any).lastMockWorker.emitError(new Error("first generation failed"));
    await pause(2);
    main.outbox.send(supervised, "queued", "value");
    expect(supervised.pending).toBe(1);

    (globalThis as any).actorPostMessageError = (msg: any) =>
      msg.type === "notify" ? new Error("flush transport failed") : undefined;

    await pause(35);
    delete (globalThis as any).actorPostMessageError;

    expect(supervised.restarts).toBe(2);
    expect(supervised.running).toBeTrue();
    expect(supervised.pending).toBe(0);
    expect(await main.outbox.request(supervised, "state", "state")).toBe(11);

    await main.outbox.stop(supervised);
  });

  it("supervisor retries replacement factory failures within the restart budget", async () => {
    async function behavior(_msg: any, state: number) {
      return state;
    }

    (globalThis as any).currentMainTask = behavior;
    const name = nextActorName();
    let generations = 0;
    const supervised = supervisor(
      () => {
        generations += 1;
        if (generations === 2) throw new Error("replacement creation failed");
        return actor(name, behavior, 0);
      },
      { maxRestarts: 2 },
    );

    (globalThis as any).lastMockWorker.emitError(new Error("generation failed"));
    await pause(30);

    expect(generations).toBe(3);
    expect(supervised.restarts).toBe(2);
    expect(supervised.running).toBeTrue();

    await main.outbox.stop(supervised);
  });


});