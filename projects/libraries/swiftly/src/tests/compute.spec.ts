import { compute, computeScript } from "../public-api";
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
});
