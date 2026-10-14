# Coroutines

`@epikodelabs/coroutines` runs CPU-heavy work in Web Workers without blocking the main thread.

A `coroutine(...)` is an **immutable worker-task definition**: the serialized task body, its helper functions, and any raw helper snippets. It owns nothing at runtime — no workers, no lifecycle, no concurrency policy. A definition runs through a **group-owned executor**, `group().executor(def)`, which owns the worker pool and its lifetime.

> **The most important boundary**:
> `coroutine()` defines worker code; `group().executor()` owns when and where it runs.

Use `coroutine(...)` when you need:
- background computation
- a stateless task executed away from the caller thread
- one reusable worker script shared by many calls
- worker-stage fusion of several steps through `compose(...)`

Do not use it to express how many operations may run at once — that belongs to `group()` (or `semaphore()`). If you need a long-lived worker with identity, state, and messaging, use `actor(...)` instead.

For the full concept-by-concept guide, see [concepts.md](./concepts.md).

---

## What a coroutine is

```text
your function -> worker script -> group-owned executor -> run(...)
```

1. You provide a task function (and any helpers it needs).
2. `coroutine(...)` turns them into an immutable definition — worker code and metadata.
3. `group().executor(definition)` creates a worker pool whose lifetime belongs to that group.
4. Calls to `run(data)` are executed on that pool's workers.

A coroutine is not a pool, a queue, or a lifecycle owner. It owns code only.

---

## Quick Start

```ts
import { coroutine, group } from "@epikodelabs/coroutines";

const primes = coroutine<number, number[]>(function findPrimes(limit) {
  const result: number[] = [];

  for (let n = 2; n <= limit; n++) {
    let isPrime = true;
    for (let d = 2; d * d <= n; d++) {
      if (n % d === 0) {
        isPrime = false;
        break;
      }
    }
    if (isPrime) result.push(n);
  }

  return result;
});

const pool = group();
const executor = pool.executor(primes);

const values = await executor.run(10_000);
await pool.settle(); // drains admitted runs, closes the pool
```

---

## Defining a coroutine

```ts
import { coroutine } from "@epikodelabs/coroutines";

const hash = coroutine<string, string>(
  (value) => expensiveHash(value),
  expensiveHash,
);
```

A coroutine worker receives only the serialized task body plus any helper functions passed after it. **Referenced outer-scope functions are not captured automatically** — `expensiveHash` must be listed explicitly so it is serialized into the worker script. A body that references a function that was not passed fails fast inside the worker with a `ReferenceError` naming the missing helper.

The task function receives a second argument with worker utilities (see [Transferable ownership](#transferable-ownership)) and may be `async`.

There are two ways to give a worker extra code.

### Positional helper functions

Use this for normal helper code you control:

```ts
const worker = coroutine<number, number>(
  async function task(input) {
    return double(await delayValue(input));
  },
  function double(value) {
    return value * 2;
  },
  async function delayValue(value) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return value;
  },
);
```

### Trailing `helpers` option

Use this for raw worker-side snippets that cannot be expressed as normal functions:

```ts
import { coroutine } from "@epikodelabs/coroutines";

declare const injected: (value: number) => number;

const worker = coroutine<number, number>(
  function task(input) {
    return injected(input);
  },
  {
    helpers: [
      "const SCALE = 2;",
      "function injected(value) { return value * SCALE; }",
    ],
  },
);
```

---

## Running a definition: `group().executor()`

Definitions do not run themselves. A worker pool is created inside a structured scope, and the scope owns it:

```ts
import { coroutine, group } from "@epikodelabs/coroutines";

const pool = group();
const executor = pool.executor(hash, { maxWorkers: 8 });

const result = await executor.run("hello");
await pool.settle();
```

- `executor(def, options?)` creates the pool and ties its lifetime to the group.
- `settle()`/`wait()` stop the pool from accepting new runs, let already-admitted runs finish, terminate the workers, and await that teardown before resolving. After the group settled, `run()` rejects with `GroupClosedError`.
- `cancel()` — or a sibling failure — disposes the pool immediately and rejects active runs.
- The pool is created lazily: an unused executor costs nothing. Executors created by an ancestor group survive this group's settlement, so shared pools belong to the nearest shared parent scope.

The executor deliberately has **no concurrency limit and no admission queue**. Calling `run()` means the operation has been admitted for execution. If an idle worker is unavailable, the executor may create another worker. Bounding how many operations run at once belongs to `group({ concurrency })`:

```ts
const pool = group();
const executor = pool.executor(hash); // the pool's workers belong to the group
const work = group({ concurrency: 4 });

const results = inputs.map((input) =>
  work.spawn((signal) => executor.run(input, signal)),
);

await work.wait();
await pool.settle();
```

### Elastic workers

The worker script is baked once. On `run()`, the executor reuses an idle worker if one exists; otherwise it lazily creates another for that concurrent invocation. Completed workers return to the executor's reusable worker list.

- `maxWorkers` caps how many workers one executor may own. When the cap is reached and no worker is idle, further submissions wait FIFO for the next worker to free up (cancellable through their signal). This is a resource cap on worker creation — not a scheduling policy.
- `idleTimeout` reaps workers that stay idle longer than the given number of milliseconds; the next `run()` recreates one on demand. Without it, workers are kept for the lifetime of the group.
- `size` exposes the number of workers the executor currently owns:

```ts
const executor = pool.executor(hash, { idleTimeout: 30_000 });
executor.size; // owned worker count right now
```

### Cancelling a submission

`run()` accepts an `AbortSignal` or run options containing one:

```ts
const controller = new AbortController();

const result = executor.run("hello", controller.signal);

controller.abort();
await result.catch(() => undefined);
```

Cancelling active arbitrary JavaScript cannot safely pre-empt the function in place, so Coroutines terminates **only the worker that owns that submission**. Concurrent sibling submissions continue on their own workers. Work waiting behind a `group()` concurrency permit — or behind a `maxWorkers` cap — can be cancelled before a worker is ever needed.

---

## Compose

`compose()` fuses multiple definitions into **one** immutable definition:

```ts
import { compose, coroutine } from "@epikodelabs/coroutines";

const decode = coroutine<string, { value: number }>(function decode(input) {
  return JSON.parse(input);
});

const project = coroutine<{ value: number }, number>(function project(input) {
  return input.value;
});

const fused = compose(decode, project);

const pool = group();
const result = await pool.executor(fused).run('{"value":42}'); // 42
await pool.settle();
```

- `compose()` accepts only definitions produced by `coroutine()` (or another `compose()`); anything else throws a `TypeError`. Nested composes are flattened into their leaf stages.
- The stages are merged into one worker script and run inside a single worker task per invocation — intermediate results never cross a worker boundary.
- The result is a definition like any other: it owns no workers and has no lifecycle. The input definitions are untouched and reusable.

Composition is for worker-stage fusion, not for streaming dataflow — for continuous flows, use channels and groups.

### Main-thread sequencing: `pipeline()`

When stages must run on the main thread — or when already-owned executors need chaining — `pipeline()` orders runnable steps sequentially:

```ts
import { pipeline } from "@epikodelabs/coroutines";

const chain = pipeline(stepOne, groupA.executor(def), stepTwo);
const output = await chain.run(input);
```

A pipeline owns nothing: steps keep their own groups and worker pools. The run signal is forwarded to every step; an input transfer list applies to the first step only. Steps are drained per executor — settle each pool's group to close it. `pipeline()` itself has no `close()`/`dispose()`/`size`: there is nothing for it to own.

---

## Transferable ownership

Worker calls can transfer ownership of transferable objects instead of structured-cloning them:

```ts
const pool = group();
const transform = pool.executor(def);

const result = await transform.run(buffer, { transfer: [buffer] });

// `buffer` is detached once it is posted to the worker.
```

Worker task functions can transfer the result back through the injected utilities:

```ts
function mutate(bytes: Uint8Array): void {
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] ^= 0xff;
  }
}

const transform = coroutine<ArrayBuffer, ArrayBuffer>(
  (buffer, { transfer }) => {
    mutate(new Uint8Array(buffer));
    return transfer(buffer, buffer);
  },
  mutate,
);
```

The rules, precisely:

- The transfer wrapper is worker-internal: callers receive the value directly, never a wrapper object.
- Duplicate entries in a transfer list are rejected before the post where Coroutines owns the list.
- A submission transfers its objects only when it is actually posted to a worker. Cancellation before worker execution — including sitting behind a group permit — leaves its transferables owned by the caller.

Transfer is an ownership operation: once posted successfully, the sender no longer owns a transferred `ArrayBuffer`. Coroutines does not wrap `SharedArrayBuffer` or `Atomics`; those platform primitives already provide shared-memory semantics.

---

## Module workers and imports

Coroutines workers are native ES module workers. Absolute dynamic imports therefore remain ordinary JavaScript:

```ts
const normalize = coroutine(async (value: string) => {
  const { default: slugify } = await import(
    "https://esm.sh/@sindresorhus/slugify"
  );

  return slugify(value);
});
```

Coroutines does not introduce a module-loading abstraction. Browser CORS, CSP, module caching, and URL resolution still apply.

Inline coroutine functions are serialized into a generated blob module, so a relative import such as `import('./helper.js')` does not retain the source TypeScript module as its base. Use an absolute module URL when serialized coroutine code needs to import another module.

---

## Rules

- Prefer `function` expressions for worker tasks and helper functions.
- Keep worker code self-contained.
- Do not rely on variables from outer lexical scope.
- Pass helper functions explicitly when the worker needs them.
- Use trailing `helpers` only for raw injected snippets that cannot be expressed as normal helper functions.
- Run definitions through `group().executor()` and let the group own the pool's lifetime — `settle()`/`wait()` to drain, `cancel()` to dispose.
- Use `group({ concurrency })` to bound how many operations run at once; `maxWorkers` only caps how many workers one executor may own.

---

## When To Use `actor(...)` Instead

Use `actor(...)` when the worker needs:
- request/response with the main thread
- one-way worker-to-main events
- one-way main-to-worker messages
- worker-local concurrency primitives plus a main-thread bridge
- long-lived state that evolves over time

Unlike a coroutine, an actor owns persistent worker identity and state across messages. See [concepts.md](./concepts.md) for actors, supervisors, channels, and the rest of the model.
