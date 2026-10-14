import {
  compose,
  coroutine,
  group,
  GroupClosedError,
  pipeline,
} from "../public-api";
import { idescribe } from "./env";
import { CoroutineWorkerSimulator, ErrorNoMessageWorker } from "./helpers/worker-harness";

idescribe('executor', () => {
  let originalWorker: any;
  let mockWorkerCreations = 0;

  beforeAll(() => {
    originalWorker = (globalThis as any).Worker;
    (globalThis as any).currentMainTask = undefined;

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
    (globalThis as any).currentMainTask = undefined;
    mockWorkerCreations = 0;
  });

  it('should process tasks and return results', async () => {
    const mainTask = (x: number) => x + 1;
    (globalThis as any).currentMainTask = mainTask;

    const work = group();
    const ex = work.executor(coroutine(mainTask));

    const stream = (async function* () {
      yield 1;
      yield 2;
      yield 3;
    })();

    const processed: number[] = [];
    for await (const v of stream) {
      processed.push(await ex.run(v as number));
    }

    expect(processed).toEqual([2, 3, 4]);
    await work.settle();
  });

  it('should process concurrent tasks on elastic workers', async () => {
    const mainTask = (x: number) => x * 2;
    (globalThis as any).currentMainTask = mainTask;

    const work = group();
    const ex = work.executor(coroutine(mainTask));

    const results = await Promise.all([
      ex.run(1),
      ex.run(2),
      ex.run(3),
    ]);

    expect(results).toEqual([2, 4, 6]);
    expect(mockWorkerCreations).toBe(3);

    await work.settle();
    expect((globalThis as any).lastMockWorker?.terminated ?? true).toBeTrue();
  });

  it('should throw error from run directly', async () => {
    spyOn(console, "log").and.callFake(() => {});
    spyOn(console, "error").and.callFake(() => {});
    spyOn(console, "warn").and.callFake(() => {});

    const mainTask = () => {
      throw new Error('boom');
    };
    (globalThis as any).currentMainTask = mainTask;

    const work = group();
    const ex = work.executor(coroutine(mainTask));

    try {
      await ex.run(1);
      fail('Expected run to throw error');
    } catch (err: any) {
      expect(err.message).toBe('boom');
    }

    await work.settle();
  });

  it('should serialize undefined worker errors sensibly', async () => {
    spyOn(console, "log").and.callFake(() => {});
    spyOn(console, "error").and.callFake(() => {});
    spyOn(console, "warn").and.callFake(() => {});

    const mainTask = () => {
      throw undefined;
    };
    (globalThis as any).currentMainTask = mainTask;

    const work = group();
    const ex = work.executor(coroutine(mainTask));

    try {
      await ex.run(1);
      fail('Expected run to throw error');
    } catch (err: any) {
      expect(err.message).toBe('Worker task threw undefined');
    }

    await work.settle();
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

    const work = group();
    const ex = work.executor(coroutine(mainTask));

    const stream = (async function* () {
      yield 1;
      yield 2;
      yield 3;
    })();

    const processed: number[] = [];
    let errorCaught = false;

    try {
      for await (const v of stream) {
        processed.push(await ex.run(v as number));
      }
    } catch (err: any) {
      errorCaught = true;
      expect(err.message).toBe('boom');
    }

    expect(errorCaught).toBe(true);
    expect(processed).toEqual([2]);
    await work.settle();
  });

  it('should limit worker creation when maxWorkers is configured', async () => {
    const mainTask = async (x: number) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return x + 1;
    };
    (globalThis as any).currentMainTask = mainTask;

    const work = group();
    const ex = work.executor(coroutine(mainTask), { maxWorkers: 1 });
    const first = ex.run(1);
    const second = ex.run(2);

    await expectAsync(first).toBeResolvedTo(2);
    await expectAsync(second).toBeResolvedTo(3);
    expect(mockWorkerCreations).toBe(1);

    await work.settle();
  });

  it('should reject with "Unknown worker error" when worker error message is missing', async () => {
    const originalWorker = (globalThis as any).Worker;
    (globalThis as any).Worker = ErrorNoMessageWorker;

    try {
      const mainTask = (x: number) => x;
      (globalThis as any).currentMainTask = mainTask;

      const work = group();
      const ex = work.executor(coroutine(mainTask));

      await expectAsync(ex.run(1)).toBeRejectedWithError("Unknown worker error");
      await work.settle();
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

    const work = group();
    const ex = work.executor(coroutine(mainTask, helperNamed, function () { return 2; }));
    await ex.run(1);
    await work.settle();
  });

  it('cancel rejects all active runs and disposes the pool', async () => {
    const mainTask = (_x: number) => new Promise<number>(() => {});
    (globalThis as any).currentMainTask = mainTask;

    const work = group();
    const ex = work.executor(coroutine(mainTask));
    const first = ex.run(1);
    const second = ex.run(2);

    work.cancel();

    await expectAsync(first).toBeRejectedWithError(/finalized before the worker task completed/);
    await expectAsync(second).toBeRejectedWithError(/finalized before the worker task completed/);

    // The executor carries the "coroutine" pool name in its error messages.
    await expectAsync(work.wait()).toBeRejected();
  });

  it('cancel rejects active runs and later submissions with the cancel reason', async () => {
    const mainTask = (_x: number) => new Promise<number>(() => {});
    (globalThis as any).currentMainTask = mainTask;

    const work = group();
    const ex = work.executor(coroutine(mainTask));
    const admitted = ex.run(1);

    work.cancel();

    await expectAsync(admitted).toBeRejected();
    // After cancellation, runs reject with the group's abort reason.
    await expectAsync(ex.run(2)).toBeRejected();
    await expectAsync(work.wait()).toBeRejected();
  });

  it('rejects runs submitted after the group settled', async () => {
    const mainTask = (x: number) => x + 1;
    (globalThis as any).currentMainTask = mainTask;

    const work = group();
    const ex = work.executor(coroutine(mainTask));

    await ex.run(1);
    await work.settle();

    await expectAsync(ex.run(2)).toBeRejectedWithError(GroupClosedError);
  });

  it('settle drains admitted runs before closing the pool', async () => {
    const mainTask = async (x: number) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return x * 2;
    };
    (globalThis as any).currentMainTask = mainTask;

    const work = group();
    const ex = work.executor(coroutine(mainTask));
    const first = ex.run(2);
    const second = ex.run(3);

    const settling = work.settle();

    await expectAsync(ex.run(4)).toBeRejectedWithError(GroupClosedError);
    expect(await first).toBe(4);
    expect(await second).toBe(6);
    await expectAsync(settling).toBeResolved();
    await expectAsync(work.settle()).toBeResolved();
  });

  it('settles cleanly when the executor was never used', async () => {
    const def = coroutine((x: number) => x);
    const work = group();
    const ex = work.executor(def);

    expect(ex.size).toBe(0);
    await expectAsync(work.settle()).toBeResolved();
    expect(ex.size).toBe(0);
  });

  it('settle and cancel are idempotent alongside manual pool close', async () => {
    const def = coroutine((x: number) => x);
    const work = group();
    const ex = work.executor(def);

    await ex.close();
    await expectAsync(work.settle()).toBeResolved();
    await expectAsync(work.settle()).toBeResolved();
    work.cancel();
    await expectAsync(ex.dispose()).toBeResolved();
  });

  it('reaps idle workers when idleTimeout is configured', async () => {
    const mainTask = (x: number) => x;
    (globalThis as any).currentMainTask = mainTask;

    const work = group();
    const ex = work.executor(coroutine(mainTask), { idleTimeout: 15 });

    expect(ex.size).toBe(0);
    await Promise.all([ex.run(1), ex.run(2), ex.run(3)]);
    expect(ex.size).toBe(3);

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(ex.size).toBe(0);

    await work.settle();
  });

  it('validates executor options', () => {
    const def = coroutine((x: number) => x);
    const work = group();

    expect(() => work.executor(def, { maxWorkers: 0 })).toThrowError(
      RangeError,
      "maxWorkers must be a positive integer",
    );
    expect(() => work.executor(def, { idleTimeout: -1 })).toThrowError(
      RangeError,
      "idleTimeout must be a positive finite number",
    );
  });

  it('uses the "compose" pool name for fused definitions', async () => {
    const mainTask = (_x: number) => new Promise<number>(() => {});
    (globalThis as any).currentMainTask = mainTask;

    const work = group();
    const ex = work.executor(compose(coroutine(mainTask)));
    const pending = ex.run(1);

    work.cancel();
    await expectAsync(pending).toBeRejectedWithError(/finalized before/);
  });

  it('a failed group disposes its executor pools', async () => {
    const mainTask = async (x: number) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return x;
    };
    (globalThis as any).currentMainTask = mainTask;

    const work = group();
    const ex = work.executor(coroutine(mainTask));

    work.spawn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      throw new Error("child boom");
    });

    const report = await work.settle();
    expect(report.error?.message).toBe("child boom");

    // The failed group disposed its pool: no runs are accepted anymore.
    await expectAsync(ex.run(1)).toBeRejected();
  });

  it('a pipeline over an executor and a plain step runs all steps while the group is open', async () => {
    const mainTask = async (x: number) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return x + 1;
    };
    (globalThis as any).currentMainTask = mainTask;

    const work = group();
    const first = work.executor(coroutine(mainTask));
    const chain = pipeline(first, { run: async (x: number) => x * 2 });

    await expectAsync(chain.run(2)).toBeResolvedTo(6);

    // Drains are per-executor: settle closes each pool, so runs submitted
    // after settle reject with GroupClosedError.
    const settling = work.settle();
    await expectAsync(chain.run(2)).toBeRejectedWithError(GroupClosedError);
    await expectAsync(settling).toBeResolved();
  });

  describe('child scopes', () => {
    it('child failure fails the parent by default', async () => {
      const parent = group();
      const child = parent.group();

      child.spawn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        throw new Error("import failed");
      });

      await expectAsync(parent.wait()).toBeRejectedWithError("import failed");
      await expectAsync(child.wait()).toBeRejectedWithError("import failed");
    });

    it('an isolated child contains its failure', async () => {
      const parent = group();
      const child = parent.group({ failure: "isolate" });

      child.spawn(async () => {
        throw new Error("background import failed");
      });

      const parentReport = await parent.settle();
      expect(parentReport.error).toBeUndefined();
      await expectAsync(child.wait()).toBeRejectedWithError("background import failed");
    });

    it('parent cancellation cancels child scopes', async () => {
      const parent = group();
      const child = parent.group();
      let childSignalAborted = false;

      child.spawn(async (signal) => {
        signal.addEventListener("abort", () => { childSignalAborted = true; }, { once: true });
        await new Promise<void>(() => {});
      });

      await new Promise((resolve) => setTimeout(resolve, 5));
      parent.cancel();

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(childSignalAborted).toBeTrue();
      expect(parent.accepting).toBeFalse();
      expect(child.accepting).toBeFalse();
    });

    it('parent settle closes the child to new spawns and awaits it', async () => {
      const parent = group();
      const child = parent.group();
      let settled = false;

      child.spawn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        settled = true;
      });

      await expectAsync(parent.wait()).toBeResolved();
      expect(settled).toBeTrue();
      await expectAsync(child.spawn(async () => undefined)).toBeRejectedWithError(GroupClosedError);
    });

    it('child scopes can create their own executors', async () => {
      const mainTask = (x: number) => x + 1;
      (globalThis as any).currentMainTask = mainTask;

      const parent = group();
      const child = parent.group();
      const ex = child.executor(coroutine(mainTask));

      await expectAsync(ex.run(1)).toBeResolvedTo(2);

      await child.wait();
      await expectAsync(ex.run(2)).toBeRejectedWithError(GroupClosedError);
      await parent.wait();
    });

    it('executors borrowed from the parent survive child settlement', async () => {
      const mainTask = (x: number) => x + 1;
      (globalThis as any).currentMainTask = mainTask;

      const parent = group();
      const shared = parent.executor(coroutine(mainTask));

      const child = parent.group();
      await child.spawn(async () => shared.run(1));
      await child.wait();

      // The borrowed executor's owner group is still open.
      await expectAsync(shared.run(2)).toBeResolvedTo(3);
      await parent.settle();
    });

    it('validates the failure option', () => {
      expect(() => group({ failure: "nope" as any })).toThrowError(
        RangeError,
        'group failure must be "propagate" or "isolate"',
      );
    });
  });
});
