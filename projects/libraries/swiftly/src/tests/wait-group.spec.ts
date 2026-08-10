import { ContextCancelledError, waitGroup } from "../public-api";

describe("waitGroup", () => {
  it("starts idle and resolves wait immediately", async () => {
    const group = waitGroup();

    expect(group.count).toBe(0);
    expect(group.waiting).toBe(0);
    await group.wait();
    expect(group.waiting).toBe(0);
  });

  it("waits until every outstanding operation is done", async () => {
    const group = waitGroup();
    group.add(3);

    let released = false;
    const waiting = group.wait().then(() => {
      released = true;
    });

    expect(group.count).toBe(3);
    expect(group.waiting).toBe(1);

    group.done();
    group.done();
    await Promise.resolve();
    expect(released).toBe(false);
    expect(group.count).toBe(1);

    group.done();
    await waiting;

    expect(released).toBe(true);
    expect(group.count).toBe(0);
    expect(group.waiting).toBe(0);
  });

  it("releases every waiter when the count reaches zero", async () => {
    const group = waitGroup();
    group.add();

    const first = jasmine.createSpy("first");
    const second = jasmine.createSpy("second");
    const wait1 = group.wait().then(first);
    const wait2 = group.wait().then(second);

    expect(group.waiting).toBe(2);
    group.done();
    await Promise.all([wait1, wait2]);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(group.waiting).toBe(0);
  });

  it("allows work to be added while a generation is active", async () => {
    const group = waitGroup();
    group.add();

    let released = false;
    const waiting = group.wait().then(() => {
      released = true;
    });

    group.add(2);
    expect(group.count).toBe(3);

    group.done();
    group.done();
    await Promise.resolve();
    expect(released).toBe(false);

    group.done();
    await waiting;
    expect(released).toBe(true);
  });

  it("is reusable after one generation reaches zero", async () => {
    const group = waitGroup();

    group.add();
    const first = group.wait();
    group.done();
    await first;

    group.add(2);
    let secondReleased = false;
    const second = group.wait().then(() => {
      secondReleased = true;
    });

    group.done();
    await Promise.resolve();
    expect(secondReleased).toBe(false);

    group.done();
    await second;
    expect(secondReleased).toBe(true);
  });

  it("cancels one waiter without changing outstanding work", async () => {
    const group = waitGroup();
    const controller = new AbortController();
    group.add();

    const cancelled = group.wait(controller.signal);
    const survivor = group.wait();
    expect(group.waiting).toBe(2);

    controller.abort(new ContextCancelledError("stop waiting"));
    await expectAsync(cancelled).toBeRejectedWithError(ContextCancelledError, "stop waiting");

    expect(group.count).toBe(1);
    expect(group.waiting).toBe(1);

    group.done();
    await survivor;
    expect(group.count).toBe(0);
    expect(group.waiting).toBe(0);
  });

  it("rejects immediately for an already-aborted signal", async () => {
    const group = waitGroup();
    const controller = new AbortController();
    controller.abort("cancelled");
    group.add();

    await expectAsync(group.wait(controller.signal)).toBeRejectedWithError(
      ContextCancelledError,
      "cancelled"
    );

    expect(group.waiting).toBe(0);
    expect(group.count).toBe(1);
  });

  it("rejects invalid add counts", () => {
    const group = waitGroup();

    expect(() => group.add(0)).toThrowError(RangeError);
    expect(() => group.add(-1)).toThrowError(RangeError);
    expect(() => group.add(1.5)).toThrowError(RangeError);
    expect(group.count).toBe(0);
  });

  it("throws instead of allowing the count to become negative", () => {
    const group = waitGroup();

    expect(() => group.done()).toThrowError(
      "wait group done called with no outstanding work"
    );
    expect(group.count).toBe(0);
  });
});