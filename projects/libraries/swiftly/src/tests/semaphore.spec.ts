import {
  ContextCancelledError,
  semaphore,
} from "../public-api";

describe("semaphore", () => {
  it("should require a positive integer capacity", () => {
    expect(() => semaphore(0)).toThrowError(/positive integer/);
    expect(() => semaphore(-1)).toThrowError(/positive integer/);
    expect(() => semaphore(1.5)).toThrowError(/positive integer/);
  });

  it("should expose capacity and available permits", async () => {
    const sem = semaphore(2);

    expect(sem.capacity).toBe(2);
    expect(sem.available).toBe(2);
    expect(sem.waiting).toBe(0);

    const release = await sem.acquire();
    expect(sem.available).toBe(1);

    release();
    expect(sem.available).toBe(2);
  });

  it("should block once all permits are acquired", async () => {
    const sem = semaphore(1);
    const releaseFirst = await sem.acquire();
    let acquiredSecond = false;

    const second = sem.acquire().then((release) => {
      acquiredSecond = true;
      return release;
    });

    await Promise.resolve();
    expect(acquiredSecond).toBeFalse();
    expect(sem.waiting).toBe(1);

    releaseFirst();
    const releaseSecond = await second;

    expect(acquiredSecond).toBeTrue();
    expect(sem.available).toBe(0);
    releaseSecond();
    expect(sem.available).toBe(1);
  });

  it("should grant waiting callers in FIFO order", async () => {
    const sem = semaphore(1);
    const first = await sem.acquire();
    const order: number[] = [];

    const second = sem.acquire().then((release) => {
      order.push(2);
      return release;
    });
    const third = sem.acquire().then((release) => {
      order.push(3);
      return release;
    });

    first();
    const releaseSecond = await second;
    expect(order).toEqual([2]);

    releaseSecond();
    const releaseThird = await third;
    expect(order).toEqual([2, 3]);

    releaseThird();
  });

  it("tryAcquire should never wait", async () => {
    const sem = semaphore(1);
    const release = sem.tryAcquire();

    expect(release).toBeDefined();
    expect(sem.tryAcquire()).toBeUndefined();

    release!();
    expect(sem.tryAcquire()).toBeDefined();
  });

  it("should cancel a waiting acquisition without consuming a permit", async () => {
    const sem = semaphore(1);
    const release = await sem.acquire();
    const controller = new AbortController();
    const waiting = sem.acquire(controller.signal);

    expect(sem.waiting).toBe(1);
    controller.abort(new ContextCancelledError("stopped"));

    await expectAsync(waiting).toBeRejectedWithError(/stopped/);
    expect(sem.waiting).toBe(0);

    release();
    expect(sem.available).toBe(1);
  });

  it("should reject immediately for an already-aborted signal", async () => {
    const sem = semaphore(1);
    const controller = new AbortController();
    controller.abort(new ContextCancelledError("already stopped"));

    await expectAsync(sem.acquire(controller.signal)).toBeRejectedWithError(/already stopped/);
    expect(sem.available).toBe(1);
  });

  it("release should be idempotent", async () => {
    const sem = semaphore(1);
    const release = await sem.acquire();

    release();
    release();

    expect(sem.available).toBe(1);
  });
});
