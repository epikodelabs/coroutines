import {
  actor,
  ActorBusMessage,
  background,
  channel,
  ContextCancelledError,
  isActorBusMessage,
  main,
  otherwise,
  receive,
  registerActorRequestHandler,
  select,
  send,
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
      private workerInbox = channel<any>();
      private busInbox = channel<any>();
      private actorState: any = undefined;
      private actorRunning = false;
      private workerId = 1;
      private taskId = "";
      private pendingWorkerRequests = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }>();
      private requestCounter = 0;

      constructor(_url: string, _options?: any) {
        this.workerId = Math.floor(Math.random() * 100000);
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
            listen: (signal?: AbortSignal) => this.busInbox.receive(signal),
          },
          concurrency: {
            channel,
            receive,
            send,
            otherwise,
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
          const envelope = await this.workerInbox.receive();
          if (!envelope) break;

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
            if (requestId) {
              const event = {
                data: { workerId: this.workerId, taskId: this.taskId, requestId, type: "error", error: err.message }
              } as any;
              this.onmessage?.(event);
              this.listeners["message"]?.forEach(fn => fn(event));
            } else {
              const event = {
                data: { workerId: this.workerId, taskId: this.taskId, type: "notify", payload: { type: "error", error: err.message } }
              } as any;
              this.onmessage?.(event);
              this.listeners["message"]?.forEach(fn => fn(event));
            }
          }
        }

        this.actorRunning = false;
        const stoppedEvent = { data: { workerId: this.workerId, taskId: this.taskId, type: "stopped" } } as any;
        this.onmessage?.(stoppedEvent);
        this.listeners["message"]?.forEach(fn => fn(stoppedEvent));
      }

      postMessage(msg: any) {
        setTimeout(() => {
          if (this.terminated) return;

          if (msg.type === "init") {
            this.taskId = msg.taskId;
            this.actorState = msg.payload;
            this.actorRunning = true;
            this.runBehaviorLoop(msg);
          } else if (msg.type === "stop") {
            this.actorRunning = false;
            this.workerInbox.close();
            this.busInbox.close();
          } else if (msg.type === "notify") {
            this.workerInbox.send(msg.payload).catch(() => {});
            if (msg.payload && typeof msg.payload === "object" && msg.payload.kind === "actor-bus") {
              this.busInbox.send(msg.payload).catch(() => {});
            }
          } else if (msg.type === "request" && msg.requestId) {
            this.workerInbox.send({ msg: msg.payload, requestId: msg.requestId, topic: msg.topic }).catch(() => {});
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
  });

  beforeEach(() => {
    (globalThis as any).currentMainTask = undefined;
    actorCounter = 0;
    main.inbox.clear();
  });

  it("should require a non-empty actor name", () => {
    expect(() => actor("", async (_msg: unknown, state: number) => state, 0)).toThrowError(
      "Actor name must be a non-empty string"
    );
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
      return { state, r1, r2, selName: sel.name };
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
});
