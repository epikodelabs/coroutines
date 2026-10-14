import { pipeline, type TaskRunControl } from "../public-api";

describe("pipeline", () => {
  const step = (name: string, fn: (value: number) => number) => ({
    run: async (value: number) => fn(value),
    name,
  });

  it("runs steps in argument order", async () => {
    const chain = pipeline(
      step("a", (x) => x + 1),
      step("b", (x) => x * 2),
      step("c", (x) => x - 1),
    );

    // ((3+1)*2)-1
    await expectAsync(chain.run(3)).toBeResolvedTo(7);
  });

  it("interleaves any run-shaped steps in argument order", async () => {
    const chain = pipeline(
      { run: async (x: number) => x + 1 },
      { run: async (x: number) => x * 2 },
      { run: async (x: number) => x - 1 },
      { run: async (x: number) => x * 3 },
    );

    // (((2+1)*2)-1)*3
    await expectAsync(chain.run(2)).toBeResolvedTo(15);
  });

  it("returns a run-only surface", () => {
    const chain = pipeline({ run: async (x: number) => x });

    expect(typeof chain.run).toBe("function");
    expect('close' in chain).toBeFalse();
    expect('dispose' in chain).toBeFalse();
    expect('size' in chain).toBeFalse();
  });

  it("passes through values when no steps are provided", async () => {
    const chain = pipeline();
    await expectAsync(chain.run(42)).toBeResolvedTo(42);
  });

  it("forwards cancellation to every step", async () => {
    const seenSignals: AbortSignal[] = [];
    const first = {
      run: async (value: number, control?: TaskRunControl) => {
        const signal = control instanceof AbortSignal ? control : control?.signal;
        if (signal) seenSignals.push(signal);
        return value + 1;
      },
    };
    const second = {
      run: async (value: number, control?: TaskRunControl) => {
        const signal = control instanceof AbortSignal ? control : control?.signal;
        if (signal) seenSignals.push(signal);
        return value * 2;
      },
    };

    const controller = new AbortController();
    const chain = pipeline(first, second);
    await expectAsync(chain.run(3, controller.signal)).toBeResolvedTo(8);

    expect(seenSignals).toEqual([controller.signal, controller.signal]);
  });

  it("applies an input transfer list only to the first step", async () => {
    const controls: TaskRunControl[] = [];
    const first = {
      run: async (value: ArrayBuffer, control?: TaskRunControl) => {
        controls.push(control);
        return value;
      },
    };
    const second = {
      run: async (value: ArrayBuffer, control?: TaskRunControl) => {
        controls.push(control);
        return value.byteLength;
      },
    };

    const controller = new AbortController();
    const buffer = new ArrayBuffer(8);
    const chain = pipeline(first, second);
    await expectAsync(
      chain.run(buffer, { signal: controller.signal, transfer: [buffer] }),
    ).toBeResolvedTo(8);

    expect((controls[0] as any).transfer).toEqual([buffer]);
    expect((controls[0] as any).signal).toBe(controller.signal);
    expect(controls[1]).toBe(controller.signal);
  });

  it("propagates step failures", async () => {
    const chain = pipeline(
      step("a", (x) => x + 1),
      {
        run: async () => {
          throw new Error("step boom");
        },
      },
    );

    await expectAsync(chain.run(1)).toBeRejectedWithError("step boom");
  });

  it("validates the chain at compile time", async () => {
    // Type-level only: a mismatched chain would not compile.
    const numberChain = pipeline(
      coroutineLike((x: number) => String(x)),
      coroutineLike((x: string) => x.length),
    );
    await expectAsync(numberChain.run(42)).toBeResolvedTo(2);
  });

  function coroutineLike<T, R>(fn: (value: T) => R) {
    return { run: async (value: T) => fn(value) };
  }
});
