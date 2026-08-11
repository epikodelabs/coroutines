# Swiftly concepts

Swiftly is a concurrency library built around a small set of ownership and coordination concepts. The primitives are intentionally separate: each one owns one kind of concurrency semantics and composes with the others instead of hiding them behind a larger framework.

This document explains **what each concept means, what it owns, what it does not own, and when to use it**.

## The model at a glance

| Concept | Owns | Does not own |
| --- | --- | --- |
| `coroutine()` | Stateless worker execution, worker reuse, worker lifecycle | Concurrency policy, persistent state |
| `group()` | Structured child lifetime, FIFO admission, concurrency bounds, sibling cancellation | Worker creation, shared resource permits |
| `channel()` | Communication, buffering, backpressure, closure | Task lifetime |
| `select()` | Waiting atomically for one of several possible operations | Long-lived scheduling |
| `semaphore()` | Shared permit budget | Task ownership |
| `barrier()` | Repeated rendezvous between a fixed number of participants | Data transport |
| `event()` | Broadcast readiness state | Queued values |
| `Context` | Cancellation lifetime and deadlines | Application data |
| `sleep()` | Cancellable delay | Repetition or scheduling policy |
| `actor()` | Persistent worker identity, state, mailbox | Restart policy |
| `supervisor()` | Stable actor identity across failed generations and restart policy | State persistence |
| `compose()` | Fusing worker-backed stages behind one runner lifecycle | Streaming/backpressure |
| transfer controls | Ownership transfer across worker boundaries | Shared-memory synchronization |

The most important boundary is:

> **`group()` owns when work may start; `coroutine()` owns where worker work executes.**

## Coroutine

A coroutine is a **stateless worker-backed operation**.

```ts
import { coroutine } from '@epikodelabs/swiftly';

function expensiveHash(value: string): string {
  return value;
}

const hash = coroutine((value: string) => {
  return expensiveHash(value);
}, expensiveHash);

const result = await hash.run('hello');
```

A coroutine owns the generated worker script, lazily creates workers as concurrent calls require them, reuses idle workers, and releases those resources through `close()` or `dispose()`.

It deliberately has **no concurrency limit and no admission queue**. Calling `run()` means the operation has been admitted for execution. If an idle worker is unavailable, the coroutine may create another worker.

Use `coroutine()` when the operation is stateless and should execute away from the caller thread.

Do not use it to express how many application tasks may execute at once. That belongs to `group()`.

### Cancellation

`run()` accepts an `AbortSignal` or run options containing one:

```ts
const controller = new AbortController();

const result = hash.run('hello', controller.signal);

controller.abort();
await result.catch(() => undefined);
```

Cancelling active arbitrary JavaScript cannot safely pre-empt the function in place, so Swiftly terminates the worker executing that submission. Other coroutine workers remain independent.

### Module workers

Swiftly workers are native ES module workers. Absolute dynamic imports therefore remain ordinary JavaScript:

```ts
const normalize = coroutine(async (value: string) => {
  const { default: slugify } = await import(
    'https://esm.sh/@sindresorhus/slugify'
  );

  return slugify(value);
});
```

Swiftly does not introduce a module-loading abstraction. Browser CORS, CSP, module caching, and URL resolution still apply.

Inline coroutine functions are serialized into a generated blob module, so a relative import such as `import('./helper.js')` does not retain the source TypeScript module as its base. Use an absolute module URL when serialized coroutine code needs to import another module.

## Group

A group is the **structured owner of dynamic asynchronous work**.

```ts
import { group } from '@epikodelabs/swiftly';

const work = group({ concurrency: 4 });

const results = inputs.map((input) =>
  work.spawn((signal) => hash.run(input, signal)),
);

await work.wait();
```

Every successful `spawn()` is immediately owned by the group. With `concurrency: 4`, at most four child operations are active. Additional children remain in the group's **FIFO admission queue** and their operation functions have not started yet.

When an active child finishes, the next queued child is admitted.

This distinction matters for worker-backed work: a queued group child has not called the coroutine yet, so it does not need a coroutine worker and has not transferred its input ownership.

### Failure and cancellation

Groups are fail-fast. The first child failure:

1. closes the group to new work;
2. aborts the group signal;
3. cancels queued children before they start;
4. asks active cooperative siblings to stop through the shared signal.

`cancel()` performs the same ownership teardown explicitly.

### `wait()` and `settle()`

`wait()` closes the group, waits for every accepted child to settle, and throws the group-level failure or cancellation reason.

`settle()` closes the group but returns a non-throwing report with outcomes in **spawn order**.

```ts
const report = await work.settle();

for (const outcome of report.outcomes) {
  if (outcome.status === 'fulfilled') {
    use(outcome.value);
  }
}
```

Use `group()` whenever a scope owns a dynamic set of concurrent operations.

## Channel

A channel transports values between concurrent operations and provides **backpressure**.

```ts
const jobs = channel<Job>(8);

await jobs.send(job);

const next = await jobs.receive();
if (next.ok) {
  process(next.value);
}
```

The capacity controls how many values may wait in the channel.

- `channel(0)` is unbuffered: send and receive rendezvous.
- `channel(n)` allows up to `n` buffered values.

A channel owns communication pressure, not the lifetime of producers or consumers. Use a group to own those operations.

Closure is explicit:

```ts
const next = await jobs.receive();

if (!next.ok) {
  // closed and drained
}
```

This allows `undefined` to remain an ordinary channel value.

Channels are also async iterable.

## Select

`select()` waits for exactly one operation among several alternatives.

```ts
const result = await select([
  receive(messages, 'message'),
  send(outgoing, value, 'sent'),
  operation((signal) => fetchStatus(signal), 'status'),
  otherwise('idle'),
]);
```

Channel cases preserve channel send/receive atomicity. An `operation()` case receives its own cancellation signal; losing operations are cancelled when another case wins.

`otherwise()` expresses an immediate default branch and at most one default branch is allowed.

Use `select()` when the decision itself is *which operation becomes ready first*. Do not use it as a general scheduler.

## Semaphore

A semaphore represents a **shared permit budget**.

```ts
const database = semaphore(8);

const release = await database.acquire(signal);
try {
  await useDatabase();
} finally {
  release();
}
```

Use it when otherwise unrelated operations contend for the same limited resource.

This differs from a group concurrency limit:

- `group({ concurrency: 4 })` limits children **owned by that group** and queues their admission.
- `semaphore(4)` limits access to a resource that may be shared by many groups or unrelated operations.

If the limit exists only because one group should run four children at once, use the group rather than layering a semaphore on it.

## Barrier

A barrier is a **reusable rendezvous point** for a fixed number of participants.

```ts
const phase = barrier(3);

await phase.wait(signal);
```

No participant passes the barrier until the configured number have arrived. After release, the barrier can be used for another generation.

Use a barrier for phased algorithms where peers must all reach the same point before continuing.

A barrier does not transport values; use channels for data.

## Event

An event is a **broadcast readiness flag**.

```ts
const ready = event();

await ready.wait(signal);

// elsewhere
ready.set();
```

When set, current waiters are released and later waiters observe the set state until it is reset.

Use an event for state such as “initialization is ready” or “processing may continue.”

It is not a message queue. If every produced value matters, use a channel.

## Context

A `Context` is a **cancellation lifetime**, not an application-data container.

```ts
const [ctx, cancel] = withCancel();

try {
  await select(cases, ctx);
} finally {
  cancel();
}
```

A context exposes:

```ts
type Context = {
  readonly signal: AbortSignal;
  readonly done: Promise<void>;
  readonly reason: unknown;
};
```

`background()` returns the shared non-cancelling root context.

`withCancel()` creates a cancellable child context. `withTimeout()` and `withDeadline()` add time-based cancellation.

Application values should be passed explicitly through normal JavaScript arguments and objects.

## Timing

`sleep()` is a cancellable delay:

```ts
await sleep(250, signal);
```

Main-thread timing uses Swiftly's shared timer worker, so the delay does not depend on the caller thread's timer queue. Actor-worker timing uses the actor worker's own event loop rather than nesting another worker.

`withTimeout()` and `withDeadline()` use the same lifetime model to cancel a context after a duration or at an absolute deadline.

Swiftly intentionally does not turn timing into a scheduler. Repetition remains ordinary control flow:

```ts
while (!signal.aborted) {
  await refresh();
  await sleep(1000, signal);
}
```

## Actor

An actor is a **long-lived stateful worker** with a stable name and mailbox.

```ts
const counter = actor(
  'counter',
  (message, state: number) => {
    if (message.kind === 'actor-bus' && message.topic === 'inc') return state + 1;
    return state;
  },
  0,
);

const value = await main.outbox.request(counter, 'inc', undefined);
await main.outbox.stop(counter);
```

Unlike a coroutine, an actor owns persistent worker identity and state across messages.

Communication goes through Swiftly's actor bus rather than exposing the raw `Worker`.

Use an actor when state belongs to a long-lived worker-side behavior rather than to one independent computation.

### Mailbox capacity

An actor may bound messages waiting behind the currently executing behavior:

```ts
const service = actor(
  'service',
  behavior,
  initialState,
  { capacity: 32 },
);
```

Mailbox capacity is actor ingress pressure. It is separate from group concurrency and supervisor restart-window capacity.

## Supervisor

A supervisor owns **recovery of an actor identity across failed generations**.

```ts
const service = supervisor(
  () => actor('service', behavior, initialState),
  {
    maxRestarts: 3,
    restartDelay: 250,
    capacity: 32,
  },
);
```

The supervisor itself remains the addressable actor handle while concrete actor generations may be replaced.

Normal actor stops are not restarted. Failures consume the restart budget.

The supervisor does not persist actor state automatically. The factory creates each new generation, so checkpointing or external persistence remains application policy.

Its `capacity` has a specific meaning: it bounds traffic waiting **between generations** while a replacement is being created. It is not the actor mailbox capacity.

## Compose

`compose()` combines worker-backed stages behind one `Coroutine` lifecycle.

```ts
const pipeline = compose(parseScript, transformScript, encodeScript);

const output = await pipeline.run(input);
```

Composition is for worker-stage fusion, not for streaming dataflow.

For streaming pipelines, compose the primitives directly:

```ts
import { coroutine, group } from '@epikodelabs/swiftly';

type Job = {
  id: string;
  value: number;
};

type Result = {
  id: string;
  value: number;
};

const process = coroutine<Job, Result>((job) => {
  return {
    id: job.id,
    value: job.value * 2,
  };
});

const work = group({ concurrency: 4 });

const pending = inputs.map((job) =>
  work.spawn((signal) => process.run(job, signal)),
);

try {
  await work.wait();

  const results = await Promise.all(pending);
  console.log(results);
} finally {
  await process.dispose();
}
```

Here the channel owns backpressure, the number of spawned workers bounds
parallel processing, the group owns worker-loop lifetime and failure
propagation, and the coroutine owns worker execution.

## Transferable ownership

Worker calls can transfer ownership of transferable objects instead of structured-cloning them.

```ts
const output = await transform.run(input, {
  transfer: [input],
});
```

Worker task utilities can transfer the result back:

```ts
function mutate(bytes: Uint8Array): void {
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] ^= 0xff;
  }
}

const transform = coroutine<ArrayBuffer, ArrayBuffer>(
  (buffer) => {
    mutate(new Uint8Array(buffer));
    return transfer(buffer, buffer);
  },
  mutate,
);
```

Transfer is an ownership operation. Once posted successfully, the sender no longer owns a transferred `ArrayBuffer`.

Because group admission happens before coroutine execution, transferables belonging to group-queued operations remain with the caller until that child is actually admitted and invokes the coroutine.

Swiftly does not wrap `SharedArrayBuffer` or `Atomics`; those platform primitives already provide shared-memory semantics.

## Choosing between neighboring concepts

### Group or semaphore?

Use a **group** when the tasks belong to one structured scope and that scope should admit only N at once.

Use a **semaphore** when many otherwise independent operations share one scarce resource.

### Coroutine or actor?

Use a **coroutine** for independent stateless computations.

Use an **actor** when worker-local identity or state must survive across messages.

### Channel or event?

Use a **channel** when values must be delivered and backpressure matters.

Use an **event** when only a readiness condition matters.

### Channel or barrier?

Use a **channel** to move data.

Use a **barrier** to synchronize phases.

### Group or supervisor?

A **group** owns a finite set of child operations and fails/cancels them as one structured scope.

A **supervisor** owns a long-lived actor identity and may replace failed generations.

### Compose or channels?

Use **`compose()`** when several worker-backed transformations should behave as one task runner.

Use **channels + groups** when values flow continuously and backpressure/lifetime need to remain explicit.

## Design principle

Swiftly's primitives are small because ownership stays explicit.

A useful way to read Swiftly code is to ask:

1. **Who owns this work?** — usually a `group`, actor, or supervisor.
2. **Where does it execute?** — a coroutine or actor worker.
3. **How does data move?** — ordinary values, channels, actor messages, or transferables.
4. **How is pressure bounded?** — group concurrency, channel capacity, semaphore permits, or mailbox capacity.
5. **How does it stop?** — `AbortSignal`, `Context`, group cancellation, runner lifecycle, or actor lifecycle.

If one primitive appears to answer several of those questions at once, it is worth checking whether two smaller Swiftly concepts should be composed instead.
