import {
  createDefaultMessageHandler,
  generateTaskId,
  type PendingTaskMap,
  type WorkerProtocolMessage,
} from "../lib/worker";
import { createTaskPool } from "../lib/worker/pool";
import { createTaskRunner } from "../lib/worker/runner";
import { scheduleWorkerTimer } from "../lib/worker/timer";
import { idescribe } from "./env.spec";

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

class MockWorker {
  static instances: MockWorker[] = [];
  static postMessageError: unknown = null;

  onmessage: ((event: MessageEvent<any>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  private timers = new Map<number, ReturnType<typeof setTimeout>>();

  readonly listeners = new Map<string, Array<(event: any) => void>>();
  readonly sentMessages: WorkerProtocolMessage[] = [];
  readonly sentTransfers: Transferable[][] = [];
  terminated = false;
  __id?: number;

  constructor(_url: string, _options?: WorkerOptions) {
    MockWorker.instances.push(this);
  }

  addEventListener(type: string, listener: (event: any) => void) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: any) => void) {
    const listeners = this.listeners.get(type);
    if (!listeners) return;
    const index = listeners.indexOf(listener);
    if (index >= 0) listeners.splice(index, 1);
  }

  postMessage(message: WorkerProtocolMessage | any, transfer: Transferable[] = []) {
    if (MockWorker.postMessageError !== null) {
      throw MockWorker.postMessageError;
    }

    this.sentMessages.push(message);
    this.sentTransfers.push([...transfer]);

    if (message?.type === "set" && typeof message.id === "number") {
      const handle = setTimeout(() => {
        this.timers.delete(message.id);
        this.onmessage?.({
          data: { type: "elapsed", id: message.id },
        } as MessageEvent<any>);
      }, message.ms);
      this.timers.set(message.id, handle);
    } else if (message?.type === "clear" && typeof message.id === "number") {
      const handle = this.timers.get(message.id);
      if (handle !== undefined) {
        clearTimeout(handle);
        this.timers.delete(message.id);
      }
    }
  }

  terminate() {
    this.terminated = true;
    for (const handle of this.timers.values()) clearTimeout(handle);
    this.timers.clear();
    this.onmessage = null;
    this.onerror = null;
  }

  dispatch(message: WorkerProtocolMessage) {
    const event = { data: message } as MessageEvent<WorkerProtocolMessage>;
    for (const listener of [...(this.listeners.get("message") || [])]) {
      listener(event);
    }
  }

  dispatchError(error: unknown, message = "worker failed") {
    const event = {
      error,
      message,
    } as ErrorEvent;
    for (const listener of [...(this.listeners.get("error") || [])]) {
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


  describe("worker script ownership", () => {
    it("acquires blob URLs lazily and releases them only after worker use", async () => {
      const createUrl = spyOn(URL, "createObjectURL").and.returnValue("blob:swiftly-lazy");
      const revokeUrl = spyOn(URL, "revokeObjectURL");

      const unused = createTaskRunner<number, number>({
        name: "unused-runner",
        main: (value: number) => value,
        functions: [],
        generateWorkerScript: () => "unused-lazy-worker-script",
      });

      expect(createUrl).not.toHaveBeenCalled();
      await unused.dispose();
      expect(createUrl).not.toHaveBeenCalled();
      expect(revokeUrl).not.toHaveBeenCalled();

      const used = createTaskRunner<number, number>({
        name: "used-runner",
        main: (value: number) => value,
        functions: [],
        generateWorkerScript: () => "used-lazy-worker-script",
      });
      const pending = used.run(1);
      await flush();

      expect(createUrl).toHaveBeenCalledTimes(1);
      const worker = MockWorker.instances[MockWorker.instances.length - 1];
      const message = worker.sentMessages[0];
      worker.dispatch({ ...message, type: "response", payload: 1 });
      await expectAsync(pending).toBeResolvedTo(1);
      await used.close();

      expect(revokeUrl).toHaveBeenCalledWith("blob:swiftly-lazy");
    });

    it("does not acquire a compute-pool blob until its first admitted run", async () => {
      const createUrl = spyOn(URL, "createObjectURL").and.returnValue("blob:swiftly-pool-lazy");
      const revokeUrl = spyOn(URL, "revokeObjectURL");

      const pool = createTaskPool<number, number>({
        name: "lazy-pool",
        concurrency: 1,
        main: (value: number) => value,
        functions: [],
        generateWorkerScript: () => "lazy-pool-worker-script",
      });

      expect(createUrl).not.toHaveBeenCalled();
      const pending = pool.run(2);
      await flush();
      expect(createUrl).toHaveBeenCalledTimes(1);

      const worker = MockWorker.instances[MockWorker.instances.length - 1];
      const message = worker.sentMessages[0];
      worker.dispatch({ ...message, type: "response", payload: 2 });
      await expectAsync(pending).toBeResolvedTo(2);
      await pool.close();

      expect(revokeUrl).toHaveBeenCalledWith("blob:swiftly-pool-lazy");
    });
  });

  describe("createTaskRunner", () => {
    it("rejects the active task on worker failure and recreates the worker for queued work", async () => {
      const runner = createTaskRunner<number, number>({
        name: "runner",
        main: (value: number) => value,
        functions: [],
        generateWorkerScript: () => "runner-worker-script",
      });

      const failedRun = runner.run(1);
      const queuedRun = runner.run(2);
      await flush();

      const failedWorker = MockWorker.instances[0];
      failedWorker.dispatchError(new Error("runner boom"));

      await expectAsync(failedRun).toBeRejectedWithError("runner boom");
      await flush();
      expect(failedWorker.terminated).toBeTrue();
      expect(MockWorker.instances.length).toBe(2);

      const replacement = MockWorker.instances[1];
      const message = replacement.sentMessages[0];
      replacement.dispatch({ ...message, type: "response", payload: 20 });

      await expectAsync(queuedRun).toBeResolvedTo(20);
      await runner.dispose();
    });


    it("continues graceful runner draining after the active worker fails", async () => {
      const runner = createTaskRunner<number, number>({
        name: "closing-failure-runner",
        main: (value: number) => value,
        functions: [],
        generateWorkerScript: () => "runner-worker-script",
      });

      const active = runner.run(1);
      const queued = runner.run(2);
      await flush();

      const closing = runner.close();
      const failedWorker = MockWorker.instances[0];
      failedWorker.dispatchError(new Error("active failed during close"));

      await expectAsync(active).toBeRejectedWithError("active failed during close");
      await flush();

      expect(MockWorker.instances.length).toBe(2);
      const replacement = MockWorker.instances[1];
      replacement.dispatch({
        ...replacement.sentMessages[0],
        type: "response",
        payload: 20,
      });

      await expectAsync(queued).toBeResolvedTo(20);
      await expectAsync(closing).toBeResolved();
      expect(replacement.terminated).toBeTrue();
    });

    it("allows dispose to escalate a runner that is already closing", async () => {
      const runner = createTaskRunner<number, number>({
        name: "close-dispose-runner",
        main: (value: number) => value,
        functions: [],
        generateWorkerScript: () => "runner-worker-script",
      });

      const active = runner.run(1);
      const queued = runner.run(2);
      await flush();
      const worker = MockWorker.instances[0];

      const closing = runner.close();
      await runner.dispose();

      await expectAsync(active).toBeRejectedWithError(/disposed/);
      await expectAsync(queued).toBeRejectedWithError(/disposed/);
      await expectAsync(closing).toBeResolved();
      expect(worker.terminated).toBeTrue();
    });

    it("cancels an active task, terminates its worker, and continues queued work", async () => {
      const runner = createTaskRunner<number, number>({
        name: "cancellable-runner",
        main: (value: number) => value,
        functions: [],
        generateWorkerScript: () => "runner-worker-script",
      });

      const controller = new AbortController();
      const cancelled = runner.run(1, controller.signal);
      const queued = runner.run(2);
      await flush();

      const firstWorker = MockWorker.instances[0];
      controller.abort(new Error("cancel active"));

      await expectAsync(cancelled).toBeRejectedWithError("cancel active");
      await flush();
      expect(firstWorker.terminated).toBeTrue();
      expect(MockWorker.instances.length).toBe(2);

      const replacement = MockWorker.instances[1];
      const message = replacement.sentMessages[0];
      replacement.dispatch({ ...message, type: "response", payload: 22 });
      await expectAsync(queued).toBeResolvedTo(22);

      await runner.dispose();
    });

    it("passes transfer ownership only when a queued runner task is posted", async () => {
      const runner = createTaskRunner<ArrayBuffer, number>({
        name: "transfer-runner",
        main: (value: ArrayBuffer) => value.byteLength,
        functions: [],
        generateWorkerScript: () => "runner-worker-script",
      });

      const firstBuffer = new ArrayBuffer(8);
      const secondBuffer = new ArrayBuffer(16);
      const controller = new AbortController();

      const first = runner.run(firstBuffer, { transfer: [firstBuffer] });
      await flush();
      const worker = MockWorker.instances[0];
      expect(worker.sentTransfers[0]).toEqual([firstBuffer]);

      const second = runner.run(secondBuffer, {
        signal: controller.signal,
        transfer: [secondBuffer],
      });
      controller.abort(new Error("cancel before transfer"));
      await expectAsync(second).toBeRejectedWithError("cancel before transfer");
      expect(worker.sentMessages.length).toBe(1);

      const message = worker.sentMessages[0];
      worker.dispatch({ ...message, type: "response", payload: 8 });
      await expectAsync(first).toBeResolvedTo(8);
      await runner.dispose();
    });



    it("schedules queued runner work by priority while preserving FIFO ties", async () => {
      const runner = createTaskRunner<number, number>({
        name: "priority-runner",
        main: (value: number) => value,
        functions: [],
        generateWorkerScript: () => "runner-worker-script",
      });

      const active = runner.run(1);
      await flush();
      const worker = MockWorker.instances[0];

      const low = runner.run(2, { priority: -1 });
      const highA = runner.run(3, { priority: 10 });
      const highB = runner.run(4, { priority: 10 });

      const firstMessage = worker.sentMessages[0];
      worker.dispatch({ ...firstMessage, type: "response", payload: 1 });
      await expectAsync(active).toBeResolvedTo(1);
      await flush();

      expect(worker.sentMessages[1].payload).toBe(3);
      worker.dispatch({ ...worker.sentMessages[1], type: "response", payload: 3 });
      await expectAsync(highA).toBeResolvedTo(3);
      await flush();

      expect(worker.sentMessages[2].payload).toBe(4);
      worker.dispatch({ ...worker.sentMessages[2], type: "response", payload: 4 });
      await expectAsync(highB).toBeResolvedTo(4);
      await flush();

      expect(worker.sentMessages[3].payload).toBe(2);
      worker.dispatch({ ...worker.sentMessages[3], type: "response", payload: 2 });
      await expectAsync(low).toBeResolvedTo(2);

      await runner.dispose();
    });


    it("prevents starvation of low-priority runner work under sustained priority pressure", async () => {
      const runner = createTaskRunner<number, number>({
        name: "fair-runner",
        main: (value: number) => value,
        functions: [],
        generateWorkerScript: () => "runner-worker-script",
      });

      const active = runner.run(0);
      await flush();
      const worker = MockWorker.instances[0];

      const low = runner.run(-1, { priority: -1000 });
      const high = Array.from({ length: 40 }, (_, index) =>
        runner.run(index + 1, { priority: 1000 })
      );

      worker.dispatch({ ...worker.sentMessages[0], type: "response", payload: 0 });
      await active;

      for (let index = 1; index <= 32; index++) {
        await flush();
        expect(worker.sentMessages[index].payload).toBe(index);
        worker.dispatch({
          ...worker.sentMessages[index],
          type: "response",
          payload: index,
        });
        await high[index - 1];
      }

      await flush();
      expect(worker.sentMessages[33].payload).toBe(-1);
      worker.dispatch({
        ...worker.sentMessages[33],
        type: "response",
        payload: -1,
      });
      await expectAsync(low).toBeResolvedTo(-1);

      await runner.dispose();
      for (const pending of high.slice(32)) {
        await expectAsync(pending).toBeRejected();
      }
    });

    it("removes cancelled priority work without disturbing remaining order", async () => {
      const runner = createTaskRunner<number, number>({
        name: "priority-cancel-runner",
        main: (value: number) => value,
        functions: [],
        generateWorkerScript: () => "runner-worker-script",
      });

      const active = runner.run(1);
      await flush();
      const worker = MockWorker.instances[0];
      const controller = new AbortController();

      const cancelled = runner.run(2, { signal: controller.signal, priority: 100 });
      const next = runner.run(3, { priority: 10 });
      controller.abort(new Error("cancel priority item"));

      await expectAsync(cancelled).toBeRejectedWithError("cancel priority item");
      worker.dispatch({ ...worker.sentMessages[0], type: "response", payload: 1 });
      await expectAsync(active).toBeResolvedTo(1);
      await flush();

      expect(worker.sentMessages[1].payload).toBe(3);
      worker.dispatch({ ...worker.sentMessages[1], type: "response", payload: 3 });
      await expectAsync(next).toBeResolvedTo(3);

      await runner.dispose();
    });

    it("removes cancelled work while it is still queued", async () => {
      const runner = createTaskRunner<number, number>({
        name: "queued-cancellation-runner",
        main: (value: number) => value,
        functions: [],
        generateWorkerScript: () => "runner-worker-script",
      });

      const active = runner.run(1);
      await flush();
      const controller = new AbortController();
      const queued = runner.run(2, controller.signal);
      controller.abort(new Error("cancel queued"));

      await expectAsync(queued).toBeRejectedWithError("cancel queued");

      const worker = MockWorker.instances[0];
      const message = worker.sentMessages[0];
      worker.dispatch({ ...message, type: "response", payload: 11 });
      await expectAsync(active).toBeResolvedTo(11);
      expect(worker.sentMessages.length).toBe(1);

      await runner.dispose();
    });
  });



    it("rejects non-finite scheduling priorities", async () => {
      const runner = createTaskRunner<number, number>({
        name: "priority-validation-runner",
        main: (value: number) => value,
        functions: [],
        generateWorkerScript: () => "runner-worker-script",
      });

      expect(() => runner.run(1, { priority: Number.POSITIVE_INFINITY }))
        .toThrowError(/priority must be a finite number/);
      await runner.dispose();
    });

  describe("createTaskPool", () => {


    it("schedules saturated pool waiters by priority and preserves FIFO ties", async () => {
      Object.defineProperty(navigator, "hardwareConcurrency", {
        value: 1,
        configurable: true,
      });

      const pool = createTaskPool<number, number>({
        name: "priority-pool",
        concurrency: 1,
        maxQueued: 4,
        main: (value: number) => value,
        functions: [],
        generateWorkerScript: () => "worker-script",
      });

      const active = pool.run(1);
      await flush();
      const worker = MockWorker.instances[0];

      const low = pool.run(2, { priority: -1 });
      const highA = pool.run(3, { priority: 5 });
      const highB = pool.run(4, { priority: 5 });
      await flush();

      worker.dispatch({ ...worker.sentMessages[0], type: "response", payload: 1 });
      await expectAsync(active).toBeResolvedTo(1);
      await flush();

      expect(worker.sentMessages[1].payload).toBe(3);
      worker.dispatch({ ...worker.sentMessages[1], type: "response", payload: 3 });
      await expectAsync(highA).toBeResolvedTo(3);
      await flush();

      expect(worker.sentMessages[2].payload).toBe(4);
      worker.dispatch({ ...worker.sentMessages[2], type: "response", payload: 4 });
      await expectAsync(highB).toBeResolvedTo(4);
      await flush();

      expect(worker.sentMessages[3].payload).toBe(2);
      worker.dispatch({ ...worker.sentMessages[3], type: "response", payload: 2 });
      await expectAsync(low).toBeResolvedTo(2);

      await pool.dispose();
    });


    it("prevents starvation of low-priority pool waiters under sustained priority pressure", async () => {
      const pool = createTaskPool<number, number>({
        name: "fair-pool",
        concurrency: 1,
        maxQueued: 64,
        main: (value: number) => value,
        functions: [],
        generateWorkerScript: () => "worker-script",
      });

      const active = pool.run(0);
      await flush();
      const worker = MockWorker.instances[0];

      const low = pool.run(-1, { priority: -1000 });
      const high = Array.from({ length: 40 }, (_, index) =>
        pool.run(index + 1, { priority: 1000 })
      );

      worker.dispatch({ ...worker.sentMessages[0], type: "response", payload: 0 });
      await active;

      for (let index = 1; index <= 32; index++) {
        await flush();
        expect(worker.sentMessages[index].payload).toBe(index);
        worker.dispatch({
          ...worker.sentMessages[index],
          type: "response",
          payload: index,
        });
        await high[index - 1];
      }

      await flush();
      expect(worker.sentMessages[33].payload).toBe(-1);
      worker.dispatch({
        ...worker.sentMessages[33],
        type: "response",
        payload: -1,
      });
      await expectAsync(low).toBeResolvedTo(-1);

      await pool.dispose();
      for (const pending of high.slice(32)) {
        await expectAsync(pending).toBeRejected();
      }
    });

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


    it("passes transfer lists through pooled submissions without reusing them", async () => {
      Object.defineProperty(navigator, "hardwareConcurrency", {
        value: 1,
        configurable: true,
      });

      const pool = createTaskPool<ArrayBuffer, number>({
        name: "transfer-pool",
        main: (value: ArrayBuffer) => value.byteLength,
        functions: [],
        generateWorkerScript: () => "worker-script",
      });

      const buffer = new ArrayBuffer(32);
      const pending = pool.run(buffer, { transfer: [buffer] });
      await flush();

      const worker = MockWorker.instances[0];
      expect(worker.sentTransfers[0]).toEqual([buffer]);
      const message = worker.sentMessages[0];
      worker.dispatch({ ...message, type: "response", payload: 32 });

      await expectAsync(pending).toBeResolvedTo(32);
      await pool.dispose();
    });

    it("rejects work owned by a failed worker and replaces it for queued work", async () => {
      Object.defineProperty(navigator, "hardwareConcurrency", {
        value: 1,
        configurable: true,
      });

      const pool = createTaskPool<number, number>({
        name: "recovering-pool",
        main: (value: number) => value,
        functions: [],
        generateWorkerScript: () => "worker-script",
      });

      const failedRun = pool.run(1);
      await flush();
      const failedWorker = MockWorker.instances[0];

      const queuedRun = pool.run(2);
      await flush();
      expect(MockWorker.instances.length).toBe(1);

      failedWorker.dispatchError(new Error("worker boom"));
      await expectAsync(failedRun).toBeRejectedWithError("worker boom");
      await flush();

      expect(failedWorker.terminated).toBeTrue();
      expect(MockWorker.instances.length).toBe(2);

      const replacement = MockWorker.instances[1];
      const replacementMessage = replacement.sentMessages[0];
      replacement.dispatch({ ...replacementMessage, type: "response", payload: 20 });

      await expectAsync(queuedRun).toBeResolvedTo(20);
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
      expect(warnSpy).not.toHaveBeenCalledWith("Worker not found.");
    });


    it("continues graceful pool draining after an active worker fails", async () => {
      const pool = createTaskPool<number, number>({
        name: "closing-failure-pool",
        concurrency: 1,
        maxQueued: 2,
        main: (value: number) => value,
        functions: [],
        generateWorkerScript: () => "worker-script",
      });

      const active = pool.run(1);
      await flush();
      const queued = pool.run(2);
      const closing = pool.close();

      const failedWorker = MockWorker.instances[0];
      failedWorker.dispatchError(new Error("pool worker failed during close"));

      await expectAsync(active).toBeRejectedWithError("pool worker failed during close");
      await flush();

      expect(MockWorker.instances.length).toBe(2);
      const replacement = MockWorker.instances[1];
      replacement.dispatch({
        ...replacement.sentMessages[0],
        type: "response",
        payload: 22,
      });

      await expectAsync(queued).toBeResolvedTo(22);
      await expectAsync(closing).toBeResolved();
      expect(replacement.terminated).toBeTrue();
    });

    it("allows dispose to escalate a pool that is already closing", async () => {
      const pool = createTaskPool<number, number>({
        name: "close-dispose-pool",
        concurrency: 1,
        maxQueued: 2,
        main: (value: number) => value,
        functions: [],
        generateWorkerScript: () => "worker-script",
      });

      const active = pool.run(1);
      await flush();
      const queued = pool.run(2);
      const worker = MockWorker.instances[0];

      const closing = pool.close();
      await pool.dispose();

      await expectAsync(active).toBeRejectedWithError(/finalized before the worker task completed/);
      await expectAsync(queued).toBeRejectedWithError(/finalized before a worker became available/);
      await expectAsync(closing).toBeResolved();
      expect(worker.terminated).toBeTrue();
      expect(pool.active).toBe(0);
      expect(pool.queued).toBe(0);
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

    it("cancels active pooled work without poisoning queued submissions", async () => {
      Object.defineProperty(navigator, "hardwareConcurrency", {
        value: 1,
        configurable: true,
      });

      const pool = createTaskPool<number, number>({
        name: "cancellable-pool",
        main: (value: number) => value,
        functions: [],
        generateWorkerScript: () => "worker-script",
      });

      const controller = new AbortController();
      const cancelled = pool.run(1, controller.signal);
      await flush();
      const queued = pool.run(2);
      const failedWorker = MockWorker.instances[0];

      controller.abort(new Error("cancel pooled task"));
      await expectAsync(cancelled).toBeRejectedWithError("cancel pooled task");
      await flush();

      expect(failedWorker.terminated).toBeTrue();
      expect(MockWorker.instances.length).toBe(2);

      const replacement = MockWorker.instances[1];
      const message = replacement.sentMessages[0];
      replacement.dispatch({ ...message, type: "response", payload: 200 });
      await expectAsync(queued).toBeResolvedTo(200);

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

  describe("worker timer lifecycle", () => {
    it("fails remaining timers coherently when timer cancellation cannot post", async () => {
      let otherError: Error | undefined;

      const first = scheduleWorkerTimer(1000, () => fail("first timer should be cancelled"));
      scheduleWorkerTimer(
        1000,
        () => fail("second timer should fail with the worker"),
        (error) => {
          otherError = error;
        },
      );

      MockWorker.postMessageError = new Error("timer post failed");

      expect(first.cancel()).toBeTrue();
      expect(otherError?.message).toBe("timer post failed");
      expect(MockWorker.instances[0].terminated).toBeTrue();
    });


    it("mass cancellation releases the shared timer worker exactly after the last timer", () => {
      const timers = Array.from({ length: 200 }, () =>
        scheduleWorkerTimer(10000, () => fail("cancelled timer elapsed")),
      );

      expect(MockWorker.instances.length).toBe(1);
      const timerWorker = MockWorker.instances[0];

      for (let index = 0; index < timers.length - 1; index++) {
        expect(timers[index].cancel()).toBeTrue();
        expect(timerWorker.terminated).toBeFalse();
      }

      expect(timers[timers.length - 1].cancel()).toBeTrue();
      expect(timerWorker.terminated).toBeTrue();

      for (const timer of timers) {
        expect(timer.cancel()).toBeFalse();
      }
    });

    it("notifies every pending timer even when one failure callback throws", () => {
      const notified: string[] = [];

      scheduleWorkerTimer(
        1000,
        () => fail("timer should fail"),
        () => {
          notified.push("first");
          throw new Error("failure callback exploded");
        },
      );
      scheduleWorkerTimer(
        1000,
        () => fail("timer should fail"),
        () => {
          notified.push("second");
        },
      );
      scheduleWorkerTimer(
        1000,
        () => fail("timer should fail"),
        () => {
          notified.push("third");
        },
      );

      const timerWorker = MockWorker.instances[0] as any;

      expect(() =>
        timerWorker.onerror({
          error: new Error("timer worker failed"),
          message: "timer worker failed",
        }),
      ).toThrowError("failure callback exploded");

      expect(notified).toEqual(["first", "second", "third"]);
      expect(timerWorker.terminated).toBeTrue();
    });

    it("releases an idle timer worker even when the elapsed callback throws", () => {
      scheduleWorkerTimer(
        1,
        () => {
          throw new Error("elapsed callback exploded");
        },
      );

      const timerWorker = MockWorker.instances[0] as any;
      const setMessage = timerWorker.sentMessages[0] as any;

      expect(() =>
        timerWorker.onmessage({
          data: { type: "elapsed", id: setMessage.id },
        }),
      ).toThrowError("elapsed callback exploded");

      expect(timerWorker.terminated).toBeTrue();
    });

    it("ignores stale timer worker errors after the worker has been released", () => {
      const timer = scheduleWorkerTimer(1000, () => {});
      const oldWorker = MockWorker.instances[0] as any;

      expect(timer.cancel()).toBeTrue();
      expect(oldWorker.terminated).toBeTrue();

      let failed = false;
      const current = scheduleWorkerTimer(
        1000,
        () => {},
        () => {
          failed = true;
        },
      );

      oldWorker.onerror?.({
        error: new Error("stale failure"),
        message: "stale failure",
      });

      expect(failed).toBeFalse();
      current.cancel();
    });
  });


});