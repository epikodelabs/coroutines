import { compose, coroutine, type TaskRunControl } from "../public-api";

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
      run: async (value: number, control?: TaskRunControl) => {
        const signal = control instanceof AbortSignal ? control : control?.signal;
        if (signal) seenSignals.push(signal);
        return value + 1;
      },
      close: async () => undefined,
      dispose: async () => undefined,
    };
    const second = {
      run: async (value: number, control?: TaskRunControl) => {
        const signal = control instanceof AbortSignal ? control : control?.signal;
        if (signal) seenSignals.push(signal);
        return value * 2;
      },
      close: async () => undefined,
      dispose: async () => undefined,
    };

    const controller = new AbortController();
    const composed = compose(first, second);
    await expectAsync(composed.run(3, controller.signal)).toBeResolvedTo(8);

    expect(seenSignals).toEqual([controller.signal, controller.signal]);
    await composed.dispose();
  });


  it("close drains and closes every composed runner", async () => {
    const lifecycle: string[] = [];
    const first = {
      run: async (value: number) => value + 1,
      close: async () => { lifecycle.push("close:first"); },
      dispose: async () => { lifecycle.push("dispose:first"); },
    };
    const second = {
      run: async (value: number) => value * 2,
      close: async () => { lifecycle.push("close:second"); },
      dispose: async () => { lifecycle.push("dispose:second"); },
    };

    const composed = compose(first, second);
    expect(await composed.run(2)).toBe(6);

    await composed.close();
    expect(lifecycle).toEqual(["close:first", "close:second"]);
  });

  it("close attempts every composed runner even when one close fails", async () => {
    const lifecycle: string[] = [];
    const composed = compose(
      {
        run: async (value: number) => value,
        close: async () => {
          lifecycle.push("first");
          throw new Error("close failed");
        },
        dispose: async () => undefined,
      },
      {
        run: async (value: number) => value,
        close: async () => {
          lifecycle.push("second");
        },
        dispose: async () => undefined,
      },
    );

    await expectAsync(composed.close()).toBeRejectedWithError("close failed");
    expect(lifecycle).toEqual(["first", "second"]);
  });


  it("applies an input transfer list only to the first composed runner", async () => {
    const controls: TaskRunControl[] = [];
    const first = {
      run: async (value: ArrayBuffer, control?: TaskRunControl) => {
        controls.push(control);
        return value;
      },
      close: async () => undefined,
      dispose: async () => undefined,
    };
    const second = {
      run: async (value: ArrayBuffer, control?: TaskRunControl) => {
        controls.push(control);
        return value.byteLength;
      },
      close: async () => undefined,
      dispose: async () => undefined,
    };

    const controller = new AbortController();
    const buffer = new ArrayBuffer(8);
    const composed = compose(first, second);
    await expectAsync(
      composed.run(buffer, { signal: controller.signal, transfer: [buffer] }),
    ).toBeResolvedTo(8);

    expect((controls[0] as any).transfer).toEqual([buffer]);
    expect((controls[0] as any).signal).toBe(controller.signal);
    expect(controls[1]).toBe(controller.signal);
    await composed.dispose();
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
    const composed = compose(first, second);

    const input = new ArrayBuffer(4);
    new Uint8Array(input)[0] = 40;
    const output = await composed.run(input, { transfer: [input] });

    expect(input.byteLength).toBe(0);
    expect(output.byteLength).toBe(4);
    expect(new Uint8Array(output)[0]).toBe(42);

    await composed.dispose();
    await first.dispose();
    await second.dispose();
  });

  it("supports arrow-function helpers inside merged coroutine stages", async () => {
    const addOne = (value: number) => value + 1;
    const double = (value: number) => value * 2;

    const first = coroutine((value: number) => addOne(value), addOne);
    const second = coroutine((value: number) => double(value), double);
    const composed = compose(first, second);

    await expectAsync(composed.run(3)).toBeResolvedTo(8);

    await composed.dispose();
    await first.dispose();
    await second.dispose();
  });


  it("close drains the entire admitted pipeline before closing any stage", async () => {
    const lifecycle: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = {
      run: async (value: number) => {
        lifecycle.push("run:first");
        await firstGate;
        return value + 1;
      },
      close: async () => {
        lifecycle.push("close:first");
      },
      dispose: async () => {
        lifecycle.push("dispose:first");
      },
    };
    const second = {
      run: async (value: number) => {
        lifecycle.push("run:second");
        return value * 2;
      },
      close: async () => {
        lifecycle.push("close:second");
      },
      dispose: async () => {
        lifecycle.push("dispose:second");
      },
    };

    const composed = compose(first, second);
    const admitted = composed.run(2);
    await Promise.resolve();

    const closing = composed.close();

    await expectAsync(composed.run(3)).toBeRejectedWithError("compose is closed");
    expect(lifecycle).toEqual(["run:first"]);

    releaseFirst();

    await expectAsync(admitted).toBeResolvedTo(6);
    await expectAsync(closing).toBeResolved();
    expect(lifecycle).toEqual([
      "run:first",
      "run:second",
      "close:first",
      "close:second",
    ]);
  });

  it("dispose settles a concurrent graceful close and rejects unfinished pipeline work", async () => {
    let rejectActive!: (error: Error) => void;
    const lifecycle: string[] = [];

    const first = {
      run: () =>
        new Promise<number>((_resolve, reject) => {
          rejectActive = reject;
        }),
      close: async () => {
        lifecycle.push("close:first");
      },
      dispose: async () => {
        lifecycle.push("dispose:first");
        rejectActive(new Error("disposed active pipeline"));
      },
    };
    const second = {
      run: async (value: number) => value,
      close: async () => {
        lifecycle.push("close:second");
      },
      dispose: async () => {
        lifecycle.push("dispose:second");
      },
    };

    const composed = compose(first, second);
    const active = composed.run(1);
    active.catch(() => undefined);

    const closing = composed.close();
    await composed.dispose();

    await expectAsync(active).toBeRejectedWithError("disposed active pipeline");
    await expectAsync(closing).toBeResolved();
    expect(lifecycle).toEqual(["dispose:first", "dispose:second"]);
  });


});
