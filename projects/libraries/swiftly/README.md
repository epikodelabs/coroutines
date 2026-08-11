# @epikodelabs/swiftly

Concurrent JavaScript built around workers, structured task ownership, channels, actors, and cancellation.

Swiftly treats concurrency as a programming model rather than exposing Web Workers as application infrastructure. Worker-backed computation, coordination, cancellation, and long-lived actors share one small set of primitives.

## Core model

- `coroutine()` — stateless worker execution with lazy worker reuse across concurrent submissions, including zero-copy transfer ownership.
- `group()` — structured ownership for dynamic concurrent work, with fail-fast sibling cancellation and optional concurrency bounds.
- `channel()` + `select()` — communication and coordination. `select()` can also race cancellable `operation()` cases.
- `background()`, `withCancel()`, `withTimeout()`, `withDeadline()` — cancellation and lifetime propagation.
- `actor()` — long-lived stateful workers with messaging and observable termination.
- `semaphore()`, `barrier()`, `event()` — synchronization primitives with distinct semantics.
- `sleep()` — worker-backed timing integrated with cancellation contexts.

## Structured concurrent work

`coroutine()` executes stateless work on Web Workers. It does not choose a
concurrency limit: concurrent calls reuse idle workers or lazily create more
workers as needed. `group()` owns the structured lifetime and concurrency policy.

```ts
import { coroutine, group } from '@epikodelabs/swiftly';

function expensiveHash(value: string): string {
  return value;
}

const hash = coroutine<string, string>(
  (value) => expensiveHash(value),
  expensiveHash,
);
const work = group({ concurrency: 4 });

const results = inputs.map((input) =>
  work.spawn((signal) => hash.run(input, signal)),
);

try {
  await work.wait();
  console.log(await Promise.all(results));
} finally {
  await hash.dispose();
}
```

The number `4` is the only concurrency policy in this example. At most four
group children may execute at once, therefore at most four `hash.run()` calls
can be active and at most four coroutine workers are needed for this operation.

The responsibilities are intentionally separate:

- `group()` owns task lifetime, failure propagation, cancellation, and concurrency.
- `coroutine()` owns worker execution, worker reuse, transfer ownership, and worker lifecycle.

This keeps worker count out of the execution primitive itself. If several groups
share the same coroutine, each group can apply its own concurrency policy while
the coroutine reuses the same idle worker list.

Referenced outer-scope functions are not captured automatically. A coroutine
worker only receives the serialized task body plus any helper functions passed
after it, as shown with `expensiveHash` above.

## Cancellable worker submissions

`Coroutine.run()` accepts either an `AbortSignal` or per-run execution options:

```ts
function parseLargeDocument(text: string): unknown {
  return text;
}

const parse = coroutine(parseLargeDocument);
const controller = new AbortController();

const result = parse.run(source, controller.signal);
controller.abort();

// Equivalent options form, also used when transferring ownership.
parse.run(source, { signal: controller.signal });
```

A worker task cannot be pre-empted safely inside arbitrary JavaScript, so Swiftly cancels an active worker submission by terminating only the worker that owns it. Concurrent sibling submissions continue on their own workers. Work waiting behind a `group()` concurrency permit can be cancelled before a coroutine worker is needed.

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


## Elastic coroutine workers

A coroutine is a reusable stateless worker-backed operation:

```ts
function expensiveHash(value: string): string {
  return value;
}

const hash = coroutine((value: string) => expensiveHash(value), expensiveHash);
```

The worker script is baked once. When `hash.run()` is called, Swiftly reuses an
idle worker if one exists; otherwise it lazily creates another worker for that
concurrent invocation. Completed workers return to the coroutine's reusable
worker list.

There is deliberately no implicit `navigator.hardwareConcurrency` limit and no
coroutine-local admission queue. Concurrency policy belongs to `group()`:

```ts
const work = group({ concurrency: 4 });

const results = inputs.map((input) =>
  work.spawn((signal) => hash.run(input, signal)),
);
```

Here the group admits at most four hash operations concurrently, so this
structured operation needs at most four workers. If unrelated operations must
share a broader resource budget, use `semaphore()`.

Persistent worker-local state does not belong in a coroutine. Use `actor()` when
worker identity and state must survive across messages.

## Native module workers

Every Swiftly-owned worker is created as a native ES module worker. This applies
to coroutine workers, actor workers, and the shared timer worker.

Because coroutine task source is executed inside a module worker, ordinary
absolute dynamic imports remain ordinary JavaScript:

```ts
const normalize = coroutine(async (value: string) => {
  const { default: slugify } = await import(
    'https://esm.sh/@sindresorhus/slugify'
  );

  return slugify(value);
});
```

Swiftly does not wrap or rewrite `import()`. CDN and other absolute module URLs
therefore use the browser's normal module loader, HTTP cache, CORS policy, and
Content Security Policy.

Relative imports inside an inline serialized coroutine are intentionally not
rewritten. Their natural base is the generated worker module URL rather than
the source TypeScript module. Use an absolute URL when an inline coroutine needs
to load another module.

Module loading does not change concurrency ownership: `coroutine()` owns worker
execution and module instances, while `group()` still owns the number of
concurrent operations.

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
coroutine owns worker execution:

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
group concurrency bounds owned operations, and coroutine owns only worker
execution and reuse.


## Graceful lifecycle

Worker-backed task runners distinguish graceful closure from immediate teardown.

```ts
const worker = coroutine(expensiveWork);

// Already-admitted work is allowed to finish.
await worker.close();

// New submissions are rejected after close begins.
```

`close()` means **stop accepting, drain, release**. It is idempotent and is the
normal lifecycle boundary when submitted work must not be lost.

`dispose()` means **terminate now**. Active and queued work is rejected and
worker resources are released immediately. Worker-script blob URLs are acquired
lazily on first execution, so constructing an unused coroutine
does not reserve browser worker resources.

The same contract is shared by `coroutine()` and `compose()`. `compose().close()` attempts to close every owned stage even if
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
const transform = coroutine<ArrayBuffer, ArrayBuffer>(
  (buffer, { transfer }) => {
    const bytes = new Uint8Array(buffer);
    mutate(bytes);

    return transfer(buffer, buffer);
  },
);

const input = new ArrayBuffer(1024 * 1024);
const output = await transform.run(input, { transfer: [input] });
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
by `coroutine()`.

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

Coroutine workers are regression-tested for lifecycle
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

`Context` is cancellation-only: it carries a signal, a completion promise, and a
terminal reason. Application data is passed explicitly rather than stored in
the cancellation tree.

`background()` is a shared immutable root context. Because it never cancels,
default coordination calls such as `select()` do not allocate a fresh
`AbortController` and never-settling `done` promise on every invocation.


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