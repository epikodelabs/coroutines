import {
  coroutine,
} from "../public-api";
import { idescribe } from "./env";
import {
  CoroutineWorkerSimulator,
  ErrorNoMessageWorker,
} from "./helpers/worker-harness";

idescribe('coroutine', () => {
  let originalWorker: any;
  let mockWorkerCreations = 0;

  beforeAll(() => {
    originalWorker = (globalThis as any).Worker;
    (globalThis as any).currentMainTask = undefined;

    // The simulator executes the real coroutine runtime string; the task
    // runs against the shipped protocol instead of a hand-copied mock.
    (globalThis as any).Worker = class extends CoroutineWorkerSimulator {
      constructor(url: string, options?: WorkerOptions) {
        super(url, options, () => { mockWorkerCreations++; });
      }
    };
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

  it('should process concurrent tasks on elastic workers', async () => {
    const mainTask = (x: number) => x * 2; // Fixed: consistent task logic
    (globalThis as any).currentMainTask = mainTask;

    const co = coroutine(mainTask);

    const results = await Promise.all([
      co.run(1),
      co.run(2),
      co.run(3),
    ]);

    expect(results).toEqual([2, 4, 6]); // Fixed expectation: x * 2
    expect(mockWorkerCreations).toBe(3);
    await co.dispose();
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
    spyOn(console, "log").and.callFake(() => {});
    spyOn(console, "error").and.callFake(() => {});
    spyOn(console, "warn").and.callFake(() => {});

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
  });

  it('should serialize undefined worker errors sensibly', async () => {
    spyOn(console, "log").and.callFake(() => {});
    spyOn(console, "error").and.callFake(() => {});
    spyOn(console, "warn").and.callFake(() => {});

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
  });

  it('should handle worker errors gracefully in stream', async () => {
    spyOn(console, "log").and.callFake(() => {});
    spyOn(console, "error").and.callFake(() => {});
    spyOn(console, "warn").and.callFake(() => {});

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
  });

  it('should support trailing coroutine options', async () => {
    const mainTask = (x: number) => x + 1;
    (globalThis as any).currentMainTask = mainTask;

    const co = coroutine(mainTask, {});

    const r = await co.run(1);
    expect(r).toBe(2);

    await co.dispose();
  });

  it('should limit worker creation when maxWorkers is configured', async () => {
    const mainTask = async (x: number) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return x + 1;
    };
    (globalThis as any).currentMainTask = mainTask;

    const co = coroutine(mainTask, { maxWorkers: 1 });
    const first = co.run(1);
    const second = co.run(2);

    await expectAsync(first).toBeResolvedTo(2);
    await expectAsync(second).toBeResolvedTo(3);
    expect(mockWorkerCreations).toBe(1);

    await co.dispose();
  });

  it('should reject with "Unknown worker error" when worker error message is missing', async () => {
    const originalWorker = (globalThis as any).Worker;
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

  it('should reject all concurrent run requests when finalized', async () => {
    const mainTask = (_x: number) => new Promise<number>(() => {});
    (globalThis as any).currentMainTask = mainTask;

    const co = coroutine(mainTask);
    const first = co.run(1);
    const second = co.run(2);

    await co.dispose();

    await expectAsync(first).toBeRejectedWithError(/finalized before the worker task completed/);
    await expectAsync(second).toBeRejectedWithError(/finalized before the worker task completed/);
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

  it("close drains admitted coroutine work and rejects new submissions", async () => {
    const mainTask = async (x: number) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return x * 2;
    };
    (globalThis as any).currentMainTask = mainTask;

    const co = coroutine(mainTask);
    const first = co.run(2);
    const second = co.run(3);

    const closing = co.close();

    await expectAsync(co.run(4)).toBeRejectedWithError(/closed/);
    expect(await first).toBe(4);
    expect(await second).toBe(6);
    await expectAsync(closing).toBeResolved();
    await expectAsync(co.close()).toBeResolved();
  });

  it("dispose remains immediate and rejects all active coroutine work", async () => {
    const mainTask = async (x: number) => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return x;
    };
    (globalThis as any).currentMainTask = mainTask;

    const co = coroutine(mainTask);
    const first = co.run(1);
    const second = co.run(2);

    await co.dispose();

    await expectAsync(first).toBeRejected();
    await expectAsync(second).toBeRejected();
    await expectAsync(co.close()).toBeResolved();
  });
});
