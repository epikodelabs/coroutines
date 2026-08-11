import {
  background,
  ContextCancelledError,
  sleep,
  withTimeout,
} from "../public-api";

describe("worker-backed timer", () => {
  it("should resolve sleep after the requested duration", async () => {
    const started = performance.now();

    await sleep(10);

    expect(performance.now() - started).toBeGreaterThanOrEqual(5);
  });

  it("should reject sleep when already cancelled", async () => {
    const controller = new AbortController();
    controller.abort(new ContextCancelledError("stopped"));

    await expectAsync(sleep(1000, controller.signal)).toBeRejectedWithError(/stopped/);
  });

  it("should cancel a pending sleep", async () => {
    const controller = new AbortController();
    const pending = sleep(10000, controller.signal);

    controller.abort(new ContextCancelledError("cancelled"));

    await expectAsync(pending).toBeRejectedWithError(/cancelled/);
  });

  it("should support concurrent sleeps through the shared timer runtime", async () => {
    const order: number[] = [];

    const slow = sleep(20).then(() => order.push(2));
    const fast = sleep(5).then(() => order.push(1));

    await Promise.all([slow, fast]);
    expect(order).toEqual([1, 2]);
  });

  it("should drive context timeouts through the timer runtime", async () => {
    const [ctx, cancel] = withTimeout(background(), 10);

    await ctx.done;

    expect(ctx.signal.aborted).toBeTrue();
    expect(String(ctx.reason)).toContain("timeout");
    cancel();
  });

  it("should reject invalid durations", async () => {
    await expectAsync(sleep(-1)).toBeRejectedWithError(RangeError);
    await expectAsync(sleep(Number.NaN)).toBeRejectedWithError(RangeError);
  });

  it("falls back to host timers when Worker is unavailable", async () => {
    const originalWorker = (globalThis as any).Worker;
    (globalThis as any).Worker = undefined;

    try {
      const started = performance.now();
      await sleep(10);
      expect(performance.now() - started).toBeGreaterThanOrEqual(5);

      const [ctx, cancel] = withTimeout(background(), 10);
      await ctx.done;
      expect(ctx.signal.aborted).toBeTrue();
      cancel();
    } finally {
      (globalThis as any).Worker = originalWorker;
    }
  });
});
