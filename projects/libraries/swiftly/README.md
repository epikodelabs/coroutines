# @epikodelabs/swiftly

Concurrent JavaScript built around workers, structured task ownership, channels, actors, and cancellation.

Swiftly treats concurrency as a programming model rather than exposing Web Workers as application infrastructure. Worker-backed computation, coordination, cancellation, and long-lived actors share one small set of primitives.

## Core model

- `coroutine()` — reusable sequential submissions on one dedicated worker.
- `compute()` — reusable multi-worker execution for independent parallel submissions, including zero-copy transfer ownership.
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

This example has one explicit concurrency policy: `group({ concurrency: 4 })`. At most four group children may execute at once, so at most four `hash()` calls can be active at once.

`compute()` does not choose another worker count underneath that policy. It owns a reusable list of workers: an idle worker is reused when available, otherwise another worker is created lazily for the concurrent call. As a result, this operation needs at most four compute workers because the group admits at most four concurrent calls.

The responsibilities are intentionally separate:

- `group()` owns task lifetime, failure propagation, cancellation, and concurrency.
- `compute()` owns worker execution and worker reuse.

Unlike `Promise.all()`, the group owns cancellation and failure propagation. Calling `wait()` closes the group to new work. Cancelling the parent signal or calling `group.cancel()` propagates to running children and to children waiting for a concurrency permit.

When several independent groups share one compute runner, each group controls its own concurrency while the compute runner reuses the same worker list across them.


## Cancellable worker submissions

`Coroutine.run()` and compute runners accept either an `AbortSignal` or per-run execution options:

```ts
const parse = coroutine((text: string) => parseLargeDocument(text));
const controller = new AbortController();

const result = parse.run(source, controller.signal);
controller.abort();

// Equivalent options form, also used when transferring ownership.
parse.run(source, { signal: controller.signal });
```

A worker task cannot be pre-empted safely inside arbitrary JavaScript, so Swiftly cancels an active worker submission by terminating that worker. Dedicated coroutine workers are recreated for later queued work; compute worker lists retire only the cancelled worker and restore pool capacity. Queued submissions can be cancelled without starting a worker task.

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


## Elastic compute workers

`compute()` is the multi-worker counterpart of `coroutine()`.

```ts
const hash = compute(
  (value: string) => expensiveHash(value),
);
```

A coroutine owns one reusable worker and serializes its submissions through that worker. A compute runner owns a reusable **list** of workers. For each concurrent submission, Swiftly reuses an idle worker when possible and lazily creates another worker when all existing workers are busy.

There is deliberately no implicit `navigator.hardwareConcurrency` limit and no compute-local admission queue. `compute()` answers only the execution question: **where does this work run?**

Concurrency policy belongs to structured coordination:

```ts
const work = group({ concurrency: 4 });

const results = inputs.map((input) =>
  work.spawn((signal) => hash(input, signal)),
);
```

Here the group admits at most four hash operations concurrently, so the compute runner needs at most four workers for this operation. If a broader shared resource budget is needed across unrelated groups, use `semaphore()`.

Compute runners expose `active` as lightweight execution observability: it is the number of workers currently executing submissions. The reusable worker list itself remains an implementation detail.


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

The composition remains explicit: channel capacity bounds data in flight,
group concurrency bounds owned operations, and compute owns only worker execution
and reuse.


## Graceful lifecycle

Worker-backed task runners distinguish graceful closure from immediate teardown.

```ts
const worker = compute(expensiveWork);

// Already-admitted work is allowed to finish.
await worker.close();

// New submissions are rejected after close begins.
```

`close()` means **stop accepting, drain, release**. It is idempotent and is the
normal lifecycle boundary when submitted work must not be lost.

`dispose()` means **terminate now**. Active and queued work is rejected and
worker resources are released immediately. Worker-script blob URLs are acquired
lazily on first execution, so constructing an unused coroutine or compute runner
does not reserve browser worker resources.

The same contract is shared by `coroutine()`, `compute()`, `computeScript()`,
and `compose()`. `compose().close()` attempts to close every owned stage even if
one stage reports an error, mirroring its immediate-disposal cleanup behavior.

This distinction is intentionally part of `TaskRunner` rather than separate
helpers: graceful ownership and forced teardown are different concurrency
semantics.

## Actor failure and restart-window resilience

An unhandled actor behavior exception terminates that actor generation. This is
deliberate: failures cross the actor lifecycle boundary instead of being hidden
as one-way notifications, so `actor.done` and `supervisor()` observe the same
failure model.

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

`capacity` is optional and defaults to `0`. When it is greater than zero, sends
and requests that arrive while a replacement generation is being created may
wait behind the stable supervisor handle. The queue is strictly bounded; excess
requests reject and excess one-way sends are dropped with a warning rather than
creating an unbounded backlog.

Buffered requests keep their `AbortSignal`. Cancelling one removes it from the
restart queue immediately. Once a request has been dispatched to a concrete
actor generation it is **not retried automatically** if that generation fails,
because retrying an in-flight request could duplicate side effects.

Replacement-factory failures consume the same `maxRestarts` budget as actor
failures. A temporary failure to create one replacement therefore does not
collapse supervision immediately when restart capacity remains.

The supervisor exposes `pending` and `capacity` for restart-window pressure
without exposing its internal queue or worker generations.


## Transferable ownership

Large `ArrayBuffer`, `MessagePort`, `ImageBitmap`, and other transferable values
can move across the worker boundary without structured-clone copying. Input
ownership is declared on the existing run call:

```ts
const result = await transform(buffer, {
  transfer: [buffer],
});

// `buffer` is detached after it is posted to the worker.
```

Worker task functions receive a small second argument. Its `transfer()` method
marks a result for transfer back to the caller:

```ts
const transform = compute<ArrayBuffer, ArrayBuffer>(
  (buffer, { transfer }) => {
    const bytes = new Uint8Array(buffer);
    mutate(bytes);

    return transfer(buffer, buffer);
  },
);

const input = new ArrayBuffer(1024 * 1024);
const output = await transform(input, { transfer: [input] });
```

The transfer wrapper is worker-internal: callers receive `output` directly, not
a wrapper object. Duplicate entries in a transfer list are rejected before the
post where Swiftly owns the list, and queued submissions do not transfer their
objects until they actually acquire a worker. Cancelling queued work therefore
leaves its transferables owned by the caller.

`compose()` applies an input transfer list to the first worker-backed stage only;
it is never reused for later stages after ownership has moved. Transfer between
stages inside one merged coroutine worker does not cross a worker boundary, so
intermediate transfer wrappers are unwrapped locally and only a final-stage
transfer is posted back to the caller.


## Priority scheduling

Worker submissions can carry a scheduling priority through the existing run control:

```ts
const low = work.run(backgroundJob, { priority: -10 });
const urgent = work.run(userVisibleJob, { priority: 20 });
```

Higher numeric priorities are selected first **only while work is still waiting**.
Swiftly never preempts a running JavaScript task. Equal priorities preserve strict
submission order, so the default `priority: 0` remains FIFO-compatible.

The rule applies wherever Swiftly actually has queued admission, such as a
dedicated coroutine queue and composed queued runners. Elastic `compute()` does
not maintain an admission queue, so priority does not create a hidden compute
scheduling policy.

Priority is deliberately a property of task admission rather than a separate
scheduler abstraction. The runtime therefore gains scheduling semantics without
adding another public concurrency object.

## Shared memory

Swiftly does not wrap `SharedArrayBuffer` or `Atomics`. Those platform primitives
already express shared-memory ownership and atomic coordination directly and can
be passed as ordinary task data. Swiftly adds abstractions only where it owns
additional semantics such as scheduling, cancellation, worker lifetime, or
transfer ownership.


## Actor mailbox pressure

Actor mailboxes can be bounded at the generation itself:

```ts
const service = actor(
  "service",
  behavior,
  initialState,
  { capacity: 32 },
);
```

`capacity` is the number of messages allowed to wait behind the behavior that is
currently executing. Omit it to preserve the unbounded mailbox behavior.

Requests that arrive after a bounded mailbox is saturated reject with
`Actor mailbox capacity exceeded`. One-way sends cannot return a rejection, so
they are dropped and counted through `actor.dropped`; Swiftly also emits a
warning. Saturation does **not** terminate the actor.

```ts
service.mailboxCapacity; // 32
service.dropped;         // one-way overflow count
```

`capacity: 0` provides rendezvous-like admission: a message is accepted only
when the actor behavior loop is ready to receive it.

Supervisor `capacity` remains a separate policy: it bounds traffic waiting
between actor generations during restart. Actor `mailboxCapacity` bounds traffic
inside the currently running generation.


## Priority fairness

Task priority is preferential rather than absolute. Higher-priority queued work
runs first under ordinary load, and equal priorities remain FIFO. A queued task
that has been bypassed 32 times is promoted for one dispatch, so a continuous
stream of urgent submissions cannot starve older work indefinitely.

```ts
worker.run(backgroundJob, { priority: -10 });
worker.run(normalJob);
worker.run(urgentJob, { priority: 20 });
```

Priority never preempts JavaScript that is already running. Fairness applies
only where work is actually waiting in a scheduler. Elastic compute submissions
create or reuse a worker immediately, so compute itself has no priority queue.


## Structured completion reports

`group()` keeps fail-fast cancellation, but it can now expose the terminal state
of every owned child without forcing callers back to `Promise.allSettled()`:

```ts
const work = group();

work.spawn(loadProfile);
work.spawn(loadPermissions);
work.spawn(loadPreferences);

const report = await work.settle();

for (const outcome of report.outcomes) {
  if (outcome.status === "fulfilled") {
    use(outcome.value);
  } else if (outcome.status === "rejected") {
    reportFailure(outcome.error);
  } else {
    reportCancellation(outcome.reason);
  }
}
```

Outcomes are ordered by `spawn()` order rather than completion order.
`rejected` identifies the child that caused group failure; work that terminates
after the group was already cancelled is reported as `cancelled`.

`settle()` never throws. Its `error` field is the same group-level reason that
`wait()` throws. Both methods close the group to new children and share one
stable completion report.

This keeps two distinct completion modes on one ownership primitive:

- `wait()` — enforce structured success/failure.
- `settle()` — inspect the full structured outcome.

No separate task-collection or `allSettled` abstraction is introduced.


## Hardening invariants

Swiftly treats cancellation cleanup as part of the concurrency contract:

- timer/context construction failures must not leave parent cancellation listeners attached;
- completed or cancelled timer workers must not affect later worker generations;
- a failed timer-worker command fails remaining timers coherently instead of stranding them;
- `select()` accepts at most one default branch, so selection policy is never ambiguous;
- task-group reports are complete by construction and never contain internal placeholder states.

These rules do not add new primitives; they tighten the lifecycle guarantees of
the existing model.


## Pipeline lifecycle ownership

`compose()` is itself a graceful-lifecycle boundary. Once `close()` begins it
rejects new pipeline runs, but a run already admitted is allowed to traverse
**every** composed stage before any owned runner is closed.

This matters when a pipeline is between stages: closing stage 2 while an admitted
run is still finishing stage 1 would violate the same drain guarantee provided
by `coroutine()` and `compute()`.

`dispose()` remains immediate and can override a concurrent graceful close;
the close promise is settled by that teardown rather than being left pending.


## Terminal ownership invariants

Cancellation and failure now close structured ownership immediately. A cancelled
or failed `group()` reports `accepting === false` even before `wait()`/`settle()`
is called, and its parent abort listener is detached as soon as the last owned
child finishes. Calling `wait()` or `settle()` then establishes the final closed
boundary for subsequent `spawn()` calls.

Supervised actor identity is also enforced across generations: every replacement
must use the original actor name. A mismatched generation is stopped and consumes
restart budget rather than silently changing routing identity. Lifecycle
observation is attached before buffered ingress is flushed, so a transport
failure during restart delivery cannot leave the supervisor watching a dead
generation incorrectly.

Dedicated runners and compute worker lists are regression-tested for the same lifecycle
pressure: worker failure during graceful close must continue draining admitted
queued work, while `dispose()` may escalate an in-progress close and settle the
close promise without stranding callers.


## Actor generation isolation

Every actor generation now carries a unique internal protocol identity. Main and
worker sides both validate that identity before accepting protocol envelopes, so
a late or malformed response from another generation cannot settle a current
request even if its request id happens to match.

Shutdown is also an admission boundary for worker-side requests. Once stopping
begins, outstanding `utils.outbox.request(...)` calls are rejected and new ones
are refused. Async main-thread handlers that finish after the source generation
has stopped do not write responses back into the dead worker.

These are internal guarantees; they do not add public actor API.


## Select registration invariants

Channel select registration is now defensive on its own, not only correct when
entered through the public `select()` fast path.

- already-settled registrations are ignored;
- receive registration against a closed channel settles immediately with
  `{ ok: false }`;
- send registration against a closed channel rejects immediately;
- newly registered compatible send/receive waiters are reconciled immediately;
- one select containing send and receive cases on the same unbuffered channel
  can never satisfy itself.

The same invariants are embedded in actor-worker channels.


## Cancellation teardown invariants

Cancellation state is shared rather than duplicated. Contexts created with
`withValue()` reuse the same `signal` and `done` completion as the source
context, so adding request-scoped values does not add another abort listener for
every value layer.

The shared timer worker also treats callback execution as cleanup-sensitive:
worker release still occurs when an elapsed callback throws, and one failing
timer failure callback cannot prevent the remaining pending timers from being
notified.

Stress coverage exercises repeated select cancellation, context-value chaining,
and mass timer cancellation to verify that cancellation leaves no channel
waiters or timer workers behind.


## Timer host isolation

The shared timer runtime binds its cached worker to the host `Worker`
constructor that created it. If the host changes while the timer runtime is
idle—for example between isolated browser test environments—the old worker is
discarded rather than reused across environments.

Test worker mocks implement the same `set` / `clear` timer protocol as the real
timer worker, so actor restart delays, context timeouts, and direct timer tests
exercise the same scheduling semantics.