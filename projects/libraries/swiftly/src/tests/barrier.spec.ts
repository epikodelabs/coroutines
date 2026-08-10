import {
  barrier,
  ContextCancelledError,
} from "../public-api";

describe("barrier", () => {
  it("should require a positive integer participant count", () => {
    expect(() => barrier(0)).toThrowError(/positive integer/);
    expect(() => barrier(-1)).toThrowError(/positive integer/);
    expect(() => barrier(1.5)).toThrowError(/positive integer/);
  });

  it("should release all waiters when every participant arrives", async () => {
    const sync = barrier(3);
    const order: string[] = [];

    const first = sync.wait().then(() => order.push("first"));
    const second = sync.wait().then(() => order.push("second"));

    await Promise.resolve();
    expect(sync.waiting).toBe(2);
    expect(order).toEqual([]);

    const third = sync.wait().then(() => order.push("third"));
    await Promise.all([first, second, third]);

    expect(sync.waiting).toBe(0);
    expect(order.length).toBe(3);
  });

  it("should automatically start a new generation after release", async () => {
    const sync = barrier(2);

    await Promise.all([sync.wait(), sync.wait()]);
    expect(sync.waiting).toBe(0);

    let released = false;
    const first = sync.wait().then(() => {
      released = true;
    });

    await Promise.resolve();
    expect(released).toBeFalse();
    expect(sync.waiting).toBe(1);

    await Promise.all([first, sync.wait()]);
    expect(released).toBeTrue();
    expect(sync.waiting).toBe(0);
  });

  it("should withdraw a cancelled arrival from the current generation", async () => {
    const sync = barrier(2);
    const controller = new AbortController();
    const cancelled = sync.wait(controller.signal);

    expect(sync.waiting).toBe(1);
    controller.abort(new ContextCancelledError("stopped"));

    await expectAsync(cancelled).toBeRejectedWithError(/stopped/);
    expect(sync.waiting).toBe(0);

    let released = false;
    const first = sync.wait().then(() => {
      released = true;
    });

    await Promise.resolve();
    expect(released).toBeFalse();

    await Promise.all([first, sync.wait()]);
    expect(released).toBeTrue();
  });

  it("should reject immediately for an already-aborted signal", async () => {
    const sync = barrier(2);
    const controller = new AbortController();
    controller.abort(new ContextCancelledError("already stopped"));

    await expectAsync(sync.wait(controller.signal)).toBeRejectedWithError(/already stopped/);
    expect(sync.waiting).toBe(0);
  });

  it("should release immediately when configured for one participant", async () => {
    const sync = barrier(1);

    await sync.wait();
    expect(sync.waiting).toBe(0);
  });
});
