import { ContextCancelledError, event } from "../public-api";

describe("event", () => {
  it("should block while clear and release all current waiters when set", async () => {
    const ready = event();
    const released: number[] = [];

    const first = ready.wait().then(() => released.push(1));
    const second = ready.wait().then(() => released.push(2));

    expect(ready.isSet).toBe(false);
    expect(ready.waiting).toBe(2);

    ready.set();
    await Promise.all([first, second]);

    expect(released.sort()).toEqual([1, 2]);
    expect(ready.isSet).toBe(true);
    expect(ready.waiting).toBe(0);
  });

  it("should remain set until explicitly cleared", async () => {
    const ready = event();

    ready.set();
    await ready.wait();
    await ready.wait();

    expect(ready.isSet).toBe(true);
    expect(ready.waiting).toBe(0);

    ready.clear();
    expect(ready.isSet).toBe(false);

    let released = false;
    const waiter = ready.wait().then(() => {
      released = true;
    });

    await Promise.resolve();
    expect(released).toBe(false);
    expect(ready.waiting).toBe(1);

    ready.set();
    await waiter;
    expect(released).toBe(true);
  });

  it("should support an initially set state", async () => {
    const ready = event(true);

    expect(ready.isSet).toBe(true);
    await ready.wait();
    expect(ready.waiting).toBe(0);
  });

  it("should make repeated set and clear operations idempotent", async () => {
    const ready = event();

    ready.clear();
    ready.clear();
    expect(ready.isSet).toBe(false);

    ready.set();
    ready.set();
    expect(ready.isSet).toBe(true);
    await ready.wait();

    ready.clear();
    expect(ready.isSet).toBe(false);
  });

  it("should reject a waiter whose signal is already cancelled", async () => {
    const ready = event();
    const controller = new AbortController();
    const reason = new ContextCancelledError("cancelled before waiting");
    controller.abort(reason);

    await expectAsync(ready.wait(controller.signal)).toBeRejectedWith(reason);
    expect(ready.waiting).toBe(0);
  });

  it("should withdraw only the cancelled waiter", async () => {
    const ready = event();
    const controller = new AbortController();
    const reason = new ContextCancelledError("cancel one waiter");

    const cancelled = ready.wait(controller.signal);
    const survivor = ready.wait();

    expect(ready.waiting).toBe(2);
    controller.abort(reason);

    await expectAsync(cancelled).toBeRejectedWith(reason);
    expect(ready.waiting).toBe(1);
    expect(ready.isSet).toBe(false);

    ready.set();
    await survivor;
    expect(ready.waiting).toBe(0);
  });

  it("should not let cancellation after release corrupt event state", async () => {
    const ready = event();
    const controller = new AbortController();

    const waiter = ready.wait(controller.signal);
    ready.set();
    await waiter;

    controller.abort(new Error("too late"));

    expect(ready.isSet).toBe(true);
    expect(ready.waiting).toBe(0);
    await ready.wait();
  });

  it("should be reusable across multiple set/clear generations", async () => {
    const ready = event();

    const first = ready.wait();
    ready.set();
    await first;

    ready.clear();
    const second = ready.wait();
    expect(ready.waiting).toBe(1);

    ready.set();
    await second;

    expect(ready.isSet).toBe(true);
    expect(ready.waiting).toBe(0);
  });

  it("should reject invalid initial state", () => {
    expect(() => event(1 as any)).toThrowError(
      TypeError,
      "event initial state must be a boolean"
    );
  });
});
