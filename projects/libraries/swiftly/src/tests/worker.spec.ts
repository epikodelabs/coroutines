import {
  createDefaultMessageHandler,
  generateTaskId,
  type PendingTaskMap,
  type WorkerProtocolMessage,
} from "../lib/worker";
import { createTaskPool } from "../lib/worker/pool";
import { idescribe } from "./env.spec";

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

class MockWorker {
  static instances: MockWorker[] = [];
  static postMessageError: unknown = null;

  readonly listeners: Array<(event: MessageEvent<WorkerProtocolMessage>) => void> = [];
  readonly sentMessages: WorkerProtocolMessage[] = [];
  terminated = false;
  __id?: number;

  constructor(_url: string, _options?: WorkerOptions) {
    MockWorker.instances.push(this);
  }

  addEventListener(_type: string, listener: (event: MessageEvent<WorkerProtocolMessage>) => void) {
    this.listeners.push(listener);
  }

  removeEventListener(_type: string, listener: (event: MessageEvent<WorkerProtocolMessage>) => void) {
    const index = this.listeners.indexOf(listener);
    if (index >= 0) {
      this.listeners.splice(index, 1);
    }
  }

  postMessage(message: WorkerProtocolMessage) {
    if (MockWorker.postMessageError !== null) {
      throw MockWorker.postMessageError;
    }

    this.sentMessages.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  dispatch(message: WorkerProtocolMessage) {
    const event = { data: message } as MessageEvent<WorkerProtocolMessage>;
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }
}

idescribe("worker helpers", () => {
  let originalWorker: any;
  let originalHardwareConcurrency: PropertyDescriptor | undefined;
  let warnSpy: jasmine.Spy;

  beforeAll(() => {
    originalWorker = (globalThis as any).Worker;
    (globalThis as any).Worker = MockWorker;
  });

  beforeEach(() => {
    MockWorker.instances.length = 0;
    MockWorker.postMessageError = null;
    warnSpy = spyOn(console, "warn");
    originalHardwareConcurrency = Object.getOwnPropertyDescriptor(
      navigator,
      "hardwareConcurrency"
    );
  });

  afterEach(() => {
    if (originalHardwareConcurrency) {
      Object.defineProperty(navigator, "hardwareConcurrency", originalHardwareConcurrency);
    }
  });

  afterAll(() => {
    (globalThis as any).Worker = originalWorker;
  });

  describe("createDefaultMessageHandler", () => {
    it("resolves and rejects pending tasks, including fallback worker errors", async () => {
      const pendingTasks: PendingTaskMap = new Map();
      const worker = {} as Worker;
      const handler = createDefaultMessageHandler(worker, pendingTasks);

      let resolvedValue: unknown;
      let rejectedError: Error | undefined;
      pendingTasks.set("ok", {
        workerId: 1,
        resolve: (value) => {
          resolvedValue = value;
        },
        reject: () => fail("response should not reject"),
      });
      pendingTasks.set("bad", {
        workerId: 1,
        resolve: () => fail("error should not resolve"),
        reject: (error) => {
          rejectedError = error;
        },
      });

      handler({ data: { workerId: 1, taskId: "ok", type: "response", payload: 42 } } as any);
      handler({ data: { workerId: 1, taskId: "bad", type: "error", error: "   " } } as any);
      handler({ data: { workerId: 1, taskId: "missing", type: "response", payload: 99 } } as any);

      expect(resolvedValue).toBe(42);
      expect(rejectedError?.message).toBe("Unknown worker error");
      expect(pendingTasks.has("ok")).toBeFalse();
      expect(pendingTasks.has("bad")).toBeFalse();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("routes request and notify hooks and warns when hooks fail or are missing", async () => {
      const pendingTasks: PendingTaskMap = new Map();
      const worker = {} as Worker;
      const onRequest = jasmine.createSpy("onRequest").and.resolveTo();
      const onWorkerMessage = jasmine.createSpy("onWorkerMessage").and.resolveTo();
      const handler = createDefaultMessageHandler(worker, pendingTasks, {
        onRequest,
        onWorkerMessage,
      });

      const requestMessage = { workerId: 1, taskId: "r", type: "request", payload: "rq" } as const;
      const notifyMessage = { workerId: 1, taskId: "n", type: "notify", payload: "nt" } as const;

      handler({ data: requestMessage } as any);
      handler({ data: notifyMessage } as any);
      await flush();

      expect(onRequest).toHaveBeenCalledWith(requestMessage);
      expect(onWorkerMessage).toHaveBeenCalledWith(notifyMessage);

      const failingHandler = createDefaultMessageHandler(worker, pendingTasks, {
        onRequest: async () => {
          throw new Error("request hook boom");
        },
        onWorkerMessage: async () => {
          throw new Error("notify hook boom");
        },
      });

      failingHandler({ data: requestMessage } as any);
      failingHandler({ data: notifyMessage } as any);
      await flush();

      const defaultHandler = createDefaultMessageHandler(worker, pendingTasks);
      defaultHandler({ data: requestMessage } as any);
      defaultHandler({ data: notifyMessage } as any);
      defaultHandler({ data: { workerId: 1, taskId: "u", type: "stopped" } } as any);

      expect(warnSpy.calls.allArgs().map(args => String(args[0]))).toEqual([
        "Worker request hook failed:",
        "Worker message hook failed:",
        "Unhandled worker request:",
        "Unhandled worker message:",
        "Unknown message type from worker:",
      ]);
    });
  });

  describe("createTaskPool", () => {
    it("reuses a busy worker for queued runs when max workers is reached", async () => {
      Object.defineProperty(navigator, "hardwareConcurrency", {
        value: 1,
        configurable: true,
      });

      const pool = createTaskPool<number, number>({
        name: "pool",
        main: (value: number) => value,
        functions: [],
        generateWorkerScript: () => "worker-script",
      });

      const firstRun = pool.run(1);
      await flush();

      const worker = MockWorker.instances[0];
      expect(worker.sentMessages.length).toBe(1);

      const secondRun = pool.run(2);
      await flush();

      expect(MockWorker.instances.length).toBe(1);
      expect(worker.sentMessages.length).toBe(1);

      const firstMessage = worker.sentMessages[0];
      worker.dispatch({ ...firstMessage, type: "response", payload: 10 });
      await flush();

      expect(worker.sentMessages.length).toBe(2);

      const secondMessage = worker.sentMessages[1];
      worker.dispatch({ ...secondMessage, type: "response", payload: 20 });

      await expectAsync(firstRun).toBeResolvedTo(10);
      await expectAsync(secondRun).toBeResolvedTo(20);
      await pool.dispose();
    });

    it("wraps worker construction and postMessage failures as errors", async () => {
      const originalWorkerCtor = (globalThis as any).Worker;

      class ThrowingWorker {
        constructor() {
          throw "worker ctor boom";
        }
      }

      (globalThis as any).Worker = ThrowingWorker;

      const ctorPool = createTaskPool<number, number>({
        name: "ctor-pool",
        main: (value: number) => value,
        functions: [],
        generateWorkerScript: () => "worker-script",
      });

      await expectAsync(ctorPool.run(1)).toBeRejectedWithError("worker ctor boom");
      await ctorPool.dispose();

      class ThrowingErrorWorker {
        constructor() {
          throw new Error("worker ctor error");
        }
      }

      (globalThis as any).Worker = ThrowingErrorWorker;

      const errorCtorPool = createTaskPool<number, number>({
        name: "ctor-error-pool",
        main: (value: number) => value,
        functions: [],
        generateWorkerScript: () => "worker-script",
      });

      await expectAsync(errorCtorPool.run(1)).toBeRejectedWithError("worker ctor error");
      await errorCtorPool.dispose();

      (globalThis as any).Worker = originalWorkerCtor;

      MockWorker.postMessageError = new Error("postMessage boom");
      const postPool = createTaskPool<number, number>({
        name: "post-pool",
        main: (value: number) => value,
        functions: [],
        generateWorkerScript: () => "worker-script",
      });

      await expectAsync(postPool.run(1)).toBeRejectedWithError("postMessage boom");
      await postPool.dispose();
    });

    it("rejects active and queued work when disposed, and rejects new runs after finalization", async () => {
      Object.defineProperty(navigator, "hardwareConcurrency", {
        value: 1,
        configurable: true,
      });

      const pool = createTaskPool<number, number>({
        name: "finalizing-pool",
        main: (value: number) => value,
        functions: [],
        generateWorkerScript: () => "worker-script",
      });

      const active = pool.run(1);
      await flush();
      const queued = pool.run(2);

      await pool.dispose();

      await expectAsync(active).toBeRejectedWithError(
        "finalizing-pool finalized before the worker task completed"
      );
      await expectAsync(queued).toBeRejectedWithError(
        "finalizing-pool finalized before a worker became available"
      );
      await expectAsync(pool.run(3)).toBeRejectedWithError(
        "finalizing-pool is finalizing"
      );
      expect(warnSpy).toHaveBeenCalledWith("Worker not found.");
    });

    it("uses a custom message handler and treats dispose as idempotent", async () => {
      const createMessageHandler = jasmine
        .createSpy("createMessageHandler")
        .and.callFake((_worker: Worker, pendingTasks: PendingTaskMap) =>
          createDefaultMessageHandler({} as Worker, pendingTasks)
        );

      const pool = createTaskPool<number, number>({
        name: "custom-handler-pool",
        main: (value: number) => value,
        functions: [],
        generateWorkerScript: () => "worker-script",
        createMessageHandler,
      });

      const pending = pool.run(5);
      await flush();

      const worker = MockWorker.instances[0];
      const message = worker.sentMessages[0];
      worker.dispatch({ ...message, type: "response", payload: 50 });

      await expectAsync(pending).toBeResolvedTo(50);
      expect(createMessageHandler).toHaveBeenCalled();

      await pool.dispose();
      await pool.dispose();
    });
  });

  describe("generateTaskId", () => {
    it("uses crypto.randomUUID when available and falls back otherwise", () => {
      const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
      const randomUUID = crypto.randomUUID;

      spyOn(crypto, "randomUUID").and.returnValue("uuid-value" as any);
      expect(generateTaskId()).toBe("uuid-value");

      if (cryptoDescriptor?.configurable) {
        Object.defineProperty(globalThis, "crypto", {
          value: { ...crypto, randomUUID: undefined },
          configurable: true,
        });
      } else {
        Object.defineProperty(crypto, "randomUUID", {
          value: undefined,
          configurable: true,
        });
      }

      const fallback = generateTaskId();
      expect(fallback).toContain("-");

      if (cryptoDescriptor?.configurable) {
        Object.defineProperty(globalThis, "crypto", cryptoDescriptor);
      } else {
        Object.defineProperty(crypto, "randomUUID", {
          value: randomUUID,
          configurable: true,
        });
      }
    });
  });
});
