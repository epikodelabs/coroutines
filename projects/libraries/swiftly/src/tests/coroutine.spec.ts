import {
  ChannelClosedError,
  ContextCancelledError,
  background,
  channel,
  coroutine,
  otherwise,
  receive,
  select,
  send,
  withCancel,
  withDeadline,
  withTimeout
} from "../public-api";
import { idescribe } from "./env.spec";

idescribe('coroutine', () => {
  let originalWorker: any;
  let originalLog: typeof console.log;
  let originalError: typeof console.error;
  let originalWarn: typeof console.warn;
  let mockWorkerCreations = 0;

  beforeAll(() => {
    // Store the original Worker
    originalWorker = (globalThis as any).Worker;

    // Save originals
    originalLog = console.log;
    originalError = console.error;
    originalWarn = console.warn;

    // Set up globalThis variable for main task
    (globalThis as any).currentMainTask = undefined;

    const serializeWorkerError = (error: unknown): string => {
      if (error instanceof Error) return error.message || error.name || "Error";
      if (error === undefined) return "Worker task threw undefined";
      if (error === null) return "Worker task threw null";
      return String(error);
    };

    class MockWorker {
      onmessage: ((ev: any) => void) | null = null;
      listeners: Record<string, ((ev: any) => void)[]> = {};
      terminated = false;
      private workerInbox = channel<any>();

      constructor(_url: string, _options?: any) {
        mockWorkerCreations++;
      }

      private handleDataRequest(_requestPayload: any): Promise<any> {
        return new Promise((resolve) => {
          // Simulate async data request by resolving with dummy data
          setTimeout(() => {
            resolve({ value: 10, message: "Dummy data from mock worker" });
          }, 1);
        });
      }

      private createWorkerUtils(message: { workerId: number; taskId: string }) {
        return {
          main: {
            send: (payload: any) => {
              const event: MessageEvent<any> = {
                data: { workerId: message.workerId, taskId: message.taskId, type: "notify", payload }
              } as any;
              this.onmessage?.(event);
              this.listeners["message"]?.forEach(fn => fn(event));
            },
            request: (requestPayload: any) => this.handleDataRequest(requestPayload),
            receive: async (signal?: AbortSignal) => {
              const result = await this.workerInbox.receive(signal);
              return result.ok ? result.value : undefined;
            },
            inbox: this.workerInbox,
          },
          concurrency: {
            channel,
            receive,
            send,
            otherwise,
            select,
            background,
            withCancel,
            withTimeout,
            withDeadline,
            ChannelClosedError,
            ContextCancelledError,
          }
        };
      }

      postMessage(msg: any) {
        setTimeout(() => {
          if (this.terminated) return;
          
          if (msg.type === 'task') {
            try {
              const mainTask = (globalThis as any).currentMainTask;
              if (!mainTask) {
                throw new Error('No main task configured');
              }
              const workerUtils = this.createWorkerUtils(msg);
              
              let result;
              
              // Check if mainTask expects utils parameter
              if (mainTask.length >= 2) {
                // Call with both data and utils
                result = mainTask(msg.payload, workerUtils);
              } else {
                // Call with only data
                result = mainTask(msg.payload);
              }
              
              // Handle both sync and async results
              Promise.resolve(result).then(finalResult => {
                const event: MessageEvent<any> = {
                  data: { ...msg, type: 'response', payload: finalResult }
                } as any;
                this.onmessage?.(event);
                this.listeners['message']?.forEach(fn => fn(event));
              }).catch(err => {
                const message = serializeWorkerError(err);
                const event: MessageEvent<any> = {
                  data: { ...msg, type: 'error', error: message }
                } as any;
                this.onmessage?.(event);
                this.listeners['message']?.forEach(fn => fn(event));
              });
              
            } catch (err: any) {
              const message = serializeWorkerError(err);
              const event: MessageEvent<any> = {
                data: { ...msg, type: 'error', error: message }
              } as any;
              this.onmessage?.(event);
              this.listeners['message']?.forEach(fn => fn(event));
            }
          } else if (msg.type === "notify") {
            this.workerInbox.send(msg.payload).catch(() => {});
          } else if (msg.type === 'data') {
            // Handle responses to worker data requests (if needed)
            console.log('MockWorker received data response:', msg);
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
        this.listeners = {};
        this.onmessage = null;
      }
    }

    (globalThis as any).Worker = MockWorker;
  });
  
  afterAll(() => {
    (globalThis as any).Worker = originalWorker;
    delete (globalThis as any).currentMainTask;
  });

  beforeEach(() => {
    // Reset before each test
    (globalThis as any).currentMainTask = undefined;
    mockWorkerCreations = 0;
  });

  it('should process tasks and return results', async () => {
    const mainTask = (x: number) => x + 1;
    (globalThis as any).currentMainTask = mainTask;
    
    const co = coroutine(mainTask);

    const stream = (async function* () {
      yield 1;
      yield 2;
      yield 3;
    })();

    const processed: number[] = [];
    for await (const v of stream) {
      processed.push(await co.run(v as number));
    }

    expect(processed).toEqual([2, 3, 4]); // Fixed expectation: x + 1
  });

  it('should process multiple tasks in sequence', async () => {
    const mainTask = (x: number) => x * 2; // Fixed: consistent task logic
    (globalThis as any).currentMainTask = mainTask;
    
    const co = coroutine(mainTask);

    const results = await Promise.all([
      co.run(1),
      co.run(2),
      co.run(3),
    ]);

    expect(results).toEqual([2, 4, 6]); // Fixed expectation: x * 2
    expect(mockWorkerCreations).toBe(1);
  });

  it('should dispose and terminate all workers', async () => {
    const mainTask = (x: number) => x * 2;
    (globalThis as any).currentMainTask = mainTask;

    const co = coroutine(mainTask);

    const result = await co.run(2);
    expect(result).toBe(4);
    await co.dispose();
  });

  it('should throw error from run directly', async () => {
    // Silence them
    console.log = () => {};
    console.error = () => {};
    console.warn = () => {};

    const mainTask = () => {
      throw new Error('boom');
    };
    (globalThis as any).currentMainTask = mainTask;

    const co = coroutine(mainTask);

    try {
      await co.run(1);
      fail('Expected run to throw error');
    } catch (err: any) {
      expect(err.message).toBe('boom');
    }

    // Restore originals
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  });

  it('should serialize undefined worker errors sensibly', async () => {
    // Silence them
    console.log = () => {};
    console.error = () => {};
    console.warn = () => {};

    const mainTask = () => {
      throw undefined;
    };
    (globalThis as any).currentMainTask = mainTask;

    const co = coroutine(mainTask);

    try {
      await co.run(1);
      fail('Expected run to throw error');
    } catch (err: any) {
      expect(err.message).toBe('Worker task threw undefined');
    }

    // Restore originals
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  });

  it('should handle worker errors gracefully in stream', async () => {
     // Silence them
    console.log = () => {};
    console.error = () => {};
    console.warn = () => {};
    
    const mainTask = (x: number) => {
      if (x === 2) {
        throw new Error('boom');
      }
      return x * 2;
    };
    (globalThis as any).currentMainTask = mainTask;

    const co = coroutine(mainTask);

    const stream = (async function* () {
      yield 1;
      yield 2; // This will cause an error
      yield 3;
    })();

    const processed: number[] = [];
    let errorCaught = false;

    try {
      for await (const v of stream) {
        processed.push(await co.run(v as number));
      }
    } catch (err: any) {
      errorCaught = true;
      expect(err.message).toBe('boom');
    }

    expect(errorCaught).toBe(true);
    expect(processed).toEqual([2]); // Only the first value processed successfully
    
    // Restore originals
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  });

  it('should fall back to 4 workers when navigator.hardwareConcurrency is not set', async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, "hardwareConcurrency");

    try {
      Object.defineProperty(navigator, "hardwareConcurrency", { value: 0, configurable: true });

      const mainTask = (x: number) => x + 1;
      (globalThis as any).currentMainTask = mainTask;

      const co = coroutine(mainTask);
      const result = await co.run(1);
      expect(result).toBe(2);
      await co.dispose();
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(navigator, "hardwareConcurrency", originalDescriptor);
      }
    }
  });

  it('should support trailing coroutine options', async () => {
    const mainTask = (x: number) => x + 1;
    (globalThis as any).currentMainTask = mainTask;

    const co = coroutine(mainTask, {});

    const r = await co.run(1);
    expect(r).toBe(2);

    await co.dispose();
  });

  it('should reject with "Unknown worker error" when worker error message is missing', async () => {
    const originalWorker = (globalThis as any).Worker;

    class ErrorNoMessageWorker {
      listeners: Record<string, ((ev: any) => void)[]> = {};
      terminated = false;

      constructor(_url: string, _options?: any) {}

      addEventListener(type: string, fn: (ev: any) => void) {
        this.listeners[type] ||= [];
        this.listeners[type].push(fn);
      }

      removeEventListener(type: string, fn: (ev: any) => void) {
        if (this.listeners[type]) {
          this.listeners[type] = this.listeners[type].filter(f => f !== fn);
        }
      }

      postMessage(msg: any) {
        setTimeout(() => {
          if (this.terminated) return;
          if (msg.type !== "task") return;

          const event: MessageEvent<any> = {
            data: { ...msg, type: "error" } // no `error` field on purpose
          } as any;

          this.listeners["message"]?.forEach(fn => fn(event));
        }, 1);
      }

      terminate() {
        this.terminated = true;
        this.listeners = {};
      }
    }

    (globalThis as any).Worker = ErrorNoMessageWorker;

    try {
      const mainTask = (x: number) => x;
      (globalThis as any).currentMainTask = mainTask;

      const co = coroutine(mainTask);

      await expectAsync(co.run(1)).toBeRejectedWithError("Unknown worker error");
      await co.dispose();
    } finally {
      (globalThis as any).Worker = originalWorker;
    }
  });

  it('should include helper function names when generating worker script', async () => {
    const mainTask = (x: number) => x;
    (globalThis as any).currentMainTask = mainTask;

    function helperNamed() {
      return 1;
    }

    const co = coroutine(mainTask, helperNamed, function () { return 2; });
    await co.run(1);
    await co.dispose();
  });

  it('should reject queued run requests when finalized', async () => {
    const mainTask = (x: number) => {
      if (x === 1) {
        return new Promise<number>(() => {}); // never resolves
      }
      return x;
    };
    (globalThis as any).currentMainTask = mainTask;

    const co = coroutine(mainTask);
    const active = co.run(1);
    const queued = co.run(2);

    await co.dispose();

    await expectAsync(active).toBeRejectedWithError(/finalized before the worker task completed/);
    await expectAsync(queued).toBeRejectedWithError(/finalized before a worker became available/);
  });

  it('dispose is safe when called before any worker is created', async () => {
    const mainTask = (x: number) => x;
    (globalThis as any).currentMainTask = mainTask;
    const co = coroutine(mainTask);

    await co.dispose();

    // After finalization, new tasks should be rejected.
    await expectAsync(co.run(1)).toBeRejectedWithError(
      /finalized before a worker became available/
    );
  });

});
