import { channel, compute, computeScript, group } from "../public-api";
import { idescribe } from "./env.spec";

idescribe("compute", () => {
  let originalLog: typeof console.log;
  let originalError: typeof console.error;
  let originalWarn: typeof console.warn;

  beforeAll(() => {
    originalLog = console.log;
    originalError = console.error;
    originalWarn = console.warn;
  });

  it("should compute a single value", async () => {
    const run = compute<number, number>((x: number) => x * 2);
    const result = await run(5);
    expect(result).toBe(10);
    await run.dispose();
  });

  it("should reuse the same pool across calls", async () => {
    const run = compute<number, number>((x: number) => x + 1);

    const r1 = await run(1);
    const r2 = await run(5);

    expect(r1).toBe(2);
    expect(r2).toBe(6);
    await run.dispose();
  });

  it("should process many values sequentially", async () => {
    const run = compute<number, number>((x: number) => x * x);
    const results: number[] = [];

    for (const n of [2, 3, 4, 5]) {
      results.push(await run(n));
    }

    expect(results).toEqual([4, 9, 16, 25]);
    await run.dispose();
  });

  it("should propagate errors from the worker task", async () => {
    console.log = () => {};
    console.error = () => {};
    console.warn = () => {};

    const run = compute<number, number>((_x: number) => {
      throw new Error("boom");
    });

    try {
      await run(99);
      fail("Expected error to be thrown");
    } catch (err: any) {
      expect(err.message).toBe("boom");
    } finally {
      console.log = originalLog;
      console.error = originalError;
      console.warn = originalWarn;
      await run.dispose();
    }
  });

  it("should preserve helper snippets when building from a coroutine script", async () => {
    const run = computeScript<number, number>({
      helpers: ["function helperScale(x) { return x * 3; }"],
      main: Function("data", "return helperScale(data);") as (data: number) => number,
    });

    const result = await run(5);

    expect(result).toBe(15);
    await run.dispose();
  });

  it("should build from a coroutine script without helpers", async () => {
    const run = computeScript<number, number>({
      main: (data: number) => data + 4,
    });

    const result = await run(5);

    expect(result).toBe(9);
    await run.dispose();
  });

  it("should expose and enforce bounded pool admission", async () => {
    const run = compute<number, number>(
      async (x: number) => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return x * 2;
      },
      { concurrency: 1, maxQueued: 1 },
    );

    expect(run.concurrency).toBe(1);

    const first = run(1);
    const second = run(2);
    const third = run(3);

    expect(run.queued).toBe(1);
    await expectAsync(third).toBeRejectedWithError(/queue capacity exceeded/);

    expect(await first).toBe(2);
    expect(await second).toBe(4);
    expect(run.queued).toBe(0);

    await run.dispose();
  });

  it("should preserve helper-function overloads with compute options support", async () => {
    function addOne(x: number) {
      return x + 1;
    }

    const legacy = compute<number, number>(
      (x: number) => addOne(x),
      addOne,
    );
    const configured = compute<number, number>(
      (x: number) => addOne(x),
      { concurrency: 2 },
      addOne,
    );

    expect(await legacy(4)).toBe(5);
    expect(await configured(4)).toBe(5);
    expect(configured.concurrency).toBe(2);

    await legacy.dispose();
    await configured.dispose();
  });

  it("should apply pool options to computeScript", async () => {
    const run = computeScript<number, number>(
      { main: (x: number) => x + 1 },
      { concurrency: 1, maxQueued: 0 },
    );

    expect(run.concurrency).toBe(1);
    expect(run.queued).toBe(0);

    await run.dispose();
  });



  it("should compose bounded channels, groups, and compute without an extra pipeline abstraction", async () => {
    const input = channel<number>(2);
    const output = channel<number>(2);
    const run = compute<number, number>(
      async (x: number) => {
        await new Promise((resolve) => setTimeout(resolve, 2));
        return x * x;
      },
      { concurrency: 2, maxQueued: 2 },
    );
    const work = group({ concurrency: 3 });
    const collected: number[] = [];

    const collector = (async () => {
      for await (const value of output) {
        collected.push(value);
      }
    })();

    work.spawn(async (signal) => {
      for (const value of [1, 2, 3, 4, 5, 6]) {
        await input.send(value, signal);
      }
      input.close();
    });

    for (let worker = 0; worker < 2; worker++) {
      work.spawn(async (signal) => {
        while (true) {
          const received = await input.receive(signal);
          if (!received.ok) return;
          const result = await run(received.value, signal);
          await output.send(result, signal);
        }
      });
    }

    await work.wait();
    output.close();
    await collector;

    expect(collected.slice().sort((a, b) => a - b)).toEqual([1, 4, 9, 16, 25, 36]);
    expect(run.queued).toBe(0);
    await run.dispose();
  });



  it("close drains admitted compute work including queued submissions", async () => {
    const run = compute<number, number>(
      async (x: number) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return x * 3;
      },
      { concurrency: 1, maxQueued: 4 },
    );

    const first = run(1);
    const second = run(2);
    const third = run(3);
    const closing = run.close();

    await expectAsync(run(4)).toBeRejectedWithError(/closed/);
    expect(await first).toBe(3);
    expect(await second).toBe(6);
    expect(await third).toBe(9);
    await expectAsync(closing).toBeResolved();
    expect(run.active).toBe(0);
    expect(run.queued).toBe(0);
  });

  it("dispose rejects active and waiting compute submissions immediately", async () => {
    const run = compute<number, number>(
      async (x: number) => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return x;
      },
      { concurrency: 1, maxQueued: 2 },
    );

    const active = run(1);
    const queued = run(2);

    await run.dispose();

    await expectAsync(active).toBeRejected();
    await expectAsync(queued).toBeRejected();
    await expectAsync(run.close()).toBeResolved();
  });


});