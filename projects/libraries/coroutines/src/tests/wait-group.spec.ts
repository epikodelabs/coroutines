import {
  ContextCancelledError,
  WaitGroup,
  waitGroup,
} from "../public-api";

describe("wait group", () => {
  const pause = (ms = 5) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  it("tracks dynamic outstanding work and rejects accounting bugs", () => {
    const downloads: WaitGroup = waitGroup();

    expect(downloads.count).toBe(0);
    downloads.add(3);
    expect(downloads.count).toBe(3);

    downloads.done();
    downloads.done();
    expect(downloads.count).toBe(1);

    // An extra done() is an accounting bug, not a silent no-op.
    downloads.done();
    expect(() => downloads.done()).toThrowError(/no outstanding work/);

    expect(() => downloads.add(0)).toThrowError(/positive integer/);
    expect(() => downloads.add(-1)).toThrowError(/positive integer/);
    expect(() => downloads.add(1.5)).toThrowError(/positive integer/);
  });

  it("waits until the count reaches zero", async () => {
    const downloads = waitGroup();
    let finished = false;

    downloads.add();
    const waiter = downloads.wait().then(() => {
      finished = true;
    });

    await pause(5);
    expect(finished).toBeFalse();

    downloads.done();
    await waiter;
    expect(finished).toBeTrue();
  });

  it("resolves immediately when nothing is outstanding", async () => {
    const downloads = waitGroup();
    await downloads.wait();
  });

  it("releases every waiter when the count reaches zero", async () => {
    const downloads = waitGroup();
    downloads.add();

    let released = 0;
    const first = downloads.wait().then(() => void released++);
    const second = downloads.wait().then(() => void released++);
    expect(downloads.waiting).toBe(2);

    downloads.done();
    await Promise.all([first, second]);
    expect(released).toBe(2);
    expect(downloads.waiting).toBe(0);
  });

  it("cancelling withdraws only that waiter and leaves the count untouched", async () => {
    const downloads = waitGroup();
    downloads.add();

    const controller = new AbortController();
    const cancelled = downloads.wait(controller.signal);
    const patient = downloads.wait();

    controller.abort(new ContextCancelledError("waiter cancelled"));
    await expectAsync(cancelled).toBeRejectedWithError(ContextCancelledError);

    expect(downloads.waiting).toBe(1);
    expect(downloads.count).toBe(1);

    downloads.done();
    await patient;
  });

  it("rejects waiters on an already-aborted signal", async () => {
    const downloads = waitGroup();
    downloads.add();

    const controller = new AbortController();
    controller.abort(new ContextCancelledError("waiter cancelled"));

    await expectAsync(downloads.wait(controller.signal)).toBeRejectedWithError(
      ContextCancelledError,
    );
  });

  it("starts a new generation after the count reaches zero", async () => {
    const downloads = waitGroup();

    downloads.add();
    downloads.done();
    await downloads.wait();

    downloads.add(2);
    expect(downloads.count).toBe(2);

    const next = downloads.wait();
    await pause(5);
    downloads.done();
    downloads.done();

    await next;
    expect(downloads.count).toBe(0);
  });
});
