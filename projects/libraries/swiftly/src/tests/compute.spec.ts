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

  it("should grow elastically with concurrent demand and reuse workers", async () => {
    const run = compute<number, number>(async (x: number) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return x * 2;
    });

    const first = run(1);
    const second = run(2);
    const third = run(3);

    expect(run.active).toBe(3);

    expect(await first).toBe(2);
    expect(await second).toBe(4);
    expect(await third).toBe(6);

    expect(run.active).toBe(0);

    expect(await run(4)).toBe(8);

    await run.dispose();
  });

  it("should preserve helper-function overloads without compute policy options", async () => {
    function addOne(x: number) {
      return x + 1;
    }

    const run = compute<number, number>(
      (x: number) => addOne(x),
      addOne,
    );

    expect(await run(4)).toBe(5);
    expect(run.active).toBe(0);

    await run.dispose();
  });

  it("should create elastic compute runners from coroutine scripts", async () => {
    const run = computeScript<number, number>({
      main: async (x: number) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return x + 1;
      },
    });

    const first = run(1);
    const second = run(2);

    expect(run.active).toBe(2);
    expect(await first).toBe(2);
    expect(await second).toBe(3);

    await run.dispose();
  });

  it("should compose bounded channels, groups, and elastic compute without an extra pipeline abstraction", async () => {
    const input = channel<number>(2);
    const output = channel<number>(2);
    const run = compute<number, number>(async (x: number) => {
      await new Promise((resolve) => setTimeout(resolve, 2));
      return x * x;
    });
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
    expect(run.active).toBe(0);
    await run.dispose();
  });

  it("close drains every admitted elastic compute submission", async () => {
    const run = compute<number, number>(async (x: number) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return x * 3;
    });

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
  });

  it("dispose rejects all active elastic compute submissions immediately", async () => {
    const run = compute<number, number>(async (x: number) => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return x;
    });

    const first = run(1);
    const second = run(2);

    await run.dispose();

    await expectAsync(first).toBeRejected();
    await expectAsync(second).toBeRejected();
    await expectAsync(run.close()).toBeResolved();
  });

  it("transfers ArrayBuffer ownership into and back out of compute workers", async () => {
    const run = compute<ArrayBuffer, ArrayBuffer>((buffer, { transfer }) => {
      const bytes = new Uint8Array(buffer);
      bytes[0] += 1;
      return transfer(buffer, buffer);
    });

    const input = new ArrayBuffer(8);
    new Uint8Array(input)[0] = 41;

    const pending = run(input, { transfer: [input] });
    const output = await pending;

    expect(input.byteLength).toBe(0);
    expect(output.byteLength).toBe(8);
    expect(new Uint8Array(output)[0]).toBe(42);

    await run.dispose();
  });

  it("does not transfer group-gated compute input when cancellation wins before admission", async () => {
    const run = compute<ArrayBuffer, number>((buffer) => buffer.byteLength);
    const work = group({ concurrency: 1 });
    const blocker = new Promise<void>(() => {});

    work.spawn(async (signal) => {
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
      await blocker;
    }).catch(() => undefined);

    const queuedBuffer = new ArrayBuffer(16);
    const pending = work.spawn((signal) =>
      run(queuedBuffer, { signal, transfer: [queuedBuffer] }),
    );

    work.cancel(new Error("cancel before compute admission"));

    await expectAsync(pending).toBeRejected();
    expect(queuedBuffer.byteLength).toBe(16);

    await work.settle();
    await run.dispose();
  });

  it("rejects duplicate input transfer ownership before posting work", async () => {
    const run = compute<ArrayBuffer, number>((buffer) => buffer.byteLength);
    const buffer = new ArrayBuffer(4);

    await expectAsync(
      run(buffer, { transfer: [buffer, buffer] }),
    ).toBeRejectedWithError(/same transferable more than once/);
    expect(buffer.byteLength).toBe(4);

    await run.dispose();
  });

});