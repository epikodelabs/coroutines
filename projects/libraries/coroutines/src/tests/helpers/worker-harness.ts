/**
 * Shared Worker stand-ins for the test suites.
 *
 * `FakeWorker` is a recorder-style Worker replacement used by worker.spec.
 * `ActorWorkerSimulator` and `CoroutineWorkerSimulator` execute the real
 * worker runtime strings (`buildActorWorkerRuntime` / `buildCoroutineWorkerRuntime`
 * plus `ACTOR_CONCURRENCY_RUNTIME`) through `new Function`, so actor and
 * coroutine suites exercise the same protocol code the browser workers run —
 * instead of a hand-copied mock.
 */

import { ACTOR_CONCURRENCY_RUNTIME } from "../../lib/worker/concurrency";
import {
  buildActorWorkerRuntime,
  buildCoroutineWorkerRuntime,
} from "../../lib/worker/runtimes";

export type WorkerListener = (event: any) => void;

export class FakeWorker {
  static instances: FakeWorker[] = [];
  static postMessageError: unknown = null;

  onmessage: WorkerListener | null = null;
  onerror: WorkerListener | null = null;
  readonly listeners = new Map<string, WorkerListener[]>();
  readonly url: string;
  readonly options: WorkerOptions | undefined;
  readonly sentMessages: any[] = [];
  readonly sentTransfers: Transferable[][] = [];
  terminated = false;
  private timers = new Map<number, ReturnType<typeof setTimeout>>();

  constructor(url: string, options?: WorkerOptions) {
    this.url = url;
    this.options = options;
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, listener: WorkerListener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: WorkerListener) {
    const listeners = this.listeners.get(type);
    if (!listeners) return;
    const index = listeners.indexOf(listener);
    if (index >= 0) listeners.splice(index, 1);
  }

  /**
   * Timer-worker protocol: `scheduleWorkerTimer` posts set/clear to its
   * dedicated worker; elapse flows back through `onmessage`. Returns true
   * when the message was handled as a timer message.
   */
  protected handleTimerProtocol(message: any): boolean {
    if (message?.type === "set" && typeof message.id === "number") {
      const handle = setTimeout(() => {
        this.timers.delete(message.id);
        this.onmessage?.({
          data: { type: "elapsed", id: message.id },
        } as MessageEvent<any>);
      }, message.ms);
      this.timers.set(message.id, handle);
      return true;
    }
    if (message?.type === "clear" && typeof message.id === "number") {
      const handle = this.timers.get(message.id);
      if (handle !== undefined) {
        clearTimeout(handle);
        this.timers.delete(message.id);
      }
      return true;
    }
    return false;
  }

  postMessage(message: any, transfer: Transferable[] = []) {
    if (FakeWorker.postMessageError !== null) {
      throw FakeWorker.postMessageError;
    }

    this.sentMessages.push(message);
    this.sentTransfers.push([...transfer]);
    this.handleTimerProtocol(message);
  }

  dispatch(message: any) {
    const event = { data: message } as MessageEvent<any>;
    for (const listener of [...(this.listeners.get("message") || [])]) {
      listener(event);
    }
  }

  dispatchError(error: unknown, message = "worker failed") {
    const event = { error, message } as ErrorEvent;
    for (const listener of [...(this.listeners.get("error") || [])]) {
      listener(event);
    }
  }

  terminate() {
    this.terminated = true;
    for (const handle of this.timers.values()) clearTimeout(handle);
    this.timers.clear();
    this.onmessage = null;
    this.onerror = null;
  }
}

/**
 * Executes the real actor runtime strings, standing in for the browser
 * worker. The runtime is compiled lazily from the first `init` message, which
 * carries the actor's mailbox capacity (baked into the worker script in
 * production). Messages from the actor worker flow back through `onmessage`
 * and the listener registry; main-thread messages enter through
 * `postMessage`. Instances also serve as timer workers for
 * `scheduleWorkerTimer`, which supervisor restart delays rely on.
 */
export class ActorWorkerSimulator extends FakeWorker {
  private runtimeOnmessage: WorkerListener | null = null;
  private debug:
    | {
        getActorState: () => any;
        getActorRunning: () => boolean;
        getPendingWorkerRequestCount: () => number;
      }
    | undefined;

  constructor(url: string, options?: WorkerOptions) {
    super(url, options);
    (globalThis as any).lastMockWorker = this;
  }

  override postMessage(msg: any) {
    this.sentMessages.push(msg);
    const injectedError = (globalThis as any).actorPostMessageError;
    if (typeof injectedError === "function") {
      const error = injectedError(msg);
      if (error) throw error;
    } else if (injectedError) {
      throw injectedError;
    }

    if (this.handleTimerProtocol(msg)) return;

    setTimeout(() => {
      if (this.terminated) return;
      if (!this.runtimeOnmessage && msg.type === "init") {
        this.buildRuntime(msg.mailboxCapacity);
      }
      this.runtimeOnmessage?.({ data: msg });
    }, 1);
  }

  override terminate() {
    super.terminate();
  }

  private buildRuntime(mailboxCapacity: number | undefined) {
    const fakePostMessage = (message: any) => {
      if (this.terminated) return;
      const event = { data: message } as MessageEvent<any>;
      this.onmessage?.(event);
      this.dispatch(message);
    };

    const mainTask = (...args: any[]) => {
      const task = (globalThis as any).currentMainTask;
      if (!task) throw new Error("No main task configured");
      return task(...args);
    };

    const runtime = new Function(
      "__fakePostMessage",
      "__mainTask",
      [
        "var onmessage = null;",
        "const postMessage = __fakePostMessage;",
        ACTOR_CONCURRENCY_RUNTIME,
        buildActorWorkerRuntime(mailboxCapacity),
        "return {",
        "  get runtimeOnmessage() { return onmessage; },",
        "  __debug: {",
        "    getActorState: () => __actorState,",
        "    getActorRunning: () => __actorRunning,",
        "    getPendingWorkerRequestCount: () => __pendingWorkerRequests.size,",
        "  },",
        "};",
      ].join("\n"),
    )(fakePostMessage, mainTask);

    this.runtimeOnmessage = runtime.runtimeOnmessage;
    this.debug = runtime.__debug;
  }

  emitError(error: Error) {
    this.dispatchError(error, error.message);
  }

  emitMessage(message: any) {
    this.dispatch(message);
  }

  get protocolIdentity() {
    const init = this.sentMessages.find((message: any) => message?.type === "init");
    return init
      ? { workerId: init.workerId, taskId: init.taskId }
      : { workerId: undefined, taskId: "" };
  }

  get pendingWorkerRequestCount() {
    return this.debug?.getPendingWorkerRequestCount() ?? 0;
  }
}

/**
 * Executes the real coroutine runtime string. `onCreate` is invoked for
 * every constructed worker so suites can count elastic worker creation.
 */
export class CoroutineWorkerSimulator extends FakeWorker {
  private runtimeOnmessage: WorkerListener | null = null;

  constructor(url: string, options?: WorkerOptions, onCreate?: () => void) {
    super(url, options);
    onCreate?.();

    const fakePostMessage = (message: any, transfer: Transferable[] = []) => {
      if (this.terminated) return;
      this.sentMessages.push(message);
      this.sentTransfers.push([...transfer]);
      const event = { data: message } as MessageEvent<any>;
      this.onmessage?.(event);
      this.dispatch(message);
    };

    const mainTask = (...args: any[]) => {
      const task = (globalThis as any).currentMainTask;
      if (!task) throw new Error("No main task configured");
      return task(...args);
    };

    // Mirrors TRANSFER_WORKER_BOOTSTRAP from worker/script.ts.
    const workerUtils = Object.freeze({
      transfer(value: any, ...transferables: Transferable[]) {
        const seen = new Set();
        for (const item of transferables) {
          if (seen.has(item)) {
            throw new TypeError("transfer list contains the same transferable more than once");
          }
          seen.add(item);
        }
        return { __transferResult: true, value, transfer: transferables };
      },
    });

    const runtime = new Function(
      "__fakePostMessage",
      "__mainTask",
      "__workerUtils",
      [
        "var onmessage = null;",
        "const postMessage = __fakePostMessage;",
        buildCoroutineWorkerRuntime(),
        "return { get runtimeOnmessage() { return onmessage; } };",
      ].join("\n"),
    )(fakePostMessage, mainTask, workerUtils);

    this.runtimeOnmessage = runtime.runtimeOnmessage;
  }

  override postMessage(msg: any, transfer: Transferable[] = []) {
    if (FakeWorker.postMessageError !== null) {
      throw FakeWorker.postMessageError;
    }

    setTimeout(() => {
      if (this.terminated) return;
      this.runtimeOnmessage?.({ data: msg });
    }, 1);
  }

  override terminate() {
    super.terminate();
  }
}

/**
 * Minimal worker that answers every task with an error message missing the
 * `error` field, exercising the runner's "Unknown worker error" fallback.
 */
export class ErrorNoMessageWorker {
  readonly listeners = new Map<string, WorkerListener[]>();
  terminated = false;

  constructor(_url: string, _options?: WorkerOptions) {}

  addEventListener(type: string, fn: WorkerListener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(fn);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, fn: WorkerListener) {
    const listeners = this.listeners.get(type);
    if (!listeners) return;
    const index = listeners.indexOf(fn);
    if (index >= 0) listeners.splice(index, 1);
  }

  postMessage(msg: any) {
    setTimeout(() => {
      if (this.terminated) return;
      if (msg.type !== "task") return;

      const event: MessageEvent<any> = {
        data: { ...msg, type: "error" }, // no `error` field on purpose
      } as any;

      for (const fn of [...(this.listeners.get("message") || [])]) {
        fn(event);
      }
    }, 1);
  }

  terminate() {
    this.terminated = true;
    this.listeners.clear();
  }
}
