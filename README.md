# Coroutines

Concurrent JavaScript built around workers, structured task ownership, channels, actors, and cancellation.

Coroutines treats concurrency as a programming model rather than exposing Web Workers as application infrastructure. Worker-backed computation, coordination, cancellation, and long-lived actors share one small set of primitives, and each primitive owns exactly one kind of concurrency semantics.

For a shorter concept-by-concept guide to ownership, boundaries, and when to use each primitive, see [`docs/concepts.md`](./docs/concepts.md).

## Installation

```sh
npm install @epikodelabs/coroutines
```

The library's only runtime dependency is `tslib`. The concurrency runtime is plain TypeScript with no framework coupling — it works anywhere modern module Web Workers work, Angular is not required.

## The mental model

Coroutines code answers five questions explicitly:

1. **Who owns this work?** — usually a `group`, actor, or supervisor.
2. **Where does it execute?** — a coroutine or actor worker.
3. **How does data move?** — ordinary values, channels, actor messages, or transferables.
4. **How is pressure bounded?** — group concurrency, channel capacity, semaphore permits, or mailbox capacity.
5. **How does it stop?** — `AbortSignal`, `Context`, group cancellation, runner lifecycle, or actor lifecycle.

The most important boundary is:

> **`coroutine()` defines worker code; `group().executor()` owns when and where it runs.**

Each primitive keeps its own responsibility and composes with the others:

| Concept | Owns | Does not own |
| --- | --- | --- |
| `coroutine()` | Immutable worker-task code and metadata | Worker pools, concurrency policy, lifecycle |
| `group()` | Structured child lifetime, FIFO admission, concurrency bounds, sibling cancellation, executor pool lifetime | Worker script content |
| `channel()` | Communication, buffering, backpressure, closure | Task lifetime |
| `select()` | Waiting atomically for one of several possible operations | Long-lived scheduling |
| `Context` | Cancellation lifetime and deadlines | Application data |
| `sleep()` | Cancellable delay | Repetition or scheduling policy |
| `semaphore()` | Shared permit budget | Task ownership |
| `barrier()` | Repeated rendezvous between a fixed number of participants | Data transport |
| `event()` | Broadcast readiness state | Queued values |
| `waitGroup()` | Dynamic completion counting across generations | Task ownership, value transport |
| `actor()` | Persistent worker identity, state, mailbox | Restart policy |
| `supervisor()` | Stable actor identity across failed generations, restart policy | State persistence |
| `compose()` | Fusing definitions into one worker script | Lifecycle, streaming/backpressure |
| `pipeline()` | Main-thread sequencing of runnable steps | Ownership, worker lifecycle |
| Transfer controls | Ownership transfer across worker boundaries | Shared-memory synchronization |

## Table of contents

- [Coroutine](#coroutine)
  - [Defining a coroutine](#defining-a-coroutine)
  - [Running a definition: `group().executor()`](#running-a-definition-groupexecutor)
  - [Elastic workers, `maxWorkers`, `idleTimeout`, and `size`](#elastic-workers-maxworkers-idletimeout-and-size)
  - [Cancelling a submission](#cancelling-a-submission)
  - [Group-owned lifecycle](#group-owned-lifecycle)
  - [Module workers and imports](#module-workers-and-imports)
- [Group](#group)
  - [Spawning and admission](#spawning-and-admission)
  - [Fail-fast failure and cancellation](#fail-fast-failure-and-cancellation)
  - [`wait()` and `settle()`](#wait-and-settle)
  - [Child scopes](#child-scopes)
- [Channel](#channel)
- [Select](#select)
- [Contexts and cancellation](#contexts-and-cancellation)
- [Timing](#timing)
- [Synchronization primitives](#synchronization-primitives)
  - [Semaphore](#semaphore)
  - [Barrier](#barrier)
  - [Event](#event)
  - [Wait group](#wait-group)
- [Actors](#actors)
  - [Messaging from the main thread](#messaging-from-the-main-thread)
  - [Inside the actor worker](#inside-the-actor-worker)
  - [Mailbox capacity and pressure](#mailbox-capacity-and-pressure)
  - [Actor failure model](#actor-failure-model)
- [Supervisor](#supervisor)
- [Compose](#compose)
- [Transferable ownership](#transferable-ownership)
- [Shared memory](#shared-memory)
- [Streaming work by composition](#streaming-work-by-composition)
- [Choosing between neighboring concepts](#choosing-between-neighboring-concepts)
- [Guarantees](#guarantees)
- [Design rule](#design-rule)

## Coroutine

A coroutine is an **immutable worker-task definition**: the serialized task body, its helper functions, and any raw helper snippets. It owns nothing at runtime — no workers, no lifecycle, no concurrency policy. It is executed through a group-owned executor.

It deliberately has **no default concurrency limit and no admission queue**. The executor lazily creates workers as concurrent calls require them and reuses idle workers. Expressing *how many* operations may run at once belongs to `group()` or `semaphore()`, not to the coroutine.

### Defining a coroutine

```ts
import { coroutine } from '@epikodelabs/coroutines';

function expensiveHash(value: string): string {
  return value;
}

const hash = coroutine<string, string>(
  (value) => expensiveHash(value),
  expensiveHash,
);
```

A coroutine worker only receives the serialized task body plus any helper functions passed after it. **Referenced outer-scope functions are not captured automatically** — `expensiveHash` must be listed explicitly so it is serialized into the worker script. A body that references a function that was not passed fails fast inside the worker with a `ReferenceError` naming the missing helper. Raw string snippets can be injected before the task code through the optional trailing options object (`{ helpers: string[] }`).

The task function receives a second argument with worker utilities (see [Transferable ownership](#transferable-ownership)) and may be `async`:

```ts
type CoroutineTask<T, R> = (
  data: T,
  utils: WorkerTaskUtils,
) => R | TransferResult<R> | Promise<R | TransferResult<R>>;
```

### Running a definition: `group().executor()`

Definitions do not run themselves. A worker pool is created inside a structured scope, and the scope owns it:

```ts
import { coroutine, group } from '@epikodelabs/coroutines';

const hash = coroutine<string, string>(
  (value) => expensiveHash(value),
  expensiveHash,
);

const pool = group();
const executor = pool.executor(hash, { maxWorkers: 8 });

const result = await executor.run('hello');
await pool.settle(); // drains admitted runs, closes the pool
```

- `executor(def, options?)` creates the pool and ties its lifetime to the group.
- `settle()`/`wait()` stop the pool from accepting new runs, let already-admitted runs finish, terminate the workers, and await that teardown before resolving. After the group settled, `run()` rejects with `GroupClosedError`.
- `cancel()` — or a sibling failure — disposes the pool immediately and rejects active runs.
- The pool is created lazily: an unused executor costs nothing. Executors created by an ancestor group survive this group's settlement, so shared pools belong to the nearest shared parent scope (see [child scopes](#child-scopes)).

### Elastic workers, `maxWorkers`, `idleTimeout`, and `size`

The worker script is baked once. When `run()` is called, the executor reuses an idle worker if one exists; otherwise it lazily creates another worker for that concurrent invocation. Completed workers return to the executor's reusable worker list. There is deliberately no implicit `navigator.hardwareConcurrency` limit.

An optional `maxWorkers` caps how many workers one executor may own:

```ts
const executor = pool.executor(hash, { maxWorkers: 8 });
```

When the cap is reached and no worker is idle, further submissions wait FIFO for the next worker to free up (cancellable through their signal). This is a resource cap on worker creation — not a scheduling policy. Structured admission still belongs to `group()`.

Elasticity also works in reverse: an optional `idleTimeout` reaps workers that stay idle longer than the given number of milliseconds, and the next `run()` recreates one on demand. Without it, workers are kept for the lifetime of the group. The executor exposes `size` — the number of workers it currently owns — for observability:

```ts
const executor = pool.executor(hash, { idleTimeout: 30_000 });
executor.size; // owned worker count right now
```

If several groups run the same definition, each group creates its own executor with its own pool and concurrency policy.

Worker-script blob URLs are acquired lazily on first execution, so a definition that is never executed does not reserve browser worker resources.

### Cancelling a submission

`run()` accepts either an `AbortSignal` or per-run execution options:

```ts
const pool = group();
const parse = pool.executor(coroutine(parseLargeDocument));
const controller = new AbortController();

const result = parse.run(source, controller.signal);
controller.abort();
await result.catch(() => undefined);

// Equivalent options form, also used when transferring ownership.
const otherResult = parse.run(source, { signal: controller.signal });
```

A worker task cannot be pre-empted safely inside arbitrary JavaScript, so Coroutines cancels an active submission by **terminating only the worker that owns it**. Concurrent sibling submissions continue on their own workers. Work waiting behind a `group()` concurrency permit — or behind a `maxWorkers` cap — can be cancelled before a worker is ever needed.

`pipeline()` forwards the same cancellation signal through every step.

### Group-owned lifecycle

Worker pools have no manual `close()`/`dispose()` obligations: the owning group performs both roles.

- `settle()`/`wait()` is the graceful boundary — **stop accepting, drain, release**. Admitted runs finish, then workers are terminated.
- `cancel()` is the immediate boundary — **terminate now**. Active runs are rejected and worker resources are released.

Because the pool lives inside a scope, forgetting to tear it down is impossible: the group's own completion disposes it.

### Module workers and imports

Every Coroutines-owned worker — coroutine workers, actor workers, and the shared timer worker — is created as a native ES module worker. Ordinary absolute dynamic imports therefore remain ordinary JavaScript:

```ts
const normalize = coroutine(async (value: string) => {
  const { default: slugify } = await import(
    'https://esm.sh/@sindresorhus/slugify'
  );

  return slugify(value);
});
```

Coroutines does not wrap or rewrite `import()`. CDN and other absolute module URLs use the browser's normal module loader, HTTP cache, CORS policy, and Content Security Policy.

Relative imports inside an inline serialized coroutine are intentionally not rewritten. Their natural base is the generated worker module URL rather than the source TypeScript module — use an absolute URL when an inline coroutine needs to load another module.

Module loading does not change concurrency ownership: `coroutine()` defines the worker code, while `group()` owns the pool and the number of concurrent operations.

## Group

A group is the **structured owner of a dynamic set of concurrent operations**. Every accepted child is owned immediately: the group propagates failure, cancels siblings, bounds admission, reports terminal state — and owns the worker pools of its executors.

```ts
import { coroutine, group } from '@epikodelabs/coroutines';

const hash = coroutine<string, string>(
  (value) => expensiveHash(value),
  expensiveHash,
);

const pool = group();
const executor = pool.executor(hash); // the pool's workers belong to the group
const work = group({ concurrency: 4 });

const results = inputs.map((input) =>
  work.spawn((signal) => executor.run(input, signal)),
);

await work.wait();
console.log(await Promise.all(results));
await pool.settle(); // no children; drains and closes the pool
```

The number `4` is the only concurrency policy in this example. The group owns a FIFO admission queue: at most four children execute at once, and queued child operations **have not started yet** — their operation function has not been invoked, no executor has been called, and no transferable input has left the caller. When an active child finishes, the next queued child is admitted.

This separation is what keeps worker count out of the execution primitive:

- `group()` owns task lifetime, failure propagation, cancellation, concurrency, and executor pool lifetime.
- `coroutine()` defines the worker code, its helpers, and transfer semantics.

### Spawning and admission

```ts
type GroupOptions = {
  concurrency?: number;      // maximum children executing at once
  signal?: AbortSignal;      // parent signal; aborting it cancels the group
  failure?: 'propagate' | 'isolate'; // child-scope failure policy (default 'propagate')
};

interface TaskGroup {
  readonly signal: AbortSignal;   // shared by all children
  readonly running: number;       // accepted children not yet settled (active + queued + child scopes)
  readonly accepting: boolean;    // whether new children may still be accepted
  spawn<T>(operation: (signal: AbortSignal) => T | Promise<T>): Promise<T>;
  executor<T, R>(definition: Coroutine<T, R>, options?: ExecutorOptions): Executor<T, R>;
  group(options?: GroupOptions): TaskGroup; // child scope
  cancel(reason?: unknown): void;
  wait(): Promise<void>;
  settle(): Promise<GroupReport>;
}
```

`spawn()` rejects once the group is closed (by `wait()`/`settle()`, cancellation, or failure). The group owns child failures even when the caller observes only `wait()`/`settle()` — the promise returned by `spawn()` never becomes an unhandled rejection.

### Fail-fast failure and cancellation

Groups are fail-fast. The first child failure:

1. closes the group to new work;
2. aborts the group signal;
3. cancels queued children before they start (reported as `cancelled`);
4. asks active cooperative siblings to stop through the shared signal;
5. disposes the group's executor pools.

`cancel(reason?)` performs the same teardown explicitly. Passing a parent `signal` ties the group's lifetime to a wider scope: aborting the parent cancels the whole group. The parent listener is detached as soon as the last owned child finishes.

### `wait()` and `settle()`

`wait()` closes the group, waits for every accepted child to settle, drains and closes every executor pool, and throws the group-level reason — the first child failure, explicit cancellation, or parent cancellation.

`settle()` closes the group but returns a non-throwing report with outcomes in **spawn order**, not completion order:

```ts
const report = await work.settle();

for (const outcome of report.outcomes) {
  if (outcome.status === 'fulfilled') {
    use(outcome.value);
  } else if (outcome.status === 'rejected') {
    reportFailure(outcome.error);   // the child that caused group failure
  } else {
    reportCancellation(outcome.reason); // work that ended after cancellation
  }
}
```

`settle()` never throws. Its `error` field is the same group-level reason `wait()` throws. Both methods share one stable, frozen completion report — two completion modes on one ownership primitive:

- `wait()` — enforce structured success/failure.
- `settle()` — inspect the full structured outcome.

No separate task-collection or `Promise.allSettled()` abstraction is introduced.

### Child scopes

`group()` creates a child scope of the same structured tree:

```ts
const appWork = group();
const transform = appWork.executor(pipeline); // shared pool at the app scope

const importWork = appWork.group(); // per-import scope
await importWork.spawn(() => transform.run(file));
await importWork.wait();            // import scope settles; the pool survives
```

The structured-concurrency rules hold across the tree:

- **Parent cancellation cancels every descendant** — aborting `appWork` cancels `importWork` and its operations.
- **Child failure fails the parent** — an unhandled import failure propagates up, cancels sibling scopes, and makes `appWork.wait()` reject. A parent never reports success while owned work has failed.
- **Parent settlement closes children** — `appWork.settle()` stops child scopes from accepting new spawns and awaits their full settlement, including their own executor pools.

Recoverable background work opts out of upward propagation explicitly with an isolation boundary:

```ts
const imports = appWork.group({ failure: 'isolate' });

imports.spawn(() => retryImport(job)); // a failure stays inside `imports`
```

An isolated scope still receives parent cancellation and still counts toward parent settlement — only the upward *failure* flow is suppressed. `settle()` on the isolated scope observes its outcomes.

## Channel

A channel transports values between concurrent operations and provides **backpressure**.

```ts
const jobs = channel<Job>(8);

await jobs.send(job);            // suspends while the buffer is full
const next = await jobs.receive();
if (next.ok) {
  process(next.value);
}
```

Capacity controls how many values may wait:

- `channel(0)` is unbuffered: send and receive **rendezvous** — a send suspends until a receiver is ready.
- `channel(n)` buffers up to `n` values; send suspends only while the buffer is full.

The full surface:

```ts
interface Channel<T> {
  readonly capacity: number;
  readonly size: number;        // buffered values right now
  readonly closed: boolean;
  send(value: T, signal?: AbortSignal): Promise<void>;
  receive(signal?: AbortSignal): Promise<ReceiveResult<T>>;
  trySend(value: T): boolean;                 // non-blocking
  tryReceive(): ReceiveResult<T> | undefined; // non-blocking
  close(): void;
}
```

**Closure is explicit.** Receive distinguishes a value from end-of-stream:

```ts
const result = await ch.receive();

if (!result.ok) {
  // closed and drained
  return;
}

use(result.value);
```

This means every JavaScript value — including `undefined` — can travel through a channel without being confused with end-of-stream. Async iteration follows the same rule internally and stops only after an explicit closed result:

```ts
for await (const value of jobs) {
  process(value);
}
```

Error and cancellation semantics:

- sending to a closed channel rejects with `ChannelClosedError`; receiving from a closed, drained channel resolves `{ ok: false }`;
- closing a channel resolves pending receivers with `{ ok: false }` and rejects pending senders;
- both `send()` and `receive()` accept an `AbortSignal`; cancelling removes only that waiter and leaves the channel queues intact.

A channel owns communication pressure, **not** the lifetime of producers or consumers — own those with a `group()`.

## Select

`select()` waits for exactly one operation among several alternatives and reports which case won:

```ts
const result = await select([
  receive(messages, 'message'),
  send(outgoing, value, 'sent'),
  operation((signal) => fetchStatus(signal), 'status'),
  otherwise('idle'),
]);

result.index;  // position of the winning case
result.op;     // 'receive' | 'send' | 'operation' | 'default'
result.value;  // payload, when the winning case produced one
```

Cases are built with:

- `receive(ch, name?)` — receive one value;
- `send(ch, value, name?)` — send one value;
- `operation(run, name?)` — a cancellable async contender;
- `otherwise(name?)` — an immediate default branch.

Semantics in detail:

- **Channel atomicity is preserved.** Channel cases register directly against the channel's wait lists, so a send/receive pair can never satisfy itself inside one select, and registration is correct even for channels waited on outside the public fast path: already-settled registrations are ignored, receive against a closed channel settles with `{ ok: false }`, send against a closed channel rejects, and newly registered compatible send/receive waiters are reconciled immediately.
- **Fairness.** Channel readiness is probed in a randomized order, so earlier cases do not systematically starve later ones.
- **Operations start only when selection must block.** If a channel case is immediately ready, or an `otherwise()` branch is present, `operation()` callbacks are never started. This is deliberate: arbitrary operations have no side-effect-free readiness probe, so they must not be launched just to discover the default branch should win.
- **Losing operations are cancelled.** Each `operation()` case receives its own `AbortSignal`; when another case wins, losing signals are aborted so cooperative work can stop promptly.
- **At most one default branch** is allowed, so selection policy is never ambiguous.
- `select()` accepts a cancellation context as its second argument (default `background()`); a cancelled context aborts the whole selection.

Use `select()` when the decision itself is *which operation becomes ready first*. Do not use it as a general scheduler.

## Contexts and cancellation

A `Context` is a **cancellation lifetime**, not an application-data container. It carries only lifecycle state:

```ts
type Context = {
  readonly signal: AbortSignal;  // aborted when the context is cancelled
  readonly done: Promise<void>;  // settles once, on cancellation
  readonly reason: unknown;      // the cancellation reason
};
```

Contexts form a tree:

- `background()` returns the shared immutable root context. It never cancels — which also means default coordination calls such as `select()` do not allocate a fresh `AbortController` and never-settling promise per invocation.
- `withCancel(parent?)` derives a cancellable child; cancelling the parent cancels the child.
- `withTimeout(parent, ms)` derives a child that cancels itself after `ms` milliseconds with `context timeout after ${ms}ms`.
- `withDeadline(parent, dateOrTimestamp)` derives a child that cancels itself at an absolute point in time; a deadline in the past cancels immediately with `context deadline exceeded`.

```ts
const [ctx, cancel] = withCancel();

try {
  await select(cases, ctx);
} finally {
  cancel(); // release the child; cancel() is safe to call from cleanup
}
```

Timeout and deadline contexts clean up their timers when the context settles for any reason, so neither the timer nor the parent abort listener outlives the context.

Application data is passed explicitly through normal arguments and objects — never stored in the cancellation tree.

The error types are:

- `ContextCancelledError` — contexts, groups, select
- `ChannelClosedError` — channels
- `RunnerClosedError` — closed or disposed coroutine/compose runners
- `GroupClosedError` — groups that no longer accept children
- `ActorStoppedError` — actors that stopped, including buffered supervisor ingress
- `ActorMailboxOverflowError` — requests that hit a saturated actor mailbox
- `SupervisorBusyError` — requests that reach a supervisor while it is restarting or its ingress is full

Cancellation reasons given to `cancel(reason)` are surfaced as-is when they are `Error` instances.

## Timing

`sleep()` is a cancellable delay:

```ts
await sleep(250, signal);
```

Main-thread timing uses Coroutines's **shared timer worker**, so `sleep()`, `withTimeout()`, and `withDeadline()` share one worker rather than spawning a worker per delay. Context deadlines also keep a host-timer watchdog, so a deadline remains terminal if its timer worker is replaced or fails before accepting the timer. Inside an actor worker, `sleep()` uses that worker's own event loop rather than nesting another worker.

The timer runtime treats callback execution as cleanup-sensitive: worker release still happens when an elapsed callback throws, and one failing timer cannot prevent the remaining pending timers from being notified — a failed timer-worker command fails remaining timers coherently instead of stranding them. Completed or cancelled timer workers never affect later worker generations.

Coroutines intentionally does not turn timing into a scheduler. Repetition remains ordinary control flow:

```ts
while (!signal.aborted) {
  await refresh();
  await sleep(1000, signal);
}
```

## Synchronization primitives

### Semaphore

A semaphore represents a **shared permit budget**:

```ts
const database = semaphore(8);

const release = await database.acquire(signal);
try {
  await useDatabase();
} finally {
  release();
}
```

- `acquire(signal?)` waits FIFO for a permit; the returned release function is **idempotent**, so cleanup code can safely call it twice.
- `tryAcquire()` returns a release function immediately, or `undefined` when no permit is available.
- `capacity`, `available`, and `waiting` expose the budget state.
- Cancelling a waiting acquisition removes only that waiter.

Use a semaphore when otherwise unrelated operations contend for one limited resource. This differs from a group concurrency limit:

- `group({ concurrency: 4 })` limits children **owned by that group** and queues their admission.
- `semaphore(4)` limits access to a resource shared by many groups or unrelated operations.

If the limit exists only because one group should run four children at once, use the group rather than layering a semaphore on it.

### Barrier

A barrier is a **reusable rendezvous point** for a fixed number of participants:

```ts
const phase = barrier(3);

await phase.wait(signal);
```

No participant passes the barrier until the configured number have arrived. After release, the barrier automatically advances to the next generation and can be used again. Cancelling a waiting arrival withdraws it from the current generation, so a later participant can take its place. `participants` and `waiting` expose the state.

Use a barrier for phased algorithms where peers must all reach the same point before continuing. A barrier does not transport values — use channels for data.

### Event

An event is a **broadcast readiness flag** (a manual-reset event):

```ts
const ready = event();

await ready.wait(signal);

// elsewhere
ready.set();
```

`set()` releases every current waiter and keeps the event set, so future `wait()` calls complete immediately. `clear()` returns it to the blocking state. Cancelling one waiter removes only that waiter and changes neither the event state nor other waiters. `isSet` and `waiting` expose the state.

Use an event for readiness conditions such as "initialization is ready" or "processing may continue". It is not a message queue — if every produced value matters, use a channel.

### Wait group

A wait group is a **dynamic completion counter** for work whose ownership lives elsewhere:

```ts
const downloads = waitGroup();

for (const url of urls) {
  downloads.add();
  downloadOne(url).finally(() => downloads.done());
}

await downloads.wait(signal);
```

- `add(n?)` registers outstanding work; `done()` completes one unit and **throws when nothing is outstanding**, so accounting bugs surface instead of hiding.
- `wait()` resolves when the count reaches zero; cancelling withdraws only that waiter and leaves the count untouched.
- After the count reaches zero and its waiters are released, later `add()` calls begin a new generation.

Use a wait group when in-flight work is registered from places no single `group()` owns. Unlike a barrier, participants do not arrive together, and the count may grow while a generation is active.

## Actors

An actor is a **long-lived stateful worker** with a stable name, a mailbox, and state that survives across messages. Unlike a coroutine, worker identity is persistent: creating an actor eagerly starts its dedicated worker and behavior loop.

```ts
import { actor, main } from '@epikodelabs/coroutines';

const counter = actor(
  'counter',
  (message, state: number) => {
    if (message.kind === 'actor-bus' && message.topic === 'inc') return state + 1;
    return state;
  },
  0, // initial state
);

const value = await main.outbox.request(counter, 'inc', undefined); // 1
await main.outbox.stop(counter);

const exit = await counter.done; // { reason: 'stopped' }
```

The behavior receives `(message, state, utils)` and returns the next state, either directly or as a promise. Communication happens through the actor bus instead of exposing the `Worker` object directly.

The handle exposes:

```ts
interface Actor {
  readonly name: string;                    // stable bus address
  readonly running: boolean;
  readonly mailboxCapacity: number | undefined;
  readonly dropped: number;                 // one-way overflow count
  readonly done: Promise<ActorExit>;        // resolves exactly once
}

type ActorExit =
  | { readonly reason: 'stopped' }
  | { readonly reason: 'error'; readonly error: Error };
```

`actor.done` resolving once with either a normal stop or worker failure is the lifecycle primitive higher-level supervision builds on — restart policy is not baked into the actor itself.

### Messaging from the main thread

`main` is the main-thread side of the bus:

```ts
main.outbox.publish(topic, payload, { from?, includeSelf? }); // broadcast to every named actor
main.outbox.send(to, topic, payload, { from? });              // one-way, one or many named targets
main.outbox.request(to, topic, payload, signal?);             // awaits a response, one target
main.outbox.stop(actorOrName, options?);                      // stop, terminate, release resources
main.inbox.subscribe(handler);                                // returns an unsubscribe function
main.inbox.clear();                                           // drop all bus listeners
```

- `request()` requires exactly one target and a topic; an unknown target rejects.
- `request()` accepts an `AbortSignal`. Cancelling withdraws **only that caller's pending response** — it does not terminate the actor generation. This composes actor request lifetimes with task groups and contexts without a separate timeout/retry API.
- `stop()` sends a stop message, gives the worker a short grace period, then terminates it and rejects outstanding requests.

**Graceful stop options:**

- `stop(actor, { drain: true })` lets the actor finish every already-admitted mailbox message before exiting — the `close()` half of the runner lifecycle. Messages that arrive during the drain are refused; requests receive `ActorStoppedError`.
- `stop(actor, { graceMs })` bounds the hard-terminate fallback (default 100ms). Extend it when a behavior legitimately runs longer; a stopping worker normally reports its own exit long before the timer.
- Supervisor handles accept the same options and forward them to their live generation.

### Inside the actor worker

Behaviors receive a `utils` object with three parts:

- `utils.concurrency` — the worker-side mirror of the standalone API: `channel()`, `receive()`, `send()`, `otherwise()`, `operation()`, `select()`, `background()`, `withCancel()`, `withTimeout()`, `withDeadline()`, `sleep()`, plus the error classes. Nothing needs to be imported inside a behavior; `sleep()` here uses the actor worker's own event loop.
- `utils.outbox` — `request(to, topic, payload)` (use `"main"` to reach the main-thread side) and `send(to, topic, payload)` for actor-to-actor messaging. Requests to `"main"` require a main-thread handler registered with `registerActorRequestHandler("main", (topic, payload, message) => …)` (unregister with `unregisterActorRequestHandler`); messages routed between actors use the bus envelope helpers `createActorBusMessage` / `isActorBusMessage`.
- `utils.reply` — `reply(value)` overrides the response payload for the request currently being handled. Without it, a request resolves with the behavior's new state, so `reply()` lets small answers flow back without cloning the whole state.
- `utils.inbox` — `listen(signal?)` **consumes** the next bus message that arrives while the behavior is suspended: each message is delivered exactly once, either to a waiting `listen()` or as the next behavior invocation — never both. The message that triggered the current behavior is never returned by `listen()`. It resolves `undefined` once the inbox closes.

### Mailbox capacity and pressure

An actor may bound messages waiting behind the currently executing behavior:

```ts
const service = actor('service', behavior, initialState, { capacity: 32 });

service.mailboxCapacity; // 32
service.dropped;         // one-way overflow count
```

- Omit `capacity` for the default unbounded mailbox.
- Requests that arrive after saturation reject with `ActorMailboxOverflowError` (`Actor mailbox capacity exceeded`).
- Bus notifications wait in a separate bounded inbox with the same capacity, so they can never crowd out request envelopes; the two streams together can buffer up to twice the configured capacity.
- One-way sends cannot return a rejection, so they are dropped, counted in `dropped`, and warned.
- Saturation does **not** terminate the actor.
- `capacity: 0` provides rendezvous-like admission: a message is accepted only when the behavior loop is ready to receive it.

### Actor failure model

An unhandled exception in the behavior **terminates that actor generation**. This is deliberate: failures cross the actor lifecycle boundary instead of being hidden as one-way notifications, so `actor.done` and `supervisor()` observe the same failure model. The failed actor stops accepting messages, rejects outstanding requests with the failure, and `done` resolves with `{ reason: 'error', error }`.

Generation isolation is enforced internally: every actor generation carries a unique protocol identity validated on both the main and worker sides, so a late or malformed response from another generation cannot settle a current request even if a request id happens to match. Once stopping begins, worker-side requests are rejected and new ones refused; async handlers that finish after their generation stopped cannot write responses back into a dead worker.

Use an actor when state belongs to a long-lived worker-side behavior rather than to one independent computation. Persistent worker-local state does not belong in a coroutine.

## Supervisor

A supervisor owns **recovery of an actor identity across failed generations**:

```ts
import { supervisor } from '@epikodelabs/coroutines';

const service = supervisor(
  () => actor('service', behavior, initialState),
  {
    maxRestarts: 3,   // default 3
    restartDelay: 250, // default 0 (ms)
    capacity: 32,      // default 0
  },
);

await main.outbox.request(service, 'refresh', undefined);
await main.outbox.stop(service);

const exit = await service.done;
```

The supervisor is itself an `Actor` handle — it extends `Actor` with:

```ts
interface Supervisor extends Actor {
  readonly restarts: number;              // restart budget consumed so far
  readonly current: Actor | undefined;    // live generation, when one is running
  readonly capacity: number;              // restart-window ingress capacity
  readonly pending: number;               // messages waiting for a replacement
}
```

All messaging goes through the stable supervisor identity, so callers never retain a stale generation. The semantics, precisely:

- **Normal stops are never restarted.** Only worker failures consume the restart budget; once it is exhausted, `done` resolves with the terminal error.
- **Replacement-factory failures consume the same budget.** A temporary failure to create one replacement does not collapse supervision immediately while restart capacity remains.
- **Restarts begin from the factory's initial state.** State persistence/checkpointing is application policy and is not hidden inside the concurrency runtime.
- **`capacity` bounds the restart window.** While a replacement generation is being created, up to `capacity` sends/requests wait behind the stable handle. The queue is strictly bounded: excess requests reject, excess one-way sends are dropped with a warning. It is a different policy from actor mailbox capacity — the supervisor bounds traffic *between generations*; `mailboxCapacity` bounds traffic *inside* the running generation.
- **Buffered requests keep their `AbortSignal`.** Cancelling one removes it from the restart queue immediately.
- **No automatic retry after dispatch.** Once a request has been dispatched to a concrete generation it is not retried if that generation fails — retrying an in-flight request could duplicate side effects.
- **Identity is enforced.** Every replacement must use the original actor name; a mismatched generation is stopped and consumes restart budget rather than silently changing routing identity. Lifecycle observation is attached before buffered ingress is flushed, so a transport failure during restart delivery cannot leave the supervisor watching a dead generation.

## Compose

`compose()` fuses multiple definitions into **one** immutable definition. Stages whose input/output types match are validated at compile time, and the fused stages run inside a single worker task per invocation — intermediate results never cross a worker boundary.

```ts
const fused = compose(parseStage, transformStage, encodeStage);

const pool = group();
const output = await pool.executor(fused).run(input);
await pool.settle();
```

- `compose()` accepts only definitions produced by `coroutine()` (or another `compose()`); anything else throws a `TypeError`. Nested composes are flattened into their leaf stages.
- The result is a definition like any other: it owns no workers and has no lifecycle — run it through `group().executor()`.
- The input definitions are untouched and reusable; nothing is disposed by `compose()`.

**Transfer:** an input transfer list applies to the whole fused task — intermediate transfer wrappers are unwrapped locally, and only a final-stage transfer is posted back to the caller.

Composition is for worker-stage fusion, **not** for streaming dataflow — see [Streaming work by composition](#streaming-work-by-composition).

### Main-thread sequencing: `pipeline()`

When stages must run on the main thread — or when already-owned executors need chaining — `pipeline()` orders runnable steps sequentially:

```ts
const chain = pipeline(stepOne, groupA.executor(def), stepTwo);
const output = await chain.run(input);
```

- A pipeline owns nothing: steps keep their own groups and worker pools. A step whose group has settled rejects the run with that group's error.
- The run signal is forwarded to every step; an input transfer list applies to the first step only.
- Steps are drained per executor: settle each pool's group to close it. `pipeline()` itself has no `close()`/`dispose()`/`size` — there is nothing for it to own.

## Transferable ownership

Large `ArrayBuffer`, `MessagePort`, `ImageBitmap`, and other transferable values can move across the worker boundary without structured-clone copying. Input ownership is declared on the existing run call:

```ts
const pool = group();
const transform = pool.executor(def);

const result = await transform.run(buffer, { transfer: [buffer] });

// `buffer` is detached once it is posted to the worker.
```

Worker task functions mark a result for transfer back through the injected utilities:

```ts
const def = coroutine<ArrayBuffer, ArrayBuffer>(
  (buffer, { transfer }) => {
    mutate(new Uint8Array(buffer));
    return transfer(buffer, buffer);
  },
  mutate,
);
```

The rules, precisely:

- The transfer wrapper is worker-internal: callers receive the value directly, never a wrapper object.
- Duplicate entries in a transfer list are rejected **before** the post where Coroutines owns the list.
- A submission transfers its objects only when it is actually posted to a worker. Cancellation before worker execution — including sitting behind a group permit — leaves its transferables owned by the caller.
- Because group admission happens before executor execution, transferables belonging to queued group children stay with the caller until that child is admitted.

Transfer is an ownership operation: once posted successfully, the sender no longer owns a transferred `ArrayBuffer`.

## Shared memory

Coroutines does not wrap `SharedArrayBuffer` or `Atomics`. Those platform primitives already express shared-memory ownership and atomic coordination directly, and can be passed as ordinary task data. Coroutines adds abstractions only where it owns additional semantics — scheduling, cancellation, worker lifetime, or transfer ownership.

## Streaming work by composition

Streaming needs no dedicated pipeline abstraction. Channels provide backpressure, groups own lifetime and failure propagation, and group-owned executors own worker execution:

```ts
const input = channel<Job>(8);
const output = channel<Result>(8);
const pool = group();
const workers = group();

const handleJob = pool.executor(
  coroutine<Job, Result>((job) => ({
    id: job.id,
    value: job.value * 2,
  })),
);

const consume = (async () => {
  const results: Result[] = [];
  for await (const result of output) {
    results.push(result);
  }
  return results;
})();

for (let i = 0; i < 4; i++) {
  workers.spawn(async (signal) => {
    while (true) {
      const next = await input.receive(signal);
      if (!next.ok) return;

      const result = await handleJob.run(next.value, signal);
      await output.send(result, signal);
    }
  });
}

workers.spawn(async (signal) => {
  try {
    for (const job of inputs) await input.send(job, signal);
  } finally {
    input.close();
  }
});

try {
  await workers.wait();
} finally {
  output.close();
}

const results = await consume;
await pool.settle(); // drains the executor's workers
```

The composition remains explicit: channel capacity bounds data in flight, the number of spawned workers bounds parallel processing, `group()` owns worker-loop lifetime, failure propagation, and the executor pool, and the definition owns only the worker code.

## Choosing between neighboring concepts

### Group or semaphore?

Use a **group** when the tasks belong to one structured scope and that scope should admit only N at once.

Use a **semaphore** when many otherwise independent operations share one scarce resource.

### Group or wait group?

Use a **group** when one structured scope spawns the work and should own its lifetime and failure.

Use a **wait group** when completion must be tracked across units of work started by different owners.

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

## Guarantees

These rules add no new primitives; they tighten the lifecycle guarantees of the model above and are covered by regression and stress tests (repeated select cancellation, context cancellation chains, mass timer cancellation, worker lifecycle pressure):

- Cancellation cleanup is part of the concurrency contract: timer/context construction failures never leave parent cancellation listeners attached.
- Cancellation and failure close structured ownership immediately: a cancelled or failed `group()` reports `accepting === false` before `wait()`/`settle()` is called, and its parent abort listener is detached as soon as the last owned child finishes. `wait()`/`settle()` then establish the final closed boundary for `spawn()`.
- Task-group reports are complete by construction and never contain internal placeholder states.
- `select()` registration is defensive on its own — see [Select](#select) for the exact invariants.
- Executor pools are tested under lifecycle pressure: group settle lets already-admitted runs finish and terminates every worker before resolving, while cancel may escalate an in-progress drain without stranding callers.
- The shared timer runtime binds its cached worker to the host `Worker` constructor that created it; if the host changes while idle — for example between isolated browser test environments — the old worker is discarded rather than reused. Test mocks implement the same `set`/`clear` timer protocol, so restart delays, context timeouts, and timer tests exercise identical scheduling semantics.

## Design rule

Coroutines keeps the core deliberately small. A public abstraction belongs here only when it contributes semantics that cannot be expressed cleanly by composing existing primitives. Convenience wrappers should stay outside the core.

If one primitive appears to answer several of the [mental-model](#the-mental-model) questions at once, it is worth checking whether two smaller Coroutines concepts should be composed instead.
