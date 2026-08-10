# @epikodelabs/swiftly

Concurrent JavaScript built around workers, structured task ownership, channels, actors, and cancellation.

Swiftly treats concurrency as a programming model rather than exposing Web Workers as application infrastructure. Worker-backed computation, coordination, cancellation, and long-lived actors share one small set of primitives.

## Core model

- `coroutine()` — reusable sequential submissions on one dedicated worker.
- `compute()` — pooled worker execution for independent parallel submissions.
- `group()` — structured ownership for dynamic concurrent work, with fail-fast sibling cancellation and optional concurrency bounds.
- `channel()` + `select()` — communication and coordination. `select()` can also race cancellable `operation()` cases.
- `background()`, `withCancel()`, `withTimeout()`, `withDeadline()` — cancellation and lifetime propagation.
- `actor()` — long-lived stateful workers with messaging and observable termination.
- `semaphore()`, `barrier()`, `waitGroup()`, `event()` — synchronization primitives with distinct semantics.
- `sleep()` — worker-backed timing integrated with cancellation contexts.

## Structured concurrent work

A task group owns every child started through it. The first child failure aborts the group's signal, siblings receive that cancellation, and `wait()` does not complete until all started children have settled.

```ts
import { compute, group } from '@epikodelabs/swiftly';

const hash = compute<string, string>((value) => expensiveHash(value));
const work = group({ concurrency: 4 });

const results = inputs.map((input) =>
  work.spawn((signal) => hash(input, signal)),
);

try {
  await work.wait();
  console.log(await Promise.all(results));
} finally {
  await hash.dispose();
}
```

`group({ concurrency: 4 })` bounds child execution without changing the child operation itself. Unlike `Promise.all()`, the group owns cancellation and failure propagation.

Calling `wait()` closes the group to new work. Cancelling the parent signal or calling `group.cancel()` propagates to running children and to children waiting for a concurrency permit.

## Cancellable worker submissions

`Coroutine.run()` and compute runners accept an optional `AbortSignal`:

```ts
const parse = coroutine((text: string) => parseLargeDocument(text));
const controller = new AbortController();

const result = parse.run(source, controller.signal);
controller.abort();
```

A worker task cannot be pre-empted safely inside arbitrary JavaScript, so Swiftly cancels an active worker submission by terminating that worker. Dedicated coroutine workers are recreated for later queued work; compute pools retire only the cancelled worker and restore pool capacity. Queued submissions can be cancelled without starting a worker task.

`compose()` forwards the same cancellation signal through every runner stage.

## Channels and selection

```ts
const messages = channel<string>();

const selected = await select([
  receive(messages, 'message'),
  operation((signal) => fetch('/status', { signal }), 'status'),
]);
```

When an operation case loses selection, its `AbortSignal` is cancelled. Channel selection keeps its atomic send/receive semantics.

## Actors

Actors are long-lived stateful workers. Communication happens through the actor bus instead of exposing the Worker object directly.

```ts
const counter = actor('counter', (message, state: number) => {
  if (message.topic === 'inc') return state + 1;
  return state;
}, 0);

main.outbox.send(counter, 'inc', undefined);

const exit = await counter.done;
```

`actor.done` resolves once with either a normal stop or worker failure, providing the lifecycle primitive needed for higher-level supervision without baking restart policy into the actor itself.

## Timing

Swiftly's main-thread timing operations use a shared timer worker. `sleep()`, `withTimeout()`, and `withDeadline()` therefore do not depend on the caller thread's timer queue. Inside an actor worker, `sleep()` uses that worker's own event loop rather than creating a nested worker.

## Design rule

Swiftly keeps the core deliberately small. A public abstraction belongs here only when it contributes semantics that cannot be expressed cleanly by composing existing primitives. Convenience wrappers should stay outside the core.


## Actor supervision

Long-lived actors can be owned by a supervisor when worker failure should be
recoverable without changing the address used by callers.

```ts
const service = supervisor(
  () => actor("service", behavior, initialState),
  {
    maxRestarts: 3,
    restartDelay: 250,
  },
);

main.outbox.send(service, "refresh", undefined);

const exit = await service.done;
```

A supervisor is itself an `Actor` handle, so `main.outbox.send`, `request`, and
`stop` use the stable supervisor identity rather than a particular worker
generation. Normal actor stops are never restarted. Worker failures consume the
restart budget; once it is exhausted, `done` resolves with the terminal error.

Supervision deliberately restarts from the factory's initial state. State
persistence/checkpointing is application policy and is not hidden inside the
concurrency runtime.


### Cancellable actor requests

Main-to-actor requests accept an `AbortSignal`. Cancelling a request withdraws
only that caller's pending response; it does not terminate the actor generation.

```ts
const controller = new AbortController();

const result = main.outbox.request(
  service,
  "lookup",
  query,
  controller.signal,
);

controller.abort();
```

This composes actor request lifetimes with task groups and contexts without
inventing a separate timeout/retry API.


## Bounded compute admission

`compute()` can bound both execution and waiting work:

```ts
const hash = compute(
  (value: string) => expensiveHash(value),
  {
    concurrency: 4,
    maxQueued: 16,
  },
);
```

`concurrency` is the maximum worker count. `maxQueued` is the maximum number of
submissions allowed to wait for a worker after the pool is saturated. When that
queue is full, further submissions reject immediately instead of growing an
unbounded backlog.

Compute runners expose `concurrency`, `active`, and `queued` so pressure can be
observed without exposing Worker objects.

## Channel closure is explicit

Channel receive results distinguish a value from closure:

```ts
const result = await ch.receive();

if (!result.ok) {
  // closed and drained
  return;
}

use(result.value);
```

This means every JavaScript value, including `undefined`, can travel through a
channel without being confused with end-of-stream. Async iteration follows the
same rule internally and stops only after an explicit closed result.

## Streaming work by composition

Swiftly does not add a separate pipeline abstraction for bounded streaming work.
Channels provide backpressure, groups own lifetime and failure propagation, and
compute owns worker parallelism:

```ts
const input = channel<Job>(8);
const output = channel<Result>(8);
const workers = group({ concurrency: 4 });

for (let i = 0; i < 4; i++) {
  workers.spawn(async (signal) => {
    while (true) {
      const next = await input.receive(signal);
      if (!next.ok) return;

      const result = await process(next.value, signal);
      await output.send(result, signal);
    }
  });
}
```

The composition remains explicit: channel capacity bounds data in flight, group
concurrency bounds owned operations, and compute pool settings bound worker and
queue pressure.


## Graceful lifecycle

Worker-backed task runners distinguish graceful closure from immediate teardown.

```ts
const worker = compute(expensiveWork, {
  concurrency: 4,
  maxQueued: 16,
});

// Already-admitted work is allowed to finish.
await worker.close();

// New submissions are rejected after close begins.
```

`close()` means **stop accepting, drain, release**. It is idempotent and is the
normal lifecycle boundary when submitted work must not be lost.

`dispose()` means **terminate now**. Active and queued work is rejected and
worker resources are released immediately.

The same contract is shared by `coroutine()`, `compute()`, `computeScript()`,
and `compose()`. `compose().close()` attempts to close every owned stage even if
one stage reports an error, mirroring its immediate-disposal cleanup behavior.

This distinction is intentionally part of `TaskRunner` rather than separate
helpers: graceful ownership and forced teardown are different concurrency
semantics.
