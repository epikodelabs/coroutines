import {
  ContextCancelledError,
  group,
} from "../public-api";

describe("task group", () => {
  const pause = (ms = 5) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  it("owns dynamic child work and waits for all children", async () => {
    const work = group();
    const completed: number[] = [];

    const first = work.spawn(async () => {
      await pause(5);
      completed.push(1);
      return "one";
    });
    const second = work.spawn(async () => {
      await pause(1);
      completed.push(2);
      return "two";
    });

    await expectAsync(work.wait()).toBeResolved();
    await expectAsync(first).toBeResolvedTo("one");
    await expectAsync(second).toBeResolvedTo("two");
    expect(completed.sort()).toEqual([1, 2]);
    expect(work.running).toBe(0);
    expect(work.accepting).toBeFalse();
  });

  it("cancels siblings when the first child fails", async () => {
    const work = group();
    let siblingCancelled = false;

    const sibling = work.spawn(
      (signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              siblingCancelled = true;
              reject(signal.reason);
            },
            { once: true },
          );
        }),
    );

    const failed = work.spawn(async () => {
      await pause(1);
      throw new Error("child boom");
    });

    await expectAsync(failed).toBeRejectedWithError("child boom");
    await expectAsync(sibling).toBeRejected();
    await expectAsync(work.wait()).toBeRejectedWithError("child boom");
    expect(siblingCancelled).toBeTrue();
    expect(work.signal.aborted).toBeTrue();
  });

  it("bounds execution without changing child operations", async () => {
    const work = group({ concurrency: 2 });
    let active = 0;
    let peak = 0;

    const children = Array.from({ length: 6 }, (_, index) =>
      work.spawn(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await pause(2);
        active -= 1;
        return index;
      }),
    );

    await work.wait();
    expect(await Promise.all(children)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(peak).toBe(2);
  });

  it("propagates parent cancellation into queued and running children", async () => {
    const parent = new AbortController();
    const work = group({ concurrency: 1, signal: parent.signal });

    const running = work.spawn(
      (signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    );
    const queued = work.spawn(async (signal) => {
      if (signal.aborted) throw signal.reason;
    });

    parent.abort(new ContextCancelledError("parent cancelled"));

    await expectAsync(running).toBeRejectedWithError(ContextCancelledError, "parent cancelled");
    await expectAsync(queued).toBeRejectedWithError(ContextCancelledError, "parent cancelled");
    await expectAsync(work.wait()).toBeRejectedWithError(ContextCancelledError, "parent cancelled");
  });

  it("supports explicit cancellation and rejects new work after close", async () => {
    const work = group();
    work.cancel(new ContextCancelledError("stop group"));

    await expectAsync(work.spawn(async () => 1)).toBeRejectedWithError(
      ContextCancelledError,
      "stop group",
    );
    await expectAsync(work.wait()).toBeRejectedWithError(ContextCancelledError, "stop group");
    await expectAsync(work.spawn(async () => 2)).toBeRejectedWithError("task group is closed");
  });

  it("validates bounded concurrency", () => {
    expect(() => group({ concurrency: 0 })).toThrowError(
      RangeError,
      "group concurrency must be a positive integer",
    );
    expect(() => group({ concurrency: 1.5 })).toThrowError(
      RangeError,
      "group concurrency must be a positive integer",
    );
  });

  it("settle reports child outcomes in spawn order without throwing", async () => {
    const work = group();

    work.spawn(async () => {
      await pause(5);
      return "first";
    });
    work.spawn(async () => {
      await pause(1);
      return "second";
    });

    const report = await work.settle();

    expect(report.error).toBeUndefined();
    expect(report.outcomes).toEqual([
      { status: "fulfilled", value: "first" },
      { status: "fulfilled", value: "second" },
    ]);
    expect(work.running).toBe(0);
    expect(work.accepting).toBeFalse();
  });

  it("settle distinguishes the failing child from siblings cancelled by the group", async () => {
    const work = group();

    work.spawn(
      (signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(signal.reason),
            { once: true },
          );
        }),
    );
    work.spawn(async () => {
      await pause(1);
      throw new Error("primary failure");
    });

    const report = await work.settle();

    expect(report.error?.message).toBe("primary failure");
    expect(report.outcomes[0].status).toBe("cancelled");
    expect(report.outcomes[1]).toEqual(
      jasmine.objectContaining({
        status: "rejected",
        error: jasmine.objectContaining({ message: "primary failure" }),
      }),
    );
  });

  it("settle reports parent cancellation without turning it into a child failure", async () => {
    const parent = new AbortController();
    const work = group({ signal: parent.signal });

    work.spawn(
      (signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(signal.reason),
            { once: true },
          );
        }),
    );

    parent.abort(new ContextCancelledError("parent stopped"));
    const report = await work.settle();

    expect(report.error?.message).toBe("parent stopped");
    expect(report.outcomes).toEqual([
      jasmine.objectContaining({
        status: "cancelled",
        reason: jasmine.objectContaining({ message: "parent stopped" }),
      }),
    ]);
  });

  it("wait and settle share one stable completion report", async () => {
    const work = group();
    work.spawn(async () => 42);

    const first = await work.settle();
    await expectAsync(work.wait()).toBeResolved();
    const second = await work.settle();

    expect(second).toBe(first);
    expect(second.outcomes).toEqual([
      { status: "fulfilled", value: 42 },
    ]);
  });


});