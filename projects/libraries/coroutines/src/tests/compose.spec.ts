import { compose, coroutine, group } from "../public-api";
import { idescribe } from "./env";

idescribe("compose coroutines", () => {
  const run = async <T, R>(def: any, value: T): Promise<R> => {
    const work = group();
    try {
      return await work.executor(def).run(value);
    } finally {
      await work.settle();
    }
  };

  it("preserves types across more than three composed stages", async () => {
    const c1 = coroutine((value: number) => String(value));
    const c2 = coroutine((value: string) => value.length);
    const c3 = coroutine((value: number) => value > 0);
    const c4 = coroutine((value: boolean) => (value ? 1 : 0));
    const c5 = coroutine((value: number) => `result:${value}`);

    const fused = compose(c1, c2, c3, c4, c5);
    const result: string = await run<number, string>(fused, 42);

    expect(result).toBe("result:1");
  });

  it("should process tasks sequentially via run", async () => {
    const c1 = coroutine((x: number) => x + 1);
    const c2 = coroutine((x: number) => x * 2);

    const fused = compose(c1, c2);

    const result = await run<number, number>(fused, 3); // (3 + 1) * 2
    expect(result).toBe(8);
  });

  it("returns an immutable definition with no executor surface", () => {
    const fused = compose(coroutine((x: number) => x + 1), coroutine((x: number) => x * 2));

    expect(Object.isFrozen(fused)).toBeTrue();
    expect('run' in fused).toBeFalse();
    expect('close' in fused).toBeFalse();
    expect('dispose' in fused).toBeFalse();
    expect('size' in fused).toBeFalse();
  });

  it("rejects non-definition inputs", () => {
    const def = coroutine((x: number) => x + 1);

    expect(() => compose(def, { run: async (x: number) => x } as any)).toThrowError(
      TypeError,
      /accepts only definitions/,
    );
  });

  it("accepts composed definitions as stages", async () => {
    const pair = compose(
      coroutine((x: number) => x + 1),
      coroutine((x: number) => x * 2),
    );
    const fused = compose(pair, coroutine((x: number) => x - 1));

    // ((5+1)*2)-1
    expect(await run<number, number>(fused, 5)).toBe(11);
  });

  it("should process tasks sequentially in a stream", async () => {
    const c1 = coroutine((x: number) => x + 1);
    const c2 = coroutine((x: number) => x * 2);

    const stream = (async function* () {
      yield 1;
      yield 2;
      yield 3;
    })();

    const work = group();
    const fused = work.executor(compose(c1, c2));

    const results: number[] = [];
    for await (const v of stream) {
      results.push(await fused.run(v));
    }

    // (1+1)*2 = 4, (2+1)*2 = 6, (3+1)*2 = 8
    expect(results).toEqual([4, 6, 8]);

    await work.settle();
  });

  it("should await async coroutine stages before passing values to the next stage", async () => {
    const c1 = coroutine(async (x: number) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return x + 1;
    });
    const c2 = coroutine((x: number) => x * 2);

    const fused = compose(c1, c2);

    const result = await run<number, number>(fused, 3);
    expect(result).toBe(8);
  });

  it("should propagate errors from inner coroutine", async () => {
    const c1 = coroutine((x: number) => x + 1);
    const c2 = coroutine((x: number) => {
      if (x === 2) throw new Error("boom");
      return x * 2;
    });

    const fused = compose(c1, c2);

    try {
      await run<number, number>(fused, 1); // (1+1) => 2, then boom
      fail("Expected error to be thrown");
    } catch (err: any) {
      expect(err.message).toBe("boom");
    }
  });

  it("should handle empty composes gracefully", async () => {
    const composed = compose(); // no tasks
    const result = await run<number, number>(composed, 42);

    expect(result).toBe(42);
  });

  it("passes through values when no tasks are provided", async () => {
    const stream = (async function* () {
      yield 1;
      yield 2;
    })();

    const passThrough = compose();
    const results: number[] = [];
    for await (const v of stream) {
      results.push(await run<number, number>(passThrough, v));
    }

    expect(results).toEqual([1, 2]);
  });

  it("keeps transfer ownership inside merged coroutine stages and returns only the final value", async () => {
    const first = coroutine<ArrayBuffer, ArrayBuffer>((buffer, { transfer }) => {
      new Uint8Array(buffer)[0] += 1;
      return transfer(buffer, buffer);
    });
    const second = coroutine<ArrayBuffer, ArrayBuffer>((buffer, { transfer }) => {
      new Uint8Array(buffer)[0] += 1;
      return transfer(buffer, buffer);
    });
    const fused = compose(first, second);

    const input = new ArrayBuffer(4);
    new Uint8Array(input)[0] = 40;

    const work = group();
    try {
      const output = await work.executor(fused).run(input, { transfer: [input] });

      expect(input.byteLength).toBe(0);
      expect(output.byteLength).toBe(4);
      expect(new Uint8Array(output)[0]).toBe(42);
    } finally {
      await work.settle();
    }
  });

  it("supports arrow-function helpers inside merged coroutine stages", async () => {
    const addOne = (value: number) => value + 1;
    const double = (value: number) => value * 2;

    const first = coroutine((value: number) => addOne(value), addOne);
    const second = coroutine((value: number) => double(value), double);
    const fused = compose(first, second);

    expect(await run<number, number>(fused, 3)).toBe(8);
  });
});
