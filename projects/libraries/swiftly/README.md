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
