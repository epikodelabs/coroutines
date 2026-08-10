import { compose, coroutine } from "../public-api";

describe("compose coroutines", () => {
  it("should process tasks sequentially via run", async () => {
    const c1 = coroutine((x: number) => x + 1);
    const c2 = coroutine((x: number) => x * 2);

    const composed = compose(c1, c2);

    const result = await composed.run(3); // (3 + 1) * 2
    expect(result).toBe(8);

    await composed.dispose();
  });

  it("should process tasks sequentially in a stream", async () => {
    const c1 = coroutine((x: number) => x + 1);
    const c2 = coroutine((x: number) => x * 2);

    const stream = (async function* () {
      yield 1;
      yield 2;
      yield 3;
    })();

    const composed = compose(c1, c2);

    const results: number[] = [];
    for await (const v of stream) {
      results.push(await composed.run(v));
    }

    // (1+1)*2 = 4, (2+1)*2 = 6, (3+1)*2 = 8
    expect(results).toEqual([4, 6, 8]);

    await composed.dispose();
  });

  it("should await async coroutine stages before passing values to the next stage", async () => {
    const c1 = coroutine(async (x: number) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return x + 1;
    });
    const c2 = coroutine((x: number) => x * 2);

    const composed = compose(c1, c2);

    const result = await composed.run(3);
    expect(result).toBe(8);

    await composed.dispose();
  });

  it("should propagate errors from inner coroutine", async () => {
    const c1 = coroutine((x: number) => x + 1);
    const c2 = coroutine((x: number) => {
      if (x === 2) throw new Error("boom");
      return x * 2;
    });

    const composed = compose(c1, c2);

    try {
      await composed.run(1); // (1+1) => 2, then boom
      fail("Expected error to be thrown");
    } catch (err: any) {
      expect(err.message).toBe("boom");
    }

    await composed.dispose();
  });

  it("should dispose all tasks", async () => {
    const finalized: string[] = [];

    const c1 = {
      run: async (x: number) => x + 1,
      dispose: async () => finalized.push("c1"),
    } as any;
    const c2 = {
      run: async (x: number) => x * 2,
      dispose: async () => finalized.push("c2"),
    } as any;

    const composed = compose(c1, c2);

    const result = await composed.run(5);
    expect(result).toBe(12);

    await composed.dispose();
    expect(finalized).toEqual(["c1", "c2"]);
  });

  it("should handle empty composes gracefully", async () => {
    const composed = compose(); // no tasks
    const result = await composed.run(42);

    expect(result).toBe(42);

    await composed.dispose();
  });

  it("passes through values when no tasks are provided", async () => {
    const stream = (async function* () {
      yield 1;
      yield 2;
    })();

    const passThrough = compose();
    const results: number[] = [];
    for await (const v of stream) {
      results.push(await passThrough.run(v));
    }

    expect(results).toEqual([1, 2]);
  });

  it("should dispose every task even when one finalizer throws", async () => {
    const finalized: string[] = [];

    const composed = compose(
      {
        run: async (x: number) => x + 1,
        dispose: async () => {
          finalized.push("c1");
          throw new Error("boom");
        },
      } as any,
      {
        run: async (x: number) => x * 2,
        dispose: async () => {
          finalized.push("c2");
        },
      } as any
    );

    await expectAsync(composed.dispose()).toBeRejectedWithError("boom");
    expect(finalized).toEqual(["c1", "c2"]);
  });

  it("forwards cancellation to every runner stage", async () => {
    const seenSignals: AbortSignal[] = [];
    const first = {
      run: async (value: number, signal?: AbortSignal) => {
        if (signal) seenSignals.push(signal);
        return value + 1;
      },
      dispose: async () => undefined,
    };
    const second = {
      run: async (value: number, signal?: AbortSignal) => {
        if (signal) seenSignals.push(signal);
        return value * 2;
      },
      dispose: async () => undefined,
    };

    const controller = new AbortController();
    const composed = compose(first, second);
    await expectAsync(composed.run(3, controller.signal)).toBeResolvedTo(8);

    expect(seenSignals).toEqual([controller.signal, controller.signal]);
    await composed.dispose();
  });

});
