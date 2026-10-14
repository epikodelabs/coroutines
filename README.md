# Coroutines

`@epikodelabs/coroutines` is a browser-first TypeScript library for running CPU-bound work in module Web Workers and coordinating asynchronous work with structured ownership, channels, cancellation, actors, and supervision.

Use it when application work should be explicit about four things: where it runs, who owns its lifetime, how values move, and how it stops. It has no framework dependency and works wherever modern module Web Workers are available.

## Installation

```sh
npm install @epikodelabs/coroutines
```

## Start here

Define worker code with `coroutine()`, create its executor from a `group()`, run it, then settle the group when the work is complete:

```ts
import { coroutine, group } from '@epikodelabs/coroutines';

function square(value: number): number {
  return value * value;
}

const work = group();
const squares = work.executor(coroutine(square));

try {
  const result = await squares.run(12);
  console.log(result); // 144
} finally {
  await work.settle();
}
```

The function passed to `coroutine()` is serialized into a worker. Pass every helper it uses explicitly; outer variables and functions are not captured automatically:

```ts
function normalize(value: string): string {
  return value.trim().toLowerCase();
}

const clean = coroutine(
  (value: string) => normalize(value),
  normalize,
);
```

`group()` owns the executor's workers. `settle()` stops new work, waits for admitted work to finish, and releases those workers. `cancel()` ends the group and its active worker work immediately.

## Run bounded parallel work

Give a group a concurrency limit to own a batch of asynchronous operations. Excess operations wait in FIFO order, and the first failure cancels the remaining work.

```ts
import { coroutine, group } from '@epikodelabs/coroutines';

function checksum(text: string): string {
  return text;
}

const pool = group();
const hash = pool.executor(coroutine(checksum));
const batch = group({ concurrency: 4 });

const pending = inputs.map((input) =>
  batch.spawn((signal) => hash.run(input, signal)),
);

try {
  await batch.wait();
  const results = await Promise.all(pending);
  console.log(results);
} finally {
  await pool.settle();
}
```

Use the same `AbortSignal` pattern for an individual run:

```ts
const controller = new AbortController();
const result = hash.run('large input', controller.signal);

controller.abort();
await result.catch(() => undefined);
```

For an executor-specific worker cap, pass `{ maxWorkers }` to `executor()`. This limits worker creation; group concurrency remains the right tool for a structured batch's admission policy.

## Choose the right primitive

| Need | Use |
| --- | --- |
| Stateless CPU work off the main thread | `coroutine()` with `group().executor()` |
| A finite owned set of async operations | `group()` |
| Values flowing between concurrent operations | `channel()` |
| Wait for the first of several operations | `select()` |
| A shared resource limit across unrelated work | `semaphore()` |
| A cancellation lifetime or deadline | `withCancel()`, `withTimeout()`, or `withDeadline()` |
| A persistent stateful worker | `actor()` |
| Restart a failed actor while keeping its address stable | `supervisor()` |
| Fuse worker transformations into one task | `compose()` |
| Sequence existing runnable steps | `pipeline()` |

The standalone coordination utilities are useful without workers too:

```ts
import {
  channel,
  receive,
  operation,
  otherwise,
  select,
} from '@epikodelabs/coroutines';

const messages = channel<string>(8);

const selected = await select([
  receive(messages, 'message'),
  operation((signal) => fetch('/status', { signal }), 'status'),
  otherwise('idle'),
]);

if (selected.name === 'message') {
  console.log(selected.value);
}
```

Channels provide buffering and backpressure. Close a producer-owned channel when no more values will arrive; consumers can then finish naturally with `for await ... of`.

## Persistent worker state

Actors are for state that should remain in a dedicated worker across messages. Communicate through the actor bus and stop the actor when it is no longer needed:

```ts
import { actor, main } from '@epikodelabs/coroutines';

const counter = actor(
  'counter',
  (message, state: number) => {
    if (message.kind === 'actor-bus' && message.topic === 'increment') {
      return state + 1;
    }
    return state;
  },
  0,
);

try {
  const value = await main.outbox.request(counter, 'increment', undefined);
  console.log(value); // 1
} finally {
  await main.outbox.stop(counter);
}
```

Use `supervisor(() => actor(...))` when an actor should be replaced after a worker failure. A supervisor preserves the public actor identity; restoring state for a replacement is application policy.

## Transfers and imports

Pass a transfer list when moving a transferable to a coroutine worker without cloning it:

```ts
const output = await executor.run(buffer, { transfer: [buffer] });
```

After a successful post, the sender no longer owns a transferred object such as an `ArrayBuffer`.

Coroutine and actor workers are native ES module workers. Absolute dynamic imports work normally inside worker code; use an absolute URL rather than a relative import from an inline serialized coroutine.

## Read next

- [Concepts](https://github.com/epikodelabs/coroutines/blob/main/docs/CONCEPTS.md) explains ownership boundaries and how to choose between neighboring primitives.
- [Coroutines reference](https://github.com/epikodelabs/coroutines/blob/main/docs/COROUTINES.md) documents the full API, lifecycle semantics, options, and edge cases.
- [Changelog](./CHANGELOG.md) lists release history.

## License

MIT
