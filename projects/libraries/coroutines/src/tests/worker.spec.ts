import {
  createDefaultMessageHandler,
  generateTaskId,
  type PendingTaskMap,
  type WorkerProtocolMessage,
} from "../lib/worker";
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
  readonly url: string;
  readonly options: WorkerOptions | undefined;
  readonly sentMessages: WorkerProtocolMessage[] = [];
  readonly sentTransfers: Transferable[][] = [];
  terminated = false;
  __id?: number;

  constructor(url: string, options?: WorkerOptions) {
    this.url = url;
    this.options = options;
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
  let warnSpy: jasmine.Spy;

  beforeAll(() => {
    originalWorker = (globalThis as any).Worker;
    (globalThis as any).Worker = MockWorker;
  });

  beforeEach(() => {
    MockWorker.instances.length = 0;
    MockWorker.postMessageError = null;
    warnSpy = spyOn(console, "warn");
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


  describe("module worker invariant", () => {
    it("creates task workers as native ES module workers", async () => {
      const runner = createTaskRunner<number, number>({
        name: "module-runner",
        main: (value: number) => value,
        functions: [],
        generateWorkerScript: () => "module-worker-script",
      });

      const pending = runner.run(1);
      await flush();

      const worker = MockWorker.instances[0];
      expect(worker.options?.type).toBe("module");

      const message = worker.sentMessages[0];
      worker.dispatch({ ...message, type: "response", payload: 1 });
      await expectAsync(pending).toBeResolvedTo(1);
      await runner.dispose();
    });

    it("creates the shared timer worker as a native ES module worker", () => {
      const timer = scheduleWorkerTimer(10000, () => fail("timer should not elapse"));
      const worker = MockWorker.instances[0];

      expect(worker.options?.type).toBe("module");

      timer.cancel();
    });
  });

  describe("worker script ownership", () => {
    it("acquires blob URLs lazily and releases them only after worker use", async () => {
      const createUrl = spyOn(URL, "createObjectURL").and.returnValue("blob:coroutines-lazy");
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

      expect(revokeUrl).toHaveBeenCalledWith("blob:coroutines-lazy");
    });

;
  });

  describe("createTaskRunner", () => {
    const createRunner = (name = "runner") =>
      createTaskRunner<number, number>({
        name,
        main: (value: number) => value,
        functions: [],
        generateWorkerScript: () => "runner-worker-script",
      });

    it("creates workers lazily for concurrent demand and reuses idle workers", async () => {
      const runner = createRunner();

      const first = runner.run(1);
      const second = runner.run(2);
      const third = runner.run(3);
      await flush();

      expect(MockWorker.instances.length).toBe(3);

      MockWorker.instances.forEach((worker, index) => {
        const message = worker.sentMessages[0];
        worker.dispatch({ ...message, type: "response", payload: index + 10 });
      });

      await expectAsync(first).toBeResolvedTo(10);
      await expectAsync(second).toBeResolvedTo(11);
      await expectAsync(third).toBeResolvedTo(12);

      const reused = runner.run(4);
      await flush();
      expect(MockWorker.instances.length).toBe(3);
      const reusedWorker = MockWorker.instances.find(worker => worker.sentMessages.length === 2)!;
      const message = reusedWorker.sentMessages[1];
      reusedWorker.dispatch({ ...message, type: "response", payload: 40 });
      await expectAsync(reused).toBeResolvedTo(40);

      await runner.dispose();
    });

    it("queues submissions when maxWorkers is reached", async () => {
      const runner = createTaskRunner<number, number>({
        name: "bounded-runner",
        maxWorkers: 1,
        main: (value: number) => value,
        functions: [],
        generateWorkerScript: () => "runner-worker-script",
      });

      const first = runner.run(1);
      const second = runner.run(2);
      await flush();

      expect(MockWorker.instances.length).toBe(1);
      const worker = MockWorker.instances[0];
      expect(worker.sentMessages.length).toBe(1);

      const firstMessage = worker.sentMessages[0];
      worker.dispatch({ ...firstMessage, type: "response", payload: 10 });
      await expectAsync(first).toBeResolvedTo(10);

      await flush();
      expect(worker.sentMessages.length).toBe(2);

      const secondMessage = worker.sentMessages[1];
      worker.dispatch({ ...secondMessage, type: "response", payload: 20 });
      await expectAsync(second).toBeResolvedTo(20);

      await runner.dispose();
    });

    it("isolates worker failure from concurrent submissions", async () => {
      const runner = createRunner("failure-runner");
      const failed = runner.run(1);
      const healthy = runner.run(2);
      await flush();

      const failedWorker = MockWorker.instances[0];
      const healthyWorker = MockWorker.instances[1];

      failedWorker.dispatchError(new Error("worker boom"));
      await expectAsync(failed).toBeRejectedWithError("worker boom");

      const message = healthyWorker.sentMessages[0];
      healthyWorker.dispatch({ ...message, type: "response", payload: 20 });
      await expectAsync(healthy).toBeResolvedTo(20);

      expect(failedWorker.terminated).toBeTrue();
      await runner.dispose();
    });

    it("cancels one active submission by retiring only its worker", async () => {
      const runner = createRunner("cancel-runner");
      const controller = new AbortController();

      const cancelled = runner.run(1, controller.signal);
      const healthy = runner.run(2);
      await flush();

      const cancelledWorker = MockWorker.instances[0];
      const healthyWorker = MockWorker.instances[1];

      controller.abort(new Error("cancel task"));
      await expectAsync(cancelled).toBeRejectedWithError("cancel task");
      expect(cancelledWorker.terminated).toBeTrue();

      const message = healthyWorker.sentMessages[0];
      healthyWorker.dispatch({ ...message, type: "response", payload: 22 });
      await expectAsync(healthy).toBeResolvedTo(22);

      await runner.dispose();
    });

    it("passes transfer ownership when a submission is posted", async () => {
      const runner = createTaskRunner<ArrayBuffer, number>({
        name: "transfer-runner",
        main: (value: ArrayBuffer) => value.byteLength,
        functions: [],
        generateWorkerScript: () => "runner-worker-script",
      });
      const buffer = new ArrayBuffer(16);
      const pending = runner.run(buffer, { transfer: [buffer] });
      await flush();

      const worker = MockWorker.instances[0];
      expect(worker.sentTransfers[0]).toEqual([buffer]);
      const message = worker.sentMessages[0];
      worker.dispatch({ ...message, type: "response", payload: 16 });

      await expectAsync(pending).toBeResolvedTo(16);
      await runner.dispose();
    });

    it("close drains all admitted submissions then releases every worker", async () => {
      const runner = createRunner("closing-runner");
      const first = runner.run(1);
      const second = runner.run(2);
      await flush();

      const closing = runner.close();
      await expectAsync(runner.run(3)).toBeRejectedWithError("closing-runner is closed");

      MockWorker.instances.forEach((worker, index) => {
        const message = worker.sentMessages[0];
        worker.dispatch({ ...message, type: "response", payload: index + 1 });
      });

      await expectAsync(first).toBeResolvedTo(1);
      await expectAsync(second).toBeResolvedTo(2);
      await expectAsync(closing).toBeResolved();
      expect(MockWorker.instances.every(worker => worker.terminated)).toBeTrue();
    });

    it("dispose immediately rejects all active submissions and settles close", async () => {
      const runner = createRunner("dispose-runner");
      const first = runner.run(1);
      const second = runner.run(2);
      await flush();

      const closing = runner.close();
      await runner.dispose();

      await expectAsync(first).toBeRejectedWithError(/finalized before the worker task completed/);
      await expectAsync(second).toBeRejectedWithError(/finalized before the worker task completed/);
      await expectAsync(closing).toBeResolved();
      expect(MockWorker.instances.every(worker => worker.terminated)).toBeTrue();
    });

    it("wraps worker construction and postMessage failures", async () => {
      const originalWorkerCtor = (globalThis as any).Worker;

      class ThrowingWorker {
        constructor() {
          throw new Error("worker ctor error");
        }
      }

      (globalThis as any).Worker = ThrowingWorker;
      const ctorRunner = createRunner("ctor-runner");
      await expectAsync(ctorRunner.run(1)).toBeRejectedWithError("worker ctor error");
      await ctorRunner.dispose();

      (globalThis as any).Worker = originalWorkerCtor;
      MockWorker.postMessageError = new Error("postMessage boom");
      const postRunner = createRunner("post-runner");
      await expectAsync(postRunner.run(1)).toBeRejectedWithError("postMessage boom");
      await postRunner.dispose();
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
      let queuedThrow: (() => void) | undefined;
      const queueMicrotaskSpy = spyOn(globalThis, "queueMicrotask").and.callFake((callback: VoidFunction) => {
        queuedThrow = callback;
      });

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
      ).not.toThrow();

      expect(notified).toEqual(["first", "second", "third"]);
      expect(timerWorker.terminated).toBeTrue();
      expect(queueMicrotaskSpy).toHaveBeenCalled();
      expect(queuedThrow).toBeDefined();
      expect(() => queuedThrow?.()).toThrowError("failure callback exploded");
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