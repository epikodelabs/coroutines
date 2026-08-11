This file is a merged representation of the entire codebase, combined into a single document by Repomix.

# File Summary

## Purpose
This file contains a packed representation of the entire repository's contents.
It is designed to be easily consumable by AI systems for analysis, code review,
or other automated processes.

## File Format
The content is organized as follows:
1. This summary section
2. Repository information
3. Directory structure
4. Repository files (if enabled)
5. Multiple file entries, each consisting of:
  a. A header with the file path (## File: path/to/file)
  b. The full contents of the file in a code block

## Usage Guidelines
- This file should be treated as read-only. Any changes should be made to the
  original repository files, not this packed version.
- When processing this file, use the file path to distinguish
  between different files in the repository.
- Be aware that this file may contain sensitive information. Handle it with
  the same level of security as you would the original repository.

## Notes
- Some files may have been excluded based on .gitignore rules and Repomix's configuration
- Binary files are not included in this packed representation. Please refer to the Repository Structure section for a complete list of file paths, including binary files
- Files matching patterns in .gitignore are excluded
- Files matching default ignore patterns are excluded
- Files are sorted by Git change count (files with more changes are at the bottom)

# Directory Structure
````
docs/
  concepts.md
projects/
  apps/
    app1/
      public/
        favicon.ico
      src/
        app/
          app.component.ts
          app.config.ts
        index.html
        main.ts
        styles.scss
      README.md
      tsconfig.app.json
      tsconfig.spec.json
    app2/
      public/
        favicon.ico
      src/
        app/
          app.config.ts
          file-size.pipe.ts
          image-pipeline.service.ts
          image-processing.utils.ts
          image-processor.component.ts
        index.html
        main.ts
        styles.scss
      README.md
      tsconfig.app.json
      tsconfig.spec.json
    app3/
      src/
        app/
          app.config.ts
          app.container.ts
          app.routes.ts
          kitchen.component.ts
          kitchen.service.ts
        index.html
        main.ts
        styles.scss
      README.md
      tsconfig.app.json
      tsconfig.spec.json
    app4/
      src/
        app/
          app.component.ts
          app.config.ts
        index.html
        main.ts
        styles.scss
        territory-wars.service.ts
      README.md
      tsconfig.app.json
      tsconfig.spec.json
    shared/
      simple-atom.ts
  libraries/
    swiftly/
      src/
        lib/
          abstractions/
            actor.ts
            bus.ts
            coroutine.ts
            index.ts
            supervisor.ts
          utils/
            barrier.ts
            channel.ts
            compose.ts
            context.ts
            event.ts
            group.ts
            index.ts
            select.ts
            semaphore.ts
            timer.ts
            transfer.ts
            wait-group.ts
          worker/
            blob.ts
            concurrency.ts
            control.ts
            index.ts
            messages.ts
            module.ts
            runner.ts
            runtimes.ts
            scheduler.ts
            script.ts
            timer.ts
            types.ts
            utils.ts
          index.ts
        tests/
          actor.spec.ts
          barrier.spec.ts
          compose.spec.ts
          coroutine.spec.ts
          env.spec.ts
          event.spec.ts
          group.spec.ts
          script.spec.ts
          semaphore.spec.ts
          timer.spec.ts
          utils.spec.ts
          worker.spec.ts
        public-api.ts
      ng-package.json
      package.json
      README.md
      tsconfig.json
      tsconfig.lib.json
      tsconfig.lib.prod.json
      tsconfig.spec.json
.editorconfig
.gitignore
.prettierrc
angular.json
package.json
README.md
testify.json
tsconfig.json
````

# Files

## File: docs/concepts.md
````markdown
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
````

## File: projects/apps/app2/src/app/app.config.ts
````typescript
import { ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';

export const appConfig: ApplicationConfig = {
  providers: [provideZonelessChangeDetection()]
};
````

## File: projects/apps/app2/src/app/file-size.pipe.ts
````typescript
// file-size.pipe.ts
import { Pipe, PipeTransform } from '@angular/core';

const FILE_SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
const FILE_SIZE_THRESHOLD = 1024;

@Pipe({
  name: 'filesize',
  standalone: true
})
export class FileSizePipe implements PipeTransform {
  transform(sizeInBytes: number | string | null | undefined): string {
    const size = typeof sizeInBytes === 'string' ? parseFloat(sizeInBytes) : sizeInBytes;

    if (size === null || size === undefined || isNaN(size)) {
      return 'N/A';
    }

    if (size === 0) {
      return '0 B';
    }

    const absSize = Math.abs(size);
    const i = Math.floor(Math.log(absSize) / Math.log(FILE_SIZE_THRESHOLD));
    const formattedSize = `${(absSize / Math.pow(FILE_SIZE_THRESHOLD, i)).toFixed(2)} ${FILE_SIZE_UNITS[i]}`;

    return size < 0 ? `-${formattedSize}` : formattedSize;
  }
}
````

## File: projects/apps/app2/src/index.html
````html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Smart Image Processor — swiftly</title>
  <base href="/">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/x-icon" href="favicon.ico">
</head>
<body>
  <app-root></app-root>
</body>
</html>
````

## File: projects/apps/app2/src/main.ts
````typescript
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { ImageProcessorComponent } from './app/image-processor.component';

bootstrapApplication(ImageProcessorComponent, appConfig)
  .catch((err) => console.error(err));
````

## File: projects/apps/app2/src/styles.scss
````scss
/* Global resets for dark theme */
*, *::before, *::after {
  box-sizing: border-box;
}

html, body {
  margin: 0;
  padding: 0;
  background: #0f1117;
  color: #e2e5ec;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

input, select, button {
  font-family: inherit;
}

a { color: inherit; }
````

## File: projects/apps/app2/tsconfig.app.json
````json
/* To learn more about Typescript configuration file: https://www.typescriptlang.org/docs/handbook/tsconfig-json.html. */
/* To learn more about Angular compiler options: https://angular.dev/reference/configs/angular-compiler-options. */
{
  "extends": "../../../tsconfig.json",
  "compilerOptions": {
    "outDir": "../../out-tsc/app",
    "types": []
  },
  "files": [
    "src/main.ts"
  ],
  "include": [
    "src/**/*.d.ts"
  ]
}
````

## File: projects/apps/app2/tsconfig.spec.json
````json
/* To learn more about Typescript configuration file: https://www.typescriptlang.org/docs/handbook/tsconfig-json.html. */
/* To learn more about Angular compiler options: https://angular.dev/reference/configs/angular-compiler-options. */
{
  "extends": "../../../tsconfig.json",
  "compilerOptions": {
    "outDir": "../../out-tsc/spec",
    "types": [
      "jasmine"
    ]
  },
  "include": [
    "src/**/*.spec.ts",
    "src/**/*.d.ts"
  ]
}
````

## File: projects/apps/app3/src/app/app.config.ts
````typescript
import { ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [provideZonelessChangeDetection(), provideRouter(routes)]
};
````

## File: projects/apps/app3/src/app/app.container.ts
````typescript
import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-container',
  standalone: true,
  imports: [RouterOutlet, CommonModule],
  template: `
    <div class="container">
      <header>
        <h1>🍕 swiftly Kitchen</h1>
        <p>Actor-based concurrency demo</p>
      </header>
      <main>
        <router-outlet></router-outlet>
      </main>
    </div>
  `,
  styles: [`
    .container {
      display: flex;
      flex-direction: column;
      align-items: center;
      min-height: 100vh;
    }
    header {
      margin: 20px 0;
      text-align: center;
    }
    header h1 {
      margin: 0;
      font-size: 2rem;
      color: #ffd700;
    }
    header p {
      margin: 5px 0 0;
      color: #aaa;
      font-size: 0.9rem;
    }
    main {
      width: 100%;
      max-width: 1200px;
      padding: 0 20px 40px;
      box-sizing: border-box;
    }
  `],
})
export class ContainerComponent {}
````

## File: projects/apps/app3/src/app/app.routes.ts
````typescript
import { Routes } from '@angular/router';
import { KitchenComponent } from './kitchen.component';

export const routes: Routes = [
  { path: '', component: KitchenComponent },
];
````

## File: projects/apps/app3/src/app/kitchen.component.ts
````typescript
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import {
  KitchenService,
  KitchenStats,
  Order,
  OvenState,
} from './kitchen.service';

@Component({
  selector: 'app-kitchen',
  standalone: true,
  imports: [],
  template: `
    <div class="kitchen">
      <div class="controls">
        <button [disabled]="isRunning" (click)="runShift(morningOrders)">🌅 Morning Shift</button>
        <button [disabled]="isRunning" (click)="runShift(lunchOrders)">🌞 Lunch Rush</button>
        <button [disabled]="isRunning" (click)="runShift(afternoonOrders)">🌤️ Afternoon</button>
        <button [disabled]="isRunning" (click)="runShift(eveningOrders)">🌙 Evening Rush</button>
        <button [disabled]="isRunning" (click)="runFullDay()" class="primary">🍕 Full Day</button>
        <button [disabled]="!isRunning" (click)="closeKitchen()" class="danger">🚨 Close Kitchen</button>
      </div>

      <div class="stats">
        <div class="stat-card">
          <div class="stat-value">{{ stats.completed }}</div>
          <div class="stat-label">Completed</div>
        </div>

        <div class="stat-card">
          <div class="stat-value">{{ stats.cancelled }}</div>
          <div class="stat-label">Cancelled</div>
        </div>

        <div class="stat-card">
          <div class="stat-value">{{ stats.active }}</div>
          <div class="stat-label">Active</div>
        </div>

        <div class="stat-card revenue">
          <div class="stat-value">\${{ stats.revenue.toFixed(2) }}</div>
          <div class="stat-label">Revenue</div>
        </div>
      </div>

      <div class="ovens">
        @for (oven of ovens; track oven.id) {
          <div class="oven" [class.active]="oven.order">
            <div class="oven-header">{{ oven.id }}</div>

            <div class="oven-body">
              <div class="pizza-icon">{{ oven.order ? '🍕' : '❄️' }}</div>

              @if (oven.order) {
                <div class="oven-order">
                  <strong>{{ oven.order.item }}</strong>
                  <span>{{ oven.order.customer }}</span>
                </div>
              }

              @if (oven.stage) {
                <div class="oven-stage">{{ oven.stage }}</div>
              }
              @if (!oven.order) {
                <div class="oven-idle">Idle</div>
              }
            </div>
          </div>
        }
      </div>

      @if (isRunning && cancellableOrders.length > 0) {
        <div class="cancel-panel">
          <span>Cancel order:</span>

          @for (order of cancellableOrders; track order.id) {
            <button (click)="cancelOrder(order.id)">
              Cancel {{ order.customer }}'s {{ order.item }}
            </button>
          }
        </div>
      }

      <div class="log-panel">
        <div class="log-header">Event Log</div>

        <div class="log-entries">
          @for (entry of logEntries; track $index) {
            <div
              class="log-entry"
              [class]="entryClass(entry)"
            >
              {{ entry }}
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .kitchen {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      justify-content: center;
    }

    .controls button {
      padding: 10px 18px;
      border: none;
      border-radius: 8px;
      background: #2d2d44;
      color: #eee;
      font-size: 0.9rem;
      cursor: pointer;
      transition: all 0.2s;
    }

    .controls button:hover:not(:disabled) {
      background: #3d3d5c;
      transform: translateY(-1px);
    }

    .controls button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .controls button.primary {
      background: #d4a017;
      color: #1a1a2e;
      font-weight: bold;
    }

    .controls button.primary:hover:not(:disabled) {
      background: #e5b128;
    }

    .controls button.danger {
      background: #c0392b;
      color: white;
    }

    .controls button.danger:hover:not(:disabled) {
      background: #e74c3c;
    }

    .stats {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 15px;
    }

    @media (max-width: 600px) {
      .stats {
        grid-template-columns: repeat(2, 1fr);
      }
    }

    .stat-card {
      background: #16213e;
      border-radius: 12px;
      padding: 16px;
      text-align: center;
      border: 1px solid #0f3460;
    }

    .stat-card.revenue {
      border-color: #d4a017;
    }

    .stat-value {
      font-size: 1.8rem;
      font-weight: bold;
      color: #ffd700;
    }

    .stat-label {
      font-size: 0.8rem;
      color: #aaa;
      margin-top: 4px;
    }

    .ovens {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 15px;
    }

    @media (max-width: 600px) {
      .ovens {
        grid-template-columns: 1fr;
      }
    }

    .oven {
      background: #16213e;
      border-radius: 12px;
      overflow: hidden;
      border: 2px solid #0f3460;
      transition: border-color 0.3s;
    }

    .oven.active {
      border-color: #e67e22;
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% {
        box-shadow: 0 0 5px rgba(230, 126, 34, 0.3);
      }

      50% {
        box-shadow: 0 0 20px rgba(230, 126, 34, 0.6);
      }
    }

    .oven-header {
      background: #0f3460;
      padding: 10px;
      font-weight: bold;
      text-align: center;
      color: #eee;
    }

    .oven-body {
      padding: 20px;
      text-align: center;
      min-height: 120px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }

    .pizza-icon {
      font-size: 2.5rem;
    }

    .oven-order {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .oven-order strong {
      color: #ffd700;
    }

    .oven-order span {
      font-size: 0.85rem;
      color: #aaa;
    }

    .oven-stage {
      font-size: 0.8rem;
      color: #e67e22;
      font-style: italic;
    }

    .oven-idle {
      color: #7f8c8d;
      font-style: italic;
    }

    .cancel-panel {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      justify-content: center;
      background: #2d1f1f;
      border: 1px solid #5c2a2a;
      border-radius: 8px;
      padding: 12px;
    }

    .cancel-panel span {
      color: #e74c3c;
      font-size: 0.9rem;
    }

    .cancel-panel button {
      padding: 6px 12px;
      border: 1px solid #c0392b;
      border-radius: 6px;
      background: transparent;
      color: #e74c3c;
      font-size: 0.8rem;
      cursor: pointer;
    }

    .cancel-panel button:hover {
      background: #c0392b;
      color: white;
    }

    .log-panel {
      background: #0a0a14;
      border-radius: 12px;
      border: 1px solid #1a1a2e;
      overflow: hidden;
    }

    .log-header {
      background: #16213e;
      padding: 12px 16px;
      font-weight: bold;
      border-bottom: 1px solid #0f3460;
    }

    .log-entries {
      padding: 10px;
      font-family: 'Courier New', monospace;
      font-size: 0.8rem;
      line-height: 1.5;
    }

    .log-entry {
      padding: 3px 0;
      border-bottom: 1px solid #1a1a2e;
      color: #ccc;
      white-space: pre-wrap;
    }

    .log-entry.started {
      color: #3498db;
    }

    .log-entry.ready {
      color: #2ecc71;
    }

    .log-entry.cancelled {
      color: #e74c3c;
    }

    .log-entry.timeout {
      color: #e67e22;
    }

    .log-entry.closed {
      color: #ffd700;
      font-weight: bold;
    }
  `],
})
export class KitchenComponent implements OnInit, OnDestroy {
  ovens: OvenState[] = [];
  cancellableOrders: Order[] = [];
  stats: KitchenStats = {
    completed: 0,
    cancelled: 0,
    revenue: 0,
    active: 0,
  };
  logEntries: string[] = [];
  isRunning = false;

  morningOrders: Order[] = [
    { id: 'M1', item: 'Margherita', customer: 'John' },
    { id: 'M2', item: 'Pepperoni', customer: 'Sarah' },
    { id: 'M3', item: 'Hawaiian', customer: 'Mike' },
  ];

  lunchOrders: Order[] = [
    { id: 'L1', item: 'Quattro Formaggi', customer: 'Emma' },
    { id: 'L2', item: 'Diavola', customer: 'Luca' },
    { id: 'L3', item: 'Margherita', customer: 'Sophia' },
    { id: 'L4', item: 'Pepperoni', customer: 'Oliver' },
  ];

  afternoonOrders: Order[] = [
    { id: 'A1', item: 'Hawaiian', customer: 'Isabella' },
    { id: 'A2', item: 'Diavola', customer: 'Ethan' },
  ];

  eveningOrders: Order[] = [
    { id: 'E1', item: 'Diavola', customer: 'Marco' },
    { id: 'E2', item: 'Quattro Formaggi', customer: 'Giulia' },
    { id: 'E3', item: 'Pepperoni', customer: 'Antonio' },
    { id: 'E4', item: 'Margherita', customer: 'Francesca' },
    { id: 'E5', item: 'Hawaiian', customer: 'Roberto' },
  ];

  private readonly cleanups: Array<() => void> = [];
  private runningInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private kitchen: KitchenService, private cdr: ChangeDetectorRef) {}

  ngOnInit() {
    this.cleanups.push(
      this.kitchen.ovens$.subscribe((ovens: OvenState[]) => {
        this.ovens = ovens;
        this.cdr.detectChanges();
      }),
    );

    this.cleanups.push(
      this.kitchen.cancellableOrders$.subscribe((orders: Order[]) => {
        this.cancellableOrders = orders;
        this.cdr.detectChanges();
      }),
    );

    this.cleanups.push(
      this.kitchen.stats$.subscribe((stats: KitchenStats) => {
        this.stats = stats;
        this.cdr.detectChanges();
      }),
    );

    this.cleanups.push(
      this.kitchen.log$.subscribe((entry) => {
        if (!entry) {
          return;
        }
        this.logEntries.push(entry);

        if (this.logEntries.length > 200) {
          this.logEntries.shift();
        }
        this.cdr.detectChanges();
      }),
    );

    this.updateRunningState();

    this.runningInterval = setInterval(() => {
      this.updateRunningState();
      this.cdr.detectChanges();
    }, 250);
    this.cleanups.push(() => {
      if (this.runningInterval) {
        clearInterval(this.runningInterval);
        this.runningInterval = null;
      }
    });


  }

  ngOnDestroy() {
    while (this.cleanups.length > 0) {
      this.cleanups.pop()!();
    }
    void this.kitchen.destroy();
  }

  async runShift(orders: Order[]) {
    this.kitchen.resetState();
    this.logEntries = [];
    this.cdr.detectChanges();

    await this.kitchen.runShift(orders);

    this.updateRunningState();
    this.cdr.detectChanges();
  }

  async runFullDay() {
    this.kitchen.resetState();
    this.logEntries = [];
    this.cdr.detectChanges();

    await this.kitchen.runFullDay();

    this.updateRunningState();
    this.cdr.detectChanges();
  }

  cancelOrder(orderId: string) {
    this.kitchen.cancelOrder(orderId);
    this.cdr.detectChanges();
  }

  closeKitchen() {
    this.kitchen.closeKitchen();
    this.cdr.detectChanges();
  }

  private updateRunningState() {
    this.isRunning = this.kitchen.isRunning();
  }

  entryClass(entry: string): string {
    if (entry.includes('🍳 Started')) return 'started';
    if (entry.includes('✅ READY')) return 'ready';
    if (entry.includes('❌ CANCELLED')) return 'cancelled';
    if (entry.includes('⏰ TIMEOUT')) return 'timeout';
    if (entry.includes('🏁 Shift closed')) return 'closed';
    if (entry.includes('🚨 Kitchen closing')) return 'cancelled';
    if (entry.includes('🚫 Cancellation requested')) return 'cancelled';

    return '';
  }
}
````

## File: projects/apps/app3/src/index.html
````html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>swiftly Kitchen</title>
  <base href="/">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/x-icon" href="favicon.ico">
</head>
<body>
  <app-container></app-container>
</body>
</html>
````

## File: projects/apps/app3/src/main.ts
````typescript
import { bootstrapApplication } from '@angular/platform-browser';

import { appConfig } from './app/app.config';
import { ContainerComponent } from './app/app.container';

bootstrapApplication(ContainerComponent, appConfig)
  .catch((err) => console.warn(err));
````

## File: projects/apps/app3/src/styles.scss
````scss
body {
  margin: 0;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  background: #1a1a2e;
  color: #eee;
}
````

## File: projects/apps/app3/tsconfig.app.json
````json
{
  "extends": "../../../tsconfig.json",
  "compilerOptions": {
    "outDir": "../../out-tsc/app",
    "types": []
  },
  "files": [
    "src/main.ts"
  ],
  "include": [
    "src/**/*.d.ts"
  ]
}
````

## File: projects/apps/app3/tsconfig.spec.json
````json
{
  "extends": "../../../tsconfig.json",
  "compilerOptions": {
    "outDir": "../../out-tsc/spec",
    "types": [
      "jasmine"
    ]
  },
  "include": [
    "src/**/*.spec.ts",
    "src/**/*.d.ts"
  ]
}
````

## File: projects/apps/app4/src/app/app.component.ts
````typescript
import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import type { TerritoryWarsState } from '../territory-wars.service';
import { TerritoryWarsService } from '../territory-wars.service';

function getHoshiSet(size: number): Set<string> {
  const set = new Set<string>();
  const add = (row: number, col: number) => set.add(`${row},${col}`);

  if (size === 9) {
    [2, 6].forEach((point) => {
      add(point, 2);
      add(point, 6);
    });
    add(4, 4);
  } else if (size === 11) {
    [2, 8].forEach((point) => {
      add(point, 2);
      add(point, 8);
    });
    add(5, 5);
  } else if (size === 13) {
    [3, 9].forEach((point) => {
      add(point, 3);
      add(point, 9);
    });
    add(6, 6);
  } else if (size === 19) {
    [3, 9, 15].forEach((row) => [3, 9, 15].forEach((col) => add(row, col)));
  } else {
    const quarter = Math.floor((size - 1) / 4);
    const middle = Math.floor((size - 1) / 2);
    add(quarter, quarter);
    add(quarter, size - 1 - quarter);
    add(size - 1 - quarter, quarter);
    add(size - 1 - quarter, size - 1 - quarter);
    add(middle, middle);
  }

  return set;
}

@Component({
  selector: 'app-root',
  standalone: true,
  template: `
    <div class="tw-shell">
      <header class="hero">
        <div class="hero-copy">
          <p class="eyebrow">swiftly Actors + Angular</p>
          <h1>Territory Wars</h1>
          <p class="hero-text">
            @if (state(); as game) {
              {{ subtitle(game) }}
            } @else {
              Starting match...
            }
          </p>
        </div>
        <div class="rules-card">
          <strong>Rules</strong>
          <p>Place a stone on any empty point. Surrounded groups are captured. Score is stones plus enclosed territory.</p>
        </div>
      </header>

      <section class="toolbar">
        <div class="toolbar-group size-picker">
          <span class="toolbar-label">Board</span>
          <button [class.active]="currentSize() === 9" (click)="startMatch(9)">9 × 9</button>
          <button [class.active]="currentSize() === 11" (click)="startMatch(11)">11 × 11</button>
          <button [class.active]="currentSize() === 13" (click)="startMatch(13)">13 × 13</button>
        </div>

        <div class="toolbar-group">
          <span class="toolbar-label">Match</span>
          <button (click)="startMatch(currentSize())">New Match</button>
          <button (click)="pass()" [disabled]="!canPass()">Pass Turn</button>
        </div>
      </section>

      @if (state(); as game) {
        <section class="dashboard">
          <article class="score-panel user-panel">
            <span class="panel-label">User Score</span>
            <strong>{{ game.score.user }}</strong>
            <span class="panel-meta">Territory <b>{{ territoryScore(game, 'user') }}</b></span>
            <span class="panel-meta">Captures <b>{{ game.captures.user }}</b></span>
          </article>

          <article class="center-panel">
            <span class="panel-label">Board State</span>
            <strong>{{ game.message }}</strong>
            <span class="panel-meta">Legal moves: user {{ game.legalMoves.user }}, rival {{ game.legalMoves.rival }}</span>
          </article>

          <article class="score-panel rival-panel">
            <span class="panel-label">Rival Score</span>
            <strong>{{ game.score.rival }}</strong>
            <span class="panel-meta">Territory <b>{{ territoryScore(game, 'rival') }}</b></span>
            <span class="panel-meta">Captures <b>{{ game.captures.rival }}</b></span>
          </article>
        </section>

        <section class="board-stage">
          <div class="board-frame">
            <div class="board-mount">
              <div
                class="board-grid"
                [style.gridTemplateColumns]="'repeat(' + game.size + ', minmax(0, 1fr))'"
                [style.gridTemplateRows]="'repeat(' + game.size + ', minmax(0, 1fr))'"
              >
                @for (row of game.board; track $index; let rowIndex = $index) {
                  @for (cell of row; track $index; let colIndex = $index) {
                    <button
                      type="button"
                      class="board-cell"
                      [class.user]="cell === 1"
                      [class.rival]="cell === 2"
                      [class.territory-user]="game.status === 'finished' && cell === 0 && game.territory[rowIndex][colIndex] === 1"
                      [class.territory-rival]="game.status === 'finished' && cell === 0 && game.territory[rowIndex][colIndex] === 2"
                      [class.last-move]="isLastMove(game, rowIndex, colIndex)"
                      [class.interactive]="canPlace(game, rowIndex, colIndex)"
                      [class.hoshi]="cell === 0 && isHoshi(rowIndex, colIndex)"
                      [disabled]="!canPlace(game, rowIndex, colIndex)"
                      [attr.aria-label]="'Row ' + (rowIndex + 1) + ' column ' + (colIndex + 1)"
                      (click)="place(rowIndex, colIndex, game)"
                    ></button>
                  }
                }
              </div>
            </div>
          </div>
        </section>

        <section class="notes">
          <p><strong>Actors:</strong> the user actor forwards clicks, the game actor owns rules and scoring, and the rival actor evaluates responses before playing back into the match.</p>
          <p><strong>Angular UI:</strong> the board now renders through a normal Angular template while the worker-driven actor model stays intact.</p>
        </section>
      }
    </div>
  `,
})
export class AppComponent implements OnInit, OnDestroy {
  private readonly unsubscribe: Array<() => void> = [];
  readonly state = signal<TerritoryWarsState | null>(null);
  readonly currentSize = signal(11);
  readonly hoshiSet = computed(() => getHoshiSet(this.currentSize()));

  constructor(private readonly service: TerritoryWarsService) {}

  ngOnInit(): void {
    this.unsubscribe.push(
      this.service.state$.subscribe((nextState) => {
        if (!nextState) {
          return;
        }
        this.state.set(nextState);
      }),
    );

    this.startMatch(this.currentSize());
  }

  ngOnDestroy(): void {
    while (this.unsubscribe.length > 0) {
      this.unsubscribe.pop()!();
    }
    void this.service.destroy();
  }

  startMatch(size: number): void {
    this.currentSize.set(size);
    this.service.start(size);
  }

  pass(): void {
    if (!this.canPass()) {
      return;
    }
    this.service.pass();
  }

  place(row: number, col: number, game: TerritoryWarsState): void {
    if (!this.canPlace(game, row, col)) {
      return;
    }
    this.service.place(row, col);
  }

  canPass(): boolean {
    const game = this.state();
    return !!game && game.status === 'playing' && game.currentPlayer === 'user' && !game.pendingRival;
  }

  canPlace(game: TerritoryWarsState, row: number, col: number): boolean {
    return game.status === 'playing' && game.currentPlayer === 'user' && !game.pendingRival && game.board[row][col] === 0;
  }

  isHoshi(row: number, col: number): boolean {
    return this.hoshiSet().has(`${row},${col}`);
  }

  isLastMove(game: TerritoryWarsState, row: number, col: number): boolean {
    return game.lastMove?.row === row && game.lastMove?.col === col;
  }

  territoryScore(game: TerritoryWarsState, player: 'user' | 'rival'): number {
    return Math.max(0, game.score[player] - game.stones[player]);
  }

  subtitle(game: TerritoryWarsState): string {
    const winnerLabel =
      game.winner === 'draw'
        ? 'Draw'
        : game.winner === 'user'
          ? 'User leads'
          : game.winner === 'rival'
            ? 'Rival leads'
            : game.currentPlayer === 'user'
              ? 'Your turn'
              : 'Rival turn';

    if (game.status === 'finished') {
      return `Match finished after ${game.moveCount} turns. ${winnerLabel}.`;
    }

    if (game.pendingRival) {
      return 'Your actor handed the board to the rival actor. The worker is thinking...';
    }

    return 'Place a stone to grow territory, pressure groups, and force captures.';
  }
}
````

## File: projects/apps/app4/src/app/app.config.ts
````typescript
import { ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';

export const appConfig: ApplicationConfig = {
  providers: [provideZonelessChangeDetection()],
};
````

## File: projects/apps/app4/src/index.html
````html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Territory Wars</title>
  <base href="/">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/x-icon" href="favicon.ico">
</head>
<body>
  <app-root></app-root>
</body>
</html>
````

## File: projects/apps/app4/src/main.ts
````typescript
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

bootstrapApplication(AppComponent, appConfig).catch((error) => console.error(error));
````

## File: projects/apps/app4/src/styles.scss
````scss
:root {
  --ink: #201912;
  --paper: #efe3c7;
  --paper-deep: #d7be90;
  --wood: #c49a5e;
  --wood-dark: #7a5123;
  --line: #4a3728;
  --shadow: rgba(24, 13, 4, 0.22);
  --user: #2f5d8d;
  --user-glow: rgba(47, 93, 141, 0.24);
  --rival: #1f1814;
  --rival-glow: rgba(31, 24, 20, 0.28);
  --accent: #b43f1e;
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  min-height: 100%;
}

body {
  font-family: "Trebuchet MS", "Segoe UI", sans-serif;
  color: var(--ink);
  background:
    radial-gradient(circle at top, rgba(255, 241, 209, 0.65), transparent 42%),
    linear-gradient(180deg, #f4e8cc 0%, #e3cc9d 52%, #c89f65 100%);
}

button {
  font: inherit;
}

#app {
  min-height: 100vh;
}

.tw-shell {
  width: min(1200px, calc(100vw - 36px));
  margin: 0 auto;
  padding: 28px 0 40px;
}

.hero {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(260px, 0.75fr);
  gap: 18px;
  align-items: start;
  margin-bottom: 20px;
}

.hero-copy,
.rules-card,
.toolbar,
.board-stage,
.notes {
  border: 1px solid rgba(94, 61, 27, 0.22);
  box-shadow: 0 18px 40px var(--shadow);
}

.hero-copy,
.rules-card,
.toolbar,
.notes {
  background: rgba(255, 247, 228, 0.82);
  backdrop-filter: blur(5px);
}

.hero-copy {
  padding: 28px 30px;
  border-radius: 26px;
}

.eyebrow {
  margin: 0 0 10px;
  font-size: 0.78rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--accent);
}

.hero h1 {
  margin: 0;
  font-family: "Palatino Linotype", Georgia, serif;
  font-size: clamp(2.7rem, 5vw, 4.8rem);
  line-height: 0.95;
}

.hero-text {
  max-width: 42rem;
  margin: 14px 0 0;
  font-size: 1rem;
  line-height: 1.65;
  color: rgba(32, 25, 18, 0.85);
}

.rules-card {
  padding: 24px 24px 22px;
  border-radius: 26px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 10px;
}

.rules-card strong {
  font-size: 0.8rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--accent);
}

.rules-card p {
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.7;
}

.toolbar {
  border-radius: 22px;
  padding: 14px;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: space-between;
  margin-bottom: 18px;
}

.toolbar-group {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.toolbar-label {
  margin-right: 4px;
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  color: rgba(32, 25, 18, 0.62);
}

.toolbar button {
  appearance: none;
  border: 1px solid rgba(84, 54, 23, 0.22);
  background: rgba(255, 250, 240, 0.94);
  color: var(--ink);
  border-radius: 999px;
  padding: 0.7rem 1rem;
  cursor: pointer;
  transition: transform 120ms ease, background 120ms ease, border-color 120ms ease;
}

.toolbar button:hover {
  transform: translateY(-1px);
  background: rgba(255, 255, 255, 0.98);
}

.toolbar button.active {
  background: #25180f;
  border-color: #25180f;
  color: #fff6e5;
}

.toolbar button:disabled {
  cursor: default;
  transform: none;
  opacity: 0.48;
}

.dashboard {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 18px;
}

.score-panel,
.center-panel {
  border-radius: 24px;
  padding: 20px 18px;
  min-height: 160px;
}

.score-panel {
  color: #fff8e6;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.user-panel {
  background: linear-gradient(160deg, #3f75ac, #204266);
}

.rival-panel {
  background: linear-gradient(160deg, #57453c, #1f1814);
}

.center-panel {
  background: linear-gradient(180deg, rgba(255, 247, 228, 0.92), rgba(240, 224, 191, 0.92));
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 8px;
  color: var(--ink);
  text-align: center;
}

.panel-label {
  font-size: 0.76rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  opacity: 0.78;
}

.score-panel strong {
  font-family: "Palatino Linotype", Georgia, serif;
  font-size: clamp(1.8rem, 3vw, 2.6rem);
}

.center-panel strong {
  font-family: "Palatino Linotype", Georgia, serif;
  font-size: clamp(1.2rem, 2.2vw, 1.7rem);
  line-height: 1.3;
}

.panel-meta {
  font-size: 0.92rem;
  opacity: 0.85;
}

.panel-meta b {
  font-weight: 800;
}

.board-stage {
  padding: 18px;
  border-radius: 28px;
  background: rgba(255, 245, 220, 0.78);
  margin-bottom: 18px;
}

.board-frame {
  background:
    linear-gradient(180deg, rgba(255, 246, 215, 0.62), rgba(207, 161, 92, 0.26)),
    linear-gradient(135deg, #c08a42, #a96f2d);
  border-radius: 22px;
  padding: 16px;
  box-shadow:
    inset 0 1px 0 rgba(255, 247, 228, 0.45),
    inset 0 -10px 20px rgba(84, 54, 23, 0.16);
}

.board-mount {
  user-select: none;
  -webkit-user-select: none;
}

/* ===== Board Grid ===== */
.board-grid {
  display: grid;
  /* grid-template set inline via JS */
  gap: 1px;
  width: min(76vw, 700px);
  aspect-ratio: 1;
  margin: 0 auto;
  border: 2px solid var(--line);
  border-radius: 4px;
  background: var(--line);
  box-shadow: 0 14px 32px rgba(74, 44, 16, 0.24);
}

/* ===== Cell ===== */
.board-cell {
  position: relative;
  appearance: none;
  border: 0;
  padding: 0;
  background: var(--wood);
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  cursor: default;
}

/* Intersection dot for empty cells */
.board-cell:not(.user):not(.rival)::before {
  content: "";
  position: absolute;
  inset: 50% auto auto 50%;
  width: 14%;
  height: 14%;
  transform: translate(-50%, -50%);
  border-radius: 999px;
  background: rgba(74, 55, 40, 0.35);
  transition: opacity 120ms ease, transform 120ms ease;
}

/* Star point (hoshi) */
.board-cell.hoshi::before {
  width: 22%;
  height: 22%;
  background: rgba(74, 55, 40, 0.55);
}

/* Hide dot when stone is present */
.board-cell.user::before,
.board-cell.rival::before {
  content: "";
  position: absolute;
  inset: 50% auto auto 50%;
  width: 82%;
  height: 82%;
  transform: translate(-50%, -50%);
  border-radius: 999px;
  transition: transform 180ms cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 180ms ease, opacity 180ms ease;
  opacity: 1;
  box-shadow: 0 6px 14px rgba(23, 12, 5, 0.22);
}

.board-cell.user::before {
  background: radial-gradient(circle at 30% 30%, #8abae8, #2f5d8d 58%, #1a3a5c 100%);
}

.board-cell.rival::before {
  background: radial-gradient(circle at 30% 30%, #6d5d54, #1f1814 58%, #0a0806 100%);
}

/* Interactive / hover */
.board-cell.interactive {
  cursor: pointer;
}

.board-cell.interactive:hover::before {
  opacity: 1;
  transform: translate(-50%, -50%) scale(1.15);
  background: rgba(180, 63, 30, 0.22);
}

.board-cell.user.interactive:hover::before,
.board-cell.rival.interactive:hover::before {
  transform: translate(-50%, -50%) scale(1.08);
  background: radial-gradient(circle at 30% 30%, #a8d0f0, #4a7fb8 58%, #2a5580 100%);
}

/* Territory shading */
.board-cell.territory-user {
  background: #c4dcb0;
}

.board-cell.territory-rival {
  background: #dcc4b0;
}

/* Territory markers — small stone dots inside empty territory cells */
.board-cell.territory-user::after {
  content: "";
  position: absolute;
  inset: 50% auto auto 50%;
  width: 28%;
  height: 28%;
  transform: translate(-50%, -50%);
  border-radius: 999px;
  background: rgba(47, 93, 141, 0.45);
  pointer-events: none;
}

.board-cell.territory-rival::after {
  content: "";
  position: absolute;
  inset: 50% auto auto 50%;
  width: 28%;
  height: 28%;
  transform: translate(-50%, -50%);
  border-radius: 999px;
  background: rgba(31, 24, 20, 0.45);
  pointer-events: none;
}

/* Last move marker */
.board-cell.last-move::after {
  content: "";
  position: absolute;
  inset: 17%;
  border-radius: 999px;
  border: 2.5px solid rgba(255, 246, 215, 0.95);
  box-shadow: 0 0 0 1px rgba(84, 54, 23, 0.3);
  pointer-events: none;
}

/* Captured / removed stone animation hint */
@keyframes place-stone {
  from {
    transform: translate(-50%, -50%) scale(0.3);
    opacity: 0;
  }
  to {
    transform: translate(-50%, -50%) scale(1);
    opacity: 1;
  }
}

.board-cell.user::before,
.board-cell.rival::before {
  animation: place-stone 220ms ease-out;
}

.notes {
  border-radius: 22px;
  padding: 18px 20px;
}

.notes p {
  margin: 0;
  line-height: 1.65;
}

.notes p + p {
  margin-top: 10px;
}

@media (max-width: 920px) {
  .hero,
  .dashboard {
    grid-template-columns: 1fr;
  }

  .board-grid {
    width: min(92vw, 620px);
  }
}

@media (max-width: 640px) {
  .tw-shell {
    width: min(100vw - 20px, 100%);
    padding-top: 16px;
  }

  .hero-copy,
  .rules-card,
  .board-stage,
  .notes {
    border-radius: 20px;
  }

  .toolbar {
    padding: 12px;
  }

  .toolbar button {
    padding: 0.62rem 0.88rem;
  }

  .board-stage {
    padding: 10px;
  }

  .board-frame {
    padding: 10px;
  }
}
````

## File: projects/apps/app4/src/territory-wars.service.ts
````typescript
import { Injectable } from '@angular/core';
import { ActorBusMessage, actor, main, WorkerUtils } from '@epikodelabs/swiftly';
import { atom } from '../../shared/simple-atom';

export type PlayerId = 'user' | 'rival';

export type TerritoryWarsState = {
  board: number[][];
  territory: number[][];
  size: number;
  currentPlayer: PlayerId;
  pendingRival: boolean;
  status: 'playing' | 'finished';
  moveCount: number;
  passStreak: number;
  captures: Record<PlayerId, number>;
  stones: Record<PlayerId, number>;
  score: Record<PlayerId, number>;
  legalMoves: Record<PlayerId, number>;
  winner: PlayerId | 'draw' | null;
  message: string;
  lastMove: { row: number; col: number; player: PlayerId } | null;
};

type MovePayload = {
  row: number;
  col: number;
};

type RivalThinkPayload = {
  board: number[][];
  size: number;
  turnId: number;
  legalMoves: MovePayload[];
};

type RivalMovePayload = {
  turnId: number;
  move: MovePayload | null;
};

type InternalGameState = {
  board: number[][];
  size: number;
  currentPlayer: PlayerId;
  pendingRival: boolean;
  status: 'playing' | 'finished';
  moveCount: number;
  passStreak: number;
  captures: Record<PlayerId, number>;
  winner: PlayerId | 'draw' | null;
  message: string;
  lastMove: { row: number; col: number; player: PlayerId } | null;
  turnId: number;
  boardHistory: Set<string>;
};

type PlacementResult =
  | {
      ok: true;
      board: number[][];
      captured: number;
    }
  | {
      ok: false;
      board: number[][];
      reason: string;
    };

function createBoard(size: number): number[][] {
  const board: number[][] = [];
  for (let row = 0; row < size; row++) {
    const line: number[] = [];
    for (let col = 0; col < size; col++) {
      line.push(0);
    }
    board.push(line);
  }
  return board;
}

function cloneBoard(board: number[][]): number[][] {
  return board.map((row) => row.slice());
}

function createInternalState(size: number): InternalGameState {
  const board = createBoard(size);
  return {
    board,
    size,
    currentPlayer: 'user',
    pendingRival: false,
    status: 'playing',
    moveCount: 0,
    passStreak: 0,
    captures: {
      user: 0,
      rival: 0,
    },
    winner: null,
    message: 'Your move. Surround rival groups to capture them.',
    lastMove: null,
    turnId: 0,
    boardHistory: new Set<string>([boardHash(board)]),
  };
}

function playerToStone(player: PlayerId): number {
  return player === 'user' ? 1 : 2;
}

function otherPlayer(player: PlayerId): PlayerId {
  return player === 'user' ? 'rival' : 'user';
}

function inBounds(size: number, row: number, col: number): boolean {
  return row >= 0 && row < size && col >= 0 && col < size;
}

function neighbors(size: number, row: number, col: number): [number, number][] {
  const result: [number, number][] = [];
  if (row > 0) result.push([row - 1, col]);
  if (row + 1 < size) result.push([row + 1, col]);
  if (col > 0) result.push([row, col - 1]);
  if (col + 1 < size) result.push([row, col + 1]);
  return result;
}

function groupKey(row: number, col: number): string {
  return `${row}:${col}`;
}

function boardHash(board: number[][]): string {
  return board.map((row) => row.join('')).join('|');
}

function collectGroup(board: number[][], row: number, col: number): {
  cells: [number, number][];
  liberties: number;
} {
  const size = board.length;
  const stone = board[row][col];
  const stack: [number, number][] = [[row, col]];
  const seen = new Set<string>([groupKey(row, col)]);
  const liberties = new Set<string>();
  const cells: [number, number][] = [];

  while (stack.length > 0) {
    const [currentRow, currentCol] = stack.pop()!;
    cells.push([currentRow, currentCol]);

    for (const [nextRow, nextCol] of neighbors(size, currentRow, currentCol)) {
      const value = board[nextRow][nextCol];
      if (value === 0) {
        liberties.add(groupKey(nextRow, nextCol));
        continue;
      }
      if (value !== stone) {
        continue;
      }
      const key = groupKey(nextRow, nextCol);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      stack.push([nextRow, nextCol]);
    }
  }

  return {
    cells,
    liberties: liberties.size,
  };
}

function removeGroup(board: number[][], cells: [number, number][]): void {
  for (const [row, col] of cells) {
    board[row][col] = 0;
  }
}

function tryPlaceStone(
  board: number[][],
  row: number,
  col: number,
  player: PlayerId,
  boardHistory?: ReadonlySet<string>
): PlacementResult {
  const size = board.length;
  if (!inBounds(size, row, col)) {
    return { ok: false, board, reason: 'That point is outside the board.' };
  }
  if (board[row][col] !== 0) {
    return { ok: false, board, reason: 'That point is already occupied.' };
  }

  const nextBoard = cloneBoard(board);
  const ownStone = playerToStone(player);
  const enemyStone = playerToStone(otherPlayer(player));
  nextBoard[row][col] = ownStone;

  let captured = 0;
  const seenEnemyGroups = new Set<string>();

  for (const [neighborRow, neighborCol] of neighbors(size, row, col)) {
    if (nextBoard[neighborRow][neighborCol] !== enemyStone) {
      continue;
    }

    const key = groupKey(neighborRow, neighborCol);
    if (seenEnemyGroups.has(key)) {
      continue;
    }

    const enemyGroup = collectGroup(nextBoard, neighborRow, neighborCol);
    for (const [groupRow, groupCol] of enemyGroup.cells) {
      seenEnemyGroups.add(groupKey(groupRow, groupCol));
    }

    if (enemyGroup.liberties === 0) {
      captured += enemyGroup.cells.length;
      removeGroup(nextBoard, enemyGroup.cells);
    }
  }

  const ownGroup = collectGroup(nextBoard, row, col);
  if (ownGroup.liberties === 0) {
    return {
      ok: false,
      board,
      reason: captured > 0 ? 'Illegal move.' : 'Suicidal moves are not allowed.',
    };
  }

  if (boardHistory) {
    const newHash = boardHash(nextBoard);
    if (boardHistory.has(newHash)) {
      return {
        ok: false,
        board,
        reason: 'Superko — repeating any previous board position is not allowed.',
      };
    }
  }

  return {
    ok: true,
    board: nextBoard,
    captured,
  };
}

function countStones(board: number[][]): Record<PlayerId, number> {
  let user = 0;
  let rival = 0;

  for (const row of board) {
    for (const cell of row) {
      if (cell === 1) user++;
      if (cell === 2) rival++;
    }
  }

  return { user, rival };
}

function computeTerritory(board: number[][]): number[][] {
  const size = board.length;
  const territory = createBoard(size);
  const open = new Set<string>();

  const stack: [number, number][] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (board[r][c] === 0 && (r === 0 || r === size - 1 || c === 0 || c === size - 1)) {
        const key = groupKey(r, c);
        if (!open.has(key)) {
          open.add(key);
          stack.push([r, c]);
        }
      }
    }
  }

  while (stack.length > 0) {
    const [r, c] = stack.pop()!;
    for (const [nr, nc] of neighbors(size, r, c)) {
      if (board[nr][nc] === 0) {
        const key = groupKey(nr, nc);
        if (!open.has(key)) {
          open.add(key);
          stack.push([nr, nc]);
        }
      }
    }
  }

  const seen = new Set<string>();
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (board[r][c] !== 0 || open.has(groupKey(r, c)) || seen.has(groupKey(r, c))) {
        continue;
      }

      const region: [number, number][] = [];
      const borderOwners = new Set<number>();
      const regionStack: [number, number][] = [[r, c]];
      seen.add(groupKey(r, c));

      while (regionStack.length > 0) {
        const [cr, cc] = regionStack.pop()!;
        region.push([cr, cc]);

        for (const [nr, nc] of neighbors(size, cr, cc)) {
          if (board[nr][nc] === 0) {
            const key = groupKey(nr, nc);
            if (!seen.has(key)) {
              seen.add(key);
              regionStack.push([nr, nc]);
            }
          } else {
            borderOwners.add(board[nr][nc]);
          }
        }
      }

      if (borderOwners.size === 1) {
        const owner = [...borderOwners][0];
        for (const [tr, tc] of region) {
          territory[tr][tc] = owner;
        }
      }
    }
  }

  return territory;
}

function countTerritory(territory: number[][]): Record<PlayerId, number> {
  let user = 0;
  let rival = 0;

  for (const row of territory) {
    for (const cell of row) {
      if (cell === 1) user++;
      if (cell === 2) rival++;
    }
  }

  return { user, rival };
}

function countLegalMoves(
  board: number[][],
  player: PlayerId,
  boardHistory?: ReadonlySet<string>,
): number {
  let total = 0;
  const size = board.length;

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (board[row][col] !== 0) {
        continue;
      }
      if (tryPlaceStone(board, row, col, player, boardHistory).ok) {
        total++;
      }
    }
  }

  return total;
}

function computeLegalMovesList(
  board: number[][],
  player: PlayerId,
  boardHistory: ReadonlySet<string>,
): MovePayload[] {
  const size = board.length;
  const moves: MovePayload[] = [];

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (board[r][c] !== 0) {
        continue;
      }
      if (tryPlaceStone(board, r, c, player, boardHistory).ok) {
        moves.push({ row: r, col: c });
      }
    }
  }

  return moves;
}

function scoreBoard(
  board: number[][],
  captures: Record<PlayerId, number>,
  boardHistory?: ReadonlySet<string>,
) {
  const stones = countStones(board);
  const territory = computeTerritory(board);
  const territoryCount = countTerritory(territory);

  return {
    stones,
    territory,
    score: {
      user: stones.user + territoryCount.user,
      rival: stones.rival + territoryCount.rival,
    },
    legalMoves: {
      user: countLegalMoves(board, 'user', boardHistory),
      rival: countLegalMoves(board, 'rival', boardHistory),
    },
    captures: {
      user: captures.user,
      rival: captures.rival,
    },
  };
}

function determineWinner(
  score: Record<PlayerId, number>,
  captures: Record<PlayerId, number>
): PlayerId | 'draw' {
  if (score.user !== score.rival) {
    return score.user > score.rival ? 'user' : 'rival';
  }
  if (captures.user !== captures.rival) {
    return captures.user > captures.rival ? 'user' : 'rival';
  }
  return 'draw';
}

function createPublicState(state: InternalGameState): TerritoryWarsState {
  const scored = scoreBoard(state.board, state.captures, state.boardHistory);

  return {
    board: state.board,
    territory: scored.territory,
    size: state.size,
    currentPlayer: state.currentPlayer,
    pendingRival: state.pendingRival,
    status: state.status,
    moveCount: state.moveCount,
    passStreak: state.passStreak,
    captures: scored.captures,
    stones: scored.stones,
    score: scored.score,
    legalMoves: scored.legalMoves,
    winner: state.winner,
    message: state.message,
    lastMove: state.lastMove,
  };
}

function emitState(
  utils: WorkerUtils<any, any, any, any>,
  state: InternalGameState
): void {
  utils.outbox.send('main', 'state', createPublicState(state));
}

function finishGame(state: InternalGameState, message: string): InternalGameState {
  const scored = scoreBoard(state.board, state.captures);
  return {
    ...state,
    pendingRival: false,
    status: 'finished',
    currentPlayer: 'user',
    winner: determineWinner(scored.score, state.captures),
    message,
  };
}

function maybeFinishGame(state: InternalGameState): InternalGameState {
  const scored = scoreBoard(state.board, state.captures);
  const boardFilled = scored.stones.user + scored.stones.rival === state.size * state.size;

  if (state.passStreak >= 2) {
    return finishGame(state, 'Both players passed. Final territory counted.');
  }

  if (boardFilled) {
    return finishGame(state, 'The board is full. Final territory counted.');
  }

  if (scored.legalMoves.user === 0 && scored.legalMoves.rival === 0) {
    return finishGame(state, 'No legal moves remain. Final territory counted.');
  }

  return state;
}

function scheduleRival(
  utils: WorkerUtils<any, any, any, any>,
  state: InternalGameState
): void {
  const legalMoves = computeLegalMovesList(state.board, 'rival', state.boardHistory);
  utils.outbox.send('territory-rival', 'think', {
    board: cloneBoard(state.board),
    size: state.size,
    turnId: state.turnId,
    legalMoves,
  } as RivalThinkPayload);
}

function countLibertiesOfMove(board: number[][], row: number, col: number): number {
  return collectGroup(board, row, col).liberties;
}

function getPositionBonus(row: number, col: number, size: number): number {
  const q = Math.floor((size - 1) / 4);
  const m = Math.floor((size - 1) / 2);

  const hoshiPositions = [
    [q, q],
    [q, size - 1 - q],
    [size - 1 - q, q],
    [size - 1 - q, size - 1 - q],
    [m, m],
  ];

  let minHoshiDist = Infinity;
  for (const [hr, hc] of hoshiPositions) {
    const d = Math.abs(row - hr) + Math.abs(col - hc);
    if (d < minHoshiDist) minHoshiDist = d;
  }

  const edgeDist = Math.min(row, col, size - 1 - row, size - 1 - col);

  return edgeDist * 3 + Math.max(0, 4 - minHoshiDist) * 5;
}

function getConnectionScore(board: number[][], row: number, col: number, player: PlayerId): number {
  const size = board.length;
  const stone = playerToStone(player);
  let friendly = 0;
  let enemy = 0;

  for (const [nr, nc] of neighbors(size, row, col)) {
    const val = board[nr][nc];
    if (val === stone) friendly++;
    else if (val !== 0) enemy++;
  }

  return friendly * 4 + enemy * 3;
}

function getEnclosureScore(board: number[][], row: number, col: number, player: PlayerId): number {
  const size = board.length;
  const stone = playerToStone(player);
  let score = 0;

  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || r >= size || c < 0 || c >= size) continue;
      if (board[r][c] === stone) score += 2;
    }
  }

  return score;
}

function simulateOpponentResponse(board: number[][], currentPlayer: PlayerId, size: number): number {
  const opponent = otherPlayer(currentPlayer);
  let bestScore = 0;

  const step = size <= 11 ? 1 : 2;
  for (let r = 0; r < size; r += step) {
    for (let c = 0; c < size; c += step) {
      if (board[r][c] !== 0) continue;
      const attempt = tryPlaceStone(board, r, c, opponent);
      if (attempt.ok) {
        const score = attempt.captured * 100 + countLibertiesOfMove(attempt.board, r, c) * 10;
        if (score > bestScore) bestScore = score;
      }
    }
  }

  return bestScore;
}

function evaluateMove(board: number[][], move: MovePayload, size: number, player: PlayerId): number {
  const attempt = tryPlaceStone(board, move.row, move.col, player);
  if (!attempt.ok) {
    return Number.NEGATIVE_INFINITY;
  }

  const nextBoard = attempt.board;

  const captureScore = attempt.captured * 150;
  const safetyScore = countLibertiesOfMove(nextBoard, move.row, move.col) * 20;
  const positionScore = getPositionBonus(move.row, move.col, size) * 30;
  const connectionScore = getConnectionScore(nextBoard, move.row, move.col, player) * 25;
  const enclosureScore = getEnclosureScore(nextBoard, move.row, move.col, player) * 15;

  const opponentThreat = simulateOpponentResponse(nextBoard, player, size);

  return captureScore + safetyScore + positionScore + connectionScore + enclosureScore - opponentThreat * 0.6;
}

function chooseRivalMove(board: number[][], legalMoves: MovePayload[], size: number): MovePayload | null {
  if (!legalMoves || legalMoves.length === 0) {
    return null;
  }

  let bestMove: MovePayload | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const candidate of legalMoves) {
    const score = evaluateMove(board, candidate, size, 'rival');
    if (score > bestScore) {
      bestScore = score;
      bestMove = candidate;
    }
  }

  return bestMove;
}

async function userActorBehavior(
  msg: unknown,
  state: { forwarded: number },
  utils: WorkerUtils<any, any, any, any>
): Promise<{ forwarded: number }> {
  if (typeof msg !== 'object' || msg === null || (msg as ActorBusMessage<any>).kind !== 'actor-bus') {
    return state;
  }

  const message = msg as ActorBusMessage<any>;
  if (message.topic === 'place') {
    utils.outbox.send('territory-game', 'user-place', message.payload as MovePayload);
    return { forwarded: state.forwarded + 1 };
  }

  if (message.topic === 'pass') {
    utils.outbox.send('territory-game', 'user-pass', null);
    return { forwarded: state.forwarded + 1 };
  }

  return state;
}

async function rivalActorBehavior(
  msg: unknown,
  state: { decisions: number },
  utils: WorkerUtils<any, any, any, any>
): Promise<{ decisions: number }> {
  if (typeof msg !== 'object' || msg === null || (msg as ActorBusMessage<any>).kind !== 'actor-bus') {
    return state;
  }

  const message = msg as ActorBusMessage<any>;
  if (message.topic !== 'think') {
    return state;
  }

  const payload = message.payload as RivalThinkPayload;
  const move = chooseRivalMove(payload.board, payload.legalMoves, payload.size);

  utils.outbox.send('territory-game', 'rival-response', {
    turnId: payload.turnId,
    move,
  } as RivalMovePayload);

  return {
    decisions: state.decisions + 1,
  };
}

async function gameActorBehavior(
  msg: unknown,
  state: InternalGameState,
  utils: WorkerUtils<any, any, any, any>
): Promise<InternalGameState> {
  if (typeof msg !== 'object' || msg === null || (msg as ActorBusMessage<any>).kind !== 'actor-bus') {
    return state;
  }

  const message = msg as ActorBusMessage<any>;

  if (message.topic === 'init') {
    const requestedSize = Number((message.payload as { size?: number } | null)?.size ?? 11);
    const size = requestedSize >= 7 && requestedSize <= 19 ? requestedSize : 11;
    const nextState = createInternalState(size);
    emitState(utils, nextState);
    return nextState;
  }

  if (state.status !== 'playing') {
    emitState(utils, state);
    return state;
  }

  if (message.topic === 'user-place') {
    if (state.currentPlayer !== 'user' || state.pendingRival) {
      return state;
    }

    const payload = message.payload as MovePayload;
    const placed = tryPlaceStone(state.board, payload.row, payload.col, 'user', state.boardHistory);
    if (!placed.ok) {
      const nextState = {
        ...state,
        message: placed.reason,
      };
      emitState(utils, nextState);
      return nextState;
    }

    const nextBoardHistory = new Set(state.boardHistory);
    nextBoardHistory.add(boardHash(placed.board));

    let nextState: InternalGameState = {
      ...state,
      board: placed.board,
      boardHistory: nextBoardHistory,
      currentPlayer: 'rival',
      pendingRival: true,
      moveCount: state.moveCount + 1,
      passStreak: 0,
      captures: {
        ...state.captures,
        user: state.captures.user + placed.captured,
      },
      message: placed.captured > 0 ? `You captured ${placed.captured} rival stone${placed.captured === 1 ? '' : 's'}.` : 'Rival is reading the board...',
      lastMove: {
        row: payload.row,
        col: payload.col,
        player: 'user',
      },
      turnId: state.turnId + 1,
    };

    nextState = maybeFinishGame(nextState);
    emitState(utils, nextState);
    if (nextState.status === 'playing') {
      scheduleRival(utils, nextState);
    }
    return nextState;
  }

  if (message.topic === 'user-pass') {
    if (state.currentPlayer !== 'user' || state.pendingRival) {
      return state;
    }

    let nextState: InternalGameState = {
      ...state,
      currentPlayer: 'rival',
      pendingRival: true,
      moveCount: state.moveCount + 1,
      passStreak: state.passStreak + 1,
      message: 'You passed. Rival is deciding whether to invade or pass back.',
      lastMove: null,
      turnId: state.turnId + 1,
    };

    nextState = maybeFinishGame(nextState);
    emitState(utils, nextState);
    if (nextState.status === 'playing') {
      scheduleRival(utils, nextState);
    }
    return nextState;
  }

  if (message.topic === 'rival-response') {
    const payload = message.payload as RivalMovePayload;
    if (!state.pendingRival || state.currentPlayer !== 'rival' || payload.turnId !== state.turnId) {
      return state;
    }

    if (!payload.move) {
      let nextState: InternalGameState = {
        ...state,
        currentPlayer: 'user',
        pendingRival: false,
        moveCount: state.moveCount + 1,
        passStreak: state.passStreak + 1,
        message: 'Rival passed. Your move.',
        lastMove: null,
      };

      nextState = maybeFinishGame(nextState);
      emitState(utils, nextState);
      return nextState;
    }

    const placed = tryPlaceStone(state.board, payload.move.row, payload.move.col, 'rival', state.boardHistory);
    if (!placed.ok) {
      let nextState: InternalGameState = {
        ...state,
        currentPlayer: 'user',
        pendingRival: false,
        moveCount: state.moveCount + 1,
        passStreak: state.passStreak + 1,
        message: 'Rival abandoned the line and passed. Your move.',
        lastMove: null,
      };

      nextState = maybeFinishGame(nextState);
      emitState(utils, nextState);
      return nextState;
    }

    const nextBoardHistory = new Set(state.boardHistory);
    nextBoardHistory.add(boardHash(placed.board));

    let nextState: InternalGameState = {
      ...state,
      board: placed.board,
      boardHistory: nextBoardHistory,
      currentPlayer: 'user',
      pendingRival: false,
      moveCount: state.moveCount + 1,
      passStreak: 0,
      captures: {
        ...state.captures,
        rival: state.captures.rival + placed.captured,
      },
      message: placed.captured > 0 ? `Rival captured ${placed.captured} of your stones.` : 'Your move.',
      lastMove: {
        row: payload.move.row,
        col: payload.move.col,
        player: 'rival',
      },
    };

    nextState = maybeFinishGame(nextState);
    emitState(utils, nextState);
    return nextState;
  }

  return state;
}

const userActor = actor(
  'territory-user',
  userActorBehavior,
  { forwarded: 0 }
);

const rivalActor = actor(
  'territory-rival',
  rivalActorBehavior,
  { decisions: 0 },
  chooseRivalMove,
  evaluateMove,
  simulateOpponentResponse,
  tryPlaceStone,
  collectGroup,
  groupKey,
  cloneBoard,
  neighbors,
  playerToStone,
  otherPlayer,
  inBounds,
  removeGroup,
  countLibertiesOfMove,
  getPositionBonus,
  getConnectionScore,
  getEnclosureScore
);

const gameActor = actor(
  'territory-game',
  gameActorBehavior,
  createInternalState(11),
  createBoard,
  cloneBoard,
  createInternalState,
  playerToStone,
  otherPlayer,
  inBounds,
  neighbors,
  groupKey,
  collectGroup,
  removeGroup,
  boardHash,
  tryPlaceStone,
  countStones,
  computeTerritory,
  countTerritory,
  countLegalMoves,
  computeLegalMovesList,
  scoreBoard,
  determineWinner,
  createPublicState,
  emitState,
  finishGame,
  maybeFinishGame,
  scheduleRival
);

@Injectable({ providedIn: 'root' })
export class TerritoryWarsService {
  private readonly state = atom<TerritoryWarsState>();
  readonly state$ = this.state;

  private readonly unsubscribeInbox: () => void;
  private destroyed = false;

  constructor() {
    this.unsubscribeInbox = main.inbox.subscribe((message: ActorBusMessage<any>) => {
      if (message.from !== 'territory-game' || message.topic !== 'state') {
        return;
      }
      this.state.next(message.payload as TerritoryWarsState);
    });
  }

  start(size: number): void {
    if (this.destroyed) {
      return;
    }
    main.outbox.send(gameActor, 'init', { size });
  }

  place(row: number, col: number): void {
    if (this.destroyed) {
      return;
    }
    main.outbox.send(userActor, 'place', { row, col });
  }

  pass(): void {
    if (this.destroyed) {
      return;
    }
    main.outbox.send(userActor, 'pass', null);
  }

  async destroy(): Promise<void> {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.unsubscribeInbox();
    await Promise.all([
      main.outbox.stop(userActor),
      main.outbox.stop(rivalActor),
      main.outbox.stop(gameActor),
    ]);
  }
}
````

## File: projects/apps/app4/tsconfig.app.json
````json
{
  "extends": "../../../tsconfig.json",
  "compilerOptions": {
    "outDir": "../../out-tsc/app",
    "types": []
  },
  "files": [
    "src/main.ts"
  ],
  "include": [
    "src/**/*.d.ts"
  ]
}
````

## File: projects/apps/app4/tsconfig.spec.json
````json
{
  "extends": "../../../tsconfig.json",
  "compilerOptions": {
    "outDir": "../../out-tsc/spec",
    "types": [
      "jasmine"
    ]
  },
  "include": [
    "src/**/*.spec.ts",
    "src/**/*.d.ts"
  ]
}
````

## File: projects/apps/shared/simple-atom.ts
````typescript
export type Unsubscribe = () => void;

export interface SimpleAtom<T> {
  readonly value: T;
  next(value: T): void;
  subscribe(handler: (value: T) => void): Unsubscribe;
  dispose(): void;
}

export function atom<T>(): SimpleAtom<T | undefined>;
export function atom<T>(initialValue: T): SimpleAtom<T>;
export function atom<T>(initialValue?: T): SimpleAtom<T | undefined> {
  let current = initialValue;
  let hasValue = arguments.length > 0;
  const listeners = new Set<(value: T | undefined) => void>();

  return {
    get value() {
      return current;
    },
    next(value) {
      current = value;
      hasValue = true;
      for (const listener of [...listeners]) {
        listener(current);
      }
    },
    subscribe(handler) {
      listeners.add(handler);
      if (hasValue) {
        handler(current);
      }
      return () => {
        listeners.delete(handler);
      };
    },
    dispose() {
      listeners.clear();
    },
  };
}
````

## File: projects/libraries/swiftly/src/lib/abstractions/index.ts
````typescript
export * from './actor';
export * from './coroutine';
````

## File: projects/libraries/swiftly/src/lib/utils/barrier.ts
````typescript
import { createAbortError } from "./context";

/**
 * Reusable synchronization barrier for phased concurrent work.
 *
 * Each call to `wait()` joins the current generation. Once the configured
 * number of participants has arrived, every waiter is released and the
 * barrier automatically advances to the next generation.
 */
export interface Barrier {
  /** Number of arrivals required to release one barrier generation. */
  readonly participants: number;
  /** Number of participants currently waiting in this generation. */
  readonly waiting: number;

  /**
   * Arrives at the barrier and waits for the remaining participants.
   *
   * Cancelling the supplied signal withdraws this arrival while the barrier is
   * still waiting, so a later participant must take its place.
   */
  wait(signal?: AbortSignal): Promise<void>;
}

type BarrierWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  abort?: () => void;
};

/**
 * Creates a reusable synchronization barrier.
 *
 * @param participants Number of arrivals required to release each generation.
 */
export function barrier(participants: number): Barrier {
  if (!Number.isInteger(participants) || participants <= 0) {
    throw new RangeError("barrier participants must be a positive integer");
  }

  let waiters: BarrierWaiter[] = [];

  const cleanup = (waiter: BarrierWaiter): void => {
    if (waiter.signal && waiter.abort) {
      waiter.signal.removeEventListener("abort", waiter.abort);
    }
  };

  const releaseGeneration = (): void => {
    const completed = waiters;
    waiters = [];

    for (const waiter of completed) {
      cleanup(waiter);
      waiter.resolve();
    }
  };

  const wait = (signal?: AbortSignal): Promise<void> => {
    if (signal?.aborted) {
      return Promise.reject(createAbortError(signal));
    }

    return new Promise<void>((resolve, reject) => {
      const waiter: BarrierWaiter = { resolve, reject, signal };

      if (signal) {
        waiter.abort = () => {
          const index = waiters.indexOf(waiter);
          if (index < 0) {
            return;
          }

          waiters.splice(index, 1);
          cleanup(waiter);
          reject(createAbortError(signal));
        };
        signal.addEventListener("abort", waiter.abort, { once: true });
      }

      waiters.push(waiter);
      if (waiters.length === participants) {
        releaseGeneration();
      }
    });
  };

  return {
    get participants() {
      return participants;
    },
    get waiting() {
      return waiters.length;
    },
    wait,
  };
}
````

## File: projects/libraries/swiftly/src/lib/utils/event.ts
````typescript
import { createAbortError } from "./context";

/**
 * Stateful broadcast signal for coordinating concurrent work.
 *
 * A concurrency event has two states: set and clear. Calling `set()` releases
 * every current waiter and keeps the event set, so future `wait()` calls
 * complete immediately. Calling `clear()` returns it to the blocking state.
 *
 * Unlike a channel, an event does not transfer values or consume readiness.
 * It represents shared readiness that any number of participants may observe.
 */
export interface ConcurrencyEvent {
  /** Whether the event is currently set. */
  readonly isSet: boolean;
  /** Number of callers currently blocked in `wait()`. */
  readonly waiting: number;

  /** Sets the event and releases every current waiter. */
  set(): void;

  /** Clears the event. Future waiters block until the next `set()`. */
  clear(): void;

  /**
   * Waits until the event is set.
   *
   * Resolves immediately when already set. Cancelling one waiter removes only
   * that waiter and does not change the event state or affect other waiters.
   */
  wait(signal?: AbortSignal): Promise<void>;
}

type EventWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  abort?: () => void;
};

/**
 * Creates a reusable manual-reset concurrency event.
 *
 * @param initiallySet Whether the event should begin in the set state.
 */
export function event(initiallySet = false): ConcurrencyEvent {
  if (typeof initiallySet !== "boolean") {
    throw new TypeError("event initial state must be a boolean");
  }

  let isSet = initiallySet;
  const waiters: EventWaiter[] = [];

  const cleanup = (waiter: EventWaiter): void => {
    if (waiter.signal && waiter.abort) {
      waiter.signal.removeEventListener("abort", waiter.abort);
    }
  };

  const set = (): void => {
    if (isSet) {
      return;
    }

    isSet = true;
    const released = waiters.splice(0, waiters.length);
    for (const waiter of released) {
      cleanup(waiter);
      waiter.resolve();
    }
  };

  const clear = (): void => {
    isSet = false;
  };

  const wait = (signal?: AbortSignal): Promise<void> => {
    if (signal?.aborted) {
      return Promise.reject(createAbortError(signal));
    }

    if (isSet) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const waiter: EventWaiter = { resolve, reject, signal };

      if (signal) {
        waiter.abort = () => {
          const index = waiters.indexOf(waiter);
          if (index < 0) {
            return;
          }

          waiters.splice(index, 1);
          cleanup(waiter);
          reject(createAbortError(signal));
        };
        signal.addEventListener("abort", waiter.abort, { once: true });
      }

      waiters.push(waiter);

      // `AbortSignal` can only transition synchronously from user code, but the
      // event itself may be set by re-entrant code while the waiter is being
      // registered. Re-checking here keeps registration state deterministic.
      if (isSet) {
        const index = waiters.indexOf(waiter);
        if (index >= 0) {
          waiters.splice(index, 1);
          cleanup(waiter);
          resolve();
        }
      }
    });
  };

  return {
    get isSet() {
      return isSet;
    },
    get waiting() {
      return waiters.length;
    },
    set,
    clear,
    wait,
  };
}
````

## File: projects/libraries/swiftly/src/lib/utils/semaphore.ts
````typescript
import { createAbortError } from "./context";

/**
 * Releases one semaphore permit.
 *
 * Release functions are idempotent so cleanup code can safely call them more
 * than once without increasing the semaphore capacity.
 */
export type SemaphoreRelease = () => void;

/**
 * Counting semaphore for bounding arbitrary asynchronous concurrency.
 *
 * Unlike a channel, a semaphore does not transfer values. It controls how many
 * callers may enter a concurrent section at once. Waiting acquirers are served
 * in FIFO order.
 */
export interface Semaphore {
  /** Maximum number of permits managed by this semaphore. */
  readonly capacity: number;
  /** Number of permits that can be acquired immediately. */
  readonly available: number;
  /** Number of callers currently waiting for a permit. */
  readonly waiting: number;

  /**
   * Acquires one permit, waiting when all permits are in use.
   *
   * The returned release function must be called when the protected work
   * finishes. A waiting acquisition can be cancelled with an `AbortSignal`.
   */
  acquire(signal?: AbortSignal): Promise<SemaphoreRelease>;

  /**
   * Attempts to acquire one permit without waiting.
   *
   * Returns `undefined` when no permit is immediately available.
   */
  tryAcquire(): SemaphoreRelease | undefined;
}

type Waiter = {
  resolve: (release: SemaphoreRelease) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  abort?: () => void;
};

/**
 * Creates a fair counting semaphore.
 *
 * @param capacity Maximum number of concurrent permit holders.
 * @returns A semaphore with FIFO acquisition order.
 */
export function semaphore(capacity: number): Semaphore {
  if (!Number.isInteger(capacity) || capacity <= 0) {
    throw new RangeError("semaphore capacity must be a positive integer");
  }

  let available = capacity;
  const waiters: Waiter[] = [];

  const removeWaiter = (waiter: Waiter): void => {
    const index = waiters.indexOf(waiter);
    if (index >= 0) {
      waiters.splice(index, 1);
    }
    if (waiter.signal && waiter.abort) {
      waiter.signal.removeEventListener("abort", waiter.abort);
    }
  };

  const createRelease = (): SemaphoreRelease => {
    let released = false;

    return () => {
      if (released) {
        return;
      }
      released = true;

      while (waiters.length > 0) {
        const waiter = waiters.shift()!;
        if (waiter.signal && waiter.abort) {
          waiter.signal.removeEventListener("abort", waiter.abort);
        }
        if (waiter.signal?.aborted) {
          waiter.reject(createAbortError(waiter.signal));
          continue;
        }

        waiter.resolve(createRelease());
        return;
      }

      available += 1;
    };
  };

  const tryAcquire = (): SemaphoreRelease | undefined => {
    if (available <= 0 || waiters.length > 0) {
      return undefined;
    }

    available -= 1;
    return createRelease();
  };

  const acquire = (signal?: AbortSignal): Promise<SemaphoreRelease> => {
    if (signal?.aborted) {
      return Promise.reject(createAbortError(signal));
    }

    const release = tryAcquire();
    if (release) {
      return Promise.resolve(release);
    }

    return new Promise<SemaphoreRelease>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, signal };

      if (signal) {
        waiter.abort = () => {
          removeWaiter(waiter);
          reject(createAbortError(signal));
        };
        signal.addEventListener("abort", waiter.abort, { once: true });
      }

      waiters.push(waiter);
    });
  };

  return {
    get capacity() {
      return capacity;
    },
    get available() {
      return available;
    },
    get waiting() {
      return waiters.length;
    },
    acquire,
    tryAcquire,
  };
}
````

## File: projects/libraries/swiftly/src/lib/utils/timer.ts
````typescript
import { scheduleWorkerTimer } from "../worker/timer";
import { createAbortError } from "./context";

/**
 * Suspends for at least `ms` milliseconds using Swiftly's timer runtime.
 *
 * When Web Workers are available the timeout is scheduled off the caller
 * thread. Otherwise Swiftly falls back to the host timer queue.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(createAbortError(signal));
  }

  return new Promise<void>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      signal?.removeEventListener("abort", abort);
    };

    const timer = scheduleWorkerTimer(
      ms,
      () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      },
      (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    );

    const abort = () => {
      if (settled) return;
      settled = true;
      timer.cancel();
      cleanup();
      reject(createAbortError(signal));
    };

    signal?.addEventListener("abort", abort, { once: true });
  });
}
````

## File: projects/libraries/swiftly/src/lib/utils/wait-group.ts
````typescript
import { createAbortError } from "./context";

/**
 * Dynamic completion counter for concurrent work.
 *
 * A wait group tracks a changing number of outstanding operations. Call
 * `add()` before starting work, `done()` exactly once when each operation
 * finishes, and `wait()` when another operation needs to observe completion.
 *
 * Unlike a barrier, participants do not have to arrive together and the number
 * of outstanding operations may grow while a generation is active.
 */
export interface WaitGroup {
  /** Number of operations that have not called `done()` yet. */
  readonly count: number;
  /** Number of callers currently blocked in `wait()`. */
  readonly waiting: number;

  /**
   * Adds outstanding work to the current generation.
   *
   * @param count Number of operations to add. Defaults to `1`.
   */
  add(count?: number): void;

  /**
   * Marks one outstanding operation as complete.
   *
   * Throws when called with no outstanding work so accounting bugs are not
   * silently hidden.
   */
  done(): void;

  /**
   * Waits until the current outstanding count reaches zero.
   *
   * If the count is already zero, resolves immediately. Cancelling the signal
   * only withdraws this waiter; it does not change the tracked work count.
   */
  wait(signal?: AbortSignal): Promise<void>;
}

type Waiter = {
  resolve: () => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  abort?: () => void;
};

/**
 * Creates a reusable wait group.
 *
 * The wait group naturally supports multiple generations: after the count
 * reaches zero and all current waiters are released, later `add()` calls begin
 * tracking a new set of work.
 */
export function waitGroup(): WaitGroup {
  let count = 0;
  const waiters: Waiter[] = [];

  const cleanup = (waiter: Waiter): void => {
    if (waiter.signal && waiter.abort) {
      waiter.signal.removeEventListener("abort", waiter.abort);
    }
  };

  const releaseWaiters = (): void => {
    const completed = waiters.splice(0, waiters.length);
    for (const waiter of completed) {
      cleanup(waiter);
      waiter.resolve();
    }
  };

  const add = (amount = 1): void => {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new RangeError("wait group add count must be a positive integer");
    }

    count += amount;
  };

  const done = (): void => {
    if (count === 0) {
      throw new Error("wait group done called with no outstanding work");
    }

    count -= 1;
    if (count === 0) {
      releaseWaiters();
    }
  };

  const wait = (signal?: AbortSignal): Promise<void> => {
    if (signal?.aborted) {
      return Promise.reject(createAbortError(signal));
    }

    if (count === 0) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, signal };

      if (signal) {
        waiter.abort = () => {
          const index = waiters.indexOf(waiter);
          if (index < 0) {
            return;
          }

          waiters.splice(index, 1);
          cleanup(waiter);
          reject(createAbortError(signal));
        };
        signal.addEventListener("abort", waiter.abort, { once: true });
      }

      waiters.push(waiter);
    });
  };

  return {
    get count() {
      return count;
    },
    get waiting() {
      return waiters.length;
    },
    add,
    done,
    wait,
  };
}
````

## File: projects/libraries/swiftly/src/lib/worker/blob.ts
````typescript
/**
 * Shared blob-URL cache keyed by the generated worker script body.
 *
 * Multiple abstractions can reuse the same worker blob URL when their
 * generated source is identical.
 */
const blobCache = new Map<string, { blobUrl: string; refCount: number }>();

/**
 * Returns a reusable blob URL for a worker script and increments its refcount.
 */
export function acquireBlobUrl(workerScript: string): string {
  const cached = blobCache.get(workerScript);
  if (cached) {
    cached.refCount++;
    return cached.blobUrl;
  }

  const blob = new Blob([workerScript], { type: "application/javascript" });
  const blobUrl = URL.createObjectURL(blob);
  blobCache.set(workerScript, { blobUrl, refCount: 1 });
  return blobUrl;
}

/**
 * Decrements the blob URL refcount and revokes it once unused.
 */
export function releaseBlobUrl(workerScript: string): void {
  const cached = blobCache.get(workerScript);
  if (!cached) {
    return;
  }

  cached.refCount--;
  if (cached.refCount <= 0) {
    URL.revokeObjectURL(cached.blobUrl);
    blobCache.delete(workerScript);
  }
}
````

## File: projects/libraries/swiftly/src/lib/worker/module.ts
````typescript
/**
 * Creates a Swiftly worker as a native ES module worker.
 *
 * All Swiftly-owned workers use the same construction path so ordinary module
 * features such as dynamic `import()` are available consistently.
 */
export function createModuleWorker(url: string): Worker {
  return new Worker(url, { type: "module" });
}
````

## File: projects/libraries/swiftly/src/lib/worker/scheduler.ts
````typescript
/**
 * Internal queued-work scheduler for execution paths that actually queue work.
 *
 * Priority is preferential, not absolute: after 32 bypasses the oldest waiting
 * item is promoted once. This bounds starvation while preserving strict FIFO
 * among equal priorities and normal priority ordering under ordinary load.
 */
export const MAX_PRIORITY_BYPASSES = 32;

export interface ScheduledItem {
  priority: number;
  sequence: number;
  bypasses: number;
}

/** Removes and returns the next scheduled item from `queue`. */
export function takeNextScheduled<T extends ScheduledItem>(queue: T[]): T | undefined {
  if (queue.length === 0) return undefined;

  let bestIndex = -1;
  let oldestStarvedSequence = Number.POSITIVE_INFINITY;

  for (let index = 0; index < queue.length; index++) {
    const item = queue[index];
    if (
      item.bypasses >= MAX_PRIORITY_BYPASSES &&
      item.sequence < oldestStarvedSequence
    ) {
      bestIndex = index;
      oldestStarvedSequence = item.sequence;
    }
  }

  if (bestIndex < 0) {
    bestIndex = 0;
    for (let index = 1; index < queue.length; index++) {
      const candidate = queue[index];
      const best = queue[bestIndex];
      if (
        candidate.priority > best.priority ||
        (candidate.priority === best.priority && candidate.sequence < best.sequence)
      ) {
        bestIndex = index;
      }
    }
  }

  const [selected] = queue.splice(bestIndex, 1);
  for (const item of queue) {
    item.bypasses += 1;
  }
  return selected;
}
````

## File: projects/libraries/swiftly/src/lib/worker/utils.ts
````typescript
/**
 * Generates a unique task identifier.
 */
export function generateTaskId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
````

## File: projects/libraries/swiftly/src/tests/barrier.spec.ts
````typescript
import {
  barrier,
  ContextCancelledError,
} from "../public-api";

describe("barrier", () => {
  it("should require a positive integer participant count", () => {
    expect(() => barrier(0)).toThrowError(/positive integer/);
    expect(() => barrier(-1)).toThrowError(/positive integer/);
    expect(() => barrier(1.5)).toThrowError(/positive integer/);
  });

  it("should release all waiters when every participant arrives", async () => {
    const sync = barrier(3);
    const order: string[] = [];

    const first = sync.wait().then(() => order.push("first"));
    const second = sync.wait().then(() => order.push("second"));

    await Promise.resolve();
    expect(sync.waiting).toBe(2);
    expect(order).toEqual([]);

    const third = sync.wait().then(() => order.push("third"));
    await Promise.all([first, second, third]);

    expect(sync.waiting).toBe(0);
    expect(order.length).toBe(3);
  });

  it("should automatically start a new generation after release", async () => {
    const sync = barrier(2);

    await Promise.all([sync.wait(), sync.wait()]);
    expect(sync.waiting).toBe(0);

    let released = false;
    const first = sync.wait().then(() => {
      released = true;
    });

    await Promise.resolve();
    expect(released).toBeFalse();
    expect(sync.waiting).toBe(1);

    await Promise.all([first, sync.wait()]);
    expect(released).toBeTrue();
    expect(sync.waiting).toBe(0);
  });

  it("should withdraw a cancelled arrival from the current generation", async () => {
    const sync = barrier(2);
    const controller = new AbortController();
    const cancelled = sync.wait(controller.signal);

    expect(sync.waiting).toBe(1);
    controller.abort(new ContextCancelledError("stopped"));

    await expectAsync(cancelled).toBeRejectedWithError(/stopped/);
    expect(sync.waiting).toBe(0);

    let released = false;
    const first = sync.wait().then(() => {
      released = true;
    });

    await Promise.resolve();
    expect(released).toBeFalse();

    await Promise.all([first, sync.wait()]);
    expect(released).toBeTrue();
  });

  it("should reject immediately for an already-aborted signal", async () => {
    const sync = barrier(2);
    const controller = new AbortController();
    controller.abort(new ContextCancelledError("already stopped"));

    await expectAsync(sync.wait(controller.signal)).toBeRejectedWithError(/already stopped/);
    expect(sync.waiting).toBe(0);
  });

  it("should release immediately when configured for one participant", async () => {
    const sync = barrier(1);

    await sync.wait();
    expect(sync.waiting).toBe(0);
  });
});
````

## File: projects/libraries/swiftly/src/tests/event.spec.ts
````typescript
import { ContextCancelledError, event } from "../public-api";

describe("event", () => {
  it("should block while clear and release all current waiters when set", async () => {
    const ready = event();
    const released: number[] = [];

    const first = ready.wait().then(() => released.push(1));
    const second = ready.wait().then(() => released.push(2));

    expect(ready.isSet).toBe(false);
    expect(ready.waiting).toBe(2);

    ready.set();
    await Promise.all([first, second]);

    expect(released.sort()).toEqual([1, 2]);
    expect(ready.isSet).toBe(true);
    expect(ready.waiting).toBe(0);
  });

  it("should remain set until explicitly cleared", async () => {
    const ready = event();

    ready.set();
    await ready.wait();
    await ready.wait();

    expect(ready.isSet).toBe(true);
    expect(ready.waiting).toBe(0);

    ready.clear();
    expect(ready.isSet).toBe(false);

    let released = false;
    const waiter = ready.wait().then(() => {
      released = true;
    });

    await Promise.resolve();
    expect(released).toBe(false);
    expect(ready.waiting).toBe(1);

    ready.set();
    await waiter;
    expect(released).toBe(true);
  });

  it("should support an initially set state", async () => {
    const ready = event(true);

    expect(ready.isSet).toBe(true);
    await ready.wait();
    expect(ready.waiting).toBe(0);
  });

  it("should make repeated set and clear operations idempotent", async () => {
    const ready = event();

    ready.clear();
    ready.clear();
    expect(ready.isSet).toBe(false);

    ready.set();
    ready.set();
    expect(ready.isSet).toBe(true);
    await ready.wait();

    ready.clear();
    expect(ready.isSet).toBe(false);
  });

  it("should reject a waiter whose signal is already cancelled", async () => {
    const ready = event();
    const controller = new AbortController();
    const reason = new ContextCancelledError("cancelled before waiting");
    controller.abort(reason);

    await expectAsync(ready.wait(controller.signal)).toBeRejectedWith(reason);
    expect(ready.waiting).toBe(0);
  });

  it("should withdraw only the cancelled waiter", async () => {
    const ready = event();
    const controller = new AbortController();
    const reason = new ContextCancelledError("cancel one waiter");

    const cancelled = ready.wait(controller.signal);
    const survivor = ready.wait();

    expect(ready.waiting).toBe(2);
    controller.abort(reason);

    await expectAsync(cancelled).toBeRejectedWith(reason);
    expect(ready.waiting).toBe(1);
    expect(ready.isSet).toBe(false);

    ready.set();
    await survivor;
    expect(ready.waiting).toBe(0);
  });

  it("should not let cancellation after release corrupt event state", async () => {
    const ready = event();
    const controller = new AbortController();

    const waiter = ready.wait(controller.signal);
    ready.set();
    await waiter;

    controller.abort(new Error("too late"));

    expect(ready.isSet).toBe(true);
    expect(ready.waiting).toBe(0);
    await ready.wait();
  });

  it("should be reusable across multiple set/clear generations", async () => {
    const ready = event();

    const first = ready.wait();
    ready.set();
    await first;

    ready.clear();
    const second = ready.wait();
    expect(ready.waiting).toBe(1);

    ready.set();
    await second;

    expect(ready.isSet).toBe(true);
    expect(ready.waiting).toBe(0);
  });

  it("should reject invalid initial state", () => {
    expect(() => event(1 as any)).toThrowError(
      TypeError,
      "event initial state must be a boolean"
    );
  });
});
````

## File: projects/libraries/swiftly/src/tests/semaphore.spec.ts
````typescript
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
````

## File: projects/libraries/swiftly/src/tests/timer.spec.ts
````typescript
import {
  background,
  ContextCancelledError,
  sleep,
  withTimeout,
} from "../public-api";

describe("worker-backed timer", () => {
  it("should resolve sleep after the requested duration", async () => {
    const started = performance.now();

    await sleep(10);

    expect(performance.now() - started).toBeGreaterThanOrEqual(5);
  });

  it("should reject sleep when already cancelled", async () => {
    const controller = new AbortController();
    controller.abort(new ContextCancelledError("stopped"));

    await expectAsync(sleep(1000, controller.signal)).toBeRejectedWithError(/stopped/);
  });

  it("should cancel a pending sleep", async () => {
    const controller = new AbortController();
    const pending = sleep(10000, controller.signal);

    controller.abort(new ContextCancelledError("cancelled"));

    await expectAsync(pending).toBeRejectedWithError(/cancelled/);
  });

  it("should support concurrent sleeps through the shared timer runtime", async () => {
    const order: number[] = [];

    const slow = sleep(20).then(() => order.push(2));
    const fast = sleep(5).then(() => order.push(1));

    await Promise.all([slow, fast]);
    expect(order).toEqual([1, 2]);
  });

  it("should drive context timeouts through the timer runtime", async () => {
    const [ctx, cancel] = withTimeout(background(), 10);

    await ctx.done;

    expect(ctx.signal.aborted).toBeTrue();
    expect(String(ctx.reason)).toContain("timeout");
    cancel();
  });

  it("should reject invalid durations", async () => {
    await expectAsync(sleep(-1)).toBeRejectedWithError(RangeError);
    await expectAsync(sleep(Number.NaN)).toBeRejectedWithError(RangeError);
  });

  it("falls back to host timers when Worker is unavailable", async () => {
    const originalWorker = (globalThis as any).Worker;
    (globalThis as any).Worker = undefined;

    try {
      const started = performance.now();
      await sleep(10);
      expect(performance.now() - started).toBeGreaterThanOrEqual(5);

      const [ctx, cancel] = withTimeout(background(), 10);
      await ctx.done;
      expect(ctx.signal.aborted).toBeTrue();
      cancel();
    } finally {
      (globalThis as any).Worker = originalWorker;
    }
  });
});
````

## File: projects/libraries/swiftly/ng-package.json
````json
{
  "$schema": "../../../node_modules/ng-packagr/ng-package.schema.json",
  "dest": "../../../dist/swiftly",
  "lib": {
    "entryFile": "src/public-api.ts"
  }
}
````

## File: projects/libraries/swiftly/package.json
````json
{
  "name": "@epikodelabs/swiftly",
  "version": "1.0.1",
  "peerDependencies": {
    "@angular/common": "^22.0.0",
    "@angular/core": "^22.0.0"
  },
  "dependencies": {
    "tslib": "^2.3.0"
  },
  "sideEffects": false
}
````

## File: projects/libraries/swiftly/tsconfig.json
````json
{
  "extends": "../../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "."
  },
  "include": [
    "src/**/*.ts"
  ]
}
````

## File: projects/libraries/swiftly/tsconfig.lib.json
````json
/* To learn more about Typescript configuration file: https://www.typescriptlang.org/docs/handbook/tsconfig-json.html. */
/* To learn more about Angular compiler options: https://angular.dev/reference/configs/angular-compiler-options. */
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "../../../dist/swiftly",
    "declaration": true,
    "declarationMap": true,
    "inlineSources": true,
    "types": []
  },
  "files": ["src/public-api.ts"],
  "exclude": ["**/*.spec.ts"]
}
````

## File: projects/libraries/swiftly/tsconfig.lib.prod.json
````json
/* To learn more about Typescript configuration file: https://www.typescriptlang.org/docs/handbook/tsconfig-json.html. */
/* To learn more about Angular compiler options: https://angular.dev/reference/configs/angular-compiler-options. */
{
  "extends": "./tsconfig.lib.json",
  "compilerOptions": {
    "declarationMap": false
  },
  "angularCompilerOptions": {
    "compilationMode": "partial"
  }
}
````

## File: .editorconfig
````
# Editor configuration, see https://editorconfig.org
root = true

[*]
charset = utf-8
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true

[*.ts]
quote_type = single
ij_typescript_use_double_quotes = false

[*.md]
max_line_length = off
trim_trailing_whitespace = false
````

## File: .gitignore
````
# See https://docs.github.com/get-started/getting-started-with-git/ignoring-files for more about ignoring files.

# Compiled output
/dist
/tmp
/out-tsc
/bazel-out

# Node
/node_modules
npm-debug.log
yarn-error.log

# IDEs and editors
.idea/
.project
.classpath
.c9/
*.launch
.settings/
*.sublime-workspace

# Visual Studio Code
.vscode/*
!.vscode/settings.json
!.vscode/tasks.json
!.vscode/launch.json
!.vscode/extensions.json
!.vscode/mcp.json
.history/*

# Miscellaneous
/.angular/cache
.sass-cache/
/connect.lock
/coverage
/libpeerconnection.log
testem.log
/typings
__screenshots__/

# System files
.DS_Store
Thumbs.db
````

## File: .prettierrc
````
{
  "printWidth": 100,
  "singleQuote": true,
  "overrides": [
    {
      "files": "*.html",
      "options": {
        "parser": "angular"
      }
    }
  ]
}
````

## File: projects/apps/app1/README.md
````markdown
# App 1 - Julia Set Explorer

Fractal renderer using `swiftly` coroutine workers.

## What it demonstrates

- **`coroutine`** - offloads Julia set pixel batches to reusable Web Workers
- **`group`** - bounds concurrent row batches explicitly
- **Progressive rendering** - row batches draw to canvas as workers complete
- **Interactive parameters** - presets, c (Re/Im), color palette
- **Reactive UI** - `ChangeDetectorRef.detectChanges()` for smooth progress updates

## Run

```bash
ng serve app1
```

## Controls

- **Presets** - Douady rabbit, Spiral, Dendrite, San Marco, Cauliflower, Circle
- **c = Re + Im** - live sliders that re-render on input
- **Palette** - Electric, Fire, Ocean, Grayscale, Sunset
- **Reset** - restores defaults
````

## File: projects/apps/app2/src/app/image-pipeline.service.ts
````typescript
import { computed, Injectable, signal } from '@angular/core';
import { coroutine, group } from '@epikodelabs/swiftly';
import { zipSync } from 'fflate';
import {
  DEFAULT_SETTINGS,
  FileTask,
  JobProgress,
  processImage,
  ProcessedResult,
  ProcessingSettings,
  ProcessInput,
  ProcessOutput,
} from './image-processing.utils';

export interface ImageJob {
  id: string;
  fileName: string;
  state: 'queued' | 'processing' | 'done' | 'error';
  progress: JobProgress;
  originalSize: number;
  originalUrl: string;
  resultUrl?: string;
  result?: ProcessedResult;
  error?: string;
  settings: ProcessingSettings;
}

@Injectable({ providedIn: 'root' })
export class ImagePipelineService {
  readonly settings = signal<ProcessingSettings>({ ...DEFAULT_SETTINGS });
  readonly jobs = signal<ImageJob[]>([]);
  readonly doneCount = computed(() => this.jobs().filter((job) => job.state === 'done').length);
  readonly totalSaved = computed(() =>
    this.jobs()
      .filter((job) => job.state === 'done')
      .reduce((sum, job) => sum + (job.result?.saved ?? 0), 0),
  );
  readonly isProcessing = computed(() => this.jobs().some((job) => job.state === 'processing'));

  private destroyed = false;
  private readonly processor = coroutine<ProcessInput, ProcessOutput>(processImage);
  private readonly work = group({
    concurrency: Math.max(
      1,
      Math.min(typeof navigator === 'undefined' ? 4 : (navigator.hardwareConcurrency || 4), 4),
    ),
  });

  uploadFile(file: File): void {
    if (this.destroyed) {
      return;
    }

    const id = crypto.randomUUID();
    const url = URL.createObjectURL(file);
    const settings = { ...this.settings() };

    this.jobs.update((list) => [
      ...list,
      {
        id,
        fileName: file.name,
        state: 'queued',
        progress: { stage: 'idle', percent: 0 },
        originalSize: file.size,
        originalUrl: url,
        settings,
      },
    ]);

    void this.work.spawn((signal) =>
      this.processTask({ file, id, settings }, signal)
    ).catch(() => undefined);
  }

  removeJob(id: string): void {
    this.jobs.update((list) => {
      const job = list.find((entry) => entry.id === id);
      if (job?.resultUrl) {
        URL.revokeObjectURL(job.resultUrl);
      }
      if (job?.originalUrl) {
        URL.revokeObjectURL(job.originalUrl);
      }
      return list.filter((entry) => entry.id !== id);
    });
  }

  clearAll(): void {
    for (const job of this.jobs()) {
      if (job.resultUrl) {
        URL.revokeObjectURL(job.resultUrl);
      }
      if (job.originalUrl) {
        URL.revokeObjectURL(job.originalUrl);
      }
    }

    this.jobs.set([]);
  }

  updateSettings(patch: Partial<ProcessingSettings>): void {
    this.settings.update((current) => ({ ...current, ...patch }));
  }

  async downloadAll(): Promise<void> {
    const doneJobs = this.jobs().filter((job) => job.state === 'done' && job.resultUrl);
    if (doneJobs.length === 0) {
      return;
    }

    const files: Record<string, Uint8Array> = {};
    const seen = new Set<string>();

    for (const job of doneJobs) {
      const ext =
        job.result?.format === 'image/png'
          ? 'png'
          : job.result?.format === 'image/webp'
            ? 'webp'
            : 'jpg';
      const base = job.fileName.replace(/\.[^.]+$/, '') || 'image';
      let fileName = `${base}.${ext}`;
      let counter = 1;

      while (seen.has(fileName)) {
        fileName = `${base}-${counter}.${ext}`;
        counter++;
      }

      seen.add(fileName);
      const response = await fetch(job.resultUrl!);
      const buffer = await response.arrayBuffer();
      files[fileName] = new Uint8Array(buffer);
    }

    const zipped = zipSync(files, { level: 0 });
    const blob = new Blob([zipped], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `processed-images-${new Date().toISOString().slice(0, 10)}.zip`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  async destroy(): Promise<void> {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.work.cancel(new Error('Image pipeline destroyed'));
    await this.work.settle();
    await this.processor.dispose();

    this.clearAll();
  }

  private async processTask(task: FileTask, signal: AbortSignal): Promise<void> {
    this.jobs.update((list) =>
      list.map((job) =>
        job.id === task.id
          ? { ...job, state: 'processing' as const, progress: { stage: 'processing', percent: 5 } }
          : job,
      ),
    );

    if (!task.file.type.startsWith('image/')) {
      this.jobs.update((list) =>
        list.map((job) =>
          job.id === task.id
            ? { ...job, state: 'error' as const, error: 'Only image files are supported.' }
            : job,
        ),
      );
      return;
    }

    try {
      const arrayBuffer = await task.file.arrayBuffer();
      this.setJobProgress(task.id, { stage: 'processing', percent: 20 });

      const input: ProcessInput = {
        blob: arrayBuffer,
        width: task.settings.maxWidth,
        height: task.settings.maxHeight,
        quality: task.settings.quality,
        format: task.settings.format,
        grayscale: task.settings.grayscale,
        taskId: task.id,
        originalSize: task.file.size,
        fileName: task.file.name,
      };

      const output = await this.processor.run(input, signal);
      if (this.destroyed || signal.aborted) {
        return;
      }

      this.setJobProgress(task.id, { stage: 'processing', percent: 90 });
      if (!this.jobs().some((job) => job.id === input.taskId)) {
        return;
      }

      const finalBlob = new Blob([output.finalBlob], { type: input.format });
      const url = URL.createObjectURL(finalBlob);
      const result: ProcessedResult = {
        id: input.taskId,
        fileName: input.fileName,
        url,
        originalSize: input.originalSize,
        resizedSize: output.resizedSize,
        finalSize: output.compressedSize,
        saved: input.originalSize - output.compressedSize,
        width: output.width,
        height: output.height,
        format: input.format,
      };

      this.jobs.update((list) =>
        list.map((job) =>
          job.id === input.taskId
            ? {
                ...job,
                state: 'done' as const,
                resultUrl: url,
                result,
                progress: { stage: 'idle', percent: 100 },
              }
            : job,
        ),
      );
    } catch (error) {
      if (this.destroyed || signal.aborted) {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      this.jobs.update((list) =>
        list.map((job) =>
          job.id === task.id
            ? { ...job, state: 'error' as const, error: message }
            : job,
        ),
      );
    }
  }

  private setJobProgress(taskId: string, progress: JobProgress): void {
    this.jobs.update((list) =>
      list.map((job) =>
        job.id === taskId
          ? { ...job, progress, state: 'processing' as const }
          : job,
      ),
    );
  }
}
````

## File: projects/apps/app2/src/app/image-processing.utils.ts
````typescript
import type { WorkerTaskResult, WorkerTaskUtils } from '@epikodelabs/swiftly';

export interface FileTask {
  file: File;
  id: string;
  settings: ProcessingSettings;
}

export interface ProcessingSettings {
  maxWidth: number;
  maxHeight: number;
  quality: number;
  format: 'image/jpeg' | 'image/png' | 'image/webp';
  grayscale: boolean;
}

export const DEFAULT_SETTINGS: ProcessingSettings = {
  maxWidth: 1200,
  maxHeight: 1200,
  quality: 0.85,
  format: 'image/jpeg',
  grayscale: false,
};

export interface ProcessInput {
  blob: ArrayBuffer;
  width: number;
  height: number;
  quality: number;
  format: string;
  grayscale: boolean;
  taskId: string;
  originalSize: number;
  fileName: string;
}

export interface ProcessOutput extends ProcessInput {
  finalBlob: ArrayBuffer;
  resizedSize: number;
  compressedSize: number;
}

export interface JobProgress {
  stage: 'processing' | 'idle';
  percent: number;
  taskId?: string;
}

export interface ProcessedResult {
  id: string;
  fileName: string;
  url: string;
  originalSize: number;
  resizedSize: number;
  finalSize: number;
  saved: number;
  width: number;
  height: number;
  format: string;
}

/**
 * Resizes and encodes an image inside one worker task.
 */
export async function processImage(
  data: ProcessInput,
  utils: WorkerTaskUtils,
): Promise<WorkerTaskResult<ProcessOutput>> {
  const imageBitmap = await createImageBitmap(new Blob([data.blob]));
  const ratio = Math.min(data.width / imageBitmap.width, data.height / imageBitmap.height, 1);
  const width = Math.round(imageBitmap.width * ratio);
  const height = Math.round(imageBitmap.height * ratio);

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D context');

  if (data.grayscale) {
    ctx.filter = 'grayscale(100%)';
  }

  ctx.drawImage(imageBitmap, 0, 0, width, height);
  imageBitmap.close();

  const outputBlob = await canvas.convertToBlob({ type: data.format, quality: data.quality });
  const finalBlob = await outputBlob.arrayBuffer();

  return utils.transfer(
    {
      ...data,
      width,
      height,
      finalBlob,
      resizedSize: outputBlob.size,
      compressedSize: outputBlob.size,
    },
    finalBlob,
  );
}
````

## File: projects/apps/app2/src/app/image-processor.component.ts
````typescript
import { DecimalPipe } from '@angular/common';
import { Component, OnDestroy, signal } from '@angular/core';
import { FileSizePipe } from './file-size.pipe';
import { ImagePipelineService } from './image-pipeline.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [DecimalPipe, FileSizePipe],
  template: `
    <div class="app">
      <header class="header">
        <h1>🖼️ Smart Image Processor</h1>
        <p class="subtitle">Resize and convert images with group-bounded swiftly workers</p>
      </header>

      <section class="toolbar">
        @if (pipeline.jobs().length) {
          <div class="stats">
            <span class="pill">{{ pipeline.jobs().length }} files</span>
            @if (pipeline.doneCount()) {
              <span class="pill done">{{ pipeline.doneCount() }} done</span>
            }
            @if (pipeline.totalSaved() > 0) {
              <span class="pill saved">{{ pipeline.totalSaved() | filesize }} saved</span>
            }
          </div>
        }
        @if (pipeline.doneCount()) {
          <button class="btn btn-primary" (click)="pipeline.downloadAll()">⬇ Download all</button>
        }
        @if (pipeline.jobs().length) {
          <button class="btn btn-ghost" (click)="pipeline.clearAll()">Clear all</button>
        }
      </section>

      <section class="settings">
        <button class="settings-toggle" (click)="showSettings.set(!showSettings())">
          ⚙️ Settings
          <span class="chevron" [class.open]="showSettings()">▼</span>
        </button>
        <div class="settings-body" [class.collapsed]="!showSettings()">
          <div class="field">
            <label>Max width</label>
            <input type="range" min="200" max="3000" step="100"
                   [value]="pipeline.settings().maxWidth"
                   (input)="pipeline.updateSettings({ maxWidth: +$any($event.target).value })" />
            <span class="value">{{ pipeline.settings().maxWidth }} px</span>
          </div>
          <div class="field">
            <label>Max height</label>
            <input type="range" min="200" max="3000" step="100"
                   [value]="pipeline.settings().maxHeight"
                   (input)="pipeline.updateSettings({ maxHeight: +$any($event.target).value })" />
            <span class="value">{{ pipeline.settings().maxHeight }} px</span>
          </div>
          <div class="field">
            <label>Quality</label>
            <input type="range" min="0.1" max="1" step="0.05"
                   [value]="pipeline.settings().quality"
                   (input)="pipeline.updateSettings({ quality: +$any($event.target).value })" />
            <span class="value">{{ (pipeline.settings().quality * 100) | number:'1.0-0' }}%</span>
          </div>
          <div class="field">
            <label>Format</label>
            <select [value]="pipeline.settings().format"
                    (change)="pipeline.updateSettings({ format: $any($event.target).value })">
              <option value="image/jpeg">JPEG</option>
              <option value="image/png">PNG</option>
              <option value="image/webp">WebP</option>
            </select>
          </div>
          <div class="field checkbox">
            <label>
              <input type="checkbox"
                     [checked]="pipeline.settings().grayscale"
                     (change)="pipeline.updateSettings({ grayscale: $any($event.target).checked })" />
              Grayscale
            </label>
          </div>
        </div>
      </section>

      <section
        class="dropzone"
        [class.dragover]="dragOver()"
        (dragover)="onDragOver($event)"
        (dragleave)="onDragLeave($event)"
        (drop)="onDrop($event)"
        (click)="fileInput.click()"
      >
        <input #fileInput type="file" multiple accept="image/*" hidden (change)="onFiles($event)" />
        <div class="dropzone-content">
          <div class="icon">📁</div>
          <p><strong>Drop images here</strong> or click to browse</p>
          <p class="hint">JPG, PNG, WebP · Up to 50 MB each</p>
        </div>
      </section>

      @if (pipeline.jobs().length) {
        <section class="gallery">
          @for (job of pipeline.jobs(); track job.id) {
            <div class="card" [class.done]="job.state === 'done'" [class.error]="job.state === 'error'">
              <button class="card-close" (click)="pipeline.removeJob(job.id); $event.stopPropagation()">×</button>

              <div class="card-preview">
                <img [src]="job.resultUrl ?? job.originalUrl" [class.original]="!job.resultUrl" loading="lazy" />
                @if (job.state === 'processing') {
                  <div class="overlay">
                    <div class="spinner"></div>
                    <span class="stage">{{ job.progress.stage }} {{ job.progress.percent }}%</span>
                  </div>
                }
                @if (job.state === 'error') {
                  <div class="overlay error-overlay">
                    <span>⚠️ {{ job.error }}</span>
                  </div>
                }
              </div>

              <div class="card-info">
                <p class="filename" [title]="job.fileName">{{ job.fileName }}</p>
                @if (job.state === 'done' && job.result) {
                  <div class="metrics">
                    <span class="metric">{{ job.originalSize | filesize }}</span>
                    <span class="arrow">→</span>
                    <span class="metric">{{ job.result.finalSize | filesize }}</span>
                    <span class="badge saved">-{{ job.result.saved | filesize }}</span>
                    <span class="badge">{{ job.result.width }}×{{ job.result.height }}</span>
                  </div>
                }
                @if (job.state !== 'done') {
                  <div class="metrics">
                    <span class="metric">{{ job.originalSize | filesize }}</span>
                    <span class="status">{{ job.state }}</span>
                  </div>
                }
                @if (job.resultUrl) {
                  <a class="btn btn-sm btn-primary" [href]="job.resultUrl" [download]="'processed-' + job.fileName">
                    ⬇ Download
                  </a>
                }
              </div>
            </div>
          }
        </section>
      }

      @if (pipeline.jobs().length) {
        <footer class="footer">
          <p>Powered by <strong>swiftly</strong> · Web Worker image pipeline</p>
        </footer>
      }
    </div>
  `,
  styles: [`
    :host {
      --bg: #0f1117;
      --surface: #181b24;
      --surface-hover: #1e2230;
      --border: #2a2f3f;
      --text: #e2e5ec;
      --text-muted: #8b92a8;
      --accent: #5b8cff;
      --accent-hover: #4a7aee;
      --success: #3ddc84;
      --error: #ff5f5f;
      --radius: 12px;
      display: block;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    .app { max-width: 1200px; margin: 0 auto; padding: 32px 24px; }

    .header { text-align: center; margin-bottom: 28px; }
    .header h1 { font-size: 2rem; font-weight: 700; margin: 0 0 6px; letter-spacing: -0.5px; }
    .subtitle { color: var(--text-muted); font-size: 0.95rem; margin: 0; }

    .toolbar {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 16px; gap: 12px; flex-wrap: wrap;
    }
    .stats { display: flex; gap: 8px; flex-wrap: wrap; }
    .pill {
      background: var(--surface); border: 1px solid var(--border);
      padding: 4px 12px; border-radius: 999px; font-size: 0.8rem; color: var(--text-muted);
    }
    .pill.done { color: var(--success); border-color: rgba(61,220,132,0.3); }
    .pill.saved { color: var(--accent); border-color: rgba(91,140,255,0.3); }

    .btn {
      cursor: pointer; border: none; border-radius: 8px; padding: 8px 16px;
      font-size: 0.85rem; font-weight: 500; transition: background 0.15s, transform 0.05s;
    }
    .btn:active { transform: scale(0.97); }
    .btn-ghost { background: transparent; color: var(--text-muted); border: 1px solid var(--border); }
    .btn-ghost:hover { background: var(--surface-hover); color: var(--text); }
    .btn-sm { padding: 5px 12px; font-size: 0.78rem; }
    .btn-primary { background: var(--accent); color: #fff; text-decoration: none; display: inline-block; }
    .btn-primary:hover { background: var(--accent-hover); }

    .settings { margin-bottom: 20px; }
    .settings-toggle {
      display: flex; align-items: center; gap: 8px; cursor: pointer;
      background: var(--surface); border: 1px solid var(--border);
      padding: 10px 16px; border-radius: var(--radius); width: 100%;
      color: var(--text); font-size: 0.9rem; font-weight: 500;
    }
    .chevron { margin-left: auto; transition: transform 0.2s; font-size: 0.7rem; }
    .chevron.open { transform: rotate(180deg); }
    .settings-body {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 16px; padding: 16px; background: var(--surface);
      border: 1px solid var(--border); border-top: none; border-radius: 0 0 var(--radius) var(--radius);
      transition: max-height 0.25s ease, opacity 0.2s ease, padding 0.2s ease;
      max-height: 400px; opacity: 1; overflow: hidden;
    }
    .settings-body.collapsed {
      max-height: 0; opacity: 0; padding-top: 0; padding-bottom: 0;
    }
    .field { display: flex; flex-direction: column; gap: 6px; }
    .field label { font-size: 0.8rem; color: var(--text-muted); font-weight: 500; }
    .field input[type="range"] { width: 100%; accent-color: var(--accent); }
    .field select {
      background: var(--bg); color: var(--text); border: 1px solid var(--border);
      padding: 6px 10px; border-radius: 6px; font-size: 0.85rem;
    }
    .field .value { font-size: 0.8rem; color: var(--text-muted); text-align: right; }
    .field.checkbox label { flex-direction: row; align-items: center; gap: 8px; cursor: pointer; color: var(--text); }
    .field.checkbox input { accent-color: var(--accent); width: 16px; height: 16px; }

    .dropzone {
      border: 2px dashed var(--border); border-radius: var(--radius);
      background: var(--surface); padding: 48px 24px; text-align: center;
      cursor: pointer; transition: border-color 0.2s, background 0.2s;
    }
    .dropzone:hover, .dropzone.dragover {
      border-color: var(--accent); background: rgba(91,140,255,0.05);
    }
    .dropzone-content .icon { font-size: 2.5rem; margin-bottom: 12px; }
    .dropzone-content p { margin: 4px 0; color: var(--text); }
    .dropzone-content .hint { font-size: 0.8rem; color: var(--text-muted); }

    .gallery {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 20px; margin-top: 28px;
    }
    .card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: var(--radius); overflow: hidden; position: relative;
      transition: transform 0.15s, box-shadow 0.15s;
    }
    .card:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.3); }
    .card-close {
      position: absolute; top: 8px; right: 8px; z-index: 2;
      width: 28px; height: 28px; border-radius: 50%;
      background: rgba(0,0,0,0.5); color: #fff; border: none;
      font-size: 1.1rem; line-height: 1; cursor: pointer; opacity: 0; transition: opacity 0.15s;
    }
    .card:hover .card-close { opacity: 1; }
    .card-close:hover { background: var(--error); }

    .card-preview { position: relative; height: 180px; background: #111; display: flex; align-items: center; justify-content: center; }
    .card-preview img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .card-preview img.original { opacity: 0.6; }
    .overlay {
      position: absolute; inset: 0; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 10px;
      background: rgba(0,0,0,0.6); color: #fff;
    }
    .spinner {
      width: 32px; height: 32px; border: 3px solid rgba(255,255,255,0.2);
      border-top-color: var(--accent); border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .stage { font-size: 0.8rem; text-transform: capitalize; }
    .error-overlay { background: rgba(200,50,50,0.25); color: var(--error); font-size: 0.8rem; padding: 12px; text-align: center; }

    .card-info { padding: 14px; }
    .filename { margin: 0 0 8px; font-size: 0.85rem; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .metrics { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
    .metric { font-size: 0.78rem; color: var(--text-muted); }
    .arrow { color: var(--text-muted); font-size: 0.7rem; }
    .badge { font-size: 0.7rem; background: var(--bg); padding: 2px 8px; border-radius: 4px; color: var(--text-muted); }
    .badge.saved { color: var(--success); background: rgba(61,220,132,0.1); }
    .status { font-size: 0.75rem; color: var(--accent); text-transform: capitalize; }

    .footer { text-align: center; margin-top: 32px; padding-top: 20px; border-top: 1px solid var(--border); }
    .footer p { color: var(--text-muted); font-size: 0.8rem; margin: 0; }
    .footer strong { color: var(--accent); }
  `],
})
export class ImageProcessorComponent implements OnDestroy {
  showSettings = signal(false);
  dragOver = signal(false);

  constructor(public pipeline: ImagePipelineService) {}

  onFiles(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files) {
      Array.from(input.files).forEach(f => this.pipeline.uploadFile(f));
      input.value = '';
    }
  }

  onDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    this.dragOver.set(true);
  }

  onDragLeave(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    this.dragOver.set(false);
  }

  onDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    this.dragOver.set(false);
    if (e.dataTransfer?.files) {
      Array.from(e.dataTransfer.files).forEach(f => this.pipeline.uploadFile(f));
    }
  }

  ngOnDestroy() {
    void this.pipeline.destroy();
  }
}
````

## File: projects/apps/app2/README.md
````markdown
# App 2 - Image Processor

Reactive image pipeline with `swiftly` workers and group-bounded concurrency.

## What it demonstrates

- **Reactive image pipeline** - drag-and-drop to process to download
- **`group`** - bounds how many image jobs run at once
- **`coroutine`** - performs resize and encode in one worker task
- **Custom pipes** - `fileSize` formatting
- **Signal-based service state** - `ImagePipelineService` exposes jobs and settings

## Run

```bash
ng serve app2
```
````

## File: projects/apps/app3/src/app/kitchen.service.ts
````typescript
/**
 * Kitchen Simulation Service — Actor-based Pizza Bakery Demo
 *
 * Architecture:
 *   • Cashier actor  : receives orders, forwards to chef via actor bus
 *   • Chef actor     : receives orders from cashier, requests recipes and
 *                      oven bakes from main thread, emits lifecycle events
 *   • Oven coroutines: worker-backed baking operations
 *
 * Communication flow:
 *   UI → Cashier : main.outbox.send(cashier, 'runShift' | 'cancel' | 'close', payload)
 *   Cashier → Chef : utils.outbox.send('chef', 'cook' | 'cancel', ...)
 *   Chef → Main    : utils.outbox.request('main', 'recipe', item) fetches recipe
 *                    utils.outbox.request('main', 'bake', { order, recipe }) dispatches to oven
 *                    utils.outbox.send('main', topic, event) pushes live events
 */
import { Injectable } from '@angular/core';
import { ActorBusMessage, actor, coroutine, main, registerActorRequestHandler, sleep, WorkerUtils } from '@epikodelabs/swiftly';
import { atom } from '../../../shared/simple-atom';

export type Order = { id: string; item: string; customer: string };

export type Recipe = {
  item: string;
  ingredients: string[];
  bakeMs: number;
};

export type KitchenMessage =
  | { type: 'runShift'; orders: Order[] }
  | { type: 'cancel'; orderId: string }
  | { type: 'close'; cancelQueued?: boolean };

export type KitchenEvent =
  | { type: 'started'; order: Order; oven: string }
  | { type: 'stage'; order: Order; stage: string; oven: string }
  | { type: 'ready'; order: Order; oven: string; price: number }
  | { type: 'cancelled'; order: Order; reason: string; oven: string }
  | { type: 'timeout'; order: Order; oven: string }
  | { type: 'closed'; completed: number; cancelled: number; totalRevenue: number };

export type OvenState = {
  id: string;
  order: Order | null;
  stage: string | null;
};

export type KitchenStats = {
  completed: number;
  cancelled: number;
  revenue: number;
  active: number;
};

const recipes = new Map<string, Recipe>([
  ['Margherita', { item: 'Margherita', ingredients: ['tomato', 'mozzarella', 'basil'], bakeMs: 3000 }],
  ['Pepperoni', { item: 'Pepperoni', ingredients: ['tomato', 'mozzarella', 'pepperoni'], bakeMs: 3500 }],
  ['Hawaiian', { item: 'Hawaiian', ingredients: ['tomato', 'mozzarella', 'ham', 'pineapple'], bakeMs: 3200 }],
  ['Quattro Formaggi', { item: 'Quattro Formaggi', ingredients: ['mozzarella', 'gorgonzola', 'parmesan', 'ricotta'], bakeMs: 2800 }],
  ['Diavola', { item: 'Diavola', ingredients: ['tomato', 'mozzarella', 'spicy salami', 'chili'], bakeMs: 3800 }],
]);

const prices = new Map<string, number>([
  ['Margherita', 12.99],
  ['Pepperoni', 14.99],
  ['Hawaiian', 13.99],
  ['Quattro Formaggi', 15.99],
  ['Diavola', 16.99],
]);

// ===== OVEN COROUTINES =====
async function ovenBakeTask(task: { order: Order; recipe: Recipe }) {
  await new Promise(r => setTimeout(r, task.recipe.bakeMs));
  return task;
}

const ovens = [
  { id: 'Oven #1', worker: coroutine(ovenBakeTask), busy: false },
  { id: 'Oven #2', worker: coroutine(ovenBakeTask), busy: false },
  { id: 'Oven #3', worker: coroutine(ovenBakeTask), busy: false },
];

type OvenSlot = (typeof ovens)[number];
type OvenReservation = { ovenId: string };
type BakeRequest = { ovenId: string; order: Order; recipe: Recipe };
type BakeResult = { ovenId: string; price: number };

const reservedOvens = new Map<string, OvenSlot>();
const ovenWaitQueue: Array<(oven: OvenSlot) => void> = [];

function emitKitchenEvent(
  utils: WorkerUtils<any, any, any, KitchenEvent>,
  event: KitchenEvent
) {
  utils.outbox.send('main', event.type, event);
}

function releaseOvenSlot(oven: OvenSlot) {
  const next = ovenWaitQueue.shift();
  if (next) {
    next(oven);
    return;
  }

  oven.busy = false;
}

async function reserveOven(): Promise<OvenReservation> {
  const idleOven = ovens.find((oven) => !oven.busy);
  const oven = idleOven
    ? idleOven
    : await new Promise<OvenSlot>((resolve) => {
        ovenWaitQueue.push(resolve);
      });

  oven.busy = true;
  reservedOvens.set(oven.id, oven);
  return { ovenId: oven.id };
}

function releaseReservedOven(ovenId: string) {
  const oven = reservedOvens.get(ovenId);
  if (!oven) {
    return false;
  }

  reservedOvens.delete(ovenId);
  releaseOvenSlot(oven);
  return true;
}

async function bakeOnReservedOven(request: BakeRequest): Promise<BakeResult> {
  const oven = reservedOvens.get(request.ovenId);
  if (!oven) {
    throw new Error(`Oven "${request.ovenId}" is not reserved`);
  }

  try {
    await oven.worker.run({ order: request.order, recipe: request.recipe });
    return { ovenId: oven.id, price: prices.get(request.order.item) ?? 10 };
  } finally {
    reservedOvens.delete(oven.id);
    releaseOvenSlot(oven);
  }
}

// ===== CHEF ACTOR =====
interface ChefState {
  activeTasks: number;
  completedCount: number;
  cancelledCount: number;
  totalRevenue: number;
  closing: boolean;
  cancelQueued: boolean;
  closedSent: boolean;
  cancelledIds: Set<string>;
}

function checkClosed(state: ChefState, utils: WorkerUtils<any, any, any, KitchenEvent>) {
  if (state.closing && state.activeTasks === 0 && !state.closedSent) {
    state.closedSent = true;
    emitKitchenEvent(utils, {
      type: 'closed',
      completed: state.completedCount,
      cancelled: state.cancelledCount,
      totalRevenue: state.totalRevenue,
    } as KitchenEvent);
  }
}

async function chefBehavior(
  msg: any,
  state: ChefState,
  utils: WorkerUtils<any, any, any, KitchenEvent>
) {
  // Handle bus messages from cashier
  if (msg.kind === 'actor-bus') {
    if (msg.topic === 'cook') {
      const order = msg.payload as Order;
      state.activeTasks++;

      // Fire-and-forget cooking task
      (async () => {
        let reservedOvenId: string | null = null;
        const cancelOrder = async (reason: string, oven = 'N/A') => {
          if (reservedOvenId) {
            await utils.outbox.request('main', 'release-oven', { ovenId: reservedOvenId });
            reservedOvenId = null;
          }

          state.activeTasks--;
          state.cancelledCount++;
          emitKitchenEvent(utils, {
            type: 'cancelled',
            order,
            reason,
            oven,
          } as KitchenEvent);
          checkClosed(state, utils);
        };

        try {
          if (state.cancelledIds.has(order.id)) {
            await cancelOrder('Cancelled before start');
            return;
          }

          if (state.cancelQueued) {
            await cancelOrder('Cancelled because the kitchen is closing');
            return;
          }

          const recipe = await utils.outbox.request('main', 'recipe', order.item) as Recipe | undefined;
          if (!recipe) throw new Error(`No recipe for ${order.item}`);

          if (state.cancelledIds.has(order.id)) {
            await cancelOrder('Cancelled before oven assignment');
            return;
          }

          if (state.cancelQueued) {
            await cancelOrder('Cancelled because the kitchen is closing');
            return;
          }

          const reservation = await utils.outbox.request('main', 'reserve-oven', { order }) as OvenReservation;
          reservedOvenId = reservation.ovenId;

          if (state.cancelledIds.has(order.id)) {
            await cancelOrder('Cancelled while waiting for an oven', reservedOvenId);
            return;
          }

          if (state.cancelQueued) {
            await cancelOrder('Cancelled because the kitchen is closing', reservedOvenId);
            return;
          }

          emitKitchenEvent(utils, {
            type: 'started',
            order,
            oven: reservedOvenId,
          } as KitchenEvent);
          emitKitchenEvent(utils, {
            type: 'stage',
            order,
            stage: 'Baking...',
            oven: reservedOvenId,
          } as KitchenEvent);

          const bakeResult = await utils.outbox.request('main', 'bake', {
            ovenId: reservedOvenId,
            order,
            recipe,
          }) as BakeResult;
          reservedOvenId = null;
          state.activeTasks--;
          state.completedCount++;
          state.totalRevenue += bakeResult.price;
          emitKitchenEvent(utils, {
            type: 'ready',
            order,
            oven: bakeResult.ovenId,
            price: bakeResult.price,
          } as KitchenEvent);
          checkClosed(state, utils);
        } catch (err: any) {
          await cancelOrder(err?.message ?? String(err), reservedOvenId ?? 'N/A');
        }
      })();
    }

    if (msg.topic === 'cancel') {
      state.cancelledIds.add(msg.payload as string);
    }

    if (msg.topic === 'close') {
      state.closing = true;
      state.cancelQueued = Boolean(msg.payload?.cancelQueued);
      state.closedSent = false;
      checkClosed(state, utils);
    }

    return state;
  }

  return state;
}

const chef = actor('chef', chefBehavior, {
  activeTasks: 0,
  completedCount: 0,
  cancelledCount: 0,
  totalRevenue: 0,
  closing: false,
  cancelQueued: false,
  closedSent: false,
  cancelledIds: new Set<string>(),
}, emitKitchenEvent, checkClosed);

const unregisterKitchenRequests = registerActorRequestHandler('main', async (topic: string, payload: unknown) => {
  if (topic === 'recipe' && typeof payload === 'string') {
    return recipes.get(payload);
  }
  if (topic === 'reserve-oven') {
    return reserveOven();
  }
  if (topic === 'release-oven') {
    const request = payload as { ovenId: string };
    return { released: releaseReservedOven(request.ovenId) };
  }
  const bakeTask = payload as BakeRequest;
  if (topic === 'bake') {
    return bakeOnReservedOven(bakeTask);
  }
  throw new Error(`Unknown request payload: ${JSON.stringify(payload)}`);
});

// ===== CASHIER ACTOR =====
const cashier = actor('cashier', async function cashier(
  msg: any,
  state: { closing: boolean },
  utils: WorkerUtils<any, any, any, any>
) {
  if (msg.kind === 'actor-bus' && msg.topic === 'runShift') {
    const payload = msg.payload as { orders: Order[] };
    for (const order of payload.orders) {
      utils.outbox.send('chef', 'cook', order);
    }
    utils.outbox.send('chef', 'close', { cancelQueued: false });
  }

  if (msg.kind === 'actor-bus' && msg.topic === 'cancel') {
    utils.outbox.send('chef', 'cancel', msg.payload as string);
  }

  if (msg.kind === 'actor-bus' && msg.topic === 'close') {
    utils.outbox.send('chef', 'close', { cancelQueued: (msg.payload as any)?.cancelQueued ?? true });
  }

  return state;
}, { closing: false });

@Injectable({ providedIn: 'root' })
export class KitchenService {
  private events = atom<KitchenEvent>();
  events$ = this.events;

  private ovens = atom<OvenState[]>([
    { id: 'Oven #1', order: null, stage: null },
    { id: 'Oven #2', order: null, stage: null },
    { id: 'Oven #3', order: null, stage: null },
  ]);
  ovens$ = this.ovens;

  private cancellableOrders = atom<Order[]>([]);
  cancellableOrders$ = this.cancellableOrders;

  private stats = atom<KitchenStats>({
    completed: 0,
    cancelled: 0,
    revenue: 0,
    active: 0,
  });
  stats$ = this.stats;

  private log = atom<string>();
  log$ = this.log;

  private running = false;
  private fullDayClosing = false;
  private inFullDay = false;
  private onMessageUnsubscribe: (() => void) | null = null;
  private destroyed = false;

  constructor() {
    this.onMessageUnsubscribe = main.inbox.subscribe((message: ActorBusMessage<any>) => {
      if (message.from !== 'chef') {
        return;
      }

      const event = message.payload as KitchenEvent;
      this.events.next(event);
      this.handleEvent(event);
    });
  }

  private handleEvent(event: KitchenEvent) {
    const ovens = [...this.ovens.value];
    const stats = this.stats.value;
    const time = new Date().toLocaleTimeString();

    const oven = 'oven' in event
      ? ovens.find(entry => entry.id === event.oven)
      : undefined;

    switch (event.type) {
      case 'started':
        if (oven) {
          oven.order = event.order;
          oven.stage = 'Preparing...';
        }
        this.log.next(
          `[${time}] 🍳 Started: ${event.order.item} for ${event.order.customer} (${event.oven})`
        );
        this.stats.next({ ...stats, active: stats.active + 1 });
        break;

      case 'stage':
        if (oven) oven.stage = event.stage;
        this.log.next(
          `[${time}] 📍 ${event.stage} - ${event.order.item} (${event.oven})`
        );
        break;

      case 'ready':
        if (oven) {
          oven.order = null;
          oven.stage = null;
        }
        this.removeCancellableOrder(event.order.id);
        this.log.next(
          `[${time}] ✅ READY! ${event.order.item} for ${event.order.customer} (${event.oven})`
        );
        this.stats.next({
          ...stats,
          completed: stats.completed + 1,
          revenue: stats.revenue + event.price,
          active: Math.max(0, stats.active - 1),
        });
        break;

      case 'cancelled':
        if (oven) {
          oven.order = null;
          oven.stage = null;
        }
        this.removeCancellableOrder(event.order.id);
        this.log.next(
          `[${time}] ❌ CANCELLED: ${event.order.item} for ${event.order.customer} - ${event.reason} (${event.oven})`
        );
        this.stats.next({
          ...stats,
          cancelled: stats.cancelled + 1,
          active: oven ? Math.max(0, stats.active - 1) : stats.active,
        });
        break;

      case 'timeout':
        if (oven) {
          oven.order = null;
          oven.stage = null;
        }
        this.removeCancellableOrder(event.order.id);
        this.log.next(
          `[${time}] ⏰ TIMEOUT: ${event.order.item} got burnt! (${event.oven})`
        );
        this.stats.next({
          ...stats,
          cancelled: stats.cancelled + 1,
          active: Math.max(0, stats.active - 1),
        });
        break;

      case 'closed':
        this.cancellableOrders.next([]);
        this.log.next(
          `[${time}] 🏁 Shift closed! Completed: ${event.completed}, Cancelled: ${event.cancelled}, Revenue: $${event.totalRevenue.toFixed(2)}`
        );
        this.stats.next({ ...this.stats.value, active: 0 });
        if (!this.inFullDay) {
          this.running = false;
        }
        break;
    }

    this.ovens.next(ovens);
  }

  async runShift(
    orders: Order[],
    options: { accumulate?: boolean; internal?: boolean } = {}
  ): Promise<{ completed: number; cancelled: number; revenue: number } | undefined> {
    if (!options.internal && this.running) return;

    if (!options.internal) {
      this.running = true;
    }

    if (options.accumulate) {
      this.resetOvens();
    } else {
      this.resetState();
    }

    this.cancellableOrders.next([...orders]);

    this.log.next(`--- Starting shift with ${orders.length} orders ---`);

    return new Promise((resolve) => {
      let resolved = false;

      const unsub = main.inbox.subscribe((message: ActorBusMessage<any>) => {
        if (message.from !== 'chef') {
          return;
        }

        const event = message.payload as KitchenEvent;
        if (event.type === 'closed' && !resolved) {
          resolved = true;
          unsub();
          if (!options.internal) {
            this.running = false;
          }
          resolve({
            completed: event.completed,
            cancelled: event.cancelled,
            revenue: event.totalRevenue,
          });
        }
      });

      main.outbox.send(cashier, 'runShift', { orders });
    });
  }

  async runFullDay(): Promise<void> {
    if (this.running) return;

    const shifts = [
      {
        name: '🌅 Morning Shift',
        orders: [
          { id: 'M1', item: 'Margherita', customer: 'John' },
          { id: 'M2', item: 'Pepperoni', customer: 'Sarah' },
          { id: 'M3', item: 'Hawaiian', customer: 'Mike' },
        ],
      },
      {
        name: '🌞 Lunch Rush',
        orders: [
          { id: 'L1', item: 'Quattro Formaggi', customer: 'Emma' },
          { id: 'L2', item: 'Diavola', customer: 'Luca' },
          { id: 'L3', item: 'Margherita', customer: 'Sophia' },
          { id: 'L4', item: 'Pepperoni', customer: 'Oliver' },
        ],
      },
      {
        name: '🌤️ Afternoon',
        orders: [
          { id: 'A1', item: 'Hawaiian', customer: 'Isabella' },
          { id: 'A2', item: 'Diavola', customer: 'Ethan' },
        ],
      },
      {
        name: '🌙 Evening Rush',
        orders: [
          { id: 'E1', item: 'Diavola', customer: 'Marco' },
          { id: 'E2', item: 'Quattro Formaggi', customer: 'Giulia' },
          { id: 'E3', item: 'Pepperoni', customer: 'Antonio' },
          { id: 'E4', item: 'Margherita', customer: 'Francesca' },
          { id: 'E5', item: 'Hawaiian', customer: 'Roberto' },
        ],
      },
    ];

    this.fullDayClosing = false;
    this.inFullDay = true;
    this.running = true;
    this.resetState();

    this.log.next('\n=== Full Day Started ===');

    for (const shift of shifts) {
      if (this.fullDayClosing) break;

      this.log.next(`\n=== ${shift.name} ===`);

      await this.runShift(shift.orders, { accumulate: true, internal: true });

      if (this.fullDayClosing) break;

      await sleep(1000);
    }

    this.cancellableOrders.next([]);

    this.log.next('\n=== Full Day Complete ===');

    this.inFullDay = false;
    this.running = false;

    const stats = this.stats.value;

    this.log.next(
      `📊 FULL DAY SUMMARY: ✅ ${stats.completed} completed, ❌ ${stats.cancelled} cancelled, 💰 $${stats.revenue.toFixed(2)}`
    );
  }

  cancelOrder(orderId: string) {
    if (!this.running) return;

    main.outbox.send(cashier, 'cancel', orderId);
    this.log.next(`🚫 Cancellation requested for order ${orderId}`);
  }

  closeKitchen() {
    if (!this.running) return;

    this.fullDayClosing = true;
    main.outbox.send(cashier, 'close', undefined);
    this.log.next('🚨 Kitchen closing requested — active ovens finish, queued orders are cancelled');
  }

  resetOvens() {
    this.ovens.next([
      { id: 'Oven #1', order: null, stage: null },
      { id: 'Oven #2', order: null, stage: null },
      { id: 'Oven #3', order: null, stage: null },
    ]);
  }

  resetState() {
    this.resetOvens();
    this.cancellableOrders.next([]);
    this.stats.next({
      completed: 0,
      cancelled: 0,
      revenue: 0,
      active: 0,
    });
  }

  private removeCancellableOrder(orderId: string) {
    this.cancellableOrders.next(
      this.cancellableOrders.value.filter(order => order.id !== orderId)
    );
  }

  async destroy() {
    if (this.destroyed) return;

    this.destroyed = true;
    this.onMessageUnsubscribe?.();
    this.onMessageUnsubscribe = null;
    unregisterKitchenRequests();

    await Promise.all([
      main.outbox.stop(cashier),
      main.outbox.stop(chef),
      ...ovens.map(o => o.worker.dispose()),
    ]);
  }

  isRunning() {
    return this.running;
  }

  isDestroyed() {
    return this.destroyed;
  }
}
````

## File: projects/apps/app3/README.md
````markdown
# App 3 - Kitchen

Real-time kitchen simulation with actors and state streams.

## What it demonstrates

- **Actor-based state** - `KitchenService` driving reactive state updates
- **`scan`** + **`tap`** - live stats aggregation
- **Shift scheduling** - Morning, Lunch, Afternoon, Evening, Full Day runs

## Run

```bash
ng serve app3
```
````

## File: projects/apps/app4/README.md
````markdown
# App 4 - Territory Wars

Board game powered by `swiftly` actors and an Angular UI.

## What it demonstrates

- **Actors** - user actor, game actor, rival actor communicating via message bus
- **Web Workers** - rival AI runs in a worker thread
- **Angular board UI** - standalone component rendering the grid directly
- **Reactive state** - `state$` stream drives UI updates without Angular templates for the board

## Run

```bash
ng serve app4
```
````

## File: projects/libraries/swiftly/src/lib/abstractions/bus.ts
````typescript
import type { Actor } from "../worker/types";

export type ActorBusTarget = string | string[];
export type ActorBusSender = string;

export type ActorBusMessage<T = any> = {
  kind: "actor-bus";
  topic: string;
  payload: T;
  from?: ActorBusSender;
  to?: ActorBusTarget;
};

export type ActorBusDispatchOptions = {
  from?: ActorBusSender;
  includeSelf?: boolean;
};

export type ActorBusHandler<T = any> = (
  message: ActorBusMessage<T>
) => void | Promise<void>;

export interface ActorBus {
  publish: <T = any>(
    topic: string,
    payload: T,
    options?: ActorBusDispatchOptions
  ) => void;
  send: <T = any>(
    to: ActorBusTarget,
    topic: string,
    payload: T,
    options?: Pick<ActorBusDispatchOptions, "from">
  ) => void;
  dispatch: <T = any>(
    message: ActorBusMessage<T>,
    options?: Pick<ActorBusDispatchOptions, "includeSelf">
  ) => void;
  listen: {
    <T = any>(handler: ActorBusHandler<T>): () => void;
    <T = any>(name: string, handler: ActorBusHandler<T>): () => void;
  };
  clear: () => void;
}

export type ActorMessageContext = {
  from?: string;
  to?: ActorBusTarget;
  topic?: string;
};

export type ActorRequestHandler<Q = any, D = any> = (
  topic: string,
  request: Q,
  message: ActorMessageContext
) => Promise<D> | D;

export type ActorInternals = {
  stop(): Promise<void>;
  post(msg: any): void;
  request(topic: string, msg: any, signal?: AbortSignal): Promise<any>;
};

type ActorBusRegistration = {
  actor: Actor;
  name: string;
};

const actorRequestHandlers = new Map<string, ActorRequestHandler<any, any>>();
const actorBusRegistrationsById = new Map<string, ActorBusRegistration>();
const actorBusRegistrationsByActor = new Map<Actor, ActorBusRegistration>();
const actorBusDirectListeners = new Map<string, Set<ActorBusHandler>>();
const actorBusListeners = new Set<ActorBusHandler>();
const actorInternalsMap = new WeakMap<Actor, ActorInternals>();

export function registerActorRequestHandler<Q = any, D = any>(
  name: string,
  handler: ActorRequestHandler<Q, D>
): () => void {
  actorRequestHandlers.set(name, handler);
  return () => actorRequestHandlers.delete(name);
}

export function unregisterActorRequestHandler(name: string): void {
  actorRequestHandlers.delete(name);
}

export const getActorRequestHandler = (
  name: string,
): ActorRequestHandler<any, any> | undefined => actorRequestHandlers.get(name);

export function createActorBusMessage<T = any>(
  topic: string,
  payload: T,
  options?: { from?: string; to?: ActorBusTarget }
): ActorBusMessage<T> {
  return {
    kind: "actor-bus",
    topic,
    payload,
    from: options?.from,
    to: options?.to,
  };
}

export function isActorBusMessage<T = any>(
  value: unknown
): value is ActorBusMessage<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as ActorBusMessage<T>).kind === "actor-bus" &&
    typeof (value as ActorBusMessage<T>).topic === "string"
  );
}

export const normalizeActorBusTargets = (to?: ActorBusTarget): string[] =>
  !to ? [] : Array.isArray(to) ? [...to] : [to];

export const resolveActorTarget = (
  actorOrName: Actor | string,
): Actor | undefined =>
  typeof actorOrName === "string"
    ? actorBusRegistrationsById.get(actorOrName)?.actor
    : actorOrName;

export const resolveActorBusTarget = (
  to: Actor | string | string[],
): string | string[] =>
  Array.isArray(to) ? to : typeof to === "string" ? to : to.name;

export const setActorInternals = (
  actor: Actor,
  internals: ActorInternals,
): void => {
  actorInternalsMap.set(actor, internals);
};

export const getActorInternals = (actor: Actor): ActorInternals => {
  const internals = actorInternalsMap.get(actor);
  if (!internals) {
    throw new Error(`Actor "${actor.name}" is unavailable`);
  }
  return internals;
};

export const tryActorInternals = (
  actor: Actor,
): ActorInternals | undefined => actorInternalsMap.get(actor);

export const warnAsyncActorBusFailure = (scope: string, error: unknown) => {
  console.warn(`${scope} failed:`, error);
};

const deliverActorBusMessage = (
  actor: Actor,
  message: ActorBusMessage,
): void => {
  try {
    tryActorInternals(actor)?.post(message);
  } catch (error) {
    warnAsyncActorBusFailure("Actor bus delivery", error);
  }
};

const notifyActorBusSubscribers = (message: ActorBusMessage): void => {
  const directHandlers = message.to
    ? normalizeActorBusTargets(message.to)
        .flatMap((name) => [...(actorBusDirectListeners.get(name) ?? [])])
    : [];
  const handlers = [...actorBusListeners, ...directHandlers];

  for (const handler of handlers) {
    Promise.resolve(handler(message)).catch((error) => {
      warnAsyncActorBusFailure("Actor bus subscriber", error);
    });
  }
};

export function unregisterActorBusTarget(idOrActor: string | Actor): void {
  const registration =
    typeof idOrActor === "string"
      ? actorBusRegistrationsById.get(idOrActor)
      : actorBusRegistrationsByActor.get(idOrActor);

  if (!registration) return;

  actorBusRegistrationsById.delete(registration.name);
  actorBusRegistrationsByActor.delete(registration.actor);
}

export function registerActorBusTarget(
  name: string,
  actor: Actor,
): () => void {
  const existingRegistration = actorBusRegistrationsById.get(name);
  if (existingRegistration && existingRegistration.actor !== actor) {
    throw new Error(`Actor name "${name}" is already registered`);
  }

  unregisterActorBusTarget(actor);

  const registration = { actor, name };
  actorBusRegistrationsById.set(name, registration);
  actorBusRegistrationsByActor.set(actor, registration);

  return () => unregisterActorBusTarget(actor);
}

export function clearActorBusListeners(): void {
  actorBusDirectListeners.clear();
  actorBusListeners.clear();
  actorRequestHandlers.clear();
}

export function dispatchActorBusMessage<T = any>(
  message: ActorBusMessage<T>,
  options?: { fromActor?: Actor; includeSelf?: boolean },
): void {
  const from =
    message.from ??
    (options?.fromActor
      ? actorBusRegistrationsByActor.get(options.fromActor)?.name ??
        options.fromActor.name
      : undefined);

  const routedMessage =
    from && message.from !== from ? { ...message, from } : message;

  notifyActorBusSubscribers(routedMessage);

  const targets = normalizeActorBusTargets(routedMessage.to);
  if (targets.length > 0) {
    const seen = new Set<string>();
    for (const target of targets) {
      if (seen.has(target)) continue;
      seen.add(target);
      const registration = actorBusRegistrationsById.get(target);
      if (registration) {
        deliverActorBusMessage(registration.actor, routedMessage);
      }
    }
    return;
  }

  for (const registration of actorBusRegistrationsById.values()) {
    if (
      routedMessage.from &&
      !options?.includeSelf &&
      registration.name === routedMessage.from
    ) {
      continue;
    }
    deliverActorBusMessage(registration.actor, routedMessage);
  }
}

export const subscribeActorBus = (
  handler: ActorBusHandler,
): (() => void) => {
  actorBusListeners.add(handler);
  return () => actorBusListeners.delete(handler);
};
````

## File: projects/libraries/swiftly/src/lib/worker/concurrency.ts
````typescript
/**
 * Worker-side concurrency runtime injected into actor worker scripts.
 *
 * This remains self-contained by design: each actor definition produces one
 * module-worker blob shared by its worker generation, while the runtime source
 * itself is authored and reviewed separately from actor lifecycle code.
 */
export const ACTOR_CONCURRENCY_RUNTIME = `
class __channelClosedError extends Error {
  constructor(message = "channel is closed") {
    super(message);
    this.name = "ChannelClosedError";
  }
}

class __contextCancelledError extends Error {
  constructor(message = "context cancelled") {
    super(message);
    this.name = "ContextCancelledError";
  }
}

const __createAbortError = (signal) => {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  return new __contextCancelledError(reason ? String(reason) : undefined);
};

const __channelInternals = Symbol("swiftly.channelInternals");

const __channel = (capacity = 0) => {
  if (!Number.isInteger(capacity) || capacity < 0) {
    throw new RangeError("channel capacity must be a non-negative integer");
  }

  const buffer = [];
  const receivers = [];
  const senders = [];
  let isClosed = false;

  const cleanupReceiver = (receiver) => {
    if (receiver.signal && receiver.abort) {
      receiver.signal.removeEventListener("abort", receiver.abort);
    }
  };

  const cleanupSender = (sender) => {
    if (sender.signal && sender.abort) {
      sender.signal.removeEventListener("abort", sender.abort);
    }
  };

  const removeReceiver = (receiver) => {
    const index = receivers.indexOf(receiver);
    if (index >= 0) receivers.splice(index, 1);
    cleanupReceiver(receiver);
  };

  const removeSender = (sender) => {
    const index = senders.indexOf(sender);
    if (index >= 0) senders.splice(index, 1);
    cleanupSender(sender);
  };

  const settleSelectedReceive = (receiver, value, ok) =>
    receiver.select.registration.settle({
      index: receiver.select.meta.index,
      caseRef: receiver.select.meta.caseRef,
      op: "receive",
      name: receiver.select.meta.name,
      value,
      ok,
    });

  const settleSelectedSend = (sender) =>
    sender.select.registration.settle({
      index: sender.select.meta.index,
      caseRef: sender.select.meta.caseRef,
      op: "send",
      name: sender.select.meta.name,
      ok: true,
    });

  const rejectSelectedWaiter = (waiter, error) =>
    waiter.select.registration.reject(error);

  const tryDispatchToWaitingReceiver = (value, senderSelectId) => {
    for (let index = 0; index < receivers.length; index++) {
      const receiver = receivers[index];
      const receiverSelectId = receiver.select?.registration.id;

      if (receiver.select?.registration.isSettled()) {
        receivers.splice(index, 1);
        cleanupReceiver(receiver);
        index -= 1;
        continue;
      }

      if (senderSelectId && receiverSelectId === senderSelectId) {
        continue;
      }

      receivers.splice(index, 1);
      cleanupReceiver(receiver);

      if (receiver.select) {
        if (!settleSelectedReceive(receiver, value, true)) {
          index -= 1;
          continue;
        }
      } else {
        receiver.resolve({ ok: true, value });
      }

      return true;
    }

    return false;
  };

  const tryAcquireFromWaitingSender = (receiverSelectId) => {
    for (let index = 0; index < senders.length; index++) {
      const sender = senders[index];
      const senderSelectId = sender.select?.registration.id;

      if (sender.select?.registration.isSettled()) {
        senders.splice(index, 1);
        cleanupSender(sender);
        index -= 1;
        continue;
      }

      if (receiverSelectId && senderSelectId === receiverSelectId) {
        continue;
      }

      senders.splice(index, 1);
      cleanupSender(sender);

      if (sender.select) {
        if (!settleSelectedSend(sender)) {
          index -= 1;
          continue;
        }
      } else {
        sender.resolve();
      }

      return { ok: true, value: sender.value };
    }

    if (isClosed) {
      return { ok: false, value: undefined };
    }

    return undefined;
  };

  const tryBufferWaitingSender = () => {
    for (let index = 0; index < senders.length; index++) {
      const sender = senders[index];

      if (sender.select?.registration.isSettled()) {
        senders.splice(index, 1);
        cleanupSender(sender);
        index -= 1;
        continue;
      }

      senders.splice(index, 1);
      cleanupSender(sender);

      if (sender.select) {
        if (!settleSelectedSend(sender)) {
          index -= 1;
          continue;
        }
      } else {
        sender.resolve();
      }

      buffer.push(sender.value);
      return true;
    }

    return false;
  };

  const tryPairWaitingSenderToReceiver = () => {
    for (let index = 0; index < senders.length; index++) {
      const sender = senders[index];
      const senderSelectId = sender.select?.registration.id;

      if (sender.select?.registration.isSettled()) {
        senders.splice(index, 1);
        cleanupSender(sender);
        index -= 1;
        continue;
      }

      if (!tryDispatchToWaitingReceiver(sender.value, senderSelectId)) {
        continue;
      }

      senders.splice(index, 1);
      cleanupSender(sender);

      if (sender.select) {
        if (!settleSelectedSend(sender)) {
          index -= 1;
          continue;
        }
      } else {
        sender.resolve();
      }

      return true;
    }

    return false;
  };

  const flushSenders = () => {
    while (senders.length > 0) {
      if (receivers.length > 0) {
        if (!tryPairWaitingSenderToReceiver()) {
          break;
        }
        continue;
      }

      if (capacity > 0 && buffer.length < capacity) {
        if (!tryBufferWaitingSender()) {
          break;
        }
        continue;
      }

      break;
    }
  };

  const sendValue = (value, signal) => {
    if (isClosed) return Promise.reject(new __channelClosedError());
    if (signal?.aborted) return Promise.reject(__createAbortError(signal));

    if (tryDispatchToWaitingReceiver(value)) {
      return Promise.resolve();
    }

    if (capacity > 0 && buffer.length < capacity) {
      buffer.push(value);
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const sender = { value, resolve, reject, signal };
      if (signal) {
        sender.abort = () => {
          removeSender(sender);
          reject(__createAbortError(signal));
        };
        signal.addEventListener("abort", sender.abort, { once: true });
      }
      senders.push(sender);
    });
  };

  const receiveValue = (signal) => {
    if (buffer.length > 0) {
      const value = buffer.shift();
      flushSenders();
      return Promise.resolve({ ok: true, value });
    }

    const matchedSender = tryAcquireFromWaitingSender();
    if (matchedSender) {
      return Promise.resolve(matchedSender);
    }

    if (isClosed) {
      return Promise.resolve({ ok: false, value: undefined });
    }

    if (signal?.aborted) return Promise.reject(__createAbortError(signal));

    return new Promise((resolve, reject) => {
      const receiver = { resolve, reject, signal };
      if (signal) {
        receiver.abort = () => {
          removeReceiver(receiver);
          reject(__createAbortError(signal));
        };
        signal.addEventListener("abort", receiver.abort, { once: true });
      }
      receivers.push(receiver);
    });
  };

  return {
    get capacity() {
      return capacity;
    },
    get size() {
      return buffer.length;
    },
    get closed() {
      return isClosed;
    },
    send: sendValue,
    async receive(signal) {
      return receiveValue(signal);
    },
    trySend(value) {
      if (isClosed) return false;
      if (tryDispatchToWaitingReceiver(value)) {
        return true;
      }
      if (capacity > 0 && buffer.length < capacity) {
        buffer.push(value);
        return true;
      }
      return false;
    },
    tryReceive() {
      if (buffer.length > 0) {
        const value = buffer.shift();
        flushSenders();
        return { ok: true, value };
      }
      const matchedSender = tryAcquireFromWaitingSender();
      if (matchedSender) {
        return matchedSender;
      }
      if (isClosed) return { ok: false, value: undefined };
      return undefined;
    },
    close() {
      if (isClosed) return;
      isClosed = true;

      while (receivers.length > 0) {
        const receiver = receivers.shift();
        cleanupReceiver(receiver);
        if (receiver.select) {
          settleSelectedReceive(receiver, undefined, false);
        } else {
          receiver.resolve({ ok: false, value: undefined });
        }
      }

      while (senders.length > 0) {
        const sender = senders.shift();
        cleanupSender(sender);
        const error = new __channelClosedError();
        if (sender.select) {
          rejectSelectedWaiter(sender, error);
        } else {
          sender.reject(error);
        }
      }
    },
    [__channelInternals]: {
      registerSelectReceive(registration, meta) {
        if (registration.isSettled()) {
          return () => {};
        }

        if (isClosed) {
          registration.settle({
            index: meta.index,
            caseRef: meta.caseRef,
            op: "receive",
            name: meta.name,
            ok: false,
          });
          return () => {};
        }

        const receiver = {
          resolve() {},
          reject() {},
          select: { registration, meta },
        };
        receivers.push(receiver);
        flushSenders();
        return () => removeReceiver(receiver);
      },
      registerSelectSend(value, registration, meta) {
        if (registration.isSettled()) {
          return () => {};
        }

        if (isClosed) {
          registration.reject(new __channelClosedError());
          return () => {};
        }

        const sender = {
          value,
          resolve() {},
          reject() {},
          select: { registration, meta },
        };
        senders.push(sender);
        flushSenders();
        return () => removeSender(sender);
      },
    },
    async *[Symbol.asyncIterator]() {
      while (true) {
        const item = await receiveValue();
        if (!item.ok) return;
        yield item.value;
      }
    },
  };
};

const __createContext = (controller) => {
  const signal = controller.signal;
  const done = new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
    } else {
      signal.addEventListener("abort", () => resolve(), { once: true });
    }
  });

  return {
    signal,
    done,
    get reason() {
      return signal.reason;
    },
  };
};

const __backgroundContext =
  __createContext(new AbortController());
const __background = () => __backgroundContext;

const __withCancel = (parent = __background()) => {
  const controller = new AbortController();
  const onParentAbort = () =>
    controller.abort(parent.reason ?? new __contextCancelledError());

  if (parent.signal.aborted) {
    onParentAbort();
  } else {
    parent.signal.addEventListener("abort", onParentAbort, { once: true });
  }

  const ctx = __createContext(controller);
  const cancel = (reason = new __contextCancelledError()) => {
    parent.signal.removeEventListener("abort", onParentAbort);
    if (!controller.signal.aborted) controller.abort(reason);
  };

  return [ctx, cancel];
};

const __withTimeout = (parent, ms) => {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new RangeError("timer duration must be a finite non-negative number");
  }

  const [ctx, cancel] = __withCancel(parent);
  const timer = setTimeout(() => cancel(new __contextCancelledError("context timeout after " + ms + "ms")), ms);
  ctx.done.finally(() => clearTimeout(timer));
  return [ctx, cancel];
};

const __withDeadline = (parent, deadline) => {
  const time = typeof deadline === "number" ? deadline : deadline.getTime();
  const remaining = time - Date.now();

  if (remaining <= 0) {
    const [ctx, cancel] = __withCancel(parent);
    cancel(new __contextCancelledError("context deadline exceeded"));
    return [ctx, cancel];
  }

  return __withTimeout(parent, remaining);
};

const __sleep = (ms, signal) => {
  if (!Number.isFinite(ms) || ms < 0) {
    return Promise.reject(new RangeError("timer duration must be a finite non-negative number"));
  }
  if (signal?.aborted) {
    return Promise.reject(__createAbortError(signal));
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const abort = () => {
      clearTimeout(timer);
      cleanup();
      reject(__createAbortError(signal));
    };

    const cleanup = () => signal?.removeEventListener("abort", abort);
    signal?.addEventListener("abort", abort, { once: true });
  });
};

const __recv = (ch, name) => ({ op: "receive", channel: ch, name });
const __send = (ch, value, name) => ({ op: "send", channel: ch, value, name });
const __otherwise = (name = "default") => ({ op: "default", name });
const __operation = (run, name) => ({ op: "operation", run, name });

const __shuffledIndices = (length) => {
  const indices = Array.from({ length }, (_, i) => i);
  for (let i = length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices;
};

const __select = async (cases, ctx = __background()) => {
  if (ctx.signal.aborted) throw __createAbortError(ctx.signal);
  if (cases.length === 0) {
    throw new RangeError("select requires at least one case");
  }

  const defaultIndices = cases
    .map((item, index) => item.op === "default" ? index : -1)
    .filter((index) => index >= 0);
  if (defaultIndices.length > 1) {
    throw new RangeError("select accepts at most one default case");
  }
  const defaultIndex = defaultIndices[0] ?? -1;
  const channelIndices = cases
    .map((item, i) => ({ item, i }))
    .filter(({ item }) => item.op === "receive" || item.op === "send")
    .map(({ i }) => i);
  const randomChannelOrder = __shuffledIndices(channelIndices.length).map((j) => channelIndices[j]);

  for (const index of randomChannelOrder) {
    const item = cases[index];
    if (item.op === "receive") {
      const result = item.channel.tryReceive();
      if (result) {
        return { index, case: item, op: item.op, name: item.name, value: result.value, ok: result.ok };
      }
    } else if (item.op === "send") {
      if (item.channel.closed) {
        throw new __channelClosedError();
      }
      if (item.channel.trySend(item.value)) {
        return { index, case: item, op: item.op, name: item.name, ok: true };
      }
    }
  }

  if (defaultIndex >= 0) {
    const item = cases[defaultIndex];
    return { index: defaultIndex, case: item, op: item.op, name: item.name, ok: true };
  }

  const contenders = cases
    .map((item, i) => ({ item, i }))
    .filter(({ item }) => item.op !== "default");
  const randomOrder = __shuffledIndices(contenders.length).map((j) => contenders[j].i);
  const selectId = Symbol("swiftly.select");
  let settled = false;
  let winnerIndex = -1;
  const cleanupFns = [];
  const operationControllers = new Map();

  const abortLosingOperations = (reason) => {
    for (const [index, controller] of operationControllers) {
      if (index !== winnerIndex && !controller.signal.aborted) {
        controller.abort(reason);
      }
    }
  };

  try {
    return await new Promise((resolve, reject) => {
      const settle = (result) => {
        if (settled) return false;
        settled = true;
        winnerIndex = result.index;
        abortLosingOperations(new __contextCancelledError("select case lost"));
        resolve(result);
        return true;
      };

      const rejectSelection = (error, index = -1) => {
        if (settled) return false;
        settled = true;
        winnerIndex = index;
        abortLosingOperations(error);
        reject(error);
        return true;
      };

      const registration = {
        id: selectId,
        isSettled: () => settled,
        settle: (outcome) => settle({
          index: outcome.index,
          case: outcome.caseRef,
          op: outcome.op,
          name: outcome.name,
          value: outcome.value,
          ok: outcome.ok,
        }),
        reject: (error) => rejectSelection(error),
      };

      const onContextAbort = () => {
        rejectSelection(__createAbortError(ctx.signal));
      };

      ctx.signal.addEventListener("abort", onContextAbort, { once: true });
      cleanupFns.push(() => ctx.signal.removeEventListener("abort", onContextAbort));

      const operationStarts = [];

      for (const index of randomOrder) {
        if (settled) break;

        const item = cases[index];
        if (item.op === "operation") {
          const controller = new AbortController();
          operationControllers.set(index, controller);
          operationStarts.push({ index, item, controller });
          continue;
        }

        const internals = item.channel[__channelInternals];
        if (!internals) {
          rejectSelection(new __contextCancelledError("channel does not support select"));
          break;
        }

        const meta = { index, caseRef: item, name: item.name };
        const unregister =
          item.op === "receive"
            ? internals.registerSelectReceive(registration, meta)
            : internals.registerSelectSend(item.value, registration, meta);

        cleanupFns.push(unregister);
      }

      if (settled) return;

      const startedOperations = operationStarts.map(({ index, item, controller }) => {
        try {
          return {
            index,
            item,
            promise: Promise.resolve(item.run(controller.signal)),
          };
        } catch (error) {
          return {
            index,
            item,
            promise: Promise.reject(error),
          };
        }
      });

      for (const { index, item, promise } of startedOperations) {
        promise.then(
          (value) => {
            settle({
              index,
              case: item,
              op: item.op,
              name: item.name,
              value,
              ok: true,
            });
          },
          (error) => {
            rejectSelection(
              error instanceof Error ? error : new Error(error ? String(error) : "select operation failed"),
              index
            );
          }
        );
      }
    });
  } finally {
    while (cleanupFns.length > 0) {
      cleanupFns.pop()();
    }
    abortLosingOperations(new __contextCancelledError("select completed"));
  }
};

const __concurrency = Object.freeze({
  channel: __channel,
  receive: __recv,
  send: __send,
  otherwise: __otherwise,
  operation: __operation,
  select: __select,
  background: __background,
  withCancel: __withCancel,
  withTimeout: __withTimeout,
  withDeadline: __withDeadline,
  sleep: __sleep,
  ChannelClosedError: __channelClosedError,
  ContextCancelledError: __contextCancelledError,
});

`;
````

## File: projects/libraries/swiftly/src/lib/worker/messages.ts
````typescript
/**
 * Internal message envelope exchanged between the main thread and worker instances.
 *
 * This is coroutine/actor runtime plumbing, not public actor API surface.
 */
export type WorkerProtocolMessageType =
  | "task"
  | "response"
  | "error"
  | "request"
  | "notify"
  | "init"
  | "stop"
  | "stopped"
  | "overflow";

/**
 * `taskId` tracks the outer task lifecycle.
 * `requestId` is reserved for nested actor request/response exchanges.
 */
export type WorkerProtocolMessage = {
  workerId: number;
  taskId: string;
  type: WorkerProtocolMessageType;
  payload?: any;
  error?: string;
  requestId?: string;
  /** Direct actor or main-thread request/message target. */
  to?: string | string[];
  /** Topic tag for targeted actor requests/messages. */
  topic?: string;
  /** Internal actor mailbox capacity supplied during init. */
  mailboxCapacity?: number;
};

/**
 * Pending task resolvers keyed by worker task id.
 */
export type PendingTaskMap = Map<
  string,
  { workerId: number; resolve: (value: any) => void; reject: (error: Error) => void }
>;

/**
 * Custom main-thread message handler for worker responses.
 */
export type WorkerProtocolHandler = (
  event: MessageEvent<WorkerProtocolMessage>,
  worker: Worker,
  pendingTasks: PendingTaskMap
) => void;

/**
 * Optional hooks for the default main-thread worker message handler.
 */
export type DefaultMessageHandlerOptions = {
  /** Called when the worker sends a request message. */
  onRequest?: (message: WorkerProtocolMessage) => void | Promise<void>;
  /** Called when the worker sends a one-way message. */
  onWorkerMessage?: (message: WorkerProtocolMessage) => void | Promise<void>;
};

/**
 * Creates the default main-thread worker message handler.
 */
export function createDefaultMessageHandler(
  _worker: Worker,
  pendingTasks: PendingTaskMap,
  options?: DefaultMessageHandlerOptions
) {
  return (event: MessageEvent<WorkerProtocolMessage>) => {
    const msg = event.data;
    const { taskId, payload, error, type } = msg;
    const pending = pendingTasks.get(taskId);

    switch (type) {
      case "response":
        if (pending) {
          pendingTasks.delete(taskId);
          pending.resolve(payload);
        }
        break;
      case "error": {
        const errorMessage = error?.trim?.() ? error : "Unknown worker error";
        if (pending) {
          pendingTasks.delete(taskId);
          pending.reject(new Error(errorMessage));
        }
        break;
      }
      case "request":
        if (options?.onRequest) {
          Promise.resolve(options.onRequest(msg)).catch((hookError) => {
            console.warn("Worker request hook failed:", hookError);
          });
        } else {
          console.warn("Unhandled worker request:", msg);
        }
        break;
      case "notify":
        if (options?.onWorkerMessage) {
          Promise.resolve(options.onWorkerMessage(msg)).catch((hookError) => {
            console.warn("Worker message hook failed:", hookError);
          });
        } else {
          console.warn("Unhandled worker message:", msg);
        }
        break;
      default:
        console.warn("Unknown message type from worker:", msg);
        break;
    }
  };
}
````

## File: projects/libraries/swiftly/src/tests/env.spec.ts
````typescript
// Environment detection
const isNode =
  typeof process !== "undefined" &&
  process.versions != null &&
  process.versions.node != null;

const isBrowser =
  typeof window !== "undefined" &&
  typeof window.document !== "undefined";

// Suite-level wrappers (describe only accepts sync functions)
/**
 * Function ndescribe.
 */
export function ndescribe(name: string, fn: () => void) {
  return isNode ? describe(name, fn) : xdescribe(name, fn);
}

/**
 * Function idescribe.
 */
export function idescribe(name: string, fn: () => void) {
  return isBrowser ? describe(name, fn) : xdescribe(name, fn);
}

// Spec-level wrappers (it allows async callbacks with DoneFn)
/**
 * Function nit.
 */
export function nit(name: string, fn: jasmine.ImplementationCallback) {
  return isNode ? it(name, fn) : xit(name, fn);
}

/**
 * Function iit.
 */
export function iit(name: string, fn: jasmine.ImplementationCallback) {
  return isBrowser ? it(name, fn) : xit(name, fn);
}

// Export environment flags too
export { isBrowser, isNode };
````

## File: projects/libraries/swiftly/src/tests/script.spec.ts
````typescript
import { buildCoroutineWorkerRuntime } from "../lib/worker/runtimes";
import { buildWorkerScript } from "../lib/worker/script";

describe("worker module scripts", () => {
  it("preserves ordinary absolute dynamic imports inside coroutine tasks", () => {
    const task = new Function(
      "value",
      'return import("https://cdn.example.invalid/normalize.js").then(module => module.normalize(value));',
    );

    const script = buildWorkerScript({
      main: task,
      functions: [],
      runtime: buildCoroutineWorkerRuntime(),
    });

    expect(script).toContain(
      'import("https://cdn.example.invalid/normalize.js")',
    );
  });

  it("does not rewrite import expressions through a Swiftly-specific loader", () => {
    const task = new Function(
      'return import("https://cdn.example.invalid/math.js").then(module => module.default);',
    );

    const script = buildWorkerScript({
      main: task,
      functions: [],
      runtime: buildCoroutineWorkerRuntime(),
    });

    expect(script).not.toContain("importWorkerModule");
    expect(script).not.toContain("__import");
  });

  it("binds named arrow-function helpers into worker scope", () => {
    const helper = (value: number) => value + 1;

    const script = buildWorkerScript({
      main: function main(value: number) {
        return helper(value);
      },
      functions: [helper],
      runtime: buildCoroutineWorkerRuntime(),
    });

    expect(script).toContain("const helper =");
  });

  it("normalizes method shorthand helpers into function declarations", () => {
    const helper = {
      transform(value: number) {
        return value + 1;
      },
    }.transform;

    const script = buildWorkerScript({
      main: function main(value: number) {
        return helper(value);
      },
      functions: [helper],
      runtime: buildCoroutineWorkerRuntime(),
    });

    expect(script).toContain("function transform(");
  });
});
````

## File: projects/libraries/swiftly/src/public-api.ts
````typescript
/**
 * Public API Surface of coroutines
 */

export * from "./lib";
````

## File: projects/libraries/swiftly/tsconfig.spec.json
````json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "../../../out-tsc/swiftly-spec",
    "types": [
      "jasmine"
    ]
  },
  "include": [
    "src/**/*.d.ts",
    "src/tests/**/*.spec.ts"
  ]
}
````

## File: testify.json
````json
{
  "srcDirs": [
    "./projects/libraries/swiftly/src/lib"
  ],
  "testDirs": [
    "./projects/libraries/swiftly/src/tests"
  ],
  "exclude": [
    "**/node_modules/**"
  ],
  "preserveOutputs": false,
  "outDir": "dist/.vite-jasmine-build",
  "browser": "chrome",
  "headless": false,
  "coverage": false,
  "port": 8888,
  "viteBuildOptions": {
    "target": "es2022",
    "sourcemap": true,
    "minify": false,
    "preserveModules": false,
    "preserveModulesRoot": "."
  },
  "jasmineConfig": {
    "env": {
      "stopSpecOnExpectationFailure": false,
      "random": true,
      "seed": 0,
      "timeout": 120000
    }
  },
  "htmlOptions": {
    "title": "Jasmine Test Runner",
    "preludeModules": []
  },
  "suppressConsoleLogs": false
}
````

## File: projects/apps/app1/src/app/app.component.ts
````typescript
import { DecimalPipe } from '@angular/common';
import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { coroutine, group } from '@epikodelabs/swiftly';

interface JuliaPreset {
  name: string;
  cr: number;
  ci: number;
  zoom: number;
}

const PRESETS: JuliaPreset[] = [
  { name: 'Douady rabbit', cr: -0.123, ci: 0.745, zoom: 220 },
  { name: 'Spiral', cr: -0.8, ci: 0.156, zoom: 200 },
  { name: 'Dendrite', cr: 0, ci: 1, zoom: 160 },
  { name: 'San Marco', cr: -0.75, ci: 0, zoom: 190 },
  { name: 'Cauliflower', cr: -0.391, ci: -0.587, zoom: 200 },
  { name: 'Circle', cr: -0.7, ci: 0.27015, zoom: 180 },
];

const PALETTES = ['Electric', 'Fire', 'Ocean', 'Grayscale', 'Sunset'] as const;
type Palette = typeof PALETTES[number];

type BatchParams = {
  width: number;
  height: number;
  startY: number;
  endY: number;
  cr: number;
  ci: number;
  zoom: number;
  maxIterations: number;
  palette: string;
};

type Pixel = { i: number; r: number; g: number; b: number };

const juliaBatchWorker = (params: BatchParams): Pixel[] => {
  const { width, height, startY, endY, cr, ci, zoom, maxIterations, palette } = params;
  const cx = width / 2;
  const cy = height / 2;

  const julia = (zx: number, zy: number): number => {
    let x = zx, y = zy;
    for (let i = 0; i < maxIterations; i++) {
      const x2 = x * x, y2 = y * y;
      if (x2 + y2 > 4) return i;
      const tmp = x2 - y2 + cr;
      y = 2 * x * y + ci;
      x = tmp;
    }
    return maxIterations;
  };

  const getColor = (iter: number): [number, number, number] => {
    if (iter === maxIterations) return [0, 0, 0];
    const t = iter / maxIterations;
    switch (palette) {
      case 'Fire':
        return [Math.round(t * 255), Math.round(t * t * 128), 0];
      case 'Ocean':
        return [0, Math.round(t * 160), Math.round(t * t * 255)];
      case 'Grayscale': {
        const v = Math.round(t * 255);
        return [v, v, v];
      }
      case 'Sunset':
        return [Math.round(t * 255), Math.round((1 - t) * 100), Math.round((1 - t * 0.5) * 200)];
      case 'Electric':
      default: {
        const hue = (t * 360) % 360;
        const sat = 0.9;
        const val = 1.0;
        const c = val * sat;
        const hx = c * (1 - Math.abs((hue / 60) % 2 - 1));
        const m = val - c;
        let r = 0, g = 0, b = 0;
        if (hue < 60) { r = c; g = hx; b = 0; }
        else if (hue < 120) { r = hx; g = c; b = 0; }
        else if (hue < 180) { r = 0; g = c; b = hx; }
        else if (hue < 240) { r = 0; g = hx; b = c; }
        else if (hue < 300) { r = hx; g = 0; b = c; }
        else { r = c; g = 0; b = hx; }
        return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
      }
    }
  };

  const pixels: Pixel[] = [];
  for (let y = startY; y < endY; y++) {
    for (let x = 0; x < width; x++) {
      const x0 = (x - cx) / zoom;
      const y0 = (y - cy) / zoom;
      const iter = julia(x0, y0);
      const [r, g, b] = getColor(iter);
      pixels.push({ i: y * width + x, r, g, b });
    }
  }
  return pixels;
};

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [DecimalPipe, FormsModule],
  template: `
    <div class="app">
      <header class="header">
        <h1>🔥 Julia Set Explorer</h1>
        <p class="subtitle">Reactive fractal rendering with swiftly workers</p>
      </header>

      <main class="grid">
        <!-- Settings: presets, c values, palette -->
        <section class="card wide">
          <div class="card-header">
            <h2>Settings</h2>
            <span class="badge">coroutine worker</span>
          </div>
          <p class="tooltip">Choose a preset or adjust c manually. Rendering is offloaded to reusable coroutine workers with group-bounded concurrency.</p>

          <div class="settings-body">
            <div class="preset-row">
              <span class="label">Presets:</span>
              @for (p of presets; track p.name) {
                <button
                  [class.active]="selectedPreset === p.name"
                  (click)="loadPreset(p)"
                >{{ p.name }}</button>
              }
            </div>

            <div class="c-row">
              <span class="label">c =</span>
              <span class="sub-label">Re</span>
              <input type="range" min="-1.5" max="1.5" step="0.001" [(ngModel)]="cr" (input)="drawJulia()" />
              <span class="value">{{ cr | number:'1.3' }}</span>
              <span class="sub-label">Im</span>
              <input type="range" min="-1.5" max="1.5" step="0.001" [(ngModel)]="ci" (input)="drawJulia()" />
              <span class="value">{{ ci | number:'1.3' }}i</span>
            </div>

            <div class="palette-row">
              <span class="label">Palette</span>
              <select [(ngModel)]="palette" (change)="drawJulia()">
                @for (p of palettes; track p) {
                  <option [value]="p">{{ p }}</option>
                }
              </select>
              <button class="reset" (click)="reset()">Reset</button>
            </div>
          </div>
        </section>

        <!-- Julia Set Canvas -->
        <section class="card wide">
          <div class="card-header">
            <h2>Julia Set</h2>
            <span class="badge">coroutine + worker</span>
          </div>
          <p class="tooltip">Canvas rows are rendered through a reusable worker coroutine.</p>

          <div class="julia-controls">
            <button (click)="drawJulia()" [disabled]="generating">{{ generating ? 'Rendering…' : 'Generate' }}</button>
            @if (elapsed > 0) {
              <span class="julia-meta">Elapsed: {{ elapsed | number:'1.0-0' }} ms</span>
            }
          </div>

          <div class="julia-canvas-wrap">
            <canvas #juliaCanvas width="1000" height="1000"></canvas>
            @if (generating) {
              <div class="julia-overlay">
                <div class="julia-progress-bar">
                  <div class="julia-progress-fill" [style.width.%]="progress"></div>
                </div>
                <span class="julia-progress-text">{{ progress | number:'1.0-0' }}%</span>
              </div>
            }
          </div>
        </section>
      </main>

      <footer class="footer">
        <p>Powered by <strong>swiftly</strong> · Worker-first concurrency for TypeScript</p>
      </footer>
    </div>
  `,
  styles: [`
    :host {
      --bg: #f6f7f9;
      --surface: #ffffff;
      --surface-hover: #f0f1f4;
      --border: #e2e4e9;
      --text: #1a1d26;
      --text-muted: #6b7280;
      --accent: #2563eb;
      --accent-hover: #1d4ed8;
      --success: #16a34a;
      --warning: #d97706;
      --error: #dc2626;
      --radius: 12px;
      display: block;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    .app { max-width: 1200px; margin: 0 auto; padding: 32px 24px; }

    .header { text-align: center; margin-bottom: 28px; }
    .header h1 { font-size: 2rem; font-weight: 700; margin: 0 0 6px; letter-spacing: -0.5px; }
    .subtitle { color: var(--text-muted); font-size: 0.95rem; margin: 0; }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 20px;
    }
    .grid .wide { grid-column: 1 / -1; }

    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .card-header h2 { margin: 0; font-size: 1.05rem; font-weight: 600; }
    .badge {
      font-size: 0.7rem;
      background: rgba(37,99,235,0.10);
      color: var(--accent);
      padding: 3px 10px;
      border-radius: 999px;
      font-weight: 500;
      white-space: nowrap;
    }

    .tooltip { color: var(--text-muted); font-size: 0.8rem; margin: 0; }

    .settings-body { display: flex; flex-direction: column; gap: 16px; }
    .preset-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .preset-row button {
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 8px 16px;
      border-radius: 20px;
      cursor: pointer;
      font-size: 0.85rem;
      transition: all 0.15s;
    }
    .preset-row button:hover { border-color: var(--accent); background: var(--surface-hover); }
    .preset-row button.active { background: var(--accent); color: #fff; border-color: var(--accent); }

    .c-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .c-row input[type="range"] { width: 160px; accent-color: var(--accent); }
    .label { font-size: 0.9rem; color: var(--text-muted); }
    .sub-label { font-size: 0.8rem; color: var(--text-muted); }
    .value { font-size: 0.9rem; color: var(--text); min-width: 50px; font-weight: 500; }

    .palette-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .palette-row select {
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 8px 12px;
      border-radius: 8px;
      font-size: 0.9rem;
      cursor: pointer;
    }
    .reset {
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 8px 16px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 0.85rem;
    }
    .reset:hover { background: var(--surface-hover); }

    .julia-controls { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .julia-controls button {
      background: var(--accent); color: #fff; border: none; border-radius: 8px;
      padding: 8px 16px; font-size: 0.85rem; font-weight: 500; cursor: pointer;
      transition: background 0.15s;
    }
    .julia-controls button:hover:not(:disabled) { background: var(--accent-hover); }
    .julia-controls button:disabled { opacity: 0.5; cursor: not-allowed; }
    .julia-meta { font-size: 0.85rem; color: var(--text-muted); }

    .julia-canvas-wrap { position: relative; display: flex; justify-content: center; }
    .julia-canvas-wrap canvas {
      background: #000; border: 1px solid var(--border); border-radius: 8px;
      max-width: 100%; height: auto; image-rendering: pixelated;
    }
    .julia-overlay {
      position: absolute; inset: 0; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 8px;
      background: rgba(0,0,0,0.5); border-radius: 8px;
    }
    .julia-progress-bar {
      width: 200px; height: 6px; background: var(--border); border-radius: 3px; overflow: hidden;
    }
    .julia-progress-fill { height: 100%; background: var(--accent); transition: width 0.1s linear; }
    .julia-progress-text { font-size: 0.8rem; color: #fff; font-weight: 500; }

    .footer { text-align: center; margin-top: 32px; padding-top: 20px; border-top: 1px solid var(--border); }
    .footer p { color: var(--text-muted); font-size: 0.8rem; margin: 0; }
    .footer strong { color: var(--accent); }
  `],
})
export class AppComponent implements AfterViewInit, OnDestroy {
  constructor(private cdr: ChangeDetectorRef) {}

  @ViewChild('juliaCanvas') juliaCanvas!: ElementRef<HTMLCanvasElement>;

  presets = PRESETS;
  palettes = [...PALETTES];
  selectedPreset = PRESETS[0].name;

  cr = PRESETS[0].cr;
  ci = PRESETS[0].ci;
  zoom = PRESETS[0].zoom;
  maxIterations = 80;
  palette: Palette = 'Electric';

  generating = false;
  progress = 0;
  elapsed = 0;

  private runner = coroutine<BatchParams, Pixel[]>(juliaBatchWorker);
  private abortController: AbortController | null = null;
  private renderGeneration = 0;

  ngAfterViewInit(): void {
    this.drawJulia();
  }

  ngOnDestroy(): void {
    this.abortController?.abort();
    void this.runner.dispose();
  }

  loadPreset(p: JuliaPreset): void {
    this.selectedPreset = p.name;
    this.cr = p.cr;
    this.ci = p.ci;
    this.zoom = p.zoom;
    this.drawJulia();
  }

  reset(): void {
    this.selectedPreset = PRESETS[0].name;
    this.cr = PRESETS[0].cr;
    this.ci = PRESETS[0].ci;
    this.zoom = PRESETS[0].zoom;
    this.palette = 'Electric';
    this.drawJulia();
  }

  async drawJulia(): Promise<void> {
    const canvas = this.juliaCanvas?.nativeElement;
    if (!canvas) return;

    this.abortController?.abort();
    this.abortController = new AbortController();
    const generation = ++this.renderGeneration;
    const signal = this.abortController.signal;

    const ctx = canvas.getContext('2d')!;
    const w = canvas.width;
    const h = canvas.height;
    const imageData = ctx.createImageData(w, h);
    const data = imageData.data;

    this.generating = true;
    this.progress = 0;
    this.elapsed = 0;
    const start = performance.now();

    const batchHeight = 30;
    const totalBatches = Math.ceil(h / batchHeight);
    let completed = 0;

    const { cr, ci, zoom, maxIterations, palette } = this;

    const work = group({
      concurrency: Math.max(1, navigator.hardwareConcurrency || 4),
      signal,
    });

    const promises = [];
    for (let y = 0; y < h; y += batchHeight) {
      promises.push(
        work.spawn((childSignal) =>
          this.runner.run({
            width: w, height: h,
            startY: y, endY: Math.min(y + batchHeight, h),
            cr, ci, zoom, maxIterations, palette,
          }, childSignal)
        )
      );
    }

    try {
      await Promise.all(
        promises.map(async (p) => {
          if (signal.aborted || generation !== this.renderGeneration) return;
          const pixels = await p;
          if (signal.aborted || generation !== this.renderGeneration) return;

          for (const pix of pixels) {
            const idx = pix.i * 4;
            data[idx] = pix.r;
            data[idx + 1] = pix.g;
            data[idx + 2] = pix.b;
            data[idx + 3] = 255;
          }

          if (signal.aborted || generation !== this.renderGeneration) return;

          completed++;
          this.progress = (completed / totalBatches) * 100;
          this.cdr.detectChanges();
          ctx.putImageData(imageData, 0, 0);
        })
      );
      await work.wait();
    } catch {
      // aborted or error
    }

    if (!signal.aborted && generation === this.renderGeneration) {
      this.elapsed = performance.now() - start;
      this.generating = false;
      this.cdr.detectChanges();
    }
  }
}
````

## File: projects/apps/app1/src/app/app.config.ts
````typescript
import { ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';

export const appConfig: ApplicationConfig = {
  providers: [provideZonelessChangeDetection()]
};
````

## File: projects/apps/app1/src/index.html
````html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Julia Set Explorer</title>
  <base href="/">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/x-icon" href="favicon.ico">
</head>
<body>
  <app-root></app-root>
</body>
</html>
````

## File: projects/apps/app1/src/main.ts
````typescript
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
````

## File: projects/apps/app1/src/styles.scss
````scss
/* You can add global styles to this file, and also import other style files */
````

## File: projects/apps/app1/tsconfig.app.json
````json
/* To learn more about Typescript configuration file: https://www.typescriptlang.org/docs/handbook/tsconfig-json.html. */
/* To learn more about Angular compiler options: https://angular.dev/reference/configs/angular-compiler-options. */
{
  "extends": "../../../tsconfig.json",
  "compilerOptions": {
    "outDir": "../../out-tsc/app",
    "types": []
  },
  "files": [
    "src/main.ts"
  ],
  "include": [
    "src/**/*.d.ts"
  ]
}
````

## File: projects/apps/app1/tsconfig.spec.json
````json
/* To learn more about Typescript configuration file: https://www.typescriptlang.org/docs/handbook/tsconfig-json.html. */
/* To learn more about Angular compiler options: https://angular.dev/reference/configs/angular-compiler-options. */
{
  "extends": "../../../tsconfig.json",
  "compilerOptions": {
    "outDir": "../../out-tsc/spec",
    "types": [
      "jasmine"
    ]
  },
  "include": [
    "src/**/*.spec.ts",
    "src/**/*.d.ts"
  ]
}
````

## File: projects/libraries/swiftly/src/lib/abstractions/supervisor.ts
````typescript
import { ContextCancelledError, createAbortError, sleep } from "../utils";
import type { Actor, ActorExit, Supervisor, SupervisorOptions } from "../worker/types";
import {
  getActorInternals,
  registerActorBusTarget,
  setActorInternals,
  tryActorInternals,
  unregisterActorBusTarget,
  warnAsyncActorBusFailure,
} from "./bus";

/**
 * Supervises an actor factory behind one stable addressable handle.
 *
 * A failed actor generation is recreated until `maxRestarts` is exhausted.
 * Normal stops are never restarted. The supervisor can be passed anywhere an
 * `Actor` is accepted by `main.outbox`, so callers never retain a stale actor
 * generation.
 */
export function supervisor(
  factory: () => Actor,
  options: SupervisorOptions = {},
): Supervisor {
  if (typeof factory !== "function") {
    throw new TypeError("supervisor factory must be a function");
  }

  const maxRestarts = options.maxRestarts ?? 3;
  const restartDelay = options.restartDelay ?? 0;
  const capacity = options.capacity ?? 0;

  if (!Number.isInteger(maxRestarts) || maxRestarts < 0) {
    throw new RangeError("supervisor maxRestarts must be a non-negative integer");
  }
  if (!Number.isFinite(restartDelay) || restartDelay < 0) {
    throw new RangeError("supervisor restartDelay must be a non-negative finite number");
  }
  if (!Number.isInteger(capacity) || capacity < 0) {
    throw new RangeError("supervisor capacity must be a non-negative integer");
  }

  type PendingIngress =
    | { kind: "post"; msg: any }
    | {
        kind: "request";
        topic: string;
        msg: any;
        signal?: AbortSignal;
        resolve: (value: any) => void;
        reject: (error: Error) => void;
        abort?: () => void;
      };

  const ingress: PendingIngress[] = [];
  let current: Actor | undefined;
  let restarts = 0;
  let totalDropped = 0;
  let stopping = false;
  let settled = false;
  let restartController: AbortController | undefined;
  let resolveDone!: (exit: ActorExit) => void;
  const done = new Promise<ActorExit>((resolve) => { resolveDone = resolve; });

  const cleanupPendingRequest = (entry: Extract<PendingIngress, { kind: "request" }>) => {
    if (entry.signal && entry.abort) {
      entry.signal.removeEventListener("abort", entry.abort);
    }
  };

  const rejectIngress = (error: Error) => {
    while (ingress.length > 0) {
      const entry = ingress.shift()!;
      if (entry.kind === "request") {
        cleanupPendingRequest(entry);
        entry.reject(error);
      }
    }
  };

  const settle = (exit: ActorExit) => {
    if (settled) return;
    settled = true;
    restartController?.abort(new ContextCancelledError("supervisor stopped"));
    restartController = undefined;
    unregisterActorBusTarget(handle);
    rejectIngress(
      exit.reason === "error"
        ? exit.error
        : new ContextCancelledError("supervisor stopped")
    );
    resolveDone(exit);
  };

  const flushIngress = () => {
    const active = current;
    if (!active?.running) return;

    while (ingress.length > 0 && current === active && active.running) {
      const entry = ingress.shift()!;
      if (entry.kind === "post") {
        try {
          tryActorInternals(active)?.post(entry.msg);
        } catch (error) {
          warnAsyncActorBusFailure("Supervisor buffered delivery", error);
        }
        continue;
      }

      cleanupPendingRequest(entry);
      if (entry.signal?.aborted) {
        entry.reject(createAbortError(entry.signal));
        continue;
      }

      const internals = tryActorInternals(active);
      if (!internals) {
        entry.reject(new Error("Supervised actor generation is unavailable"));
        continue;
      }

      internals
        .request(entry.topic, entry.msg, entry.signal)
        .then(entry.resolve, entry.reject);
    }
  };

  const scheduleRestart = async (failure: Error): Promise<void> => {
    let lastError = failure;

    while (!stopping && !settled) {
      if (restarts >= maxRestarts) {
        settle({ reason: "error", error: lastError });
        return;
      }

      restarts += 1;
      restartController = new AbortController();

      if (restartDelay > 0) {
        try {
          await sleep(restartDelay, restartController.signal);
        } catch (error) {
          if (stopping || settled) return;
          lastError = error instanceof Error ? error : new Error(String(error));
          continue;
        } finally {
          restartController = undefined;
        }
      }

      if (stopping || settled) return;

      // The stable supervisor owns the public name between generations.
      // `actor(name, ...)` also registers during construction, so temporarily
      // release that registration while the replacement is created. The
      // factory is synchronous, making this hand-off atomic with respect to
      // ordinary main-thread message dispatch.
      unregisterActorBusTarget(handle);

      let next: Actor | undefined;
      try {
        next = factory();
        if (next.name !== first.name) {
          const error = new Error(
            `supervisor replacement name must remain "${first.name}"; received "${next.name}"`,
          );
          await tryActorInternals(next)?.stop();
          next = undefined;
          throw error;
        }

        bindCurrent(next);
        return;
      } catch (error) {
        if (next && current !== next) {
          await tryActorInternals(next)?.stop().catch(() => undefined);
        }

        lastError = error instanceof Error ? error : new Error(String(error));

        if (!stopping && !settled) {
          // A failed construction must not make the supervisor disappear from
          // name-based routing while another restart attempt is still allowed.
          unregisterActorBusTarget(first.name);
          registerActorBusTarget(first.name, handle);
        }
      }
    }
  };

  const bindCurrent = (next: Actor) => {
    if (next.name !== first.name) {
      throw new Error(
        `supervisor replacement name must remain "${first.name}"; received "${next.name}"`,
      );
    }

    // The generation registers itself during actor(); replace that public
    // registration with the stable supervisor handle before exposing it as
    // current. This keeps name routing transactional across restarts.
    unregisterActorBusTarget(next);
    registerActorBusTarget(first.name, handle);
    current = next;

    // Attach lifecycle observation before flushing buffered traffic. A
    // synchronous transport failure during flush can terminate the generation.
    void next.done.then((exit) => {
      if (current !== next || settled) return;
      totalDropped += next.dropped;
      current = undefined;

      if (stopping || exit.reason === "stopped") {
        settle({ reason: "stopped" });
        return;
      }

      void scheduleRestart(exit.error);
    });

    flushIngress();
  };

  const first = factory();

  const handle: Supervisor = {
    get name() {
      return first.name;
    },
    get running() {
      return current?.running ?? false;
    },
    get mailboxCapacity() {
      return current?.mailboxCapacity ?? first.mailboxCapacity;
    },
    get dropped() {
      return totalDropped + (current?.dropped ?? 0);
    },
    get current() {
      return current;
    },
    get restarts() {
      return restarts;
    },
    get capacity() {
      return capacity;
    },
    get pending() {
      return ingress.length;
    },
    done,
  };

  const enqueue = (entry: PendingIngress): boolean => {
    if (settled || stopping || capacity === 0 || ingress.length >= capacity) {
      return false;
    }
    ingress.push(entry);
    return true;
  };

  setActorInternals(handle, {
    stop: async () => {
      if (settled) return;
      stopping = true;
      restartController?.abort(new ContextCancelledError("supervisor stopped"));
      restartController = undefined;
      const active = current;
      if (active) {
        await tryActorInternals(active)?.stop();
      } else {
        settle({ reason: "stopped" });
      }
      await done;
    },
    post: (msg: any) => {
      const active = current;
      if (active?.running) {
        tryActorInternals(active)?.post(msg);
        return;
      }

      if (!enqueue({ kind: "post", msg })) {
        console.warn(
          settled || stopping
            ? "Supervised actor is stopped; message dropped"
            : capacity === 0
              ? "Supervised actor is restarting; message dropped"
              : "Supervisor ingress capacity exceeded; message dropped"
        );
      }
    },
    request: (topic: string, msg: any, signal?: AbortSignal) => {
      const active = current;
      if (active?.running) {
        return getActorInternals(active).request(topic, msg, signal);
      }
      if (signal?.aborted) {
        return Promise.reject(createAbortError(signal));
      }
      if (settled || stopping) {
        return Promise.reject(new Error("Supervised actor is stopped"));
      }
      if (capacity === 0 || ingress.length >= capacity) {
        return Promise.reject(
          new Error(
            capacity === 0
              ? "Supervised actor is restarting"
              : "Supervisor ingress capacity exceeded"
          )
        );
      }

      return new Promise((resolve, reject) => {
        const entry: Extract<PendingIngress, { kind: "request" }> = {
          kind: "request",
          topic,
          msg,
          signal,
          resolve,
          reject,
        };

        if (signal) {
          entry.abort = () => {
            const index = ingress.indexOf(entry);
            if (index < 0) return;
            ingress.splice(index, 1);
            cleanupPendingRequest(entry);
            reject(createAbortError(signal));
          };
          signal.addEventListener("abort", entry.abort, { once: true });
        }

        ingress.push(entry);
      });
    },
  });

  bindCurrent(first);
  return handle;
}


export type { Supervisor, SupervisorOptions } from "../worker/types";
````

## File: projects/libraries/swiftly/src/lib/worker/control.ts
````typescript
import type { TaskRunControl, TaskRunOptions } from "../utils/transfer";

const assertUniqueTransferables = (items: readonly Transferable[]): void => {
  const seen = new Set<Transferable>();
  for (const item of items) {
    if (seen.has(item)) {
      throw new TypeError("transfer list contains the same transferable more than once");
    }
    seen.add(item);
  }
};

/** @internal */
export function normalizeTaskRunControl(control: TaskRunControl): {
  signal?: AbortSignal;
  transfer: Transferable[];
} {
  if (
    control &&
    typeof control === "object" &&
    "aborted" in control &&
    typeof (control as AbortSignal).addEventListener === "function"
  ) {
    return { signal: control as AbortSignal, transfer: [] };
  }

  const options = (control ?? {}) as TaskRunOptions;
  const transferables = [...(options.transfer ?? [])];
  assertUniqueTransferables(transferables);

  return { signal: options.signal, transfer: transferables };
}
````

## File: projects/libraries/swiftly/src/lib/worker/index.ts
````typescript
export * from './types';
export * from './messages';
export * from './script';
export * from './runtimes';
export * from './runner';
export * from './utils';
export * from "./module";
````

## File: projects/libraries/swiftly/src/lib/index.ts
````typescript
export * from './utils';
export * from './abstractions';
````

## File: projects/libraries/swiftly/src/lib/utils/channel.ts
````typescript
import { createAbortError } from "./context";
import type {
    ChannelSelectInternals,
    SelectCaseMeta,
    SelectOutcome,
    SelectRegistration,
} from "./select";

/**
 * Thrown when sending to or receiving from a closed channel.
 */
export class ChannelClosedError extends Error {
  constructor(message = "channel is closed") {
    super(message);
    this.name = "ChannelClosedError";
  }
}

/**
 * Result of a channel receive operation.
 * `ok: true` when a value was available, `ok: false` when the channel is closed and empty.
 */
export type ReceiveResult<T> =
  | { ok: true; value: T }
  | { ok: false; value: undefined };

/**
 * Internal symbol used by `select(...)` to access atomic wait-list hooks on a channel.
 *
 * This is exported so `select.ts` can coordinate with the channel implementation,
 * but it is not part of the normal end-user API surface.
 *
 * @internal
 */
export const CHANNEL_INTERNALS = Symbol("swiftly.channelInternals");

type WaitingReceiver<T> = {
  resolve: (result: ReceiveResult<T>) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  abort?: () => void;
  select?: {
    registration: SelectRegistration<T>;
    meta: SelectCaseMeta;
  };
};

type WaitingSender<T> = {
  value: T;
  resolve: () => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  abort?: () => void;
  select?: {
    registration: SelectRegistration<T>;
    meta: SelectCaseMeta;
  };
};

type SelectableChannel<T> = Channel<T> & {
  [CHANNEL_INTERNALS]: ChannelSelectInternals<T>;
};

/**
 * An async channel for passing values between concurrent operations.
 *
 * - `capacity = 0` creates an unbuffered channel (send blocks until receive is ready).
 * - `capacity > 0` creates a buffered channel (send succeeds while buffer has space).
 *
 * Channels are async iterables; use `for await...of` to consume values until closed.
 */
export type Channel<T> = AsyncIterable<T> & {
  /** Maximum number of values that can be buffered. */
  readonly capacity: number;
  /** Current number of buffered values. */
  readonly size: number;
  /** Whether the channel has been closed. */
  readonly closed: boolean;
  /** Sends a value. Blocks if the channel is unbuffered and no receiver is waiting, or if the buffer is full. Rejects if the channel is closed. */
  send(value: T, signal?: AbortSignal): Promise<void>;
  /** Receives one channel result. `ok: false` means the channel is closed and drained. */
  receive(signal?: AbortSignal): Promise<ReceiveResult<T>>;
  /** Non-blocking send. Returns `true` if the value was accepted immediately. */
  trySend(value: T): boolean;
  /** Non-blocking receive. Returns the result immediately, or `undefined` if nothing is available. */
  tryReceive(): ReceiveResult<T> | undefined;
  /** Closes the channel. Pending receivers resolve with `{ ok: false }`; pending senders reject. */
  close(): void;
};

/**
 * Creates a new async channel with the given buffer capacity.
 *
 * @param capacity - Buffer size. `0` means unbuffered (hand-off semantics). Must be a non-negative integer.
 * @returns A new channel.
 */
export function channel<T>(capacity = 0): Channel<T> {
  if (!Number.isInteger(capacity) || capacity < 0) {
    throw new RangeError("channel capacity must be a non-negative integer");
  }

  const buffer: T[] = [];
  const receivers: WaitingReceiver<T>[] = [];
  const senders: WaitingSender<T>[] = [];
  let isClosed = false;

  const cleanupReceiver = (receiver: WaitingReceiver<T>) => {
    if (receiver.signal && receiver.abort) {
      receiver.signal.removeEventListener("abort", receiver.abort);
    }
  };

  const cleanupSender = (sender: WaitingSender<T>) => {
    if (sender.signal && sender.abort) {
      sender.signal.removeEventListener("abort", sender.abort);
    }
  };

  const removeReceiver = (receiver: WaitingReceiver<T>) => {
    const index = receivers.indexOf(receiver);
    if (index >= 0) receivers.splice(index, 1);
    cleanupReceiver(receiver);
  };

  const removeSender = (sender: WaitingSender<T>) => {
    const index = senders.indexOf(sender);
    if (index >= 0) senders.splice(index, 1);
    cleanupSender(sender);
  };

  /**
   * Settles a waiting receive-side select case with the value it won.
   */
  const settleSelectedReceive = (
    receiver: WaitingReceiver<T>,
    result: ReceiveResult<T>
  ): boolean => {
    const outcome: SelectOutcome<T> = {
      index: receiver.select!.meta.index,
      caseRef: receiver.select!.meta.caseRef,
      op: "receive",
      name: receiver.select!.meta.name,
      ok: result.ok,
    };

    if (result.ok) {
      outcome.value = result.value;
    }

    return receiver.select!.registration.settle(outcome);
  };

  /**
   * Settles a waiting send-side select case after its value has been accepted.
   */
  const settleSelectedSend = (sender: WaitingSender<T>): boolean =>
    sender.select!.registration.settle({
      index: sender.select!.meta.index,
      caseRef: sender.select!.meta.caseRef,
      op: "send",
      name: sender.select!.meta.name,
      ok: true,
    } satisfies SelectOutcome<T>);

  /**
   * Rejects a select waiter when the channel is closed.
   */
  const rejectSelectedWaiter = (
    waiter: WaitingReceiver<T> | WaitingSender<T>,
    error: Error
  ): boolean => waiter.select!.registration.reject(error);

  /**
   * Tries to hand a value directly to the first compatible waiting receiver.
   *
   * When called from a select-managed sender we must avoid matching the sender
   * with a receiver owned by the same outer select registration.
   */
  const tryDispatchToWaitingReceiver = (
    value: T,
    senderSelectId?: symbol
  ): boolean => {
    for (let index = 0; index < receivers.length; index++) {
      const receiver = receivers[index];
      const receiverSelectId = receiver.select?.registration.id;

      if (receiver.select?.registration.isSettled()) {
        receivers.splice(index, 1);
        cleanupReceiver(receiver);
        index--;
        continue;
      }

      if (senderSelectId && receiverSelectId === senderSelectId) {
        continue;
      }

      receivers.splice(index, 1);
      cleanupReceiver(receiver);

      if (receiver.select) {
        if (!settleSelectedReceive(receiver, { ok: true, value })) {
          index--;
          continue;
        }
      } else {
        receiver.resolve({ ok: true, value });
      }

      return true;
    }

    return false;
  };

  /**
   * Tries to pull one waiting sender out of the queue and complete it.
   *
   * When called from a select-managed receiver we must avoid matching the
   * receiver with a sender owned by the same outer select registration.
   */
  const tryAcquireFromWaitingSender = (
    receiverSelectId?: symbol
  ): ReceiveResult<T> | undefined => {
    for (let index = 0; index < senders.length; index++) {
      const sender = senders[index];
      const senderSelectId = sender.select?.registration.id;

      if (sender.select?.registration.isSettled()) {
        senders.splice(index, 1);
        cleanupSender(sender);
        index--;
        continue;
      }

      if (receiverSelectId && senderSelectId === receiverSelectId) {
        continue;
      }

      senders.splice(index, 1);
      cleanupSender(sender);

      if (sender.select) {
        if (!settleSelectedSend(sender)) {
          index--;
          continue;
        }
      } else {
        sender.resolve();
      }

      return { ok: true, value: sender.value };
    }

    if (isClosed) {
      return { ok: false, value: undefined };
    }

    return undefined;
  };

  /**
   * Moves the next waiting sender into the channel buffer when space is available.
   */
  const tryBufferWaitingSender = (): boolean => {
    for (let index = 0; index < senders.length; index++) {
      const sender = senders[index];

      if (sender.select?.registration.isSettled()) {
        senders.splice(index, 1);
        cleanupSender(sender);
        index--;
        continue;
      }

      senders.splice(index, 1);
      cleanupSender(sender);

      if (sender.select) {
        if (!settleSelectedSend(sender)) {
          index--;
          continue;
        }
      } else {
        sender.resolve();
      }

      buffer.push(sender.value);
      return true;
    }

    return false;
  };

  /**
   * Pairs queued senders with queued receivers while preserving select atomicity.
   */
  const tryPairWaitingSenderToReceiver = (): boolean => {
    for (let index = 0; index < senders.length; index++) {
      const sender = senders[index];
      const senderSelectId = sender.select?.registration.id;

      if (sender.select?.registration.isSettled()) {
        senders.splice(index, 1);
        cleanupSender(sender);
        index--;
        continue;
      }

      if (!tryDispatchToWaitingReceiver(sender.value, senderSelectId)) {
        continue;
      }

      senders.splice(index, 1);
      cleanupSender(sender);

      if (sender.select) {
        if (!settleSelectedSend(sender)) {
          index--;
          continue;
        }
      } else {
        sender.resolve();
      }

      return true;
    }

    return false;
  };

  /**
   * Advances queued senders after a receive frees space or a receiver becomes available.
   */
  const flushSenders = () => {
    while (senders.length > 0) {
      if (receivers.length > 0) {
        if (!tryPairWaitingSenderToReceiver()) {
          break;
        }
        continue;
      }

      if (capacity > 0 && buffer.length < capacity) {
        if (!tryBufferWaitingSender()) {
          break;
        }
        continue;
      }

      break;
    }
  };

  const send = (value: T, signal?: AbortSignal): Promise<void> => {
    if (isClosed) return Promise.reject(new ChannelClosedError());
    if (signal?.aborted) return Promise.reject(createAbortError(signal));

    if (tryDispatchToWaitingReceiver(value)) {
      return Promise.resolve();
    }

    if (capacity > 0 && buffer.length < capacity) {
      buffer.push(value);
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const sender: WaitingSender<T> = { value, resolve, reject, signal };
      if (signal) {
        sender.abort = () => {
          removeSender(sender);
          reject(createAbortError(signal));
        };
        signal.addEventListener("abort", sender.abort, { once: true });
      }
      senders.push(sender);
    });
  };

  const instance: SelectableChannel<T> = {
    get capacity() {
      return capacity;
    },
    get size() {
      return buffer.length;
    },
    get closed() {
      return isClosed;
    },
    send,
    async receive(signal?: AbortSignal): Promise<ReceiveResult<T>> {
      if (buffer.length > 0) {
        const value = buffer.shift()!;
        flushSenders();
        return { ok: true, value };
      }

      const matchedSender = tryAcquireFromWaitingSender();
      if (matchedSender) {
        return matchedSender;
      }

      if (isClosed) {
        return { ok: false, value: undefined };
      }

      if (signal?.aborted) return Promise.reject(createAbortError(signal));

      return new Promise<ReceiveResult<T>>((resolve, reject) => {
        const receiver: WaitingReceiver<T> = { resolve, reject, signal };
        if (signal) {
          receiver.abort = () => {
            removeReceiver(receiver);
            reject(createAbortError(signal));
          };
          signal.addEventListener("abort", receiver.abort, { once: true });
        }
        receivers.push(receiver);
      });
    },
    trySend(value: T) {
      if (isClosed) return false;
      if (tryDispatchToWaitingReceiver(value)) {
        return true;
      }
      if (capacity > 0 && buffer.length < capacity) {
        buffer.push(value);
        return true;
      }
      return false;
    },
    tryReceive() {
      if (buffer.length > 0) {
        const value = buffer.shift()!;
        flushSenders();
        return { ok: true, value };
      }
      const matchedSender = tryAcquireFromWaitingSender();
      if (matchedSender) {
        return matchedSender;
      }
      if (isClosed) return { ok: false, value: undefined };
      return undefined;
    },
    close() {
      if (isClosed) return;
      isClosed = true;

      while (receivers.length > 0) {
        const receiver = receivers.shift()!;
        cleanupReceiver(receiver);
        if (receiver.select) {
          settleSelectedReceive(receiver, { ok: false, value: undefined });
        } else {
          receiver.resolve({ ok: false, value: undefined });
        }
      }

      while (senders.length > 0) {
        const sender = senders.shift()!;
        cleanupSender(sender);
        const error = new ChannelClosedError();
        if (sender.select) {
          rejectSelectedWaiter(sender, error);
        } else {
          sender.reject(error);
        }
      }
    },
    [CHANNEL_INTERNALS]: {
      registerSelectReceive(
        registration: SelectRegistration<T>,
        meta: SelectCaseMeta
      ) {
        if (registration.isSettled()) {
          return () => {};
        }

        if (isClosed) {
          registration.settle({
            index: meta.index,
            caseRef: meta.caseRef,
            op: "receive",
            name: meta.name,
            ok: false,
          });
          return () => {};
        }

        const receiver: WaitingReceiver<T> = {
          resolve: () => {},
          reject: () => {},
          select: { registration, meta },
        };
        receivers.push(receiver);

        // Reconcile against any sender that may already be waiting. Public
        // select normally catches this in its fast path, but the internal hook
        // remains atomic and correct on its own.
        flushSenders();

        return () => removeReceiver(receiver);
      },
      registerSelectSend(
        value: T,
        registration: SelectRegistration<T>,
        meta: SelectCaseMeta
      ) {
        if (registration.isSettled()) {
          return () => {};
        }

        if (isClosed) {
          registration.reject(new ChannelClosedError());
          return () => {};
        }

        const sender: WaitingSender<T> = {
          value,
          resolve: () => {},
          reject: () => {},
          select: { registration, meta },
        };
        senders.push(sender);

        // Reconcile immediately with a compatible receiver or available buffer
        // capacity instead of relying on some later channel operation to flush.
        flushSenders();

        return () => removeSender(sender);
      },
    } satisfies ChannelSelectInternals<T>,
    async *[Symbol.asyncIterator]() {
      while (true) {
        const result = await this.receive();
        if (!result.ok) return;
        yield result.value;
      }
    },
  };

  return instance;
}
````

## File: projects/libraries/swiftly/src/tests/coroutine.spec.ts
````typescript
import {
  ChannelClosedError,
  ContextCancelledError,
  background,
  channel,
  coroutine,
  otherwise,
  receive,
  select,
  send,
  withCancel,
  withDeadline,
  withTimeout
} from "../public-api";
import { idescribe } from "./env.spec";

idescribe('coroutine', () => {
  let originalWorker: any;
  let originalLog: typeof console.log;
  let originalError: typeof console.error;
  let originalWarn: typeof console.warn;
  let mockWorkerCreations = 0;

  beforeAll(() => {
    // Store the original Worker
    originalWorker = (globalThis as any).Worker;

    // Save originals
    originalLog = console.log;
    originalError = console.error;
    originalWarn = console.warn;

    // Set up globalThis variable for main task
    (globalThis as any).currentMainTask = undefined;

    const serializeWorkerError = (error: unknown): string => {
      if (error instanceof Error) return error.message || error.name || "Error";
      if (error === undefined) return "Worker task threw undefined";
      if (error === null) return "Worker task threw null";
      return String(error);
    };

    class MockWorker {
      onmessage: ((ev: any) => void) | null = null;
      listeners: Record<string, ((ev: any) => void)[]> = {};
      terminated = false;
      private workerInbox = channel<any>();

      constructor(_url: string, _options?: any) {
        mockWorkerCreations++;
      }

      private handleDataRequest(_requestPayload: any): Promise<any> {
        return new Promise((resolve) => {
          // Simulate async data request by resolving with dummy data
          setTimeout(() => {
            resolve({ value: 10, message: "Dummy data from mock worker" });
          }, 1);
        });
      }

      private createWorkerUtils(message: { workerId: number; taskId: string }) {
        return {
          main: {
            send: (payload: any) => {
              const event: MessageEvent<any> = {
                data: { workerId: message.workerId, taskId: message.taskId, type: "notify", payload }
              } as any;
              this.onmessage?.(event);
              this.listeners["message"]?.forEach(fn => fn(event));
            },
            request: (requestPayload: any) => this.handleDataRequest(requestPayload),
            receive: async (signal?: AbortSignal) => {
              const result = await this.workerInbox.receive(signal);
              return result.ok ? result.value : undefined;
            },
            inbox: this.workerInbox,
          },
          concurrency: {
            channel,
            receive,
            send,
            otherwise,
            select,
            background,
            withCancel,
            withTimeout,
            withDeadline,
            ChannelClosedError,
            ContextCancelledError,
          }
        };
      }

      postMessage(msg: any) {
        setTimeout(() => {
          if (this.terminated) return;
          
          if (msg.type === 'task') {
            try {
              const mainTask = (globalThis as any).currentMainTask;
              if (!mainTask) {
                throw new Error('No main task configured');
              }
              const workerUtils = this.createWorkerUtils(msg);
              
              let result;
              
              // Check if mainTask expects utils parameter
              if (mainTask.length >= 2) {
                // Call with both data and utils
                result = mainTask(msg.payload, workerUtils);
              } else {
                // Call with only data
                result = mainTask(msg.payload);
              }
              
              // Handle both sync and async results
              Promise.resolve(result).then(finalResult => {
                const event: MessageEvent<any> = {
                  data: { ...msg, type: 'response', payload: finalResult }
                } as any;
                this.onmessage?.(event);
                this.listeners['message']?.forEach(fn => fn(event));
              }).catch(err => {
                const message = serializeWorkerError(err);
                const event: MessageEvent<any> = {
                  data: { ...msg, type: 'error', error: message }
                } as any;
                this.onmessage?.(event);
                this.listeners['message']?.forEach(fn => fn(event));
              });
              
            } catch (err: any) {
              const message = serializeWorkerError(err);
              const event: MessageEvent<any> = {
                data: { ...msg, type: 'error', error: message }
              } as any;
              this.onmessage?.(event);
              this.listeners['message']?.forEach(fn => fn(event));
            }
          } else if (msg.type === "notify") {
            this.workerInbox.send(msg.payload).catch(() => {});
          } else if (msg.type === 'data') {
            // Handle responses to worker data requests (if needed)
            console.log('MockWorker received data response:', msg);
          }
        }, 1);
      }

      addEventListener(type: string, fn: (ev: any) => void) {
        this.listeners[type] ||= [];
        this.listeners[type].push(fn);
      }

      removeEventListener(type: string, fn: (ev: any) => void) {
        if (this.listeners[type]) {
          this.listeners[type] = this.listeners[type].filter(f => f !== fn);
        }
      }

      terminate() {
        this.terminated = true;
        this.listeners = {};
        this.onmessage = null;
      }
    }

    (globalThis as any).Worker = MockWorker;
  });
  
  afterAll(() => {
    (globalThis as any).Worker = originalWorker;
    delete (globalThis as any).currentMainTask;
  });

  beforeEach(() => {
    // Reset before each test
    (globalThis as any).currentMainTask = undefined;
    mockWorkerCreations = 0;
  });

  it('should process tasks and return results', async () => {
    const mainTask = (x: number) => x + 1;
    (globalThis as any).currentMainTask = mainTask;
    
    const co = coroutine(mainTask);

    const stream = (async function* () {
      yield 1;
      yield 2;
      yield 3;
    })();

    const processed: number[] = [];
    for await (const v of stream) {
      processed.push(await co.run(v as number));
    }

    expect(processed).toEqual([2, 3, 4]); // Fixed expectation: x + 1
  });

  it('should process concurrent tasks on elastic workers', async () => {
    const mainTask = (x: number) => x * 2; // Fixed: consistent task logic
    (globalThis as any).currentMainTask = mainTask;
    
    const co = coroutine(mainTask);

    const results = await Promise.all([
      co.run(1),
      co.run(2),
      co.run(3),
    ]);

    expect(results).toEqual([2, 4, 6]); // Fixed expectation: x * 2
    expect(mockWorkerCreations).toBe(3);
    await co.dispose();
  });

  it('should dispose and terminate all workers', async () => {
    const mainTask = (x: number) => x * 2;
    (globalThis as any).currentMainTask = mainTask;

    const co = coroutine(mainTask);

    const result = await co.run(2);
    expect(result).toBe(4);
    await co.dispose();
  });

  it('should throw error from run directly', async () => {
    // Silence them
    console.log = () => {};
    console.error = () => {};
    console.warn = () => {};

    const mainTask = () => {
      throw new Error('boom');
    };
    (globalThis as any).currentMainTask = mainTask;

    const co = coroutine(mainTask);

    try {
      await co.run(1);
      fail('Expected run to throw error');
    } catch (err: any) {
      expect(err.message).toBe('boom');
    }

    // Restore originals
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  });

  it('should serialize undefined worker errors sensibly', async () => {
    // Silence them
    console.log = () => {};
    console.error = () => {};
    console.warn = () => {};

    const mainTask = () => {
      throw undefined;
    };
    (globalThis as any).currentMainTask = mainTask;

    const co = coroutine(mainTask);

    try {
      await co.run(1);
      fail('Expected run to throw error');
    } catch (err: any) {
      expect(err.message).toBe('Worker task threw undefined');
    }

    // Restore originals
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  });

  it('should handle worker errors gracefully in stream', async () => {
     // Silence them
    console.log = () => {};
    console.error = () => {};
    console.warn = () => {};
    
    const mainTask = (x: number) => {
      if (x === 2) {
        throw new Error('boom');
      }
      return x * 2;
    };
    (globalThis as any).currentMainTask = mainTask;

    const co = coroutine(mainTask);

    const stream = (async function* () {
      yield 1;
      yield 2; // This will cause an error
      yield 3;
    })();

    const processed: number[] = [];
    let errorCaught = false;

    try {
      for await (const v of stream) {
        processed.push(await co.run(v as number));
      }
    } catch (err: any) {
      errorCaught = true;
      expect(err.message).toBe('boom');
    }

    expect(errorCaught).toBe(true);
    expect(processed).toEqual([2]); // Only the first value processed successfully
    
    // Restore originals
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  });

  it('should fall back to 4 workers when navigator.hardwareConcurrency is not set', async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, "hardwareConcurrency");

    try {
      Object.defineProperty(navigator, "hardwareConcurrency", { value: 0, configurable: true });

      const mainTask = (x: number) => x + 1;
      (globalThis as any).currentMainTask = mainTask;

      const co = coroutine(mainTask);
      const result = await co.run(1);
      expect(result).toBe(2);
      await co.dispose();
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(navigator, "hardwareConcurrency", originalDescriptor);
      }
    }
  });

  it('should support trailing coroutine options', async () => {
    const mainTask = (x: number) => x + 1;
    (globalThis as any).currentMainTask = mainTask;

    const co = coroutine(mainTask, {});

    const r = await co.run(1);
    expect(r).toBe(2);

    await co.dispose();
  });

  it('should limit worker creation when maxWorkers is configured', async () => {
    const mainTask = async (x: number) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return x + 1;
    };
    (globalThis as any).currentMainTask = mainTask;

    const co = coroutine(mainTask, { maxWorkers: 1 });
    const first = co.run(1);
    const second = co.run(2);

    await expectAsync(first).toBeResolvedTo(2);
    await expectAsync(second).toBeResolvedTo(3);
    expect(mockWorkerCreations).toBe(1);

    await co.dispose();
  });

  it('should reject with "Unknown worker error" when worker error message is missing', async () => {
    const originalWorker = (globalThis as any).Worker;

    class ErrorNoMessageWorker {
      listeners: Record<string, ((ev: any) => void)[]> = {};
      terminated = false;

      constructor(_url: string, _options?: any) {}

      addEventListener(type: string, fn: (ev: any) => void) {
        this.listeners[type] ||= [];
        this.listeners[type].push(fn);
      }

      removeEventListener(type: string, fn: (ev: any) => void) {
        if (this.listeners[type]) {
          this.listeners[type] = this.listeners[type].filter(f => f !== fn);
        }
      }

      postMessage(msg: any) {
        setTimeout(() => {
          if (this.terminated) return;
          if (msg.type !== "task") return;

          const event: MessageEvent<any> = {
            data: { ...msg, type: "error" } // no `error` field on purpose
          } as any;

          this.listeners["message"]?.forEach(fn => fn(event));
        }, 1);
      }

      terminate() {
        this.terminated = true;
        this.listeners = {};
      }
    }

    (globalThis as any).Worker = ErrorNoMessageWorker;

    try {
      const mainTask = (x: number) => x;
      (globalThis as any).currentMainTask = mainTask;

      const co = coroutine(mainTask);

      await expectAsync(co.run(1)).toBeRejectedWithError("Unknown worker error");
      await co.dispose();
    } finally {
      (globalThis as any).Worker = originalWorker;
    }
  });

  it('should include helper function names when generating worker script', async () => {
    const mainTask = (x: number) => x;
    (globalThis as any).currentMainTask = mainTask;

    function helperNamed() {
      return 1;
    }

    const co = coroutine(mainTask, helperNamed, function () { return 2; });
    await co.run(1);
    await co.dispose();
  });

  it('should reject all concurrent run requests when finalized', async () => {
    const mainTask = (_x: number) => new Promise<number>(() => {});
    (globalThis as any).currentMainTask = mainTask;

    const co = coroutine(mainTask);
    const first = co.run(1);
    const second = co.run(2);

    await co.dispose();

    await expectAsync(first).toBeRejectedWithError(/finalized before the worker task completed/);
    await expectAsync(second).toBeRejectedWithError(/finalized before the worker task completed/);
  });

  it('dispose is safe when called before any worker is created', async () => {
    const mainTask = (x: number) => x;
    (globalThis as any).currentMainTask = mainTask;
    const co = coroutine(mainTask);

    await co.dispose();

    // After finalization, new tasks should be rejected.
    await expectAsync(co.run(1)).toBeRejectedWithError(
      /finalized before a worker became available/
    );
  });


  it("close drains admitted coroutine work and rejects new submissions", async () => {
    const mainTask = async (x: number) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return x * 2;
    };
    (globalThis as any).currentMainTask = mainTask;

    const co = coroutine(mainTask);
    const first = co.run(2);
    const second = co.run(3);

    const closing = co.close();

    await expectAsync(co.run(4)).toBeRejectedWithError(/closed/);
    expect(await first).toBe(4);
    expect(await second).toBe(6);
    await expectAsync(closing).toBeResolved();
    await expectAsync(co.close()).toBeResolved();
  });

  it("dispose remains immediate and rejects all active coroutine work", async () => {
    const mainTask = async (x: number) => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return x;
    };
    (globalThis as any).currentMainTask = mainTask;

    const co = coroutine(mainTask);
    const first = co.run(1);
    const second = co.run(2);

    await co.dispose();

    await expectAsync(first).toBeRejected();
    await expectAsync(second).toBeRejected();
    await expectAsync(co.close()).toBeResolved();
  });


});
````

## File: projects/libraries/swiftly/src/tests/group.spec.ts
````typescript
import {
  ContextCancelledError,
  group,
} from "../public-api";

describe("task group", () => {
  const pause = (ms = 5) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  it("owns dynamic child work and waits for all children", async () => {
    const work = group();
    const completed: number[] = [];

    const first = work.spawn(async () => {
      await pause(5);
      completed.push(1);
      return "one";
    });
    const second = work.spawn(async () => {
      await pause(1);
      completed.push(2);
      return "two";
    });

    await expectAsync(work.wait()).toBeResolved();
    await expectAsync(first).toBeResolvedTo("one");
    await expectAsync(second).toBeResolvedTo("two");
    expect(completed.sort()).toEqual([1, 2]);
    expect(work.running).toBe(0);
    expect(work.accepting).toBeFalse();
  });

  it("cancels siblings when the first child fails", async () => {
    const work = group();
    let siblingCancelled = false;

    const sibling = work.spawn(
      (signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              siblingCancelled = true;
              reject(signal.reason);
            },
            { once: true },
          );
        }),
    );

    const failed = work.spawn(async () => {
      await pause(1);
      throw new Error("child boom");
    });

    await expectAsync(failed).toBeRejectedWithError("child boom");
    await expectAsync(sibling).toBeRejected();
    await expectAsync(work.wait()).toBeRejectedWithError("child boom");
    expect(siblingCancelled).toBeTrue();
    expect(work.signal.aborted).toBeTrue();
  });

  it("bounds execution without changing child operations", async () => {
    const work = group({ concurrency: 2 });
    let active = 0;
    let peak = 0;

    const children = Array.from({ length: 6 }, (_, index) =>
      work.spawn(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await pause(2);
        active -= 1;
        return index;
      }),
    );

    await work.wait();
    expect(await Promise.all(children)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(peak).toBe(2);
  });

  it("starts bounded work in FIFO order as group slots become free", async () => {
    const work = group({ concurrency: 2 });
    const started: number[] = [];
    const releases: Array<() => void> = [];

    const children = Array.from({ length: 5 }, (_, index) =>
      work.spawn(async () => {
        started.push(index);
        await new Promise<void>((resolve) => releases.push(resolve));
        return index;
      }),
    );

    expect(started).toEqual([0, 1]);
    expect(work.running).toBe(5);

    releases.shift()!();
    await pause(0);
    expect(started).toEqual([0, 1, 2]);

    releases.shift()!();
    await pause(0);
    expect(started).toEqual([0, 1, 2, 3]);

    releases.shift()!();
    releases.shift()!();
    await pause(0);
    expect(started).toEqual([0, 1, 2, 3, 4]);

    releases.shift()!();

    await work.wait();
    expect(await Promise.all(children)).toEqual([0, 1, 2, 3, 4]);
  });

  it("cancels queued children without starting their operations", async () => {
    const work = group({ concurrency: 1 });
    let queuedStarted = false;

    const running = work.spawn(
      (signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    );

    const queued = work.spawn(async () => {
      queuedStarted = true;
      return 2;
    });

    expect(queuedStarted).toBeFalse();

    work.cancel(new ContextCancelledError("cancel queued"));

    await expectAsync(running).toBeRejectedWithError(
      ContextCancelledError,
      "cancel queued",
    );
    await expectAsync(queued).toBeRejectedWithError(
      ContextCancelledError,
      "cancel queued",
    );
    expect(queuedStarted).toBeFalse();
    expect(work.running).toBe(0);
  });

  it("propagates parent cancellation into queued and running children", async () => {
    const parent = new AbortController();
    const work = group({ concurrency: 1, signal: parent.signal });

    const running = work.spawn(
      (signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    );
    const queued = work.spawn(async (signal) => {
      if (signal.aborted) throw signal.reason;
    });

    parent.abort(new ContextCancelledError("parent cancelled"));

    await expectAsync(running).toBeRejectedWithError(ContextCancelledError, "parent cancelled");
    await expectAsync(queued).toBeRejectedWithError(ContextCancelledError, "parent cancelled");
    await expectAsync(work.wait()).toBeRejectedWithError(ContextCancelledError, "parent cancelled");
  });

  it("supports explicit cancellation and rejects new work after close", async () => {
    const work = group();
    work.cancel(new ContextCancelledError("stop group"));

    await expectAsync(work.spawn(async () => 1)).toBeRejectedWithError(
      ContextCancelledError,
      "stop group",
    );
    await expectAsync(work.wait()).toBeRejectedWithError(ContextCancelledError, "stop group");
    await expectAsync(work.spawn(async () => 2)).toBeRejectedWithError("task group is closed");
  });

  it("validates bounded concurrency", () => {
    expect(() => group({ concurrency: 0 })).toThrowError(
      RangeError,
      "group concurrency must be a positive integer",
    );
    expect(() => group({ concurrency: 1.5 })).toThrowError(
      RangeError,
      "group concurrency must be a positive integer",
    );
  });

  it("settle reports child outcomes in spawn order without throwing", async () => {
    const work = group();

    work.spawn(async () => {
      await pause(5);
      return "first";
    });
    work.spawn(async () => {
      await pause(1);
      return "second";
    });

    const report = await work.settle();

    expect(report.error).toBeUndefined();
    expect(report.outcomes).toEqual([
      { status: "fulfilled", value: "first" },
      { status: "fulfilled", value: "second" },
    ]);
    expect(work.running).toBe(0);
    expect(work.accepting).toBeFalse();
  });

  it("settle distinguishes the failing child from siblings cancelled by the group", async () => {
    const work = group();

    work.spawn(
      (signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(signal.reason),
            { once: true },
          );
        }),
    );
    work.spawn(async () => {
      await pause(1);
      throw new Error("primary failure");
    });

    const report = await work.settle();

    expect(report.error?.message).toBe("primary failure");
    expect(report.outcomes[0].status).toBe("cancelled");
    expect(report.outcomes[1]).toEqual(
      jasmine.objectContaining({
        status: "rejected",
        error: jasmine.objectContaining({ message: "primary failure" }),
      }),
    );
  });

  it("settle reports parent cancellation without turning it into a child failure", async () => {
    const parent = new AbortController();
    const work = group({ signal: parent.signal });

    work.spawn(
      (signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(signal.reason),
            { once: true },
          );
        }),
    );

    parent.abort(new ContextCancelledError("parent stopped"));
    const report = await work.settle();

    expect(report.error?.message).toBe("parent stopped");
    expect(report.outcomes).toEqual([
      jasmine.objectContaining({
        status: "cancelled",
        reason: jasmine.objectContaining({ message: "parent stopped" }),
      }),
    ]);
  });

  it("wait and settle share one stable completion report", async () => {
    const work = group();
    work.spawn(async () => 42);

    const first = await work.settle();
    await expectAsync(work.wait()).toBeResolved();
    const second = await work.settle();

    expect(second).toBe(first);
    expect(second.outcomes).toEqual([
      { status: "fulfilled", value: 42 },
    ]);
  });



  it("closes acceptance immediately on cancellation and detaches the parent listener without wait", async () => {
    const listeners = new Set<EventListenerOrEventListenerObject>();
    const parentSignal = {
      aborted: false,
      reason: undefined,
      addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        if (type === "abort") listeners.add(listener);
      },
      removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        if (type === "abort") listeners.delete(listener);
      },
    } as unknown as AbortSignal;

    const work = group({ signal: parentSignal });
    expect(listeners.size).toBe(1);
    expect(work.accepting).toBeTrue();

    work.cancel(new ContextCancelledError("cancel now"));

    expect(work.accepting).toBeFalse();
    expect(listeners.size).toBe(0);
    await expectAsync(work.spawn(async () => 1)).toBeRejectedWithError(
      ContextCancelledError,
      "cancel now",
    );
  });

  it("closes acceptance immediately when a child failure owns the group", async () => {
    const work = group();
    const failed = work.spawn(async () => {
      throw new Error("terminal child failure");
    });

    await expectAsync(failed).toBeRejectedWithError("terminal child failure");
    expect(work.accepting).toBeFalse();
    await expectAsync(work.spawn(async () => 2)).toBeRejectedWithError(
      "terminal child failure",
    );
    await expectAsync(work.wait()).toBeRejectedWithError("terminal child failure");
    await expectAsync(work.spawn(async () => 3)).toBeRejectedWithError("task group is closed");
  });


});
````

## File: angular.json
````json
{
  "$schema": "./node_modules/@angular/cli/lib/config/schema.json",
  "version": 1,
  "cli": {
    "packageManager": "npm"
  },
  "newProjectRoot": "projects",
  "projects": {
    "app1": {
      "projectType": "application",
      "schematics": {
        "@schematics/angular:component": {
          "style": "scss"
        }
      },
      "root": "projects/apps/app1",
      "sourceRoot": "projects/apps/app1/src",
      "prefix": "app",
      "architect": {
        "build": {
          "builder": "@angular/build:application",
          "options": {
            "outputPath": "dist/apps/app1",
            "index": "projects/apps/app1/src/index.html",
            "browser": "projects/apps/app1/src/main.ts",
            "polyfills": [],
            "tsConfig": "projects/apps/app1/tsconfig.app.json",
            "inlineStyleLanguage": "scss",
            "assets": [
              {
                "glob": "**/*",
                "input": "projects/apps/app1/public"
              }
            ],
            "styles": ["projects/apps/app1/src/styles.scss"],
            "scripts": []
          },
          "configurations": {
            "production": {
              "budgets": [
                {
                  "type": "initial",
                  "maximumWarning": "500kB",
                  "maximumError": "1MB"
                },
                {
                  "type": "anyComponentStyle",
                  "maximumWarning": "4kB",
                  "maximumError": "8kB"
                }
              ],
              "outputHashing": "all"
            },
            "development": {
              "optimization": false,
              "extractLicenses": false,
              "sourceMap": true
            }
          },
          "defaultConfiguration": "production"
        },
        "serve": {
          "builder": "@angular/build:dev-server",
          "configurations": {
            "production": {
              "buildTarget": "app1:build:production"
            },
            "development": {
              "buildTarget": "app1:build:development"
            }
          },
          "defaultConfiguration": "development"
        },
        "extract-i18n": {
          "builder": "@angular/build:extract-i18n"
        },
        "test": {
          "builder": "@angular/build:unit-test",
          "options": {
            "tsConfig": "projects/apps/app1/tsconfig.spec.json"
          }
        }
      }
    },
    "app2": {
      "projectType": "application",
      "schematics": {
        "@schematics/angular:component": {
          "style": "scss"
        }
      },
      "root": "projects/apps/app2",
      "sourceRoot": "projects/apps/app2/src",
      "prefix": "app",
      "architect": {
        "build": {
          "builder": "@angular/build:application",
          "options": {
            "outputPath": "dist/apps/app2",
            "index": "projects/apps/app2/src/index.html",
            "browser": "projects/apps/app2/src/main.ts",
            "polyfills": [],
            "tsConfig": "projects/apps/app2/tsconfig.app.json",
            "inlineStyleLanguage": "scss",
            "assets": [
              {
                "glob": "**/*",
                "input": "projects/apps/app2/public"
              }
            ],
            "styles": ["projects/apps/app2/src/styles.scss"],
            "scripts": []
          },
          "configurations": {
            "production": {
              "budgets": [
                {
                  "type": "initial",
                  "maximumWarning": "500kB",
                  "maximumError": "1MB"
                },
                {
                  "type": "anyComponentStyle",
                  "maximumWarning": "4kB",
                  "maximumError": "8kB"
                }
              ],
              "outputHashing": "all"
            },
            "development": {
              "optimization": false,
              "extractLicenses": false,
              "sourceMap": true
            }
          },
          "defaultConfiguration": "production"
        },
        "serve": {
          "builder": "@angular/build:dev-server",
          "configurations": {
            "production": {
              "buildTarget": "app2:build:production"
            },
            "development": {
              "buildTarget": "app2:build:development"
            }
          },
          "defaultConfiguration": "development"
        },
        "extract-i18n": {
          "builder": "@angular/build:extract-i18n"
        },
        "test": {
          "builder": "@angular/build:unit-test",
          "options": {
            "tsConfig": "projects/apps/app2/tsconfig.spec.json"
          }
        }
      }
    },
    "app3": {
      "projectType": "application",
      "schematics": {
        "@schematics/angular:component": {
          "style": "scss"
        }
      },
      "root": "projects/apps/app3",
      "sourceRoot": "projects/apps/app3/src",
      "prefix": "app",
      "architect": {
        "build": {
          "builder": "@angular/build:application",
          "options": {
            "outputPath": "dist/apps/app3",
            "index": "projects/apps/app3/src/index.html",
            "browser": "projects/apps/app3/src/main.ts",
            "polyfills": [],
            "tsConfig": "projects/apps/app3/tsconfig.app.json",
            "inlineStyleLanguage": "scss",
            "assets": [],
            "styles": ["projects/apps/app3/src/styles.scss"],
            "scripts": []
          },
          "configurations": {
            "production": {
              "budgets": [
                {
                  "type": "initial",
                  "maximumWarning": "500kB",
                  "maximumError": "1MB"
                },
                {
                  "type": "anyComponentStyle",
                  "maximumWarning": "4kB",
                  "maximumError": "8kB"
                }
              ],
              "outputHashing": "all"
            },
            "development": {
              "optimization": false,
              "extractLicenses": false,
              "sourceMap": true
            }
          },
          "defaultConfiguration": "production"
        },
        "serve": {
          "builder": "@angular/build:dev-server",
          "configurations": {
            "production": {
              "buildTarget": "app3:build:production"
            },
            "development": {
              "buildTarget": "app3:build:development"
            }
          },
          "defaultConfiguration": "development"
        },
        "extract-i18n": {
          "builder": "@angular/build:extract-i18n"
        },
        "test": {
          "builder": "@angular/build:unit-test",
          "options": {
            "tsConfig": "projects/apps/app3/tsconfig.spec.json"
          }
        }
      }
    },
    "app4": {
      "projectType": "application",
      "schematics": {
        "@schematics/angular:component": {
          "style": "scss"
        }
      },
      "root": "projects/apps/app4",
      "sourceRoot": "projects/apps/app4/src",
      "prefix": "app",
      "architect": {
        "build": {
          "builder": "@angular/build:application",
          "options": {
            "outputPath": "dist/apps/app4",
            "index": "projects/apps/app4/src/index.html",
            "browser": "projects/apps/app4/src/main.ts",
            "polyfills": [],
            "tsConfig": "projects/apps/app4/tsconfig.app.json",
            "inlineStyleLanguage": "scss",
            "assets": [],
            "styles": ["projects/apps/app4/src/styles.scss"],
            "scripts": []
          },
          "configurations": {
            "production": {
              "budgets": [
                {
                  "type": "initial",
                  "maximumWarning": "500kB",
                  "maximumError": "1MB"
                }
              ],
              "outputHashing": "all"
            },
            "development": {
              "optimization": false,
              "extractLicenses": false,
              "sourceMap": true
            }
          },
          "defaultConfiguration": "production"
        },
        "serve": {
          "builder": "@angular/build:dev-server",
          "configurations": {
            "production": {
              "buildTarget": "app4:build:production"
            },
            "development": {
              "buildTarget": "app4:build:development"
            }
          },
          "defaultConfiguration": "development"
        },
        "extract-i18n": {
          "builder": "@angular/build:extract-i18n"
        },
        "test": {
          "builder": "@angular/build:unit-test",
          "options": {
            "tsConfig": "projects/apps/app4/tsconfig.spec.json"
          }
        }
      }
    },
    "swiftly": {
      "projectType": "library",
      "root": "projects/libraries/swiftly",
      "sourceRoot": "projects/libraries/swiftly/src",
      "prefix": "lib",
      "architect": {
        "build": {
          "builder": "@angular/build:ng-packagr",
          "options": {
            "project": "projects/libraries/swiftly/ng-package.json"
          },
          "configurations": {
            "production": {
              "tsConfig": "projects/libraries/swiftly/tsconfig.lib.prod.json"
            },
            "development": {
              "tsConfig": "projects/libraries/swiftly/tsconfig.lib.json"
            }
          },
          "defaultConfiguration": "production"
        },
        "test": {
          "builder": "@angular/build:unit-test",
          "options": {
            "tsConfig": "projects/libraries/swiftly/tsconfig.spec.json"
          }
        }
      }
    }
  }
}
````

## File: tsconfig.json
````json
{
  "compileOnSave": false,
  "compilerOptions": {
    "rootDir": ".",
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "paths": {
      "@epikodelabs/swiftly": [
        "./projects/libraries/swiftly/src/public-api.ts"
      ]
    },
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "sourceMap": true,
    "experimentalDecorators": true,
    "importHelpers": true,
    "moduleResolution": "bundler",
    "target": "ES2022",
    "module": "preserve",
    "useDefineForClassFields": false,
    "lib": [
      "ES2022",
      "dom"
    ],
    "types": [
      "jasmine"
    ]
  },
  "angularCompilerOptions": {
    "enableI18nLegacyMessageIdFormat": false,
    "strictInjectionParameters": true,
    "strictInputAccessModifiers": true,
    "strictTemplates": true
  },
  "files": [],
  "references": [
    {
      "path": "./projects/apps/app1/tsconfig.app.json"
    },
    {
      "path": "./projects/apps/app1/tsconfig.spec.json"
    },
    {
      "path": "./projects/apps/app2/tsconfig.app.json"
    },
    {
      "path": "./projects/apps/app2/tsconfig.spec.json"
    },
    {
      "path": "./projects/apps/app3/tsconfig.app.json"
    },
    {
      "path": "./projects/apps/app3/tsconfig.spec.json"
    },
    {
      "path": "./projects/apps/app4/tsconfig.app.json"
    },
    {
      "path": "./projects/apps/app4/tsconfig.spec.json"
    },
    {
      "path": "./projects/libraries/swiftly/tsconfig.lib.json"
    },
    {
      "path": "./projects/libraries/swiftly/tsconfig.spec.json"
    }
  ]
}
````

## File: projects/libraries/swiftly/src/lib/abstractions/coroutine.ts
````typescript
import { createTaskRunner } from "../worker/runner";
import { buildCoroutineWorkerRuntime } from "../worker/runtimes";
import { buildWorkerScript } from "../worker/script";
import type { Coroutine, CoroutineScript } from "../worker/types";
import type { WorkerTaskResult, WorkerTaskUtils } from "../utils/transfer";

/**
 * Task function executed inside a worker without actor utilities.
 */
export type CoroutineTask<T = any, R = any> = (data: T, utils: WorkerTaskUtils) =>
  | WorkerTaskResult<R>
  | Promise<WorkerTaskResult<R>>;

/**
 * Optional settings for plain one-way coroutine workers.
 */
export type CoroutineOptions = {
  /** Raw helper snippets injected into the worker before task code. */
  helpers?: string[];
  /** Maximum number of workers this coroutine may own concurrently. */
  maxWorkers?: number;
};

type CoroutineDefinitionRest = Function[] | [...Function[], CoroutineOptions];

function createCoroutineImpl<T, R>(
  main: CoroutineTask<T, R>,
  functions: Function[],
  options: CoroutineOptions,
): Coroutine<T, R> & CoroutineScript<T, R> {
  const runner = createTaskRunner<T, R>({
    name: "coroutine",
    maxWorkers: options.maxWorkers,
    config: options.helpers && options.helpers.length > 0 ? { helpers: options.helpers } : undefined,
    main,
    functions,
    generateWorkerScript: (task, dependencies, workerConfig) =>
      buildWorkerScript({
        helpers: workerConfig?.helpers,
        main: task,
        functions: dependencies,
        runtime: buildCoroutineWorkerRuntime(),
      }),
  });

  return {
    run: runner.run,
    close: runner.close,
    dispose: runner.dispose,
    helpers: options.helpers || [],
    main,
    functions,
  } as Coroutine<T, R> & CoroutineScript<T, R>;
}

/**
 * Creates a reusable stateless worker-backed task runner.
 *
 * The task script is baked once. Concurrent `run()` calls reuse idle workers or
 * lazily create additional workers as demand requires. Coroutine itself does
 * not impose a concurrency policy; use `group()` or `semaphore()` when work
 * should be bounded. Call `.dispose()` when done to terminate all owned workers.
 * Raw helper snippets can be provided through an optional trailing options object.
 */
export function coroutine<T, R>(
  main: CoroutineTask<T, R>,
  ...rest: CoroutineDefinitionRest
): Coroutine<T, R> & CoroutineScript<T, R>;
export function coroutine<T, R>(
  main: CoroutineTask<T, R>,
  ...rest: CoroutineDefinitionRest
): Coroutine<T, R> & CoroutineScript<T, R> {
  const last = rest[rest.length - 1];
  const hasOptions =
    typeof last === "object" &&
    last !== null &&
    typeof last !== "function" &&
    !Array.isArray(last);

  const options = (hasOptions ? last : undefined) as CoroutineOptions | undefined;
  const functions = (hasOptions ? rest.slice(0, -1) : rest) as Function[];

  return createCoroutineImpl(main, functions, options || {});
}

export type { CoroutineScript } from "../worker/types";
````

## File: projects/libraries/swiftly/src/lib/utils/select.ts
````typescript
import {
    CHANNEL_INTERNALS,
    ChannelClosedError,
    type Channel,
} from "./channel";
import { background, Context, ContextCancelledError, createAbortError } from "./context";

/**
 * Internal outcome payload used when a registered `select(...)` case wins.
 *
 * The outer `select(...)` call maps this low-level result back into the public
 * `SelectResult` shape.
 *
 * @internal
 */
export type SelectOutcome<T> = {
  index: number;
  caseRef: unknown;
  op: "receive" | "send";
  name?: string;
  value?: T;
  ok?: boolean;
};

/**
 * Internal select registration shared between `channel(...)` and `select(...)`.
 *
 * A registration owns the winner/loser state for one `select(...)` call so the
 * channel can settle exactly one branch atomically.
 *
 * @internal
 */
export type SelectRegistration<T> = {
  id: symbol;
  isSettled: () => boolean;
  settle: (outcome: SelectOutcome<T>) => boolean;
  reject: (error: Error) => boolean;
};

/**
 * Internal metadata carried with each registered channel case.
 *
 * @internal
 */
export type SelectCaseMeta = {
  index: number;
  caseRef: unknown;
  name?: string;
};

/**
 * Internal hooks exposed by a channel so `select(...)` can register atomic send
 * and receive contenders directly against the waiting queues.
 *
 * @internal
 */
export type ChannelSelectInternals<T> = {
  registerSelectReceive: (
    registration: SelectRegistration<T>,
    meta: SelectCaseMeta
  ) => () => void;
  registerSelectSend: (
    value: T,
    registration: SelectRegistration<T>,
    meta: SelectCaseMeta
  ) => () => void;
};

/**
 * Represents a `select` case that receives a value from a channel.
 *
 * @template T The type of value received from the channel.
 */
export type SelectReceiveCase<T = any> = {
  op: "receive";
  channel: Channel<T>;
  name?: string;
};

/**
 * Represents a `select` case that sends a value into a channel.
 *
 * @template T The type of value sent to the channel.
 */
export type SelectSendCase<T = any> = {
  op: "send";
  channel: Channel<T>;
  value: T;
  name?: string;
};

/**
 * Represents a default `select` case that fires when no other case is ready.
 */
export type SelectDefaultCase = {
  op: "default";
  name?: string;
};

/**
 * Represents a cancellable asynchronous operation that can participate in
 * `select(...)` alongside channel sends and receives.
 *
 * The operation receives an `AbortSignal`. When another case wins, Swiftly
 * aborts this signal so cooperative work can stop promptly.
 */
export type SelectOperationCase<T = any> = {
  op: "operation";
  run: (signal: AbortSignal) => T | Promise<T>;
  name?: string;
};

/**
 * A union of all possible `select` cases.
 *
 * @template T The selected value type.
 */
export type SelectCase<T = any> =
  | SelectReceiveCase<T>
  | SelectSendCase<T>
  | SelectOperationCase<T>
  | SelectDefaultCase;

/**
 * Result of a `select` operation indicating which case was chosen.
 *
 * @template T The channel value type.
 */
export type SelectResult<T = any> = {
  index: number;
  case: SelectCase<T>;
  op: SelectCase<T>["op"];
  name?: string;
  value?: T;
  ok?: boolean;
};

/**
 * Builds a receive case for use with `select(...)`.
 *
 * @template T The channel value type.
 * @param ch The channel to receive from.
 * @param name Optional identifier for this case.
 * @returns A `SelectReceiveCase`.
 */
export const receive = <T>(ch: Channel<T>, name?: string): SelectReceiveCase<T> => ({ op: "receive", channel: ch, name });

/**
 * Builds a send case for use with `select(...)`.
 *
 * @template T The channel value type.
 * @param ch The channel to send into.
 * @param value The value to send.
 * @param name Optional identifier for this case.
 * @returns A `SelectSendCase`.
 */
export const send = <T>(ch: Channel<T>, value: T, name?: string): SelectSendCase<T> => ({ op: "send", channel: ch, value, name });

/**
 * Builds a default case for use with `select(...)`.
 *
 * @param name Optional identifier for this case.
 * @returns A `SelectDefaultCase`.
 */
export const otherwise = (name = "default"): SelectDefaultCase => ({ op: "default", name });

/**
 * Builds a cancellable async operation for use with `select(...)`.
 *
 * The callback is started only when selection must block. If another case wins,
 * its signal is aborted. With an `otherwise(...)` case present, operations are
 * not started when no channel case is immediately ready.
 *
 * @template T The operation result type.
 * @param run Work to execute when the select blocks.
 * @param name Optional identifier for this case.
 * @returns A `SelectOperationCase`.
 */
export const operation = <T>(
  run: (signal: AbortSignal) => T | Promise<T>,
  name?: string
): SelectOperationCase<T> => ({ op: "operation", run, name });

/**
 * Waits on channel operations and cancellable async operations simultaneously,
 * returning the first contender that completes.
 *
 * Losing async operations are aborted through the signal passed to `operation(...)`.
 * If a default case is provided and no channel operation is immediately available,
 * the default case is selected without starting async operations.
 *
 * @template T The selected value type.
 * @param cases An array of receive, send, operation, or default cases.
 * @param ctx A cancellation context. Defaults to `background()`.
 * @returns A `SelectResult` describing which case was chosen and its value.
 */
/**
 * Fisher-Yates shuffle for randomizing select case evaluation order.
 */
function shuffledIndices(length: number): number[] {
  const indices = Array.from({ length }, (_, i) => i);
  for (let i = length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices;
}

export async function select<T = any>(cases: SelectCase<T>[], ctx: Context = background()): Promise<SelectResult<T>> {
  if (ctx.signal.aborted) throw createAbortError(ctx.signal);
  if (cases.length === 0) {
    throw new RangeError("select requires at least one case");
  }

  const defaultIndices = cases
    .map((item, index) => item.op === "default" ? index : -1)
    .filter((index) => index >= 0);
  if (defaultIndices.length > 1) {
    throw new RangeError("select accepts at most one default case");
  }
  const defaultIndex = defaultIndices[0] ?? -1;
  const channelIndices = cases
    .map((item, i) => ({ item, i }))
    .filter(({ item }) => item.op === "receive" || item.op === "send")
    .map(({ i }) => i);
  const randomChannelOrder = shuffledIndices(channelIndices.length).map((j) => channelIndices[j]);

  // Fast path: channel readiness can be observed without starting any work.
  for (const index of randomChannelOrder) {
    const item = cases[index];
    if (item.op === "receive") {
      const result = item.channel.tryReceive();
      if (result) {
        return { index, case: item, op: item.op, name: item.name, value: result.value, ok: result.ok };
      }
    } else if (item.op === "send") {
      if (item.channel.closed) {
        throw new ChannelClosedError();
      }
      if (item.channel.trySend(item.value)) {
        return { index, case: item, op: item.op, name: item.name, ok: true };
      }
    }
  }

  // A default branch is deliberately non-starting: arbitrary operations have
  // no side-effect-free readiness probe, so we must not launch them just to
  // discover that the default branch should win.
  if (defaultIndex >= 0) {
    const item = cases[defaultIndex];
    return { index: defaultIndex, case: item, op: item.op, name: item.name, ok: true };
  }

  const contenders = cases
    .map((item, i) => ({ item, i }))
    .filter(({ item }) => item.op !== "default");
  const randomOrder = shuffledIndices(contenders.length).map((j) => contenders[j].i);
  const selectId = Symbol("swiftly.select");
  let settled = false;
  let winnerIndex = -1;
  const cleanupFns: Array<() => void> = [];
  const operationControllers = new Map<number, AbortController>();

  const abortLosingOperations = (reason: unknown) => {
    for (const [index, controller] of operationControllers) {
      if (index !== winnerIndex && !controller.signal.aborted) {
        controller.abort(reason);
      }
    }
  };

  try {
    return await new Promise<SelectResult<T>>((resolve, reject) => {
      const settle = (result: SelectResult<T>): boolean => {
        if (settled) return false;
        settled = true;
        winnerIndex = result.index;
        abortLosingOperations(new ContextCancelledError("select case lost"));
        resolve(result);
        return true;
      };

      const rejectSelection = (error: Error, index = -1): boolean => {
        if (settled) return false;
        settled = true;
        winnerIndex = index;
        abortLosingOperations(error);
        reject(error);
        return true;
      };

      // One registration coordinates all channel contenders for this select call.
      const registration: SelectRegistration<T> = {
        id: selectId,
        isSettled: () => settled,
        settle: (outcome) =>
          settle({
            index: outcome.index,
            case: outcome.caseRef as SelectCase<T>,
            op: outcome.op,
            name: outcome.name,
            value: outcome.value,
            ok: outcome.ok,
          }),
        reject: (error) => rejectSelection(error),
      };

      const onContextAbort = () => {
        rejectSelection(createAbortError(ctx.signal));
      };

      ctx.signal.addEventListener("abort", onContextAbort, { once: true });
      cleanupFns.push(() => ctx.signal.removeEventListener("abort", onContextAbort));

      const operationStarts: Array<{
        index: number;
        item: SelectOperationCase<T>;
        controller: AbortController;
      }> = [];

      // Phase 1: register every channel contender and allocate every operation
      // controller before any operation result is allowed to settle selection.
      for (const index of randomOrder) {
        if (settled) break;

        const item = cases[index];
        if (item.op === "operation") {
          const controller = new AbortController();
          operationControllers.set(index, controller);
          operationStarts.push({ index, item, controller });
          continue;
        }

        if (item.op !== "receive" && item.op !== "send") continue;

        const internals = (item.channel as Channel<T> & {
          [CHANNEL_INTERNALS]?: ChannelSelectInternals<T>;
        })[CHANNEL_INTERNALS];

        if (!internals) {
          rejectSelection(new ContextCancelledError("channel does not support select"));
          break;
        }

        const meta = { index, caseRef: item, name: item.name };
        const unregister =
          item.op === "receive"
            ? internals.registerSelectReceive(registration, meta)
            : internals.registerSelectSend(item.value, registration, meta);
        cleanupFns.push(unregister);
      }

      if (settled) return;

      void Promise.resolve().then(() => {
        if (settled) {
          return;
        }
        if (ctx.signal.aborted) {
          rejectSelection(createAbortError(ctx.signal));
          return;
        }

        type StartedOperation = {
          index: number;
          item: SelectOperationCase<T>;
          promise: Promise<T>;
        };

        // Phase 2: invoke every operation before observing any completion. This
        // guarantees that a synchronous failure in one contender still has real
        // started siblings to cancel.
        const startedOperations: StartedOperation[] = operationStarts.map(
          ({ index, item, controller }) => {
            try {
              return {
                index,
                item,
                promise: Promise.resolve(item.run(controller.signal)),
              };
            } catch (error) {
              return {
                index,
                item,
                promise: Promise.reject(error),
              };
            }
          }
        );

        // Phase 3: observe operation completion/failure only after all contenders
        // have started.
        for (const { index, item, promise } of startedOperations) {
          void promise.then(
            (value) => {
              settle({
                index,
                case: item,
                op: item.op,
                name: item.name,
                value,
                ok: true,
              });
            },
            (error) => {
              rejectSelection(
                error instanceof Error
                  ? error
                  : new Error(error ? String(error) : "select operation failed"),
                index
              );
            }
          );
        }
      });
    });
  } finally {
    while (cleanupFns.length > 0) {
      cleanupFns.pop()!();
    }
    abortLosingOperations(new ContextCancelledError("select completed"));
  }
}
````

## File: projects/libraries/swiftly/src/lib/utils/transfer.ts
````typescript
/**
 * Per-submission worker execution controls.
 *
 * `transfer` moves ownership of transferable values to the worker instead of
 * cloning them. Existing `AbortSignal` call sites remain supported directly.
 */
export type TaskRunOptions = {
  signal?: AbortSignal;
  transfer?: readonly Transferable[];
};

/** Accepted second argument for worker-backed task execution. */
export type TaskRunControl = AbortSignal | TaskRunOptions | undefined;

/** Marker returned by worker task utilities when a result should be transferred. */
export type TransferResult<T> = {
  readonly __transferResult: true;
  readonly value: T;
  readonly transfer: readonly Transferable[];
};

/** A worker task may return a normal value or explicitly transfer its result. */
export type WorkerTaskResult<T> = T | TransferResult<T>;

/** Utilities injected as the second argument of coroutine task functions. */
export interface WorkerTaskUtils {
  /**
   * Transfers ownership of one or more transferable objects with the task result.
   * The caller receives `value`; the transfer wrapper itself never leaves the worker.
   */
  transfer<T>(value: T, ...transferables: Transferable[]): TransferResult<T>;
}
````

## File: projects/libraries/swiftly/src/lib/worker/script.ts
````typescript
import type { CoroutineScript } from "./types";

/**
 * Internal bootstrap required by transpiled async/generator code inside worker
 * tasks and injected helper functions.
 */
const ASYNC_WORKER_BOOTSTRAP = `var __defProp=Object.defineProperty,__defProps=Object.defineProperties,__getOwnPropDescs=Object.getOwnPropertyDescriptors,__getOwnPropSymbols=Object.getOwnPropertySymbols,__hasOwnProp=Object.prototype.hasOwnProperty,__propIsEnum=Object.prototype.propertyIsEnumerable,__knownSymbol=(r,e)=>(e=Symbol[r])?e:Symbol.for("Symbol."+r),__defNormalProp=(r,e,o)=>e in r?__defProp(r,e,{enumerable:!0,configurable:!0,writable:!0,value:o}):r[e]=o,__spreadValues=(r,e)=>{for(var o in e||={})__hasOwnProp.call(e,o)&&__defNormalProp(r,o,e[o]);if(__getOwnPropSymbols)for(var o of __getOwnPropSymbols(e))__propIsEnum.call(e,o)&&__defNormalProp(r,o,e[o]);return r},__spreadProps=(r,e)=>__defProps(r,__getOwnPropDescs(e)),__async=(r,e,o)=>new Promise((t,n)=>{var a=r=>{try{s(o.next(r))}catch(e){n(e)}},p=r=>{try{s(o.throw(r))}catch(e){n(e)}},s=r=>r.done?t(r.value):Promise.resolve(r.value).then(a,p);s((o=o.apply(r,e)).next())}),__await=function(r,e){this[0]=r,this[1]=e},__asyncGenerator=(r,e,o)=>{var t=(r,e,n,a)=>{try{var p=o[r](e),s=(e=p.value)instanceof __await,l=p.done;Promise.resolve(s?e[0]:e).then(o=>s?t("return"===r?r:"next",e[1]?{done:o.done,value:o.value}:o,n,a):n({value:o,done:l})).catch(r=>t("throw",r,n,a))}catch(y){a(y)}},n=r=>a[r]=e=>new Promise((o,n)=>t(r,e,o,n)),a={};return o=o.apply(r,e),a[__knownSymbol("asyncIterator")] =()=>a,n("next"),n("throw"),n("return"),a};`;

const TRANSFER_WORKER_BOOTSTRAP = `
const __workerUtils = Object.freeze({
  transfer(value, ...transferables) {
    const seen = new Set();
    for (const item of transferables) {
      if (seen.has(item)) {
        throw new TypeError("transfer list contains the same transferable more than once");
      }
      seen.add(item);
    }

    return {
      __transferResult: true,
      value,
      transfer: transferables,
    };
  },
});`;

const NAMED_FUNCTION_DECLARATION_RE =
  /^(async\s+)?function(?:\s+[A-Za-z_$][\w$]*)\s*\(/;
const METHOD_SHORTHAND_RE =
  /^(async\s+)?([A-Za-z_$][\w$]*)\s*\(/;

const normalizeCallableSource = (fn: Function): string => {
  const source = fn.toString().trim();

  if (source.startsWith("function") || source.startsWith("async function")) {
    return source;
  }

  const methodMatch = METHOD_SHORTHAND_RE.exec(source);
  if (!methodMatch) {
    return source;
  }

  const [, asyncPrefix = "", name] = methodMatch;
  return source.replace(
    METHOD_SHORTHAND_RE,
    `${asyncPrefix}function ${name}(`,
  );
};

const serializeDependencyFunction = (fn: Function, index: number): string => {
  const source = normalizeCallableSource(fn);
  if (NAMED_FUNCTION_DECLARATION_RE.test(source)) {
    return source;
  }

  const bindingName = fn.name || `__helper${index}`;
  return `const ${bindingName} = ${source};`;
};

/**
 * Serializes helper and task functions for worker-script injection.
 */
export function serializeFunction(fn: Function): string {
  return normalizeCallableSource(fn);
}

/**
 * Derives the string representation of a `CoroutineScript` from its
 * function source(s).  This is the single source-of-truth for how
 * `main` and `functions` are turned into worker-transmittable code.
 */
export function serializeScript<T, R>(script: CoroutineScript<T, R>): {
  code: string;
  deps: string[];
} {
  return {
    code: script.main.toString(),
    deps: (script.functions || []).map((f, index) =>
      serializeDependencyFunction(f, index),
    ),
  };
}

const joinScriptSections = (sections: string[]): string =>
  sections
    .map((section) => section.trim())
    .filter((section) => section.length > 0)
    .join("\n\n");

/**
 * Builds a worker script from:
 * - internal async bootstrap
 * - user-supplied helper snippets
 * - serialized helper functions
 * - the main task function
 * - the runtime wrapper
 *
 * The generated blob is executed as an ES module worker. Native module syntax
 * inside serialized task code, including absolute dynamic `import()`, is left
 * untouched and resolved by the browser.
 */
export function buildWorkerScript({
  helpers,
  main,
  functions,
  runtime,
}: {
  helpers?: string[];
  main: Function;
  functions: Function[];
  runtime: string;
}): string {
  const helperSections = [ASYNC_WORKER_BOOTSTRAP, TRANSFER_WORKER_BOOTSTRAP, ...(helpers || [])];
  const dependencySection = functions
    .map((fn, index) => serializeDependencyFunction(fn, index))
    .join("\n");
  const mainSection = `const __mainTask = ${serializeFunction(main)};`;

  return joinScriptSections([
    ...helperSections,
    dependencySection,
    mainSection,
    runtime,
  ]);
}
````

## File: package.json
````json
{
  "name": "swiftly",
  "version": "1.0.1",
  "scripts": {
    "ng": "ng",
    "start": "ng serve app1",
    "build": "ng build app1 && ng build swiftly",
    "build:app": "ng build app1",
    "build:lib": "ng build swiftly",
    "watch": "ng build app1 --watch --configuration development",
    "test": "ng test app1",
    "test:app": "ng test app1",
    "test:lib": "testify"
  },
  "private": true,
  "packageManager": "npm@10.9.8",
  "dependencies": {
    "@angular/common": "^22.0.0",
    "@angular/compiler": "^22.0.0",
    "@angular/core": "^22.0.0",
    "@angular/forms": "^22.0.0",
    "@angular/platform-browser": "^22.0.0",
    "@angular/router": "^22.0.0",
    "@epikodelabs/testify": "^1.0.36",
    "fflate": "^0.8.3",
    "rxjs": "~7.8.0",
    "tslib": "^2.3.0"
  },
  "devDependencies": {
    "@angular/build": "^22.0.8",
    "@angular/cli": "^22.0.8",
    "@angular/compiler-cli": "^22.0.0",
    "@types/jasmine": "^5.1.0",
    "ng-packagr": "^22.0.0",
    "prettier": "^3.8.1",
    "typescript": "~6.0.2"
  }
}
````

## File: README.md
````markdown
# Swiftly

Concurrent JavaScript built around workers, structured task ownership, channels, actors, and cancellation.

Swiftly treats concurrency as a programming model rather than exposing Web Workers as application infrastructure. Worker-backed computation, coordination, cancellation, and long-lived actors share one small set of primitives.

For a concept-by-concept guide to ownership, boundaries, and when to use each primitive, see [`CONCEPTS.md`](./CONCEPTS.md).

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

The number `4` is the only concurrency policy in this example. The group owns a
FIFO admission queue: at most four children execute at once, and queued child
operations have not called `hash.run()` yet. Therefore at most four hash calls
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
await result.catch(() => undefined);

// Equivalent options form, also used when transferring ownership.
const otherController = new AbortController();
const otherResult = parse.run(source, { signal: otherController.signal });
otherController.abort();
await otherResult.catch(() => undefined);
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
  if (message.kind === 'actor-bus' && message.topic === 'inc') return state + 1;
  return state;
}, 0);

const value = await main.outbox.request(counter, 'inc', undefined);
await main.outbox.stop(counter);

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

await main.outbox.request(service, "refresh", undefined);
await main.outbox.stop(service);

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
await result.catch(() => undefined);
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
const workers = group();
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

      const result = await process(next.value, signal);
      await output.send(result, signal);
    }
  });
}

await Promise.all(inputs.map((job) => input.send(job)));
input.close();

try {
  await workers.wait();
} finally {
  output.close();
}

const results = await consume;
```

The composition remains explicit: channel capacity bounds data in flight,
the number of spawned workers bounds parallel processing, `group()` owns worker
lifetime and failure propagation, and coroutine owns only worker execution and
reuse.


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

`dispose()` means **terminate now**. Active work is rejected and worker resources
are released immediately. Worker-script blob URLs are acquired
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
post where Swiftly owns the list. A submission transfers its objects only when
it is posted to a worker, so cancellation before worker execution leaves its
transferables owned by the caller.

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

Coroutine workers are regression-tested for lifecycle pressure: graceful close
allows already-admitted active work to finish, while `dispose()` may escalate an
in-progress close and settle the close promise without stranding callers.


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

Stress coverage exercises repeated select cancellation, context cancellation
chains, and mass timer cancellation to verify that cancellation leaves no channel
waiters or timer workers behind.


## Timer host isolation

The shared timer runtime binds its cached worker to the host `Worker`
constructor that created it. If the host changes while the timer runtime is
idle—for example between isolated browser test environments—the old worker is
discarded rather than reused across environments.

Test worker mocks implement the same `set` / `clear` timer protocol as the real
timer worker, so actor restart delays, context timeouts, and direct timer tests
exercise the same scheduling semantics.
````

## File: projects/libraries/swiftly/src/lib/utils/group.ts
````typescript
import { createAbortError, ContextCancelledError } from "./context";

/**
 * One unit of structured asynchronous work owned by a task group.
 *
 * The supplied signal is aborted when the group is cancelled or when a sibling
 * fails. Operations are expected to pass it to cancellable work they start.
 */
export type GroupOperation<T> = (signal: AbortSignal) => T | Promise<T>;

/** Options controlling a structured task group. */
export type GroupOptions = {
  /** Maximum number of child operations allowed to execute at once. */
  concurrency?: number;
  /** Optional parent signal. Aborting it cancels the whole group. */
  signal?: AbortSignal;
};

/** Terminal outcome of one child, ordered by spawn order in a group report. */
export type GroupOutcome<T = unknown> =
  | { readonly status: "fulfilled"; readonly value: T }
  | { readonly status: "rejected"; readonly error: Error }
  | { readonly status: "cancelled"; readonly reason: Error };

/**
 * Non-throwing structured completion report.
 *
 * `error` is the group-level reason that `wait()` would throw: the first child
 * failure, explicit cancellation, or parent cancellation.
 */
export interface GroupReport {
  readonly outcomes: readonly GroupOutcome[];
  readonly error?: Error;
}

/**
 * Structured owner for a dynamic set of concurrent operations.
 *
 * Every accepted child is owned immediately. With bounded concurrency, excess
 * children wait in the group's FIFO queue and their operation does not start
 * until an execution slot becomes free.
 *
 * A group has fail-fast semantics: the first child failure aborts running
 * siblings and cancels queued children before they start. `wait()` and
 * `settle()` both close the group to new children and wait until every accepted
 * child has settled.
 */
export interface TaskGroup {
  /** Signal shared by all children and aborted when the group is cancelled. */
  readonly signal: AbortSignal;
  /**
   * Number of accepted children that have not settled yet.
   *
   * This includes both actively executing and queued children.
   */
  readonly running: number;
  /** Whether new child operations may still be accepted. */
  readonly accepting: boolean;

  /** Accepts one child operation owned by this group. */
  spawn<T>(operation: GroupOperation<T>): Promise<T>;

  /** Cancels this group and every cooperative child operation. */
  cancel(reason?: unknown): void;

  /**
   * Closes the group and waits until every accepted child settles.
   * Rejects with the group-level failure/cancellation reason.
   */
  wait(): Promise<void>;

  /**
   * Closes the group and waits until every accepted child settles without
   * throwing. Outcomes are returned in spawn order.
   */
  settle(): Promise<GroupReport>;
}

type GroupWaiter = {
  resolve: (report: GroupReport) => void;
};

type QueuedChild = {
  operation: GroupOperation<any>;
  outcomeIndex: number;
  resolve: (value: any) => void;
  reject: (error: Error) => void;
};

const normalizeError = (reason: unknown): Error => {
  if (reason instanceof Error) return reason;
  if (reason === undefined) return new ContextCancelledError("task group cancelled");
  return new ContextCancelledError(String(reason));
};

/**
 * Creates a structured task group.
 *
 * This is intentionally different from `Promise.all()`: the group owns child
 * lifetime, propagates cancellation, cancels siblings on failure, queues excess
 * bounded work itself, and can report the terminal state of every owned child.
 */
export function group(options: GroupOptions = {}): TaskGroup {
  const { concurrency, signal: parentSignal } = options;

  if (concurrency !== undefined && (!Number.isInteger(concurrency) || concurrency <= 0)) {
    throw new RangeError("group concurrency must be a positive integer");
  }

  const controller = new AbortController();
  const limit = concurrency ?? Number.POSITIVE_INFINITY;
  const queue: QueuedChild[] = [];
  const waiters: GroupWaiter[] = [];
  const outcomes: Array<GroupOutcome | undefined> = [];

  let active = 0;
  let running = 0;
  let accepting = true;
  let settlementRequested = false;
  let firstError: Error | undefined;
  let finalReport: GroupReport | undefined;

  const groupError = (): Error | undefined =>
    firstError ??
    (controller.signal.aborted ? createAbortError(controller.signal) : undefined);

  const createReport = (): GroupReport => {
    if (finalReport) return finalReport;
    finalReport = Object.freeze({
      outcomes: Object.freeze(
        outcomes.map((outcome) => {
          if (!outcome) {
            throw new Error("task group settled with an incomplete child outcome");
          }
          return outcome;
        }),
      ),
      error: groupError(),
    });
    return finalReport;
  };

  const settleWaiters = (): void => {
    if (running !== 0 || waiters.length === 0) return;

    const report = createReport();
    const settled = waiters.splice(0, waiters.length);
    for (const waiter of settled) waiter.resolve(report);
  };

  const onParentAbort = (): void => cancel(parentSignal?.reason);
  let parentListenerAttached = false;
  const detachParent = (): void => {
    if (!parentListenerAttached) return;
    parentSignal?.removeEventListener("abort", onParentAbort);
    parentListenerAttached = false;
  };

  const finishOwnedChild = (): void => {
    running -= 1;
    if (!accepting && running === 0) detachParent();
    settleWaiters();
  };

  const cancelQueued = (): void => {
    if (queue.length === 0) return;

    const reason = normalizeError(controller.signal.reason);
    const cancelled = queue.splice(0, queue.length);
    for (const child of cancelled) {
      outcomes[child.outcomeIndex] = { status: "cancelled", reason };
      child.reject(reason);
      finishOwnedChild();
    }
  };

  const cancel = (
    reason: unknown = new ContextCancelledError("task group cancelled"),
  ): void => {
    accepting = false;
    if (!controller.signal.aborted) controller.abort(reason);
    cancelQueued();
    if (running === 0) detachParent();
    settleWaiters();
  };

  if (parentSignal?.aborted) {
    onParentAbort();
  } else if (parentSignal) {
    parentSignal.addEventListener("abort", onParentAbort, { once: true });
    parentListenerAttached = true;
  }

  const fail = (error: Error, outcomeIndex: number): void => {
    if (firstError || controller.signal.aborted) return;

    firstError = error;
    accepting = false;
    outcomes[outcomeIndex] = { status: "rejected", error };
    controller.abort(error);
    cancelQueued();
  };

  const pump = (): void => {
    while (
      active < limit &&
      queue.length > 0 &&
      !controller.signal.aborted
    ) {
      const child = queue.shift()!;
      active += 1;

      void (async () => {
        try {
          const value = await child.operation(controller.signal);
          outcomes[child.outcomeIndex] = { status: "fulfilled", value };
          child.resolve(value);
        } catch (reason) {
          const error = normalizeError(reason);
          const alreadyCancelled = controller.signal.aborted;

          if (!firstError && !alreadyCancelled) {
            fail(error, child.outcomeIndex);
          } else {
            const cancellationReason = normalizeError(
              controller.signal.reason ?? error,
            );
            outcomes[child.outcomeIndex] = {
              status: "cancelled",
              reason: cancellationReason,
            };
          }

          child.reject(error);
        } finally {
          active -= 1;
          finishOwnedChild();
          pump();
        }
      })();
    }
  };

  const spawn = <T>(operation: GroupOperation<T>): Promise<T> => {
    if (typeof operation !== "function") {
      return Promise.reject(new TypeError("group operation must be a function"));
    }
    if (settlementRequested) {
      return Promise.reject(new Error("task group is closed"));
    }
    if (controller.signal.aborted) {
      return Promise.reject(createAbortError(controller.signal));
    }
    if (!accepting) {
      return Promise.reject(new Error("task group is closed"));
    }

    const outcomeIndex = outcomes.length;
    outcomes.push(undefined);
    running += 1;

    const child = new Promise<T>((resolve, reject) => {
      queue.push({
        operation,
        outcomeIndex,
        resolve,
        reject,
      });
      pump();
    });

    // The group owns child failures even when callers choose to observe only
    // wait()/settle(). The returned promise still preserves the child result.
    void child.catch(() => undefined);
    return child;
  };

  const settle = (): Promise<GroupReport> => {
    settlementRequested = true;
    accepting = false;

    if (running === 0) {
      detachParent();
      return Promise.resolve(createReport());
    }

    return new Promise<GroupReport>((resolve) => {
      waiters.push({ resolve });
    });
  };

  const wait = async (): Promise<void> => {
    const report = await settle();
    if (report.error) throw report.error;
  };

  return {
    get signal() {
      return controller.signal;
    },
    get running() {
      return running;
    },
    get accepting() {
      return accepting;
    },
    spawn,
    cancel,
    wait,
    settle,
  };
}
````

## File: projects/libraries/swiftly/src/lib/worker/timer.ts
````typescript
import { acquireBlobUrl, releaseBlobUrl } from "./blob";
import { createModuleWorker } from "./module";

const TIMER_WORKER_SCRIPT = `
const timers = new Map();

self.onmessage = ({ data }) => {
  if (!data || typeof data !== "object") return;

  if (data.type === "set") {
    const handle = setTimeout(() => {
      timers.delete(data.id);
      self.postMessage({ type: "elapsed", id: data.id });
    }, data.ms);

    timers.set(data.id, handle);
    return;
  }

  if (data.type === "clear") {
    const handle = timers.get(data.id);
    if (handle !== undefined) {
      clearTimeout(handle);
      timers.delete(data.id);
    }
  }
};
`;

type PendingTimer = {
  elapsed: () => void;
  failed: (error: Error) => void;
};

let worker: Worker | undefined;
let workerConstructor: typeof Worker | undefined;
let nextTimerId = 0;
const pending = new Map<number, PendingTimer>();

const createHostTimer = (
  ms: number,
  elapsed: () => void,
): WorkerTimer => {
  let pending = true;
  const handle = setTimeout(() => {
    if (!pending) return;
    pending = false;
    elapsed();
  }, ms);

  return {
    cancel(): boolean {
      if (!pending) return false;
      pending = false;
      clearTimeout(handle);
      return true;
    },
  };
};

const normalizeWorkerError = (event: ErrorEvent): Error =>
  event.error instanceof Error
    ? event.error
    : new Error(event.message || "timer worker failed");

const releaseWorkerIfIdle = (): void => {
  if (!worker || pending.size !== 0) return;

  worker.terminate();
  worker = undefined;
  workerConstructor = undefined;
  releaseBlobUrl(TIMER_WORKER_SCRIPT);
};

const failPendingTimers = (error: Error): void => {
  const timers = [...pending.values()];
  pending.clear();

  worker?.terminate();
  worker = undefined;
  workerConstructor = undefined;
  releaseBlobUrl(TIMER_WORKER_SCRIPT);

  let callbackError: unknown;
  for (const timer of timers) {
    try {
      timer.failed(error);
    } catch (reason) {
      callbackError ??= reason;
    }
  }

  if (callbackError !== undefined) {
    queueMicrotask(() => {
      throw callbackError;
    });
  }
};

const ensureTimerWorker = (): Worker => {
  if (typeof Worker === "undefined") {
    throw new Error("worker-backed timers require Web Worker support");
  }

  if (worker) {
    if (workerConstructor === Worker) {
      return worker;
    }

    // The host Worker implementation changed (common in isolated browser tests).
    // Reusing a worker created by a previous host would cross environment
    // boundaries. Only an idle worker may be replaced safely.
    if (pending.size !== 0) {
      throw new Error("timer worker host changed while timers are pending");
    }

    worker.terminate();
    worker = undefined;
    workerConstructor = undefined;
    releaseBlobUrl(TIMER_WORKER_SCRIPT);
  }

  const blobUrl = acquireBlobUrl(TIMER_WORKER_SCRIPT);

  let createdWorker: Worker;
  try {
    createdWorker = createModuleWorker(blobUrl);
    worker = createdWorker;
    workerConstructor = Worker;
  } catch (error) {
    releaseBlobUrl(TIMER_WORKER_SCRIPT);
    throw error;
  }

  createdWorker.onmessage = ({ data }: MessageEvent<{ type?: string; id?: number }>) => {
    if (worker !== createdWorker) return;
    if (data?.type !== "elapsed" || typeof data.id !== "number") return;

    const timer = pending.get(data.id);
    if (!timer) return;

    pending.delete(data.id);
    try {
      timer.elapsed();
    } finally {
      releaseWorkerIfIdle();
    }
  };

  createdWorker.onerror = (event) => {
    if (worker !== createdWorker) return;
    failPendingTimers(normalizeWorkerError(event));
  };

  return createdWorker;
};

export type WorkerTimer = {
  /** Cancels the timer. Returns true only when it was still pending. */
  cancel(): boolean;
};

/**
 * Schedules one timeout on Swiftly's shared timer worker.
 *
 * Concurrent timers share one worker. The worker is terminated automatically
 * when the last outstanding timer settles or is cancelled.
 */
export function scheduleWorkerTimer(
  ms: number,
  elapsed: () => void,
  failed: (error: Error) => void = () => {},
): WorkerTimer {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new RangeError("timer duration must be a finite non-negative number");
  }

  if (typeof Worker === "undefined") {
    return createHostTimer(ms, elapsed);
  }

  const timerWorker = ensureTimerWorker();
  const id = ++nextTimerId;
  pending.set(id, { elapsed, failed });

  try {
    timerWorker.postMessage({ type: "set", id, ms });
  } catch (error) {
    pending.delete(id);
    releaseWorkerIfIdle();
    throw error;
  }

  return {
    cancel(): boolean {
      if (!pending.delete(id)) return false;

      try {
        timerWorker.postMessage({ type: "clear", id });
      } catch (error) {
        // A failed post means this worker can no longer be trusted for the
        // remaining timers. Fail them coherently instead of stranding them.
        if (worker === timerWorker) {
          failPendingTimers(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      } finally {
        releaseWorkerIfIdle();
      }
      return true;
    },
  };
}
````

## File: projects/libraries/swiftly/src/tests/compose.spec.ts
````typescript
import { compose, coroutine, type TaskRunControl } from "../public-api";

describe("compose coroutines", () => {
  it("should process tasks sequentially via run", async () => {
    const c1 = coroutine((x: number) => x + 1);
    const c2 = coroutine((x: number) => x * 2);

    const composed = compose(c1, c2);

    const result = await composed.run(3); // (3 + 1) * 2
    expect(result).toBe(8);

    await composed.dispose();
  });

  it("should process tasks sequentially in a stream", async () => {
    const c1 = coroutine((x: number) => x + 1);
    const c2 = coroutine((x: number) => x * 2);

    const stream = (async function* () {
      yield 1;
      yield 2;
      yield 3;
    })();

    const composed = compose(c1, c2);

    const results: number[] = [];
    for await (const v of stream) {
      results.push(await composed.run(v));
    }

    // (1+1)*2 = 4, (2+1)*2 = 6, (3+1)*2 = 8
    expect(results).toEqual([4, 6, 8]);

    await composed.dispose();
  });

  it("should await async coroutine stages before passing values to the next stage", async () => {
    const c1 = coroutine(async (x: number) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return x + 1;
    });
    const c2 = coroutine((x: number) => x * 2);

    const composed = compose(c1, c2);

    const result = await composed.run(3);
    expect(result).toBe(8);

    await composed.dispose();
  });

  it("should propagate errors from inner coroutine", async () => {
    const c1 = coroutine((x: number) => x + 1);
    const c2 = coroutine((x: number) => {
      if (x === 2) throw new Error("boom");
      return x * 2;
    });

    const composed = compose(c1, c2);

    try {
      await composed.run(1); // (1+1) => 2, then boom
      fail("Expected error to be thrown");
    } catch (err: any) {
      expect(err.message).toBe("boom");
    }

    await composed.dispose();
  });

  it("should dispose all tasks", async () => {
    const finalized: string[] = [];

    const c1 = {
      run: async (x: number) => x + 1,
      dispose: async () => finalized.push("c1"),
    } as any;
    const c2 = {
      run: async (x: number) => x * 2,
      dispose: async () => finalized.push("c2"),
    } as any;

    const composed = compose(c1, c2);

    const result = await composed.run(5);
    expect(result).toBe(12);

    await composed.dispose();
    expect(finalized).toEqual(["c1", "c2"]);
  });

  it("should handle empty composes gracefully", async () => {
    const composed = compose(); // no tasks
    const result = await composed.run(42);

    expect(result).toBe(42);

    await composed.dispose();
  });

  it("passes through values when no tasks are provided", async () => {
    const stream = (async function* () {
      yield 1;
      yield 2;
    })();

    const passThrough = compose();
    const results: number[] = [];
    for await (const v of stream) {
      results.push(await passThrough.run(v));
    }

    expect(results).toEqual([1, 2]);
  });

  it("should dispose every task even when one finalizer throws", async () => {
    const finalized: string[] = [];

    const composed = compose(
      {
        run: async (x: number) => x + 1,
        dispose: async () => {
          finalized.push("c1");
          throw new Error("boom");
        },
      } as any,
      {
        run: async (x: number) => x * 2,
        dispose: async () => {
          finalized.push("c2");
        },
      } as any
    );

    await expectAsync(composed.dispose()).toBeRejectedWithError("boom");
    expect(finalized).toEqual(["c1", "c2"]);
  });

  it("forwards cancellation to every runner stage", async () => {
    const seenSignals: AbortSignal[] = [];
    const first = {
      run: async (value: number, control?: TaskRunControl) => {
        const signal = control instanceof AbortSignal ? control : control?.signal;
        if (signal) seenSignals.push(signal);
        return value + 1;
      },
      close: async () => undefined,
      dispose: async () => undefined,
    };
    const second = {
      run: async (value: number, control?: TaskRunControl) => {
        const signal = control instanceof AbortSignal ? control : control?.signal;
        if (signal) seenSignals.push(signal);
        return value * 2;
      },
      close: async () => undefined,
      dispose: async () => undefined,
    };

    const controller = new AbortController();
    const composed = compose(first, second);
    await expectAsync(composed.run(3, controller.signal)).toBeResolvedTo(8);

    expect(seenSignals).toEqual([controller.signal, controller.signal]);
    await composed.dispose();
  });


  it("close drains and closes every composed runner", async () => {
    const lifecycle: string[] = [];
    const first = {
      run: async (value: number) => value + 1,
      close: async () => { lifecycle.push("close:first"); },
      dispose: async () => { lifecycle.push("dispose:first"); },
    };
    const second = {
      run: async (value: number) => value * 2,
      close: async () => { lifecycle.push("close:second"); },
      dispose: async () => { lifecycle.push("dispose:second"); },
    };

    const composed = compose(first, second);
    expect(await composed.run(2)).toBe(6);

    await composed.close();
    expect(lifecycle).toEqual(["close:first", "close:second"]);
  });

  it("close attempts every composed runner even when one close fails", async () => {
    const lifecycle: string[] = [];
    const composed = compose(
      {
        run: async (value: number) => value,
        close: async () => {
          lifecycle.push("first");
          throw new Error("close failed");
        },
        dispose: async () => undefined,
      },
      {
        run: async (value: number) => value,
        close: async () => {
          lifecycle.push("second");
        },
        dispose: async () => undefined,
      },
    );

    await expectAsync(composed.close()).toBeRejectedWithError("close failed");
    expect(lifecycle).toEqual(["first", "second"]);
  });


  it("applies an input transfer list only to the first composed runner", async () => {
    const controls: TaskRunControl[] = [];
    const first = {
      run: async (value: ArrayBuffer, control?: TaskRunControl) => {
        controls.push(control);
        return value;
      },
      close: async () => undefined,
      dispose: async () => undefined,
    };
    const second = {
      run: async (value: ArrayBuffer, control?: TaskRunControl) => {
        controls.push(control);
        return value.byteLength;
      },
      close: async () => undefined,
      dispose: async () => undefined,
    };

    const controller = new AbortController();
    const buffer = new ArrayBuffer(8);
    const composed = compose(first, second);
    await expectAsync(
      composed.run(buffer, { signal: controller.signal, transfer: [buffer] }),
    ).toBeResolvedTo(8);

    expect((controls[0] as any).transfer).toEqual([buffer]);
    expect((controls[0] as any).signal).toBe(controller.signal);
    expect(controls[1]).toBe(controller.signal);
    await composed.dispose();
  });

  it("keeps transfer ownership inside merged coroutine stages and returns only the final value", async () => {
    const first = coroutine<ArrayBuffer, ArrayBuffer>((buffer, { transfer }) => {
      new Uint8Array(buffer)[0] += 1;
      return transfer(buffer, buffer);
    });
    const second = coroutine<ArrayBuffer, ArrayBuffer>((buffer, { transfer }) => {
      new Uint8Array(buffer)[0] += 1;
      return transfer(buffer, buffer);
    });
    const composed = compose(first, second);

    const input = new ArrayBuffer(4);
    new Uint8Array(input)[0] = 40;
    const output = await composed.run(input, { transfer: [input] });

    expect(input.byteLength).toBe(0);
    expect(output.byteLength).toBe(4);
    expect(new Uint8Array(output)[0]).toBe(42);

    await composed.dispose();
    await first.dispose();
    await second.dispose();
  });

  it("supports arrow-function helpers inside merged coroutine stages", async () => {
    const addOne = (value: number) => value + 1;
    const double = (value: number) => value * 2;

    const first = coroutine((value: number) => addOne(value), addOne);
    const second = coroutine((value: number) => double(value), double);
    const composed = compose(first, second);

    await expectAsync(composed.run(3)).toBeResolvedTo(8);

    await composed.dispose();
    await first.dispose();
    await second.dispose();
  });


  it("close drains the entire admitted pipeline before closing any stage", async () => {
    const lifecycle: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = {
      run: async (value: number) => {
        lifecycle.push("run:first");
        await firstGate;
        return value + 1;
      },
      close: async () => {
        lifecycle.push("close:first");
      },
      dispose: async () => {
        lifecycle.push("dispose:first");
      },
    };
    const second = {
      run: async (value: number) => {
        lifecycle.push("run:second");
        return value * 2;
      },
      close: async () => {
        lifecycle.push("close:second");
      },
      dispose: async () => {
        lifecycle.push("dispose:second");
      },
    };

    const composed = compose(first, second);
    const admitted = composed.run(2);
    await Promise.resolve();

    const closing = composed.close();

    await expectAsync(composed.run(3)).toBeRejectedWithError("compose is closed");
    expect(lifecycle).toEqual(["run:first"]);

    releaseFirst();

    await expectAsync(admitted).toBeResolvedTo(6);
    await expectAsync(closing).toBeResolved();
    expect(lifecycle).toEqual([
      "run:first",
      "run:second",
      "close:first",
      "close:second",
    ]);
  });

  it("dispose settles a concurrent graceful close and rejects unfinished pipeline work", async () => {
    let rejectActive!: (error: Error) => void;
    const lifecycle: string[] = [];

    const first = {
      run: () =>
        new Promise<number>((_resolve, reject) => {
          rejectActive = reject;
        }),
      close: async () => {
        lifecycle.push("close:first");
      },
      dispose: async () => {
        lifecycle.push("dispose:first");
        rejectActive(new Error("disposed active pipeline"));
      },
    };
    const second = {
      run: async (value: number) => value,
      close: async () => {
        lifecycle.push("close:second");
      },
      dispose: async () => {
        lifecycle.push("dispose:second");
      },
    };

    const composed = compose(first, second);
    const active = composed.run(1);
    active.catch(() => undefined);

    const closing = composed.close();
    await composed.dispose();

    await expectAsync(active).toBeRejectedWithError("disposed active pipeline");
    await expectAsync(closing).toBeResolved();
    expect(lifecycle).toEqual(["dispose:first", "dispose:second"]);
  });


});
````

## File: projects/libraries/swiftly/src/lib/utils/context.ts
````typescript
import { scheduleWorkerTimer } from "../worker/timer";

/**
 * Thrown when a context is cancelled or times out.
 */
export class ContextCancelledError extends Error {
  constructor(message = "context cancelled") {
    super(message);
    this.name = "ContextCancelledError";
  }
}

/**
 * Cancellation scope used by Swiftly coordination primitives.
 *
 * A context carries only lifecycle state: its `AbortSignal`, completion promise,
 * and terminal reason. Application data should be passed explicitly through
 * ordinary JavaScript values rather than hidden in the cancellation tree.
 */
export type Context = {
  /** Abort signal that becomes aborted when the context is cancelled. */
  readonly signal: AbortSignal;
  /** Promise that resolves when the context is cancelled. */
  readonly done: Promise<void>;
  /** The cancellation reason, if any. */
  readonly reason: unknown;
};

/**
 * Function that cancels a context, optionally supplying a reason.
 */
export type Cancel = (reason?: unknown) => void;

/**
 * Creates an abort error from an `AbortSignal`'s reason.
 */
export const createAbortError = (signal?: AbortSignal): Error => {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  return new ContextCancelledError(reason ? String(reason) : undefined);
};

const createContext = (controller: AbortController): Context => {
  const signal = controller.signal;
  const done = new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
    } else {
      signal.addEventListener("abort", () => resolve(), { once: true });
    }
  });

  return {
    signal,
    done,
    get reason() {
      return signal.reason;
    },
  };
};

const backgroundContext = createContext(new AbortController());

/**
 * Returns Swiftly's immutable root cancellation context.
 *
 * The background context never cancels, so one shared instance avoids creating
 * an AbortController and never-settling completion promise for every default
 * coordination call.
 */
export const background = (): Context => backgroundContext;

/**
 * Derives a cancellable child context from a parent.
 *
 * The child is automatically cancelled when the parent is cancelled.
 */
export function withCancel(parent: Context = background()): [Context, Cancel] {
  const controller = new AbortController();
  const onParentAbort = () =>
    controller.abort(parent.reason ?? new ContextCancelledError());

  if (parent.signal.aborted) {
    onParentAbort();
  } else {
    parent.signal.addEventListener("abort", onParentAbort, { once: true });
  }

  const ctx = createContext(controller);
  const cancel: Cancel = (reason = new ContextCancelledError()) => {
    parent.signal.removeEventListener("abort", onParentAbort);
    if (!controller.signal.aborted) controller.abort(reason);
  };

  return [ctx, cancel];
}

/**
 * Derives a child context that automatically cancels after a timeout.
 */
export function withTimeout(parent: Context, ms: number): [Context, Cancel] {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new RangeError("timer duration must be a finite non-negative number");
  }

  const [ctx, cancel] = withCancel(parent);

  try {
    const timer = scheduleWorkerTimer(
      ms,
      () => cancel(new ContextCancelledError(`context timeout after ${ms}ms`)),
      (error) => cancel(error),
    );
    ctx.done.finally(() => timer.cancel());
    return [ctx, cancel];
  } catch (error) {
    cancel(error);
    throw error;
  }
}

/**
 * Derives a child context that automatically cancels at a specific deadline.
 */
export function withDeadline(
  parent: Context,
  deadline: Date | number,
): [Context, Cancel] {
  const time = typeof deadline === "number" ? deadline : deadline.getTime();
  const remaining = time - Date.now();

  if (remaining <= 0) {
    const [ctx, cancel] = withCancel(parent);
    cancel(new ContextCancelledError("context deadline exceeded"));
    return [ctx, cancel];
  }

  return withTimeout(parent, remaining);
}
````

## File: projects/libraries/swiftly/src/lib/worker/runtimes.ts
````typescript
/**
 * Standard coroutine worker runtime.
 *
 * Used by `coroutine()` and `compose()`.
 */
export const buildCoroutineWorkerRuntime = (): string => `
const __serializeWorkerError = (error) => {
  if (error instanceof Error) return error.message || error.name || "Error";
  if (error === undefined) return "Worker task threw undefined";
  if (error === null) return "Worker task threw null";
  return String(error);
};

onmessage = async (event) => {
  const { workerId, taskId, payload, type } = event.data;

  if (type !== 'task') {
    return;
  }

  try {
    const result = await __mainTask(payload, __workerUtils);
    if (
      result &&
      result.__transferResult === true &&
      Array.isArray(result.transfer)
    ) {
      postMessage(
        { workerId, taskId, payload: result.value, type: 'response' },
        result.transfer,
      );
    } else {
      postMessage({ workerId, taskId, payload: result, type: 'response' });
    }
  } catch (error) {
    const message = __serializeWorkerError(error);
    postMessage({ workerId, taskId, error: message, type: 'error' });
  }
};`;

/**
 * Actor worker runtime.
 *
 * Supports persistent behavior loop via `init`, `notify`, `request`,
 * and `stop` messages. Uses `__concurrency` helpers injected
 * by the build script.
 */
export const buildActorWorkerRuntime = (mailboxCapacity?: number): string => `
const __serializeWorkerError = (error) => {
  if (error instanceof Error) return error.message || error.name || "Error";
  if (error === undefined) return "Worker task threw undefined";
  if (error === null) return "Worker task threw null";
  return String(error);
};

const __pendingWorkerRequests = new Map();
let __requestCounter = 0;

const __rejectPendingWorkerRequests = (error) => {
  const pending = [...__pendingWorkerRequests.values()];
  __pendingWorkerRequests.clear();
  for (const request of pending) {
    request.reject(error);
  }
};

const __postToMain = (message) => {
  postMessage(message);
};

const __createRequestId = (taskId) => {
  __requestCounter += 1;
  return taskId + ':request:' + __requestCounter;
};

const __requestMain = (workerId, taskId, to, topic, payload) => {
  if (__actorStopping || !__actorRunning) {
    return Promise.reject(new Error("Actor stopped"));
  }

  return new Promise((resolve, reject) => {
    const requestId = __createRequestId(taskId);
    __pendingWorkerRequests.set(requestId, { resolve, reject });
    __postToMain({ workerId, taskId, requestId, to, topic, type: 'request', payload });
  });
};

const __workerInbox = __concurrency.channel();

const __enqueueActorInbox = (payload, scope) => {
  __workerInbox.send(payload).catch((error) => {
    console.warn(scope, error);
  });
};

const __createWorkerUtils = (workerId, taskId) => {
  const outbox = {
    request: (to, topic, requestPayload) => __requestMain(workerId, taskId, to, topic, requestPayload),
    send: (to, topic, messagePayload) => {
      __postToMain({
        workerId,
        taskId,
        payload: { kind: 'actor-bus', to, topic, payload: messagePayload },
        type: 'notify',
      });
    },
  };
  return {
    outbox,
    inbox: {
      listen: async (signal) => {
        const result = await __workerInbox.receive(signal);
        return result.ok ? result.value : undefined;
      },
    },
    concurrency: __concurrency,
  };
};

const __actorMailboxCapacity = ${mailboxCapacity === undefined ? "undefined" : mailboxCapacity};
const __actorMailbox = __actorMailboxCapacity === undefined
  ? __concurrency.channel()
  : __concurrency.channel(__actorMailboxCapacity);

const __enqueueActorMessage = (value, requestId) => {
  if (__actorMailboxCapacity === undefined) {
    __actorMailbox.send(value).catch((error) => {
      console.warn("Actor worker failed to enqueue message", error);
    });
    return true;
  }

  if (__actorMailbox.trySend(value)) {
    return true;
  }

  if (requestId) {
    __postToMain({
      workerId: __workerId,
      taskId: __actorId,
      requestId,
      type: "error",
      error: "Actor mailbox capacity exceeded",
    });
  } else {
    __postToMain({
      workerId: __workerId,
      taskId: __actorId,
      type: "overflow",
    });
  }
  return false;
};

let __actorState = undefined;
let __actorRunning = false;
let __actorStopping = false;
let __actorId = null;
let __workerId = null;

const __runBehaviorLoop = async (workerId, taskId) => {
  const utils = __createWorkerUtils(workerId, taskId);

  while (__actorRunning) {
    const received = await __actorMailbox.receive();
    if (!received.ok) break;
    const envelope = received.value;

    let msg = envelope;
    let replyId = null;

    if (envelope && typeof envelope === "object" && "requestId" in envelope) {
      replyId = envelope.requestId;
      msg = envelope.msg;
    }

    try {
      const result = await __mainTask(msg, __actorState, utils);
      __actorState = result;

      if (replyId) {
        __postToMain({ workerId, taskId, type: "response", requestId: replyId, payload: result });
      }
    } catch (error) {
      if (__actorStopping) {
        break;
      }

      const message = __serializeWorkerError(error);
      if (replyId) {
        __postToMain({ workerId, taskId, type: "error", requestId: replyId, error: message });
      }

      // An unhandled behavior exception terminates this actor generation.
      // Supervision can then make the restart decision at the ownership boundary.
      __actorRunning = false;
      __rejectPendingWorkerRequests(new Error(message));
      __postToMain({ workerId, taskId, type: "error", error: message });
      break;
    }
  }

  __actorMailbox.close();
  __workerInbox.close();
  __postToMain({ workerId, taskId, type: "stopped" });
};

onmessage = async (event) => {
  const { workerId, taskId, payload, type, requestId, error, topic } = event.data;

  if (
    type !== "init" &&
    (__workerId !== workerId || __actorId !== taskId)
  ) {
    return;
  }

  if (type === "notify") {
    if (__actorRunning) {
      const accepted = __enqueueActorMessage(payload);
      if (
        accepted &&
        payload &&
        typeof payload === "object" &&
        payload.kind === "actor-bus"
      ) {
        __enqueueActorInbox(payload, "Actor worker failed to mirror bus message to inbox");
      }
    } else {
      console.warn("Actor worker received main message before init", event.data);
    }
    return;
  }

  if (type === "response" || (type === "error" && !!requestId)) {
    if (!requestId) {
      console.warn("Actor worker received request response without requestId", event.data);
      return;
    }

    const pendingRequest = __pendingWorkerRequests.get(requestId);
    if (pendingRequest) {
      __pendingWorkerRequests.delete(requestId);
      if (type === "response") {
        pendingRequest.resolve(payload);
      } else {
        pendingRequest.reject(new Error(error || payload?.error || payload?.message || "Actor request failed"));
      }
    }
    return;
  }

  if (type === "init") {
    if (__actorId !== null || __workerId !== null) {
      return;
    }

    __workerId = workerId;
    __actorId = taskId;
    __actorState = payload;
    __actorStopping = false;
    __actorRunning = true;
    __runBehaviorLoop(workerId, taskId);
    return;
  }

  if (type === "stop") {
    __actorStopping = true;
    __actorRunning = false;
    __rejectPendingWorkerRequests(new Error("Actor stopped"));
    __actorMailbox.close();
    __workerInbox.close();
    return;
  }

  if (type === "request" && !!requestId) {
    __enqueueActorMessage({ msg: payload, requestId, topic }, requestId);
    return;
  }
};`;
````

## File: projects/libraries/swiftly/src/lib/worker/types.ts
````typescript
import type { TaskRunControl, WorkerTaskResult, WorkerTaskUtils } from "../utils/transfer";

/**
 * Task descriptor ready to be baked into a worker blob.
 *
 * `main` and `functions` are the single source of truth.
 * String forms are derived on demand via `serializeScript()`.
 */
export interface CoroutineScript<T = any, R = any> {
  /** Raw worker-side snippets injected before the serialized functions. */
  helpers?: string[];
  /** Main task body executed inside the worker. */
  main: (data: T, utils: WorkerTaskUtils) => WorkerTaskResult<R> | Promise<WorkerTaskResult<R>>;
  /** Additional named helper functions serialized alongside `main`. */
  functions?: Function[];
}

/**
 * Base contract for anything that can process a task and be finalized.
 */
export interface TaskRunner<T = any, R = any> {
  /** Submits one value for worker-side processing. */
  run: (data: T, control?: TaskRunControl) => Promise<R>;
  /**
   * Stops accepting new work, drains already-admitted work, then releases resources.
   * Repeated calls share the same lifecycle completion.
   */
  close: () => Promise<void>;
  /**
   * Immediately terminates resources and rejects queued/active work.
   * Use `close()` when admitted work should be allowed to finish.
   */
  dispose: () => Promise<void>;
}

/**
 * Stateless background-task runner backed by an elastic reusable worker list.
 *
 * Created by `coroutine(mainTask)` and accepted by `compose(...)`.
 */
export interface Coroutine<T = any, R = T> extends TaskRunner<T, R> {}

/**
 * Terminal state of a long-lived actor.
 */
export type ActorExit =
  | { readonly reason: "stopped" }
  | { readonly reason: "error"; readonly error: Error };


/** Bounded mailbox policy for an actor generation. */
export type ActorOptions = {
  /** Maximum number of messages allowed to wait behind the currently executing behavior. Omit for the legacy unbounded mailbox. */
  readonly capacity?: number;
};

/**
 * Long-lived stateful worker with bidirectional messaging.
 *
 * `Actor` is an opaque handle to a persistent behavior loop running in a
 * dedicated worker. Messaging is done through the `main` utility:
 * `main.outbox.send(actorOrName, topic, msg)`, `main.outbox.request(actorOrName, topic, msg)`,
 * and `main.inbox.subscribe(handler)`.
 *
 * Lifecycle is managed through the bus — call `main.outbox.stop(actorOrName)`
 * to stop the actor and release resources.
 *
 * Unlike `Coroutine`, an actor owns persistent worker identity and state.
 */
export interface Actor {
  /** Stable actor name used for actor-to-actor addressing. */
  readonly name: string;

  /** `true` while the behavior loop is running. */
  readonly running: boolean;

  /** Configured bounded mailbox capacity, or `undefined` for an unbounded mailbox. */
  readonly mailboxCapacity: number | undefined;

  /** Number of one-way messages dropped because a bounded mailbox was saturated. */
  readonly dropped: number;

  /** Resolves exactly once when the actor terminates. */
  readonly done: Promise<ActorExit>;
}


/** Restart policy for a supervised actor. */
export type SupervisorOptions = {
  /** Maximum number of restart attempts after actor failure. Defaults to 3. */
  readonly maxRestarts?: number;
  /** Delay before each restart attempt in milliseconds. Defaults to 0. */
  readonly restartDelay?: number;
  /**
   * Number of sends/requests that may wait while no actor generation is running.
   * Defaults to 0, preserving fail-fast behavior unless buffering is explicit.
   */
  readonly capacity?: number;
};

/**
 * Stable lifecycle owner for an actor that may be recreated after worker failure.
 *
 * The supervisor itself is the addressable handle. Its `done` promise settles only
 * when it is explicitly stopped or its restart budget is exhausted.
 */
export interface Supervisor extends Actor {
  /** Number of restart attempts consumed after actor failure. */
  readonly restarts: number;
  /** Current actor generation, when one is running. */
  readonly current: Actor | undefined;
  /** Configured restart-window ingress capacity. */
  readonly capacity: number;
  /** Number of sends/requests currently waiting for a replacement generation. */
  readonly pending: number;
}
````

## File: projects/libraries/swiftly/src/tests/utils.spec.ts
````typescript
import {
  background,
  channel,
  CHANNEL_INTERNALS,
  ChannelClosedError,
  ContextCancelledError,
  createAbortError,
  event,
  otherwise,
  operation,
  receive,
  select,
  semaphore,
  send,
  withCancel,
  withDeadline,
  withTimeout,
} from "../public-api";

describe("channel", () => {
  it("should create an unbuffered channel by default", () => {
    const ch = channel<number>();
    expect(ch.capacity).toBe(0);
    expect(ch.size).toBe(0);
    expect(ch.closed).toBeFalse();
  });

  it("should create a buffered channel", () => {
    const ch = channel<string>(3);
    expect(ch.capacity).toBe(3);
    expect(ch.size).toBe(0);
  });

  it("should throw for negative capacity", () => {
    expect(() => channel(-1)).toThrowError(/non-negative integer/);
  });

  it("should throw for non-integer capacity", () => {
    expect(() => channel(1.5)).toThrowError(/non-negative integer/);
  });

  it("should hand off values on an unbuffered channel", async () => {
    const ch = channel<number>();

    const receive$ = ch.receive();
    await ch.send(42);
    const value = await receive$;

    expect(value).toEqual({ ok: true, value: 42 });
  });

  it("should buffer sends while space remains", async () => {
    const ch = channel<number>(2);

    await ch.send(1); // buffered
    await ch.send(2); // buffered

    expect(ch.size).toBe(2);
    expect(await ch.receive()).toEqual({ ok: true, value: 1 });
    expect(await ch.receive()).toEqual({ ok: true, value: 2 });
  });

  it("should block send when buffer is full", async () => {
    const ch = channel<number>(1);
    await ch.send(1);

    let sent = false;
    const pending = ch.send(2).then(() => {
      sent = true;
    });

    await new Promise(r => setTimeout(r, 5));
    expect(sent).toBeFalse();

    await ch.receive();
    await pending;
    expect(sent).toBeTrue();
  });

  it("trySend should succeed when space is available", async () => {
    const ch = channel<number>(1);
    expect(ch.trySend(7)).toBeTrue();
    expect(ch.size).toBe(1);
  });

  it("trySend should fail on unbuffered channel with no receiver", () => {
    const ch = channel<number>();
    expect(ch.trySend(7)).toBeFalse();
  });

  it("trySend should fail when buffer is full", async () => {
    const ch = channel<number>(1);
    await ch.send(1);
    expect(ch.trySend(2)).toBeFalse();
  });

  it("tryReceive should return buffered values", async () => {
    const ch = channel<number>(1);
    await ch.send(99);

    const result = ch.tryReceive();
    expect(result).toEqual(jasmine.objectContaining({ ok: true, value: 99 }));
  });

  it("tryReceive should return undefined when empty", () => {
    const ch = channel<number>();
    expect(ch.tryReceive()).toBeUndefined();
  });

  it("tryReceive should return ok:false when closed and empty", () => {
    const ch = channel<number>();
    ch.close();
    expect(ch.tryReceive()).toEqual(jasmine.objectContaining({ ok: false }));
  });

  it("should close and reject pending senders", async () => {
    const ch = channel<number>();

    const pendingSend = ch.send(1);
    ch.close();

    await expectAsync(pendingSend).toBeRejectedWithError(ChannelClosedError);
  });

  it("should close and resolve pending receivers with ok:false", async () => {
    const ch = channel<number>();

    const pendingReceive = ch.receive();
    ch.close();

    expect(await pendingReceive).toEqual({ ok: false, value: undefined });
  });

  it("should reject send on a closed channel", async () => {
    const ch = channel<number>();
    ch.close();

    await expectAsync(ch.send(1)).toBeRejectedWithError(ChannelClosedError);
  });

  it("should return ok:false when receiving from closed empty channel", async () => {
    const ch = channel<number>();
    ch.close();

    expect(await ch.receive()).toEqual({ ok: false, value: undefined });
  });

  it("should carry undefined as a normal channel value", async () => {
    const ch = channel<undefined>(1);
    await ch.send(undefined);
    ch.close();

    expect(await ch.receive()).toEqual({ ok: true, value: undefined });
    expect(await ch.receive()).toEqual({ ok: false, value: undefined });
  });

  it("async iteration should not treat undefined as channel closure", async () => {
    const ch = channel<number | undefined>(2);
    await ch.send(undefined);
    await ch.send(1);
    ch.close();

    const values: Array<number | undefined> = [];
    for await (const value of ch) values.push(value);

    expect(values).toEqual([undefined, 1]);
  });

  it("should be async iterable", async () => {
    const ch = channel<number>(2);
    await ch.send(1);
    await ch.send(2);
    ch.close();

    const values: number[] = [];
    for await (const v of ch) {
      values.push(v);
    }

    expect(values).toEqual([1, 2]);
  });

  it("should reject send when signal is already aborted", async () => {
    const ch = channel<number>();
    const controller = new AbortController();
    controller.abort(new ContextCancelledError("stopped"));

    await expectAsync(ch.send(1, controller.signal)).toBeRejectedWithError(/stopped/);
  });

  it("should reject receive when signal is already aborted", async () => {
    const ch = channel<number>();
    const controller = new AbortController();
    controller.abort(new ContextCancelledError("stopped"));

    await expectAsync(ch.receive(controller.signal)).toBeRejectedWithError(/stopped/);
  });

  it("should abort a blocked send via signal", async () => {
    const ch = channel<number>();
    const controller = new AbortController();

    const pending = ch.send(1, controller.signal);
    controller.abort(new ContextCancelledError("stopped"));

    await expectAsync(pending).toBeRejectedWithError(/stopped/);
  });

  it("should abort a blocked receive via signal", async () => {
    const ch = channel<number>();
    const controller = new AbortController();

    const pending = ch.receive(controller.signal);
    controller.abort(new ContextCancelledError("stopped"));

    await expectAsync(pending).toBeRejectedWithError(/stopped/);
  });
});

describe("context", () => {
  it("background creates a non-aborted context", () => {
    const ctx = background();
    expect(ctx.signal.aborted).toBeFalse();
    expect(ctx.reason).toBeUndefined();
  });

  it("withCancel cancel aborts the child signal", () => {
    const [ctx, cancel] = withCancel();
    expect(ctx.signal.aborted).toBeFalse();

    cancel();
    expect(ctx.signal.aborted).toBeTrue();
    expect(ctx.reason).toBeInstanceOf(ContextCancelledError);
  });

  it("withCancel cancel accepts a custom reason", () => {
    const [ctx, cancel] = withCancel();
    const err = new Error("custom");
    cancel(err);
    expect(ctx.reason).toBe(err);
  });

  it("withCancel child is aborted when parent aborts", async () => {
    const [parent, cancelParent] = withCancel(background());
    const [child] = withCancel(parent);

    expect(child.signal.aborted).toBeFalse();
    cancelParent();
    expect(child.signal.aborted).toBeTrue();
  });


  it("withTimeout rejects invalid durations before deriving a live child context", () => {
    expect(() => withTimeout(background(), -1)).toThrowError(
      RangeError,
      "timer duration must be a finite non-negative number",
    );
    expect(() => withTimeout(background(), Number.POSITIVE_INFINITY)).toThrowError(
      RangeError,
      "timer duration must be a finite non-negative number",
    );
  });

  it("withTimeout aborts after the specified delay", async () => {
    const [ctx, cancel] = withTimeout(background(), 20);
    expect(ctx.signal.aborted).toBeFalse();

    await new Promise(r => setTimeout(r, 50));
    expect(ctx.signal.aborted).toBeTrue();
    expect(String(ctx.reason)).toContain("timeout");

    cancel(); // idempotent cleanup
  });

  it("withTimeout manual cancel clears the timer", () => {
    const [ctx, cancel] = withTimeout(background(), 10000);
    cancel();
    expect(ctx.signal.aborted).toBeTrue();
  });

  it("withDeadline aborts at the deadline", async () => {
    const [ctx] = withDeadline(background(), Date.now() + 20);
    expect(ctx.signal.aborted).toBeFalse();

    await new Promise(r => setTimeout(r, 50));
    expect(ctx.signal.aborted).toBeTrue();
  });

  it("withDeadline accepts a Date object", async () => {
    const [ctx] = withDeadline(background(), new Date(Date.now() + 20));
    await new Promise(r => setTimeout(r, 50));
    expect(ctx.signal.aborted).toBeTrue();
  });

  it("withDeadline with past deadline aborts soon after", async () => {
    const [ctx] = withDeadline(background(), Date.now() - 10);
    // setTimeout(0) schedules on next tick; wait a bit
    await new Promise(r => setTimeout(r, 10));
    expect(ctx.signal.aborted).toBeTrue();
  });

  it("done resolves when cancelled", async () => {
    const [ctx, cancel] = withCancel();
    let resolved = false;
    ctx.done.then(() => { resolved = true; });

    cancel();
    await ctx.done;
    expect(resolved).toBeTrue();
  });


  it("createAbortError returns the Error reason unchanged", () => {
    const err = new Error("boom");
    const ctrl = new AbortController();
    ctrl.abort(err);
    expect(createAbortError(ctrl.signal)).toBe(err);
  });

  it("createAbortError wraps string reason in ContextCancelledError", () => {
    const ctrl = new AbortController();
    ctrl.abort("stopped");
    const result = createAbortError(ctrl.signal);
    expect(result).toBeInstanceOf(ContextCancelledError);
    expect(result.message).toBe("stopped");
  });

  it("createAbortError with ContextCancelledError reason returns it", () => {
    const err = new ContextCancelledError("my cancel");
    const ctrl = new AbortController();
    ctrl.abort(err);
    expect(createAbortError(ctrl.signal)).toBe(err);
  });
});

describe("selection", () => {
  it("receive builds a receive case", () => {
    const ch = channel<number>();
    const c = receive(ch, "myCase");
    expect(c.op).toBe("receive");
    expect(c.channel).toBe(ch);
    expect(c.name).toBe("myCase");
  });

  it("send builds a send case", () => {
    const ch = channel<number>();
    const c = send(ch, 42, "myCase");
    expect(c.op).toBe("send");
    expect(c.channel).toBe(ch);
    expect(c.value).toBe(42);
    expect(c.name).toBe("myCase");
  });

  it("otherwise builds a default case", () => {
    const c = otherwise("fallback");
    expect(c.op).toBe("default");
    expect(c.name).toBe("fallback");
  });

  it("select chooses a ready receive case", async () => {
    const ch = channel<number>(1);
    await ch.send(7);

    const result = await select([receive(ch, "r")]);
    expect(result.op).toBe("receive");
    expect(result.name).toBe("r");
    expect(result.value).toBe(7);
    expect(result.ok).toBeTrue();
  });

  it("select chooses a ready send case", async () => {
    const ch = channel<number>(1);

    const result = await select([send(ch, 8, "s")]);
    expect(result.op).toBe("send");
    expect(result.name).toBe("s");
    expect(result.ok).toBeTrue();
    expect(await ch.receive()).toEqual({ ok: true, value: 8 });
  });

  it("select falls back to default when nothing is ready", async () => {
    const ch = channel<number>();

    const result = await select([receive(ch, "r"), otherwise("def")]);
    expect(result.op).toBe("default");
    expect(result.name).toBe("def");
    expect(result.ok).toBeTrue();
  });


  it("select rejects multiple default branches", async () => {
    await expectAsync(
      select([otherwise("first"), otherwise("second")]),
    ).toBeRejectedWithError(
      RangeError,
      "select accepts at most one default case",
    );
  });

  it("select blocks until a case is ready", async () => {
    const ch = channel<number>();

    const pending = select([receive(ch, "r")]);
    setTimeout(() => ch.send(99), 10);

    const result = await pending;
    expect(result.value).toBe(99);
  });

  it("select receive on closed channel returns ok:false", async () => {
    const ch = channel<number>();
    ch.close();

    const result = await select([receive(ch, "r")]);
    expect(result.op).toBe("receive");
    expect(result.ok).toBeFalse();
  });

  it("select send on closed channel throws ChannelClosedError", async () => {
    const ch = channel<number>();
    ch.close();

    await expectAsync(select([send(ch, 1, "s")])).toBeRejectedWithError(ChannelClosedError);
  });

  it("select throws when context is already aborted", async () => {
    const ch = channel<number>();
    const err = new ContextCancelledError("pre-aborted");
    const fakeSignal = {
      aborted: true,
      reason: err,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    } as unknown as AbortSignal;

    const fakeCtx = {
      signal: fakeSignal,
      done: Promise.resolve(),
      reason: err,
    } as any;

    await expectAsync(select([receive(ch, "r")], fakeCtx)).toBeRejectedWithError(/pre-aborted/);
  });

  it("select aborts when context is cancelled while waiting", async () => {
    const ch = channel<number>();
    const [ctx, cancel] = withCancel();

    const pending = select([receive(ch, "r")], ctx);
    cancel();

    await expectAsync(pending).toBeRejectedWithError(ContextCancelledError);
  });

  it("select with multiple ready cases chooses exactly one", async () => {
    const a = channel<number>(1);
    const b = channel<number>(1);
    await a.send(1);
    await b.send(2);

    const result = await select([receive(a, "a"), receive(b, "b")]);
    expect(["a", "b"]).toContain(result.name!);
    expect(result.ok).toBeTrue();

    // Only one value should be consumed
    const remaining = [a.tryReceive(), b.tryReceive()].filter(r => r !== undefined);
    expect(remaining.length).toBe(1);
    expect(remaining[0]).toEqual(jasmine.objectContaining({ ok: true }));
  });

  it("select send case paired with waiting receiver", async () => {
    const ch = channel<number>();

    const pendingReceive = ch.receive();
    const result = await select([send(ch, 123, "s")]);

    expect(result.op).toBe("send");
    expect(await pendingReceive).toEqual({ ok: true, value: 123 });
  });

  it("select receive case paired with waiting sender", async () => {
    const ch = channel<number>();

    const pendingSend = ch.send(456);
    const result = await select([receive(ch, "r")]);

    expect(result.op).toBe("receive");
    expect(result.value).toBe(456);
    await pendingSend;
  });

  it("select cleans up registrations after resolution", async () => {
    const a = channel<number>();
    const b = channel<number>();

    const pending = select([receive(a, "a"), receive(b, "b")]);
    await a.send(1);

    const result = await pending;
    expect(result.name).toBe("a");

    // b should still be able to receive normally later
    setTimeout(() => b.send(2), 5);
    expect(await b.receive()).toEqual({ ok: true, value: 2 });
  });

  it("select resolves a pending receive with ok:false when the channel closes", async () => {
    const ch = channel<number>();

    const pending = select([receive(ch, "r")]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    ch.close();

    const result = await pending;
    expect(result.op).toBe("receive");
    expect(result.name).toBe("r");
    expect(result.ok).toBeFalse();
    expect(result.value).toBeUndefined();
  });

  it("select resolves a pending send when a receiver arrives later", async () => {
    const ch = channel<number>();

    const pending = select([send(ch, 123, "s")]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const receive$ = ch.receive();
    const result = await pending;

    expect(result.op).toBe("send");
    expect(result.name).toBe("s");
    expect(result.ok).toBeTrue();
    expect(await receive$).toEqual({ ok: true, value: 123 });
  });

  it("select rejects a pending send when the channel closes", async () => {
    const ch = channel<number>();

    const pending = select([send(ch, 1, "s")]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    ch.close();

    await expectAsync(pending).toBeRejectedWithError(ChannelClosedError);
  });

  it("select flushes a queued send into the buffer after space is freed", async () => {
    const ch = channel<number>(1);
    await ch.send(1);

    const pending = select([send(ch, 2, "s")]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(await ch.receive()).toEqual({ ok: true, value: 1 });

    const result = await pending;
    expect(result.op).toBe("send");
    expect(result.name).toBe("s");
    expect(result.ok).toBeTrue();
    expect(await ch.receive()).toEqual({ ok: true, value: 2 });
  });

  it("channel internals reject select sends registered after close", () => {
    const ch = channel<number>();
    ch.close();

    const registration = {
      id: Symbol("select"),
      isSettled: () => false,
      settle: () => false,
      reject: jasmine.createSpy("reject").and.returnValue(true),
    };

    const unregister = (ch as any)[CHANNEL_INTERNALS].registerSelectSend(1, registration, {
      index: 0,
      caseRef: send(ch, 1, "s"),
      name: "s",
    });

    expect(registration.reject).toHaveBeenCalledWith(jasmine.any(ChannelClosedError));
    unregister();
  });

  it("channel internals can unregister a pending select send more than once", () => {
    const ch = channel<number>();

    const unregister = (ch as any)[CHANNEL_INTERNALS].registerSelectSend(
      1,
      {
        id: Symbol("select"),
        isSettled: () => false,
        settle: () => false,
        reject: () => false,
      },
      {
        index: 0,
        caseRef: send(ch, 1, "s"),
        name: "s",
      }
    );

    unregister();
    unregister();

    expect(ch.tryReceive()).toBeUndefined();
  });

  it("channel internals discard settled select receivers before dispatch", () => {
    const ch = channel<number>();

    const unregister = (ch as any)[CHANNEL_INTERNALS].registerSelectReceive(
      {
        id: Symbol("receive"),
        isSettled: () => true,
        settle: () => true,
        reject: () => false,
      },
      {
        index: 0,
        caseRef: receive(ch, "r"),
        name: "r",
      }
    );

    expect(ch.trySend(1)).toBeFalse();

    unregister();
  });

  it("channel internals discard settled select senders before receiving", () => {
    const ch = channel<number>();

    const unregister = (ch as any)[CHANNEL_INTERNALS].registerSelectSend(
      1,
      {
        id: Symbol("send"),
        isSettled: () => true,
        settle: () => true,
        reject: () => false,
      },
      {
        index: 0,
        caseRef: send(ch, 1, "s"),
        name: "s",
      }
    );

    expect(ch.tryReceive()).toBeUndefined();

    unregister();
  });


  it("channel internals settle a select receive registered after close", () => {
    const ch = channel<number>();
    ch.close();

    const registration = {
      id: Symbol("closed-receive"),
      isSettled: () => false,
      settle: jasmine.createSpy("settleClosedReceive").and.returnValue(true),
      reject: jasmine.createSpy("rejectClosedReceive").and.returnValue(false),
    };

    const unregister = (ch as any)[CHANNEL_INTERNALS].registerSelectReceive(
      registration,
      {
        index: 0,
        caseRef: receive(ch, "closed"),
        name: "closed",
      },
    );

    expect(registration.settle).toHaveBeenCalledWith(
      jasmine.objectContaining({
        op: "receive",
        ok: false,
        name: "closed",
      }),
    );
    expect(registration.reject).not.toHaveBeenCalled();
    unregister();
  });

  it("channel internals ignore already-settled registrations", () => {
    const ch = channel<number>();
    const settle = jasmine.createSpy("settle");
    const reject = jasmine.createSpy("reject");
    const registration = {
      id: Symbol("settled"),
      isSettled: () => true,
      settle,
      reject,
    };

    const unregisterReceive = (ch as any)[CHANNEL_INTERNALS].registerSelectReceive(
      registration,
      {
        index: 0,
        caseRef: receive(ch, "r"),
        name: "r",
      },
    );
    const unregisterSend = (ch as any)[CHANNEL_INTERNALS].registerSelectSend(
      1,
      registration,
      {
        index: 1,
        caseRef: send(ch, 1, "s"),
        name: "s",
      },
    );

    expect(ch.tryReceive()).toBeUndefined();
    expect(ch.trySend(2)).toBeFalse();
    expect(settle).not.toHaveBeenCalled();
    expect(reject).not.toHaveBeenCalled();

    unregisterReceive();
    unregisterSend();
  });

  it("channel internals reconcile compatible select waiters immediately", () => {
    const ch = channel<number>();
    const receiveRegistration = {
      id: Symbol("receive"),
      isSettled: () => false,
      settle: jasmine.createSpy("receiveSettle").and.returnValue(true),
      reject: jasmine.createSpy("receiveReject").and.returnValue(false),
    };
    const sendRegistration = {
      id: Symbol("send"),
      isSettled: () => false,
      settle: jasmine.createSpy("sendSettle").and.returnValue(true),
      reject: jasmine.createSpy("sendReject").and.returnValue(false),
    };

    const unregisterReceive = (ch as any)[CHANNEL_INTERNALS].registerSelectReceive(
      receiveRegistration,
      {
        index: 0,
        caseRef: receive(ch, "r"),
        name: "r",
      },
    );

    const unregisterSend = (ch as any)[CHANNEL_INTERNALS].registerSelectSend(
      7,
      sendRegistration,
      {
        index: 1,
        caseRef: send(ch, 7, "s"),
        name: "s",
      },
    );

    expect(receiveRegistration.settle).toHaveBeenCalledWith(
      jasmine.objectContaining({
        op: "receive",
        value: 7,
        ok: true,
      }),
    );
    expect(sendRegistration.settle).toHaveBeenCalledWith(
      jasmine.objectContaining({
        op: "send",
        ok: true,
      }),
    );

    unregisterReceive();
    unregisterSend();
  });

  it("same select send and receive cases never self-match on an unbuffered channel", async () => {
    const ch = channel<number>();
    const [ctx, cancel] = withCancel();

    const pending = select([
      receive(ch, "receive"),
      send(ch, 1, "send"),
    ], ctx);

    await Promise.resolve();
    cancel(new ContextCancelledError("stop self-select"));

    await expectAsync(pending).toBeRejectedWithError(
      ContextCancelledError,
      "stop self-select",
    );

    expect(ch.tryReceive()).toBeUndefined();
    expect(ch.trySend(2)).toBeFalse();
  });

  it("close and cancellation cannot settle one select twice", async () => {
    const ch = channel<number>();
    const [ctx, cancel] = withCancel();
    let settlements = 0;

    const pending = select([receive(ch, "r")], ctx);
    pending.then(
      () => settlements += 1,
      () => settlements += 1,
    );

    await Promise.resolve();
    ch.close();
    cancel(new ContextCancelledError("late cancel"));

    await expectAsync(pending).toBeResolvedTo(
      jasmine.objectContaining({
        op: "receive",
        ok: false,
      }),
    );
    await Promise.resolve();

    expect(settlements).toBe(1);
  });

  it("channel internals pair queued select senders with queued select receivers during flush", async () => {
    const ch = channel<number>(1);
    const internals = (ch as any)[CHANNEL_INTERNALS];

    await ch.send(1);

    const receiverRegistration = {
      id: Symbol("receive"),
      isSettled: () => false,
      settle: jasmine.createSpy("settleReceive").and.returnValue(true),
      reject: jasmine.createSpy("rejectReceive").and.returnValue(false),
    };
    const senderRegistration = {
      id: Symbol("send"),
      isSettled: () => false,
      settle: jasmine.createSpy("settleSend").and.returnValue(true),
      reject: jasmine.createSpy("rejectSend").and.returnValue(false),
    };

    const unregisterReceive = internals.registerSelectReceive(receiverRegistration, {
      index: 0,
      caseRef: receive(ch, "r"),
      name: "r",
    });
    const unregisterSend = internals.registerSelectSend(2, senderRegistration, {
      index: 1,
      caseRef: send(ch, 2, "s"),
      name: "s",
    });

    expect(ch.tryReceive()).toEqual(jasmine.objectContaining({ ok: true, value: 1 }));
    expect(receiverRegistration.settle).toHaveBeenCalledWith(
      jasmine.objectContaining({ op: "receive", value: 2, ok: true, name: "r" })
    );
    expect(senderRegistration.settle).toHaveBeenCalledWith(
      jasmine.objectContaining({ op: "send", ok: true, name: "s" })
    );

    unregisterReceive();
    unregisterSend();
  });
});


describe("operation selection", () => {
  it("operation builds a cancellable operation case", () => {
    const run = (signal: AbortSignal) => signal.aborted;
    const c = operation(run, "work");

    expect(c.op).toBe("operation");
    expect(c.run).toBe(run);
    expect(c.name).toBe("work");
  });

  it("select resolves with the first completed operation", async () => {
    const result = await select([
      operation(async () => {
        await new Promise(r => setTimeout(r, 20));
        return "slow";
      }, "slow"),
      operation(async () => {
        await new Promise(r => setTimeout(r, 1));
        return "fast";
      }, "fast"),
    ]);

    expect(result.op).toBe("operation");
    expect(result.name).toBe("fast");
    expect(result.value).toBe("fast");
  });

  it("select aborts losing operations", async () => {
    let loserAborted = false;

    const result = await select([
      operation(async (signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => {
            loserAborted = true;
            resolve();
          }, { once: true });
        });
        return "loser";
      }, "loser"),
      operation(() => "winner", "winner"),
    ]);

    await Promise.resolve();
    expect(result.name).toBe("winner");
    expect(loserAborted).toBeTrue();
  });

  it("select can coordinate an operation with a channel receive", async () => {
    const ch = channel<string>();
    setTimeout(() => ch.send("message"), 1);

    let operationAborted = false;
    const result = await select([
      receive(ch, "message"),
      operation(async (signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => {
            operationAborted = true;
            resolve();
          }, { once: true });
        });
        return "timeout";
      }, "operation"),
    ]);

    await Promise.resolve();
    expect(result.name).toBe("message");
    expect(result.value).toBe("message");
    expect(operationAborted).toBeTrue();
  });

  it("default selection does not start operations", async () => {
    let started = false;

    const result = await select([
      operation(() => {
        started = true;
        return "work";
      }, "work"),
      otherwise("default"),
    ]);

    expect(result.name).toBe("default");
    expect(started).toBeFalse();
  });

  it("context cancellation aborts active operations", async () => {
    const [ctx, cancel] = withCancel();
    let aborted = false;

    const pending = select([
      operation(async (signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            resolve();
          }, { once: true });
        });
        return "never";
      }),
    ], ctx);

    await Promise.resolve();
    cancel(new ContextCancelledError("stop selection"));

    await expectAsync(pending).toBeRejectedWithError(/stop selection/);
    expect(aborted).toBeTrue();
  });

  it("context cancellation before operation start does not launch work", async () => {
    const [ctx, cancel] = withCancel();
    let started = false;

    const pending = select([
      operation(() => {
        started = true;
        return "work";
      }),
    ], ctx);

    cancel(new ContextCancelledError("stop before start"));

    await expectAsync(pending).toBeRejectedWithError(/stop before start/);
    await Promise.resolve();
    expect(started).toBeFalse();
  });

  it("operation failure rejects selection and aborts siblings", async () => {
    let siblingAborted = false;

    const pending = select([
      operation(async (signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => {
            siblingAborted = true;
            resolve();
          }, { once: true });
        });
        return "sibling";
      }),
      operation(() => {
        throw new Error("boom");
      }),
    ]);

    await expectAsync(pending).toBeRejectedWithError(/boom/);
    expect(siblingAborted).toBeTrue();
  });

  it("select rejects an empty case list", async () => {
    await expectAsync(select([])).toBeRejectedWithError(/at least one case/);
  });

  it("repeated cancellation leaves coordination primitives reusable", async () => {
    const ch = channel<number>();
    const gate = event();
    const sem = semaphore(1);

    for (let index = 0; index < 100; index++) {
      const controller = new AbortController();

      const receivePending = ch.receive(controller.signal);
      const eventPending = gate.wait(controller.signal);

      const held = await sem.acquire();
      const acquirePending = sem.acquire(controller.signal);

      controller.abort(new ContextCancelledError("stress cancel"));

      await expectAsync(receivePending).toBeRejected();
      await expectAsync(eventPending).toBeRejected();
      await expectAsync(acquirePending).toBeRejected();

      held();

      expect(gate.waiting).toBe(0);
      expect(sem.waiting).toBe(0);
    }

    ch.close();
  });



  it("mass select cancellation leaves no channel registrations or active operations behind", async () => {
    for (let index = 0; index < 200; index++) {
      const ch = channel<number>();
      const [ctx, cancel] = withCancel();
      let operationAborted = false;

      const pending = select([
        receive(ch, "receive"),
        send(ch, index, "send"),
        operation(
          (signal) =>
            new Promise<number>((resolve) => {
              signal.addEventListener(
                "abort",
                () => {
                  operationAborted = true;
                  resolve(-1);
                },
                { once: true },
              );
            }),
          "operation",
        ),
      ], ctx);

      await Promise.resolve();
      cancel(new ContextCancelledError(`cancel-${index}`));

      await expectAsync(pending).toBeRejectedWithError(
        ContextCancelledError,
        `cancel-${index}`,
      );
      await Promise.resolve();

      expect(operationAborted).toBeTrue();
      expect(ch.tryReceive()).toBeUndefined();
      expect(ch.trySend(index + 1)).toBeFalse();
    }
  });


});
````

## File: projects/libraries/swiftly/src/lib/utils/compose.ts
````typescript
import { buildCoroutineWorkerRuntime, buildWorkerScript, createTaskRunner, serializeScript } from "../worker";
import type { Coroutine, CoroutineScript, TaskRunner } from "../worker/types";
import type { TaskRunControl } from "./transfer";
import { normalizeTaskRunControl } from "../worker/control";

function isCoroutineScript(value: unknown): value is CoroutineScript {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as CoroutineScript).main === "function"
  );
}

async function composedCoroutineMain(data: any, utils: any): Promise<any> {
  const stages = (globalThis as typeof globalThis & {
    __composeStages?: Array<(value: any, utils: any) => any>;
  }).__composeStages;

  if (!Array.isArray(stages)) {
    throw new Error("compose stages are not initialized");
  }

  let result = data;
  for (let index = 0; index < stages.length; index += 1) {
    result = await stages[index](result, utils);
    if (
      index < stages.length - 1 &&
      result &&
      typeof result === "object" &&
      (result as { __transferResult?: boolean }).__transferResult === true
    ) {
      result = (result as { value: any }).value;
    }
  }

  return result;
}

/**
 * Merges multiple `CoroutineScript`s into a single composed script suitable for
 * baking into a worker blob via `createTaskRunner`.
 *
 * Each stage is wrapped in an IIFE so that dependency function names
 * and internal variables do not collide across stages.
 */
function mergeCoroutineScripts(scripts: CoroutineScript[]): {
  main: Function;
  helpers: string[];
  generateScript: (main: Function, helpers?: string[]) => string;
} {
  const helpers = Array.from(
    new Set(scripts.flatMap((s) => s.helpers || []))
  );

  const stageBodies = scripts
    .map((s, i) => {
      const { code, deps } = serializeScript(s);
      const depsSection = deps.length > 0 ? deps.join(";\n") + ";" : "";
      return `const __stage${i} = (() => {
${depsSection ? '  ' + depsSection.replace(/\n/g, '\n  ') + '\n' : ''}  return (${code});
})();`;
    })
    .reduce((acc, body, i) => `${acc}${i > 0 ? '\n\n' : ''}${body}`, '');
  const stageRegistry = `globalThis.__composeStages = [${scripts
    .map((_, i) => `__stage${i}`)
    .join(", ")}];`;

  const generateScript = (task: Function, taskHelpers?: string[]) => {
    const allHelpers = Array.from(
      new Set([...(taskHelpers || []), ...helpers])
    );
    return buildWorkerScript({
      helpers: [stageBodies, stageRegistry, ...allHelpers],
      main: task,
      functions: [],
      runtime: buildCoroutineWorkerRuntime(),
    });
  };

  return { main: composedCoroutineMain, helpers, generateScript };
}

/**
 * Chains multiple coroutines sequentially into a single `Coroutine`.
 *
 * `CoroutineScript` inputs (created by `coroutine()`) are merged into one
 * worker script so the entire pipeline runs inside one worker task per concurrent invocation.
 *
 * `TaskRunner` inputs are chained in the main thread after the worker
 * stage completes.
 */
export function compose<A, B>(...scripts: [CoroutineScript<A, B>]): Coroutine<A, B>;
export function compose<A, B, C>(...scripts: [CoroutineScript<A, B>, CoroutineScript<B, C>]): Coroutine<A, C>;
export function compose<A, B, C, D>(...scripts: [CoroutineScript<A, B>, CoroutineScript<B, C>, CoroutineScript<C, D>]): Coroutine<A, D>;
export function compose<T = any, R = any>(...scripts: Array<CoroutineScript<any, any> | TaskRunner<any, any>>): Coroutine<T, R>;

export function compose<T = any, R = any>(
  ...scripts: Array<CoroutineScript<any, any> | TaskRunner<any, any>>
): Coroutine<T, R> {
  const workerScripts: CoroutineScript<any, any>[] = [];
  const taskRunners: TaskRunner<any, any>[] = [];

  for (const s of scripts) {
    if (isCoroutineScript(s)) {
      workerScripts.push(s);
    } else if (s && typeof (s as TaskRunner).run === "function") {
      taskRunners.push(s as TaskRunner);
    }
  }

  let workerRunner: TaskRunner<T, R> | null = null;

  if (workerScripts.length > 0) {
    const merged = mergeCoroutineScripts(workerScripts);
    workerRunner = createTaskRunner<T, R>({
      name: "compose",
      config: merged.helpers.length > 0 ? { helpers: merged.helpers } : undefined,
      main: merged.main,
      functions: [],
      generateWorkerScript: (task, _dependencies, workerConfig) =>
        merged.generateScript(task, workerConfig?.helpers),
    });
  }

  let lifecycle: "open" | "closing" | "finalizing" | "finalized" = "open";
  let activeRuns = 0;
  let gracefulCloseStarted = false;
  let closePromise: Promise<void> | null = null;
  let resolveClose: (() => void) | null = null;
  let rejectClose: ((error: Error) => void) | null = null;
  let disposePromise: Promise<void> | null = null;

  const ownedRunners = (): TaskRunner<any, any>[] => [
    ...(workerRunner ? [workerRunner] : []),
    ...taskRunners,
  ];

  const closeOwnedRunners = async (): Promise<void> => {
    const errors: Error[] = [];

    for (const runner of ownedRunners()) {
      try {
        await runner.close();
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }

    if (errors.length > 0) throw errors[0];
  };

  const disposeOwnedRunners = async (): Promise<void> => {
    const errors: Error[] = [];

    for (const runner of ownedRunners()) {
      try {
        await runner.dispose();
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }

    if (errors.length > 0) throw errors[0];
  };

  const ensureClosePromise = (): Promise<void> => {
    if (closePromise) return closePromise;

    closePromise = new Promise<void>((resolve, reject) => {
      resolveClose = resolve;
      rejectClose = reject;
    });
    return closePromise;
  };

  const settleLifecycle = (outcome: "resolve" | "reject", error?: Error): void => {
    lifecycle = "finalized";
    if (outcome === "reject" && error) rejectClose?.(error);
    else resolveClose?.();
    resolveClose = null;
    rejectClose = null;
  };

  const maybeStartGracefulClose = (): void => {
    if (
      lifecycle !== "closing" ||
      activeRuns !== 0 ||
      gracefulCloseStarted
    ) {
      return;
    }

    gracefulCloseStarted = true;
    void closeOwnedRunners().then(
      () => settleLifecycle("resolve"),
      (error) =>
        settleLifecycle(
          "reject",
          error instanceof Error ? error : new Error(String(error)),
        ),
    );
  };

  const run = async (data: T, control?: TaskRunControl): Promise<R> => {
    if (lifecycle !== "open") {
      throw new Error("compose is closed");
    }

    activeRuns += 1;
    try {
      let result: any = data;
      const { signal, transfer } = normalizeTaskRunControl(control);
      let transferPending = transfer.length > 0;

      if (workerRunner) {
        result = await workerRunner.run(
          result,
          transferPending
            ? { signal, transfer }
            : signal,
        );
        transferPending = false;
      }

      for (const runner of taskRunners) {
        result = await runner.run(
          result,
          transferPending
            ? { signal, transfer }
            : signal,
        );
        transferPending = false;
      }

      return result;
    } finally {
      activeRuns = Math.max(0, activeRuns - 1);
      maybeStartGracefulClose();
    }
  };

  const close = (): Promise<void> => {
    if (lifecycle === "finalized") {
      return closePromise ?? Promise.resolve();
    }
    if (lifecycle === "finalizing") {
      return ensureClosePromise();
    }

    if (lifecycle === "open") {
      lifecycle = "closing";
    }

    const pendingClose = ensureClosePromise();
    maybeStartGracefulClose();
    return pendingClose;
  };

  const dispose = (): Promise<void> => {
    if (disposePromise) return disposePromise;
    if (lifecycle === "finalized") {
      return Promise.resolve();
    }

    lifecycle = "finalizing";
    ensureClosePromise();

    disposePromise = disposeOwnedRunners().then(
      () => {
        settleLifecycle("resolve");
      },
      (error) => {
        const normalized =
          error instanceof Error ? error : new Error(String(error));
        settleLifecycle("resolve");
        throw normalized;
      },
    );

    return disposePromise;
  };

  return {
    run,
    close,
    dispose,
  } as Coroutine<T, R>;
}
````

## File: projects/libraries/swiftly/src/lib/utils/index.ts
````typescript
export * from "./barrier";
export * from "./channel";
export * from "./compose";
export * from "./context";
export * from "./event";
export * from "./group";
export * from "./select";
export * from "./semaphore";

export * from "./timer";
export * from "./transfer";
````

## File: projects/libraries/swiftly/src/lib/worker/runner.ts
````typescript
import { acquireBlobUrl, releaseBlobUrl } from "./blob";
import type { PendingTaskMap, WorkerProtocolMessage } from "./messages";
import { createDefaultMessageHandler } from "./messages";
import { createModuleWorker } from "./module";
import type { TaskRunner } from "./types";
import { generateTaskId } from "./utils";
import { createAbortError } from "../utils/context";
import type { TaskRunControl } from "../utils/transfer";
import { normalizeTaskRunControl } from "./control";

export type WorkerScriptConfig = {
  helpers?: string[];
};

export type TaskRunnerOptions = {
  name: string;
  maxWorkers?: number;
  config?: WorkerScriptConfig;
  main: Function;
  functions: Function[];
  generateWorkerScript: (
    main: Function,
    functions: Function[],
    config?: WorkerScriptConfig,
  ) => string;
  createMessageHandler?: (
    worker: Worker,
    pendingTasks: PendingTaskMap,
  ) => (event: MessageEvent<WorkerProtocolMessage>) => void;
};

const toError = (error: unknown, fallback: string): Error =>
  error instanceof Error ? error : new Error(error ? String(error) : fallback);

/**
 * Internal elastic worker executor used by `coroutine()` and fused `compose()` stages.
 *
 * The executor owns worker reuse, not concurrency policy. Each concurrently
 * admitted run either reuses an idle worker or lazily creates another one.
 * Callers bound concurrency structurally with `group()` or `semaphore()`.
 */
export function createTaskRunner<T, R>({
  name,
  maxWorkers,
  config,
  main,
  functions,
  generateWorkerScript,
  createMessageHandler,
}: TaskRunnerOptions): TaskRunner<T, R> {
  if (
    maxWorkers !== undefined &&
    (!Number.isInteger(maxWorkers) || maxWorkers <= 0)
  ) {
    throw new RangeError("maxWorkers must be a positive integer");
  }

  const idleWorkers: Worker[] = [];
  const workers = new Map<number, Worker>();
  const workerMessageHandlers = new Map<
    number,
    (event: MessageEvent<WorkerProtocolMessage>) => void
  >();
  const workerErrorHandlers = new Map<number, (event: ErrorEvent) => void>();
  const pendingMessages: PendingTaskMap = new Map();

  const workerScript = generateWorkerScript(main, functions, config);
  let blobUrl: string | null = null;
  let lifecycle: "open" | "closing" | "finalizing" = "open";
  let isFinalized = false;
  let admittedRuns = 0;
  let closePromise: Promise<void> | null = null;
  let resolveClose: (() => void) | null = null;
  let nextWorkerId = 0;
  let hasReleasedBlobUrl = false;
  const workerWaiters: Array<{
    signal?: AbortSignal;
    abort?: () => void;
    resolve: (worker: Worker) => void;
    reject: (error: Error) => void;
  }> = [];

  const getWorkerScriptUrl = (): string => {
    if (blobUrl) return blobUrl;
    blobUrl = acquireBlobUrl(workerScript);
    return blobUrl;
  };

  const releaseWorkerScript = (): void => {
    if (hasReleasedBlobUrl || !blobUrl) return;
    hasReleasedBlobUrl = true;
    releaseBlobUrl(workerScript);
    blobUrl = null;
  };

  const getWorkerId = (worker: Worker): number | undefined =>
    (worker as any).__id;

  const removeFromIdleWorkers = (worker: Worker): void => {
    const index = idleWorkers.indexOf(worker);
    if (index >= 0) idleWorkers.splice(index, 1);
  };

  const cleanupWorkerWaiter = (
    waiter: (typeof workerWaiters)[number],
  ): void => {
    if (waiter.signal && waiter.abort) {
      waiter.signal.removeEventListener("abort", waiter.abort);
    }
  };

  const rejectWorkerWaiters = (error: Error): void => {
    while (workerWaiters.length > 0) {
      const waiter = workerWaiters.shift()!;
      cleanupWorkerWaiter(waiter);
      waiter.reject(error);
    }
  };

  const takeNextWorkerWaiter = () => {
    while (workerWaiters.length > 0) {
      const waiter = workerWaiters.shift()!;
      cleanupWorkerWaiter(waiter);
      if (waiter.signal?.aborted) {
        waiter.reject(createAbortError(waiter.signal));
        continue;
      }
      return waiter;
    }

    return undefined;
  };

  const rejectWorkerTasks = (workerId: number, error: Error): void => {
    for (const [taskId, pending] of pendingMessages) {
      if (pending.workerId !== workerId) continue;
      pendingMessages.delete(taskId);
      pending.reject(error);
    }
  };

  const detachWorker = (worker: Worker): void => {
    const workerId = getWorkerId(worker);
    if (workerId === undefined) return;

    const messageHandler = workerMessageHandlers.get(workerId);
    if (messageHandler) {
      worker.removeEventListener("message", messageHandler);
      workerMessageHandlers.delete(workerId);
    }

    const errorHandler = workerErrorHandlers.get(workerId);
    if (errorHandler) {
      worker.removeEventListener("error", errorHandler);
      workerErrorHandlers.delete(workerId);
    }
  };

  const terminateWorkerNow = (worker: Worker): void => {
    const workerId = getWorkerId(worker);
    detachWorker(worker);
    removeFromIdleWorkers(worker);
    if (workerId !== undefined) workers.delete(workerId);
    worker.terminate();
  };

  const createFinalizedActiveError = () =>
    new Error(`${name} finalized before the worker task completed`);
  const createFinalizedQueuedError = () =>
    new Error(`${name} finalized before a worker became available`);
  const createRunClosedError = () => new Error(`${name} is closed`);

  const finalizeGracefulClose = (): void => {
    if (lifecycle !== "closing" || isFinalized || admittedRuns > 0) return;

    isFinalized = true;
    const owned = [...workers.values()];
    workers.clear();
    idleWorkers.length = 0;

    for (const worker of owned) {
      detachWorker(worker);
      worker.terminate();
    }

    workerMessageHandlers.clear();
    workerErrorHandlers.clear();
    releaseWorkerScript();
    resolveClose?.();
    resolveClose = null;
  };

  const retireWorker = (worker: Worker, error?: Error): void => {
    const workerId = getWorkerId(worker);
    if (
      workerId === undefined ||
      (!workers.has(workerId) &&
        !workerMessageHandlers.has(workerId) &&
        !workerErrorHandlers.has(workerId))
    ) {
      return;
    }

    terminateWorkerNow(worker);
    if (error) rejectWorkerTasks(workerId, error);
    serviceWorkerWaiters();
    finalizeGracefulClose();
  };

  const createWorker = (): Worker => {
    const workerId = ++nextWorkerId;
    const worker = createModuleWorker(getWorkerScriptUrl());
    const messageHandler = createMessageHandler
      ? createMessageHandler(worker, pendingMessages)
      : createDefaultMessageHandler(worker, pendingMessages);
    const errorHandler = (event: ErrorEvent) => {
      const error =
        event.error instanceof Error
          ? event.error
          : new Error(event.message || `${name} worker failed`);
      retireWorker(worker, error);
    };

    worker.addEventListener("message", messageHandler);
    worker.addEventListener("error", errorHandler);
    (worker as any).__id = workerId;
    workerMessageHandlers.set(workerId, messageHandler);
    workerErrorHandlers.set(workerId, errorHandler);
    workers.set(workerId, worker);
    return worker;
  };

  const serviceWorkerWaiters = (): void => {
    while (workerWaiters.length > 0) {
      const waiter = takeNextWorkerWaiter();
      if (!waiter) return;

      const idleWorker = idleWorkers.shift();
      if (idleWorker) {
        waiter.resolve(idleWorker);
        continue;
      }

      if (maxWorkers === undefined || workers.size < maxWorkers) {
        try {
          waiter.resolve(createWorker());
        } catch (error) {
          waiter.reject(toError(error, `${name} worker creation failed`));
        }
        continue;
      }

      workerWaiters.unshift(waiter);
      return;
    }
  };

  const checkoutWorker = async (signal?: AbortSignal): Promise<Worker> => {
    if (signal?.aborted) throw createAbortError(signal);
    if (lifecycle === "finalizing" || isFinalized) {
      throw createFinalizedQueuedError();
    }

    const idleWorker = idleWorkers.shift();
    if (idleWorker) return idleWorker;
    if (maxWorkers === undefined || workers.size < maxWorkers) {
      return createWorker();
    }

    return new Promise<Worker>((resolve, reject) => {
      const waiter = {
        signal,
        resolve: (worker: Worker) => {
          cleanupWorkerWaiter(waiter);
          resolve(worker);
        },
        reject: (error: Error) => {
          cleanupWorkerWaiter(waiter);
          reject(error);
        },
      } as (typeof workerWaiters)[number];

      if (signal) {
        waiter.abort = () => {
          const index = workerWaiters.indexOf(waiter);
          if (index < 0) return;
          workerWaiters.splice(index, 1);
          cleanupWorkerWaiter(waiter);
          reject(createAbortError(signal));
        };
        signal.addEventListener("abort", waiter.abort, { once: true });
      }

      workerWaiters.push(waiter);
    });
  };

  const checkinWorker = (worker: Worker): void => {
    const workerId = getWorkerId(worker);
    if (workerId === undefined || !workers.has(workerId)) return;

    if (lifecycle === "finalizing" || isFinalized) {
      retireWorker(worker);
      return;
    }

    const waiter = takeNextWorkerWaiter();
    if (waiter) {
      waiter.resolve(worker);
      return;
    }

    idleWorkers.push(worker);
  };

  const submitTask = (
    worker: Worker,
    data: T,
    signal?: AbortSignal,
    transferables: Transferable[] = [],
  ): Promise<R> => {
    if (signal?.aborted) return Promise.reject(createAbortError(signal));
    if (lifecycle === "finalizing" || isFinalized) {
      return Promise.reject(createFinalizedActiveError());
    }

    const workerId = getWorkerId(worker);
    if (workerId === undefined || !workers.has(workerId)) {
      return Promise.reject(
        isFinalized
          ? createFinalizedActiveError()
          : new Error("Worker not found or is not active"),
      );
    }

    const taskId = generateTaskId();
    return new Promise<R>((resolve, reject) => {
      let settled = false;
      const cleanupAbort = () => signal?.removeEventListener("abort", onAbort);
      const finishResolve = (value: R) => {
        if (settled) return;
        settled = true;
        cleanupAbort();
        resolve(value);
      };
      const finishReject = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanupAbort();
        reject(error);
      };
      const onAbort = () => {
        if (settled) return;
        pendingMessages.delete(taskId);
        finishReject(createAbortError(signal));
        retireWorker(worker);
      };

      pendingMessages.set(taskId, {
        workerId,
        resolve: finishResolve,
        reject: finishReject,
      });
      signal?.addEventListener("abort", onAbort, { once: true });

      try {
        worker.postMessage(
          { workerId, taskId, payload: data, type: "task" },
          transferables,
        );
      } catch (error) {
        pendingMessages.delete(taskId);
        finishReject(toError(error, `${name} worker postMessage failed`));
        retireWorker(worker);
      }
    });
  };

  const run = async (value: T, control?: TaskRunControl): Promise<R> => {
    const { signal, transfer } = normalizeTaskRunControl(control);

    if (lifecycle === "closing") throw createRunClosedError();
    if (lifecycle === "finalizing" || isFinalized) {
      throw createFinalizedQueuedError();
    }

    admittedRuns += 1;
    try {
      const worker = await checkoutWorker(signal);
      try {
        return await submitTask(worker, value, signal, transfer);
      } finally {
        checkinWorker(worker);
      }
    } finally {
      admittedRuns = Math.max(0, admittedRuns - 1);
      finalizeGracefulClose();
    }
  };

  const close = (): Promise<void> => {
    if (isFinalized || lifecycle === "finalizing") return Promise.resolve();
    if (closePromise) return closePromise;

    lifecycle = "closing";
    closePromise = new Promise<void>((resolve) => {
      resolveClose = resolve;
    });
    finalizeGracefulClose();
    return closePromise;
  };

  const dispose = async (): Promise<void> => {
    if (isFinalized || lifecycle === "finalizing") return;

    lifecycle = "finalizing";
    isFinalized = true;

    pendingMessages.forEach(({ reject }) => {
      reject(createFinalizedActiveError());
    });
    pendingMessages.clear();
    rejectWorkerWaiters(createFinalizedQueuedError());

    const owned = [...workers.values()];
    workers.clear();
    idleWorkers.length = 0;

    for (const worker of owned) {
      detachWorker(worker);
      worker.terminate();
    }

    workerMessageHandlers.clear();
    workerErrorHandlers.clear();
    releaseWorkerScript();

    resolveClose?.();
    resolveClose = null;
  };

  return {
    run,
    close,
    dispose,
  };
}
````

## File: projects/libraries/swiftly/src/tests/actor.spec.ts
````typescript
import {
  actor,
  ActorBusMessage,
  background,
  channel,
  ContextCancelledError,
  isActorBusMessage,
  main,
  otherwise,
  operation,
  receive,
  registerActorRequestHandler,
  select,
  send,
  supervisor,
  withCancel,
} from "../public-api";
import {
  idescribe
} from "./env.spec";

idescribe("actor", () => {
  let originalWorker: any;
  let _originalLog: typeof console.log;
  let _originalError: typeof console.error;
  let _originalWarn: typeof console.warn;
  let actorCounter = 0;

  const nextActorName = () => `actor-${++actorCounter}`;
  const pause = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitForMainMessage = (
    predicate: (message: ActorBusMessage<any>) => boolean,
    timeoutMs = 200
  ) =>
    new Promise<ActorBusMessage<any>>((resolve, reject) => {
      let unsubscribe = () => {};
      const timeoutId = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Timed out waiting for actor-bus message after ${timeoutMs}ms`));
      }, timeoutMs);

      unsubscribe = main.inbox.subscribe((message: ActorBusMessage<any>) => {
        if (!predicate(message)) {
          return;
        }

        clearTimeout(timeoutId);
        unsubscribe();
        resolve(message);
      });
    });

  beforeAll(() => {
    originalWorker = (globalThis as any).Worker;
    _originalLog = console.log;
    _originalError = console.error;
    _originalWarn = console.warn;
    (globalThis as any).currentMainTask = undefined;

    class MockWorker {
      onmessage: ((ev: any) => void) | null = null;
      listeners: Record<string, ((ev: any) => void)[]> = {};
      terminated = false;
      readonly options: WorkerOptions | undefined;
      readonly sentMessages: any[] = [];
      private workerInbox = channel<any>();
      private busInbox = channel<any>();
      private mailboxCapacity: number | undefined;
      private actorState: any = undefined;
      private actorRunning = false;
      private actorStopping = false;
      private workerId = 1;
      private taskId = "";
      private pendingWorkerRequests = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }>();
      private requestCounter = 0;
      private timers = new Map<number, ReturnType<typeof setTimeout>>();

      constructor(_url: string, options?: WorkerOptions) {
        this.options = options;
        this.workerId = Math.floor(Math.random() * 100000);
        (globalThis as any).lastMockWorker = this;
      }

      emitError(error: Error) {
        const event = { error, message: error.message } as ErrorEvent;
        this.listeners["error"]?.forEach(fn => fn(event));
      }

      emitMessage(message: any) {
        const event = { data: message } as any;
        this.onmessage?.(event);
        this.listeners["message"]?.forEach(fn => fn(event));
      }

      get protocolIdentity() {
        const init = this.sentMessages.find((message: any) => message?.type === "init");
        return init
          ? { workerId: init.workerId, taskId: init.taskId }
          : { workerId: this.workerId, taskId: this.taskId };
      }

      get pendingWorkerRequestCount() {
        return this.pendingWorkerRequests.size;
      }

      private createWorkerUtils(message: { workerId: number; taskId: string }) {
        const post = (payload: any) => {
          const event = {
            data: { workerId: message.workerId, taskId: message.taskId, type: "notify", payload }
          } as any;
          this.onmessage?.(event);
          this.listeners["message"]?.forEach(fn => fn(event));
        };
        const outbox = {
          request: (to: string | string[], topic: string, requestPayload: any) => {
            if (this.actorStopping || !this.actorRunning) {
              return Promise.reject(new Error("Actor stopped"));
            }

            return new Promise((resolve, reject) => {
              this.requestCounter += 1;
              const requestId = message.taskId + ":request:" + this.requestCounter;
              this.pendingWorkerRequests.set(requestId, { resolve, reject });

              setTimeout(() => {
                const reqEvent = {
                  data: {
                    workerId: message.workerId,
                    taskId: message.taskId,
                    requestId,
                    to,
                    topic,
                    type: "request",
                    payload: requestPayload,
                  }
                } as any;
                this.onmessage?.(reqEvent);
                this.listeners["message"]?.forEach(fn => fn(reqEvent));
              }, 1);
            });
          },
          send: (to: string | string[], topic: string, payload: any) => {
            post({ kind: "actor-bus", to, topic, payload });
          },
        };
        return {
          outbox,
          inbox: {
            listen: async (signal?: AbortSignal) => {
              const result = await this.busInbox.receive(signal);
              return result.ok ? result.value : undefined;
            },
          },
          concurrency: {
            channel,
            receive,
            send,
            otherwise,
  operation,
            select,
            background,
            withCancel,
            ContextCancelledError,
          },
        };
      }

      private async runBehaviorLoop(_msg: any) {
        const utils = this.createWorkerUtils({ workerId: this.workerId, taskId: this.taskId });
        const mainTask = (globalThis as any).currentMainTask;
        if (!mainTask) return;

        while (this.actorRunning && !this.terminated) {
          const received = await this.workerInbox.receive();
          if (!received.ok) break;
          const envelope = received.value;

          let item = envelope;
          let requestId = null;

          if (envelope && typeof envelope === "object" && "requestId" in envelope) {
            requestId = envelope.requestId;
            item = envelope.msg;
          }

          try {
            const result = await Promise.resolve(mainTask(item, this.actorState, utils));
            this.actorState = result;

            if (requestId) {
              const event = {
                data: { workerId: this.workerId, taskId: this.taskId, requestId, type: "response", payload: result }
              } as any;
              this.onmessage?.(event);
              this.listeners["message"]?.forEach(fn => fn(event));
            }
          } catch (err: any) {
            if (this.actorStopping) {
              break;
            }

            if (requestId) {
              const requestError = {
                data: { workerId: this.workerId, taskId: this.taskId, requestId, type: "error", error: err.message }
              } as any;
              this.onmessage?.(requestError);
              this.listeners["message"]?.forEach(fn => fn(requestError));
            }

            this.actorRunning = false;
            const fatalError = {
              data: { workerId: this.workerId, taskId: this.taskId, type: "error", error: err.message }
            } as any;
            this.onmessage?.(fatalError);
            this.listeners["message"]?.forEach(fn => fn(fatalError));
            break;
          }
        }

        this.actorRunning = false;
        const stoppedEvent = { data: { workerId: this.workerId, taskId: this.taskId, type: "stopped" } } as any;
        this.onmessage?.(stoppedEvent);
        this.listeners["message"]?.forEach(fn => fn(stoppedEvent));
      }

      postMessage(msg: any) {
        this.sentMessages.push(msg);
        const injectedError = (globalThis as any).actorPostMessageError;
        if (typeof injectedError === "function") {
          const error = injectedError(msg);
          if (error) throw error;
        } else if (injectedError) {
          throw injectedError;
        }

        if (msg?.type === "set" && typeof msg.id === "number") {
          const handle = setTimeout(() => {
            this.timers.delete(msg.id);
            const event = { data: { type: "elapsed", id: msg.id } } as any;
            this.onmessage?.(event);
          }, msg.ms);
          this.timers.set(msg.id, handle);
          return;
        }

        if (msg?.type === "clear" && typeof msg.id === "number") {
          const handle = this.timers.get(msg.id);
          if (handle !== undefined) {
            clearTimeout(handle);
            this.timers.delete(msg.id);
          }
          return;
        }

        setTimeout(() => {
          if (this.terminated) return;

          if (msg.type === "init") {
            this.workerId = msg.workerId;
            this.taskId = msg.taskId;
            this.actorState = msg.payload;
            this.mailboxCapacity = msg.mailboxCapacity;
            if (this.mailboxCapacity !== undefined) {
              this.workerInbox = channel<any>(this.mailboxCapacity);
            }
            this.actorStopping = false;
            this.actorRunning = true;
            this.runBehaviorLoop(msg);
          } else if (msg.type === "stop") {
            this.actorStopping = true;
            this.actorRunning = false;
            for (const pending of this.pendingWorkerRequests.values()) {
              pending.reject(new Error("Actor stopped"));
            }
            this.pendingWorkerRequests.clear();
            this.workerInbox.close();
            this.busInbox.close();
          } else if (msg.type === "notify") {
            const accepted =
              this.mailboxCapacity === undefined
                ? (this.workerInbox.send(msg.payload).catch(() => {}), true)
                : this.workerInbox.trySend(msg.payload);

            if (!accepted) {
              const overflowEvent = {
                data: { workerId: this.workerId, taskId: this.taskId, type: "overflow" }
              } as any;
              this.onmessage?.(overflowEvent);
              this.listeners["message"]?.forEach(fn => fn(overflowEvent));
            } else if (
              msg.payload &&
              typeof msg.payload === "object" &&
              msg.payload.kind === "actor-bus"
            ) {
              this.busInbox.send(msg.payload).catch(() => {});
            }
          } else if (msg.type === "request" && msg.requestId) {
            const envelope = { msg: msg.payload, requestId: msg.requestId, topic: msg.topic };
            const accepted =
              this.mailboxCapacity === undefined
                ? (this.workerInbox.send(envelope).catch(() => {}), true)
                : this.workerInbox.trySend(envelope);

            if (!accepted) {
              const overflowEvent = {
                data: {
                  workerId: this.workerId,
                  taskId: this.taskId,
                  requestId: msg.requestId,
                  type: "error",
                  error: "Actor mailbox capacity exceeded",
                }
              } as any;
              this.onmessage?.(overflowEvent);
              this.listeners["message"]?.forEach(fn => fn(overflowEvent));
            }
          } else if ((msg.type === "response" || msg.type === "error") && msg.requestId) {
            const pending = this.pendingWorkerRequests.get(msg.requestId);
            if (pending) {
              this.pendingWorkerRequests.delete(msg.requestId);
              if (msg.type === "response") {
                pending.resolve(msg.payload);
              } else {
                pending.reject(new Error(msg.error || "Mock worker request failed"));
              }
            }
          }
        }, 1);
      }

      addEventListener(type: string, fn: (ev: any) => void) {
        this.listeners[type] ||= [];
        this.listeners[type].push(fn);
      }

      removeEventListener(type: string, fn: (ev: any) => void) {
        if (this.listeners[type]) {
          this.listeners[type] = this.listeners[type].filter(f => f !== fn);
        }
      }

      terminate() {
        this.terminated = true;
        this.actorRunning = false;
        for (const handle of this.timers.values()) clearTimeout(handle);
        this.timers.clear();
        this.workerInbox.close();
        this.listeners = {};
        this.onmessage = null;
      }
    }

    (globalThis as any).Worker = MockWorker;
  });

  afterAll(() => {
    (globalThis as any).Worker = originalWorker;
    console.log = _originalLog;
    console.error = _originalError;
    console.warn = _originalWarn;
    delete (globalThis as any).currentMainTask;
    delete (globalThis as any).lastMockWorker;
    delete (globalThis as any).actorPostMessageError;
  });

  beforeEach(() => {
    (globalThis as any).currentMainTask = undefined;
    delete (globalThis as any).actorPostMessageError;
    actorCounter = 0;
    main.inbox.clear();
  });

  it("should require a non-empty actor name", () => {
    expect(() => actor("", async (_msg: unknown, state: number) => state, 0)).toThrowError(
      "Actor name must be a non-empty string"
    );
  });



  it("cleans up actor construction when the init transport fails synchronously", () => {
    async function behavior(_msg: any, state: number) {
      return state;
    }

    (globalThis as any).currentMainTask = behavior;
    (globalThis as any).actorPostMessageError = new Error("init transport failed");

    expect(() =>
      actor(nextActorName(), behavior, 0)
    ).toThrowError("init transport failed");

    expect((globalThis as any).lastMockWorker.terminated).toBeTrue();
  });

  it("marks an actor failed when a request cannot be posted to its worker", async () => {
    async function behavior(_msg: any, state: number) {
      return state;
    }

    (globalThis as any).currentMainTask = behavior;
    const a = actor(nextActorName(), behavior, 0);

    (globalThis as any).actorPostMessageError = new Error("request transport failed");
    const pending = main.outbox.request(a, "state", undefined);

    await expectAsync(pending).toBeRejectedWithError("request transport failed");
    const exit = await a.done;
    expect(exit.reason).toBe("error");
    if (exit.reason === "error") {
      expect(exit.error.message).toBe("request transport failed");
    }
    expect(a.running).toBeFalse();
  });

  it("continues one-way bus delivery when one recipient transport fails", async () => {
    const received: string[] = [];

    async function behavior(msg: any, state: number, utils: any) {
      if (msg.kind === "actor-bus") {
        utils.outbox.send("main", "seen", msg.payload);
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;
    const first = actor(nextActorName(), behavior, 0);
    const firstWorker = (globalThis as any).lastMockWorker;
    const second = actor(nextActorName(), behavior, 0);

    const originalPost = firstWorker.postMessage.bind(firstWorker);
    firstWorker.postMessage = (msg: any) => {
      if (msg.type === "notify") throw new Error("first recipient failed");
      return originalPost(msg);
    };

    const seen$ = waitForMainMessage(
      (message) => message.to === "main" && message.topic === "seen" && message.payload === "broadcast",
    );

    main.outbox.publish("work", "broadcast");
    const seen = await seen$;

    expect(seen.payload).toBe("broadcast");
    await main.outbox.stop(second);
  });

  it("preserves stable name routing across supervisor restart construction", async () => {
    async function behavior(msg: any, state: number) {
      return msg === "state" ? state : state;
    }

    (globalThis as any).currentMainTask = behavior;
    const name = nextActorName();
    const supervised = supervisor(
      () => actor(name, behavior, 7),
      { maxRestarts: 1 },
    );

    (globalThis as any).lastMockWorker.emitError(new Error("restart generation"));
    await pause(25);

    expect(supervised.running).toBeTrue();
    expect(await main.outbox.request(name, "state", "state")).toBe(7);

    await main.outbox.stop(name);
  });


  it("actor worker select keeps same-registration send/receive cases from self-matching", async () => {
    async function behavior(msg: any, state: number, utils: any) {
      if (msg !== "check") return state;

      const ch = utils.concurrency.channel();
      const [ctx, cancel] = utils.concurrency.withCancel();

      const pending = utils.concurrency.select([
        utils.concurrency.receive(ch, "receive"),
        utils.concurrency.send(ch, 1, "send"),
      ], ctx);

      await Promise.resolve();
      cancel(new utils.concurrency.ContextCancelledError("worker select cancelled"));

      let rejected = false;
      try {
        await pending;
      } catch (error: any) {
        rejected = error?.message === "worker select cancelled";
      }

      return rejected && ch.tryReceive() === undefined && ch.trySend(2) === false
        ? 1
        : -1;
    }

    (globalThis as any).currentMainTask = behavior;
    const a = actor(nextActorName(), behavior, 0);

    expect(await main.outbox.request(a, "check", "check")).toBe(1);
    await main.outbox.stop(a);
  });

  it("should validate bounded actor mailbox capacity", () => {
    async function behavior(_msg: any, state: number) {
      return state;
    }

    expect(() =>
      actor(nextActorName(), behavior, 0, { capacity: -1 })
    ).toThrowError(/non-negative integer/);

    expect(() =>
      actor(nextActorName(), behavior, 0, { capacity: 1.5 })
    ).toThrowError(/non-negative integer/);
  });

  it("should bound queued actor requests without terminating the actor", async () => {
    async function behavior(msg: number, state: number) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return state + msg;
    }

    (globalThis as any).currentMainTask = behavior;
    const a = actor(nextActorName(), behavior, 0, { capacity: 1 });

    expect(a.mailboxCapacity).toBe(1);
    expect(a.dropped).toBe(0);

    const first = main.outbox.request(a, "add", 1);
    const second = main.outbox.request(a, "add", 2);
    const overflow = main.outbox.request(a, "add", 4);

    await expectAsync(overflow).toBeRejectedWithError(/mailbox capacity exceeded/);
    expect(await first).toBe(1);
    expect(await second).toBe(3);
    expect(a.running).toBeTrue();
    expect(a.dropped).toBe(0);

    await main.outbox.stop(a);
  });

  it("should count one-way messages dropped by a saturated bounded mailbox", async () => {
    async function behavior(_msg: any, state: number) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return state + 1;
    }

    (globalThis as any).currentMainTask = behavior;
    const a = actor(nextActorName(), behavior, 0, { capacity: 1 });

    main.outbox.send(a, "work", 1);
    main.outbox.send(a, "work", 2);
    main.outbox.send(a, "work", 3);

    await pause(10);

    expect(a.running).toBeTrue();
    expect(a.dropped).toBe(1);

    await pause(60);
    await main.outbox.stop(a);
  });

  it("capacity zero allows only direct handoff while behavior is ready", async () => {
    async function behavior(_msg: any, state: number) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return state + 1;
    }

    (globalThis as any).currentMainTask = behavior;
    const a = actor(nextActorName(), behavior, 0, { capacity: 0 });

    const first = main.outbox.request(a, "work", undefined);
    const second = main.outbox.request(a, "work", undefined);

    await expectAsync(second).toBeRejectedWithError(/mailbox capacity exceeded/);
    expect(await first).toBe(1);
    expect(a.running).toBeTrue();

    await main.outbox.stop(a);
  });

  it("should eagerly initialize behavior actor with state", async () => {
    async function behavior(msg: any, state: number) {
      if (msg.kind === "actor-bus" && msg.topic === "inc") return state + 1;
      if (msg.kind === "actor-bus" && msg.topic === "dec") return state - 1;
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(nextActorName(), behavior, 0);
    await new Promise(r => setTimeout(r, 10));
    expect(a.running).toBe(true);

    main.outbox.send(a, "inc", undefined);
    await new Promise(r => setTimeout(r, 10));
    expect(a.running).toBe(true);

    await main.outbox.stop(a);
  });

  it("should process multiple sends and update state", async () => {
    async function behavior(msg: any, state: number) {
      if (msg.kind === "actor-bus" && msg.topic === "add") return state + msg.payload.n;
      if (msg.kind === "actor-bus" && msg.topic === "sub") return state - msg.payload.n;
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(nextActorName(), behavior, 10);
    main.outbox.send(a, "add", { n: 5 });
    main.outbox.send(a, "sub", { n: 3 });
    main.outbox.send(a, "add", { n: 2 });

    const state = await main.outbox.request(a, "add", { n: 0 });
    expect(state).toBe(14);

    await main.outbox.stop(a);
  });

  it("should request and receive updated state", async () => {
    async function behavior(msg: number, state: number) {
      return state + msg;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(nextActorName(), behavior, 0);

    const s1 = await main.outbox.request(a, "add", 5);
    expect(s1).toBe(5);

    const s2 = await main.outbox.request(a, "add", 3);
    expect(s2).toBe(8);

    await main.outbox.stop(a);
  });

  it("should deliver direct bus messages to main listeners", async () => {
    const messages: Array<{ topic: string; payload: string; from?: string }> = [];

    async function behavior(msg: any, state: number, utils: any) {
      if (msg.kind === "actor-bus" && msg.topic === "ping") {
        utils.outbox.send("main", "reply", "pong");
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(nextActorName(), behavior, 0);
    const unsubscribe = main.inbox.subscribe((message: ActorBusMessage<any>) => {
      if (message.to === "main") {
        messages.push({ topic: message.topic, payload: message.payload, from: message.from });
      }
    });

    main.outbox.send(a, "ping", undefined);
    await new Promise(r => setTimeout(r, 20));

    expect(messages).toEqual([{ topic: "reply", payload: "pong", from: a.name }]);
    unsubscribe();
    await main.outbox.stop(a);
  });

  it("should allow unsubscribing from main bus listeners", async () => {
    const messages: string[] = [];

    async function behavior(msg: any, state: number, utils: any) {
      if (msg.kind === "actor-bus" && msg.topic === "ping") {
        utils.outbox.send("main", "reply", "pong");
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(nextActorName(), behavior, 0);
    const unsubscribe = main.inbox.subscribe((message: ActorBusMessage<any>) => {
      if (message.to === "main") {
        messages.push(message.payload);
      }
    });
    unsubscribe();

    main.outbox.send(a, "ping", undefined);
    await new Promise(r => setTimeout(r, 20));

    expect(messages).toEqual([]);
    await main.outbox.stop(a);
  });

  it("should stop behavior actor gracefully", async () => {
    async function behavior(_msg: any, state: number) {
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(nextActorName(), behavior, 0);
    main.outbox.send(a, "anything", undefined);
    await new Promise(r => setTimeout(r, 10));
    expect(a.running).toBe(true);

    await main.outbox.stop(a);
    expect(a.running).toBe(false);
  });

  it("should race cancellable operations inside behavior actor", async () => {
    async function behavior(msg: any, state: number, utils: any) {
      if (msg.kind !== "actor-bus" || msg.topic !== "run") return state;

      const { operation, select } = utils.concurrency;
      let loserAborted = false;

      const result = await select([
        operation(async (signal: AbortSignal) => {
          await new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => {
              loserAborted = true;
              resolve();
            }, { once: true });
          });
          return "loser";
        }, "loser"),
        operation(() => "winner", "winner"),
      ]);

      await Promise.resolve();
      utils.outbox.send("main", "selected", {
        name: result.name,
        loserAborted,
      });
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(nextActorName(), behavior, 0);
    const selected$ = waitForMainMessage(
      (message) => message.to === "main" && message.topic === "selected"
    );

    main.outbox.send(a, "run", undefined);
    const selected = await selected$;

    expect(selected.payload).toEqual({ name: "winner", loserAborted: true });
    await main.outbox.stop(a);
  });

  it("should use concurrency utils inside behavior actor", async () => {
    async function behavior(_msg: any, state: number, utils: any) {
      const { channel: ch, receive, send, select, otherwise } = utils.concurrency;
      const c = ch(2);
      await c.send(1);
      await c.send(2);
      const r1 = await c.receive();
      const r2 = await c.receive();
      const s = send(c, 3, "s");
      const rc = receive(c, "r");
      const sel = await select([s, rc, otherwise("def")]);
      return {
        state,
        r1: r1.ok ? r1.value : undefined,
        r2: r2.ok ? r2.value : undefined,
        selName: sel.name,
      };
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(nextActorName(), behavior as any, 42);
    const result = await main.outbox.request(a, "go", undefined) as any;

    expect(result.state).toBe(42);
    expect(result.r1).toBe(1);
    expect(result.r2).toBe(2);
    expect(["s", "r", "def"]).toContain(result.selName);
    await main.outbox.stop(a);
  });

  it("should reject request after stop", async () => {
    async function behavior(_msg: any, state: number) {
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(nextActorName(), behavior, 0);
    main.outbox.send(a, "x", undefined);
    await new Promise(r => setTimeout(r, 10));

    await main.outbox.stop(a);
    await expectAsync(main.outbox.request(a, "y", undefined)).toBeRejectedWithError("Actor stopped");
  });

  it("should reject in-flight requests when stopped", async () => {
    async function behavior(msg: string, state: number) {
      if (msg === "wait") {
        return new Promise<number>(() => {});
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(nextActorName(), behavior, 0);
    const pending = main.outbox.request(a, "wait", "wait");
    pending.catch(() => {}); // prevent unhandled rejection warning

    await new Promise(r => setTimeout(r, 10));
    await main.outbox.stop(a);

    await expectAsync(pending).toBeRejectedWithError("Actor stopped");
  });

  it("should support direct messages and requests", async () => {
    async function behavior(msg: number, state: number) {
      return state + msg;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(nextActorName(), behavior, 5);

    const state = await main.outbox.request(a, "add", 10);
    expect(state).toBe(15);
    await main.outbox.stop(a);
  });

  it('should call the source actor request handler when worker requests "main"', async () => {
    const onRequest = jasmine.createSpy("onRequest").and.callFake((topic: string, payload: string) => {
      expect(topic).toBe("echo");
      return payload.toUpperCase();
    });

    async function behavior(msg: any, state: number, utils: any) {
      if (msg.kind === "actor-bus") {
        const response = await utils.outbox.request("main", "echo", msg.payload);
        utils.outbox.send("main", "response", response);
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(nextActorName(), behavior, 0);
    const unregister = registerActorRequestHandler("main", onRequest);
    const response$ = waitForMainMessage(
      (message) => message.to === "main" && message.topic === "response"
    );
    main.outbox.send(a, "hello", "hello");
    const response = await response$;

    expect(onRequest).toHaveBeenCalled();
    expect(response.payload).toBe("HELLO");
    unregister();
    await main.outbox.stop(a);
  });

  it("should keep multiple main bus listeners independent", async () => {
    const allMessages: string[] = [];
    const directMessages: string[] = [];

    async function behavior(msg: any, state: number, utils: any) {
      if (msg.kind === "actor-bus" && msg.topic === "go") {
        utils.outbox.send("main", "ping", "ping");
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(nextActorName(), behavior, 0);
    const unsubscribeAll = main.inbox.subscribe((message: ActorBusMessage<any>) => {
      if (message.to === "main" && message.topic === "ping") {
        allMessages.push(message.payload);
      }
    });
    const unsubscribeDirect = main.inbox.subscribe((message: ActorBusMessage<any>) => {
      if (message.to === "main" && message.topic === "ping") {
        directMessages.push(message.payload);
      }
    });

    main.outbox.send(a, "go", undefined);
    await new Promise(r => setTimeout(r, 20));

    expect(allMessages).toEqual(["ping"]);
    expect(directMessages).toEqual(["ping"]);
    unsubscribeAll();
    unsubscribeDirect();
    await main.outbox.stop(a);
  });

  it("should deliver multiple direct bus messages to main in order", async () => {
    const seen: string[] = [];

    async function behavior(msg: any, state: number, utils: any) {
      if (msg.kind === "actor-bus" && msg.topic === "double") {
        utils.outbox.send("main", "step", "first");
        utils.outbox.send("main", "step", "second");
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor("global-source", behavior, 0);
    const unsubscribe = main.inbox.subscribe((message: ActorBusMessage<any>) => {
      if (message.to === "main" && message.topic === "step") {
        seen.push(message.payload);
      }
    });

    main.outbox.send(a, "double", undefined);
    await new Promise(r => setTimeout(r, 20));

    expect(seen).toEqual(["first", "second"]);

    unsubscribe();
    await main.outbox.stop(a);
  });

  it("should route worker requests to named actor request handlers", async () => {
    async function requesterBehavior(msg: any, state: number, utils: any) {
      if (msg.kind === "actor-bus" && msg.topic === "ask") {
        const response = await utils.outbox.request("responder", "greet", "hello");
        utils.outbox.send("main", "response", response);
      }
      return state;
    }

    async function responderBehavior(_msg: unknown, state: number) {
      return state;
    }

    (globalThis as any).currentMainTask = requesterBehavior;

    const requester = actor("requester", requesterBehavior, 0);
    const responder = actor("responder", responderBehavior, 0);
    const unregister = registerActorRequestHandler("responder", (topic: string, payload: string) => {
      expect(topic).toBe("greet");
      return payload.toUpperCase();
    });
    const response$ = waitForMainMessage(
      (message) => message.to === "main" && message.topic === "response"
    );
    main.outbox.send(requester, "ask", undefined);
    const response = await response$;

    expect(response.payload).toBe("HELLO");

    unregister();
    await Promise.all([main.outbox.stop(requester), main.outbox.stop(responder)]);
  });

  it("should target explicit actors through utils.outbox.send", async () => {
    type State = { role: "sender" | "receiver"; hits: number[] };

    async function behavior(msg: unknown, state: State, utils: any) {
      if (state.role === "sender" && isActorBusMessage(msg) && msg.topic === "direct") {
        utils.outbox.send("beta", "direct", 7);
        return state;
      }

      if (state.role === "receiver" && isActorBusMessage<number>(msg) && msg.topic === "direct") {
        return {
          ...state,
          hits: [...state.hits, msg.payload],
        };
      }

      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const senderActor = actor("sender", behavior, { role: "sender", hits: [] });
    const alpha = actor("alpha", behavior, { role: "receiver", hits: [] });
    const beta = actor("beta", behavior, { role: "receiver", hits: [] });

    main.outbox.send(senderActor, "direct", undefined);
    await new Promise(r => setTimeout(r, 20));

    const [alphaState, betaState] = await Promise.all([
      main.outbox.request<unknown, State>(alpha, "read", undefined),
      main.outbox.request<unknown, State>(beta, "read", undefined),
    ]);

    expect(alphaState.hits).toEqual([]);
    expect(betaState.hits).toEqual([7]);

    await Promise.all([main.outbox.stop(senderActor), main.outbox.stop(alpha), main.outbox.stop(beta)]);
  });

  it("should publish from main.bus to every actor", async () => {
    type State = { hits: string[] };

    async function behavior(msg: unknown, state: State) {
      if (isActorBusMessage<string>(msg) && msg.topic === "announce") {
        return {
          hits: [...state.hits, msg.payload],
        };
      }

      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const alpha = actor("alpha", behavior, { hits: [] });
    const beta = actor("beta", behavior, { hits: [] });
    main.outbox.publish("announce", "yes");
    await new Promise(r => setTimeout(r, 20));

    const [alphaState, betaState] = await Promise.all([
      main.outbox.request<unknown, State>("alpha", "read", undefined),
      main.outbox.request<unknown, State>("beta", "read", undefined),
    ]);

    expect(alphaState.hits).toEqual(["yes"]);
    expect(betaState.hits).toEqual(["yes"]);

    await Promise.all([main.outbox.stop(alpha), main.outbox.stop(beta)]);
  });

  it("should deliver published bus messages to global main inbox listeners", async () => {
    const seen: Array<{ topic: string; payload: string; from?: string }> = [];

    async function behavior(_msg: unknown, state: number) {
      return state;
    }


    (globalThis as any).currentMainTask = behavior;

    const alpha = actor("alpha", behavior, 0);
    const unsubscribe = main.inbox.subscribe((message: ActorBusMessage<any>) => {
      seen.push({ topic: message.topic, payload: message.payload, from: message.from });
    });

    main.outbox.publish("announce", "yes");
    await new Promise(r => setTimeout(r, 20));

    expect(seen).toEqual([{ topic: "announce", payload: "yes", from: "main" }]);

    unsubscribe();
    await main.outbox.stop(alpha);
  });

  it("should publish from main.outbox to every actor", async () => {
    type State = { hits: string[] };

    async function behavior(msg: unknown, state: State) {
      if (isActorBusMessage<string>(msg) && msg.topic === "announce") {
        return {
          hits: [...state.hits, msg.payload],
        };
      }

      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const alpha = actor("alpha", behavior, { hits: [] });
    const beta = actor("beta", behavior, { hits: [] });
    main.outbox.publish<string>("announce", "yes");
    await new Promise(r => setTimeout(r, 20));

    const [alphaState, betaState] = await Promise.all([
      main.outbox.request<unknown, State>("alpha", "read", undefined),
      main.outbox.request<unknown, State>("beta", "read", undefined),
    ]);

    expect(alphaState.hits).toEqual(["yes"]);
    expect(betaState.hits).toEqual(["yes"]);

    await Promise.all([main.outbox.stop(alpha), main.outbox.stop(beta)]);
  });

  it("should deliver direct bus messages to main", async () => {
    const seen: Array<{ topic: string; payload: string; from?: string }> = [];

    async function behavior(msg: any, state: number, utils: any) {
      if (msg.kind === "actor-bus" && msg.topic === "report") {
        utils.outbox.send("main", "status", "ready");
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const reporter = actor("reporter", behavior, 0);
    const unsubscribe = main.inbox.subscribe((message: ActorBusMessage<any>) => {
      if (message.to === "main") {
        seen.push({ topic: message.topic, payload: message.payload, from: message.from });
      }
    });

    main.outbox.send("reporter", "report", undefined);
    await new Promise(r => setTimeout(r, 20));

    expect(seen).toEqual([{ topic: "status", payload: "ready", from: "reporter" }]);

    unsubscribe();
    await main.outbox.stop(reporter);
  });

  it("should send direct messages from main.outbox", async () => {
    type State = { hits: number[] };

    async function behavior(msg: unknown, state: State) {
      if (isActorBusMessage<number>(msg) && typeof msg.payload === "number") {
        return {
          hits: [...state.hits, msg.payload],
        };
      }

      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const alpha = actor("alpha", behavior, { hits: [] });
    const beta = actor("beta", behavior, { hits: [] });
    main.outbox.send<number>("beta", "hit", 7);
    await new Promise(r => setTimeout(r, 20));

    const [alphaState, betaState] = await Promise.all([
      main.outbox.request<unknown, State>("alpha", "read", undefined),
      main.outbox.request<unknown, State>("beta", "read", undefined),
    ]);

    expect(alphaState.hits).toEqual([]);
    expect(betaState.hits).toEqual([7]);

    await Promise.all([main.outbox.stop(alpha), main.outbox.stop(beta)]);
  });

  it("should reject requests and stops for unknown actor targets", async () => {
    await expectAsync(main.outbox.request("missing", "topic", 1)).toBeRejectedWithError(
      'Unknown actor target "missing"'
    );
    await expectAsync(main.outbox.stop("missing")).toBeRejectedWithError(
      'Unknown actor target "missing"'
    );
  });

  it("should deduplicate repeated direct send targets", async () => {
    type State = { hits: number[] };

    async function behavior(msg: unknown, state: State) {
      if (isActorBusMessage<number>(msg) && msg.topic === "hit") {
        return { hits: [...state.hits, msg.payload] };
      }

      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const alpha = actor("alpha", behavior, { hits: [] });
    const beta = actor("beta", behavior, { hits: [] });
    const gamma = actor("gamma", behavior, { hits: [] });

    main.outbox.send(["alpha", "beta", "alpha"], "hit", 7);
    await pause();

    const [alphaState, betaState, gammaState] = await Promise.all([
      main.outbox.request<unknown, State>("alpha", "read", undefined),
      main.outbox.request<unknown, State>("beta", "read", undefined),
      main.outbox.request<unknown, State>("gamma", "read", undefined),
    ]);

    expect(alphaState.hits).toEqual([7]);
    expect(betaState.hits).toEqual([7]);
    expect(gammaState.hits).toEqual([]);

    await Promise.all([main.outbox.stop(alpha), main.outbox.stop(beta), main.outbox.stop(gamma)]);
  });

  it("should exclude the sender during publish unless includeSelf is enabled", async () => {
    type State = { hits: string[] };

    async function behavior(msg: unknown, state: State) {
      if (isActorBusMessage<string>(msg) && msg.topic === "announce") {
        return { hits: [...state.hits, msg.payload] };
      }

      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const alpha = actor("alpha", behavior, { hits: [] });
    const beta = actor("beta", behavior, { hits: [] });

    main.outbox.publish("announce", "first", { from: "alpha" });
    main.outbox.publish("announce", "second", { from: "alpha", includeSelf: true });
    await pause();

    const [alphaState, betaState] = await Promise.all([
      main.outbox.request<unknown, State>("alpha", "read", undefined),
      main.outbox.request<unknown, State>("beta", "read", undefined),
    ]);

    expect(alphaState.hits).toEqual(["second"]);
    expect(betaState.hits).toEqual(["first", "second"]);

    await Promise.all([main.outbox.stop(alpha), main.outbox.stop(beta)]);
  });

  it("should swallow async main inbox subscriber failures", async () => {
    const seen: string[] = [];

    async function behavior(msg: any, state: number, utils: any) {
      if (msg.kind === "actor-bus" && msg.topic === "ping") {
        utils.outbox.send("main", "reply", "pong");
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const warn = spyOn(console, "warn");
    const a = actor(nextActorName(), behavior, 0);
    const unsubscribeFailing = main.inbox.subscribe(async (message: ActorBusMessage<any>) => {
      if (message.to === "main") {
        throw new Error("subscriber failed");
      }
    });
    const unsubscribeHealthy = main.inbox.subscribe((message: ActorBusMessage<any>) => {
      if (message.to === "main") {
        seen.push(message.payload);
      }
    });

    main.outbox.send(a, "ping", undefined);
    await pause();

    expect(seen).toEqual(["pong"]);
    expect(warn).toHaveBeenCalled();
    expect(warn.calls.mostRecent().args[0]).toBe("Actor bus subscriber failed:");

    unsubscribeFailing();
    unsubscribeHealthy();
    await main.outbox.stop(a);
  });

  it("should reject worker requests with multiple targets", async () => {
    async function behavior(msg: any, state: number, utils: any) {
      if (msg.kind === "actor-bus" && msg.topic === "go") {
        try {
          await utils.outbox.request(["main", "other"], "echo", "hello");
        } catch (error: any) {
          utils.outbox.send("main", "error", error.message);
        }
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(nextActorName(), behavior, 0);
    const error$ = waitForMainMessage(
      (message) => message.to === "main" && message.topic === "error"
    );
    main.outbox.send(a, "go", undefined);
    const errorMessage = await error$;

    expect(errorMessage.payload).toBe("Actor request requires exactly one target");

    await main.outbox.stop(a);
  });

  it("should reject worker requests without a registered target handler", async () => {
    async function behavior(msg: any, state: number, utils: any) {
      if (msg.kind === "actor-bus" && msg.topic === "go") {
        try {
          await utils.outbox.request("missing", "echo", "hello");
        } catch (error: any) {
          utils.outbox.send("main", "error", error.message);
        }
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(nextActorName(), behavior, 0);
    const error$ = waitForMainMessage(
      (message) => message.to === "main" && message.topic === "error"
    );
    main.outbox.send(a, "go", undefined);
    const errorMessage = await error$;

    expect(errorMessage.payload).toBe('No actor request handler registered for "missing"');

    await main.outbox.stop(a);
  });

  it("should reject worker requests without a topic", async () => {
    async function behavior(msg: any, state: number, utils: any) {
      if (msg.kind === "actor-bus" && msg.topic === "go") {
        try {
          await utils.outbox.request("main", "", "hello");
        } catch (error: any) {
          utils.outbox.send("main", "error", error.message);
        }
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(nextActorName(), behavior, 0);
    const error$ = waitForMainMessage(
      (message) => message.to === "main" && message.topic === "error"
    );
    const unregister = registerActorRequestHandler("main", () => "ok");

    main.outbox.send(a, "go", undefined);
    const errorMessage = await error$;

    expect(errorMessage.payload).toBe("Actor request requires a topic");

    unregister();
    await main.outbox.stop(a);
  });

  it("should convert async worker request handler rejections into error messages", async () => {
    async function behavior(msg: any, state: number, utils: any) {
      if (msg.kind === "actor-bus" && msg.topic === "go") {
        try {
          await utils.outbox.request("main", "echo", "hello");
        } catch (error: any) {
          utils.outbox.send("main", "error", error.message);
        }
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(nextActorName(), behavior, 0);
    const error$ = waitForMainMessage(
      (message) => message.to === "main" && message.topic === "error"
    );
    const unregister = registerActorRequestHandler("main", () => Promise.reject("bad request"));

    main.outbox.send(a, "go", undefined);
    const errorMessage = await error$;

    expect(errorMessage.payload).toBe("bad request");

    unregister();
    await main.outbox.stop(a);
  });

  it("should fall back to a default message for falsy worker request errors", async () => {
    async function behavior(msg: any, state: number, utils: any) {
      if (msg.kind === "actor-bus" && msg.topic === "go") {
        try {
          await utils.outbox.request("main", "echo", "hello");
        } catch (error: any) {
          utils.outbox.send("main", "error", error.message);
        }
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(nextActorName(), behavior, 0);
    const error$ = waitForMainMessage(
      (message) => message.to === "main" && message.topic === "error"
    );
    const unregister = registerActorRequestHandler("main", () => {
      throw undefined;
    });

    main.outbox.send(a, "go", undefined);
    const errorMessage = await error$;

    expect(errorMessage.payload).toBe("Actor request failed");

    unregister();
    await main.outbox.stop(a);
  });
  it("should expose normal actor termination through done", async () => {
    async function behavior(_msg: any, state: number) {
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(nextActorName(), behavior, 0);
    const done = a.done;

    await main.outbox.stop(a);

    expect(await done).toEqual({ reason: "stopped" });
    expect(a.running).toBe(false);
  });

  it("should surface worker failure through done and stop the actor", async () => {
    async function behavior(_msg: any, state: number) {
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(nextActorName(), behavior, 0);
    const failure = new Error("worker crashed");
    const worker = (globalThis as any).lastMockWorker;

    worker.emitError(failure);

    const exit = await a.done;
    expect(exit.reason).toBe("error");
    if (exit.reason === "error") {
      expect(exit.error).toBe(failure);
    }
    expect(a.running).toBe(false);
  });

  it("should settle actor done only once when stop is repeated", async () => {
    async function behavior(_msg: any, state: number) {
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(nextActorName(), behavior, 0);

    await Promise.all([main.outbox.stop(a), main.outbox.stop(a)]);

    expect(await a.done).toEqual({ reason: "stopped" });
  });



  it("cancels in-flight main-to-actor requests without stopping the actor", async () => {
    async function behavior(msg: any, state: number) {
      return typeof msg === "number" ? state + msg : state;
    }

    (globalThis as any).currentMainTask = behavior;
    const a = actor(nextActorName(), behavior, 0);
    const controller = new AbortController();

    const pending = main.outbox.request(a, "slow", 1, controller.signal);
    controller.abort(new ContextCancelledError("request cancelled"));

    await expectAsync(pending).toBeRejectedWithError(ContextCancelledError, "request cancelled");
    expect(a.running).toBe(true);

    await main.outbox.stop(a);
  });


  it("ignores a response correlated to the right request but the wrong actor generation", async () => {
    async function behavior(msg: number, state: number) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return state + msg;
    }

    (globalThis as any).currentMainTask = behavior;
    const a = actor(nextActorName(), behavior, 0);
    const worker = (globalThis as any).lastMockWorker;

    const pending = main.outbox.request<number, number>(a, "add", 5);
    let settled = false;
    pending.finally(() => {
      settled = true;
    });

    const requestMessage = worker.sentMessages.find((message: any) => message.type === "request");
    expect(requestMessage).toBeDefined();

    worker.emitMessage({
      ...requestMessage,
      workerId: requestMessage.workerId + 1000,
      type: "response",
      payload: 999,
    });

    await pause(5);
    expect(settled).toBeFalse();

    await expectAsync(pending).toBeResolvedTo(5);
    await main.outbox.stop(a);
  });

  it("creates actor workers as native ES module workers", async () => {
    async function behavior(_msg: any, state: number) {
      return state;
    }

    (globalThis as any).currentMainTask = behavior;
    const a = actor(nextActorName(), behavior, 0);
    const worker = (globalThis as any).lastMockWorker;

    expect(worker.options?.type).toBe("module");

    await main.outbox.stop(a);
  });

  it("uses a unique protocol identity for every actor generation", async () => {
    async function behavior(_msg: any, state: number) {
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const first = actor(nextActorName(), behavior, 0);
    const firstWorker = (globalThis as any).lastMockWorker;
    await Promise.resolve();
    const firstIdentity = {
      ...firstWorker.protocolIdentity,
    };

    const second = actor(nextActorName(), behavior, 0);
    const secondWorker = (globalThis as any).lastMockWorker;
    await Promise.resolve();
    const secondIdentity = {
      ...secondWorker.protocolIdentity,
    };

    expect(secondIdentity.workerId).not.toBe(firstIdentity.workerId);
    expect(secondIdentity.taskId).not.toBe(firstIdentity.taskId);

    await main.outbox.stop(first);
    await main.outbox.stop(second);
  });

  it("does not write an async worker request response into a generation that stopped meanwhile", async () => {
    let resolveHandler!: (value: string) => void;
    const handlerResult = new Promise<string>((resolve) => {
      resolveHandler = resolve;
    });
    const handler = jasmine.createSpy("lateHandler").and.returnValue(handlerResult);

    async function behavior(msg: any, state: number, utils: any) {
      if (msg.kind === "actor-bus" && msg.topic === "lookup") {
        await utils.outbox.request("main", "lookup", msg.payload);
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;
    const a = actor(nextActorName(), behavior, 0);
    const worker = (globalThis as any).lastMockWorker;
    const unregister = registerActorRequestHandler("main", handler);

    main.outbox.send(a, "lookup", "value");
    await pause(10);

    expect(handler).toHaveBeenCalled();
    expect(worker.pendingWorkerRequestCount).toBe(1);

    await main.outbox.stop(a);
    expect(worker.pendingWorkerRequestCount).toBe(0);

    const sentAtStop = worker.sentMessages.length;
    resolveHandler("late result");
    await pause(5);

    expect(worker.sentMessages.length).toBe(sentAtStop);

    unregister();
  });

  it("settles an in-flight main request exactly once when stop races a late response", async () => {
    async function behavior(msg: number, state: number) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return state + msg;
    }

    (globalThis as any).currentMainTask = behavior;
    const a = actor(nextActorName(), behavior, 0);

    let settlements = 0;
    const pending = main.outbox.request<number, number>(a, "add", 1);
    pending.then(
      () => settlements += 1,
      () => settlements += 1,
    );

    await pause(5);
    const stopping = main.outbox.stop(a);

    await expectAsync(pending).toBeRejectedWithError("Actor stopped");
    await stopping;
    await pause(30);

    expect(settlements).toBe(1);
    expect((await a.done).reason).toBe("stopped");
  });


  it("does not admit new worker-to-main requests after actor shutdown begins", async () => {
    const handler = jasmine.createSpy("shutdownHandler").and.returnValue("unexpected");

    async function behavior(msg: any, state: number, utils: any) {
      if (msg.kind === "actor-bus" && msg.topic === "late-request") {
        await new Promise((resolve) => setTimeout(resolve, 20));
        await utils.outbox.request("main", "late", msg.payload);
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;
    const unregister = registerActorRequestHandler("main", handler);
    const a = actor(nextActorName(), behavior, 0);

    main.outbox.send(a, "late-request", "value");
    await pause(5);
    await main.outbox.stop(a);
    await pause(25);

    expect(handler).not.toHaveBeenCalled();
    expect((await a.done).reason).toBe("stopped");

    unregister();
  });

  it("validates supervisor restart-window capacity", () => {
    async function behavior(_msg: any, state: number) {
      return state;
    }

    (globalThis as any).currentMainTask = behavior;
    expect(() => supervisor(
      () => actor(nextActorName(), behavior, 0),
      { capacity: -1 },
    )).toThrowError(/capacity/);
  });


  it("supervisor preserves mailbox drop accounting across generations", async () => {
    async function behavior(_msg: any, state: number) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return state;
    }

    (globalThis as any).currentMainTask = behavior;
    const name = nextActorName();
    const supervised = supervisor(
      () => actor(name, behavior, 0, { capacity: 1 }),
      { maxRestarts: 1 },
    );

    main.outbox.send(supervised, "work", 1);
    main.outbox.send(supervised, "work", 2);
    main.outbox.send(supervised, "work", 3);
    await pause(10);

    expect(supervised.mailboxCapacity).toBe(1);
    expect(supervised.dropped).toBe(1);

    (globalThis as any).lastMockWorker.emitError(new Error("restart"));
    await pause(20);

    expect(supervised.dropped).toBe(1);
    await main.outbox.stop(supervised);
  });

  it("supervisor restarts failed actors behind a stable handle", async () => {
    async function behavior(_msg: any, state: number) {
      return state;
    }

    (globalThis as any).currentMainTask = behavior;
    const name = nextActorName();
    const supervised = supervisor(
      () => actor(name, behavior, 0),
      { maxRestarts: 2 },
    );

    const first = supervised.current;
    expect(first).toBeDefined();
    expect(supervised.name).toBe(name);

    (globalThis as any).lastMockWorker.emitError(new Error("generation failed"));
    await pause(20);

    expect(supervised.restarts).toBe(1);
    expect(supervised.current).toBeDefined();
    expect(supervised.current).not.toBe(first);
    expect(supervised.running).toBe(true);

    await main.outbox.stop(supervised);
    expect((await supervised.done).reason).toBe("stopped");
  });

  it("supervisor stops after exhausting its restart budget", async () => {
    async function behavior(_msg: any, state: number) {
      return state;
    }

    (globalThis as any).currentMainTask = behavior;
    const name = nextActorName();
    const supervised = supervisor(
      () => actor(name, behavior, 0),
      { maxRestarts: 1 },
    );

    (globalThis as any).lastMockWorker.emitError(new Error("first failure"));
    await pause(20);
    expect(supervised.restarts).toBe(1);

    (globalThis as any).lastMockWorker.emitError(new Error("terminal failure"));
    const exit = await supervised.done;

    expect(exit.reason).toBe("error");
    if (exit.reason === "error") {
      expect(exit.error.message).toBe("terminal failure");
    }
    expect(supervised.running).toBe(false);
  });



  it("behavior failure terminates the actor generation", async () => {
    async function behavior(msg: any, state: number) {
      if (msg?.kind === "actor-bus" && msg.topic === "crash") {
        throw new Error("behavior crashed");
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;
    const a = actor(nextActorName(), behavior, 0);

    main.outbox.send(a, "crash", undefined);
    const exit = await a.done;

    expect(exit.reason).toBe("error");
    if (exit.reason === "error") {
      expect(exit.error.message).toBe("behavior crashed");
    }
    expect(a.running).toBeFalse();
  });

  it("supervisor restarts after an unhandled behavior failure", async () => {
    async function behavior(msg: any, state: number) {
      if (msg?.kind === "actor-bus" && msg.topic === "crash") {
        throw new Error("behavior crashed");
      }
      if (msg?.kind === "actor-bus" && msg.topic === "inc") return state + 1;
      return state;
    }

    (globalThis as any).currentMainTask = behavior;
    const name = nextActorName();
    const supervised = supervisor(
      () => actor(name, behavior, 0),
      { maxRestarts: 2 },
    );
    const first = supervised.current;

    main.outbox.send(supervised, "crash", undefined);
    await pause(30);

    expect(supervised.restarts).toBe(1);
    expect(supervised.current).not.toBe(first);
    expect(supervised.running).toBeTrue();

    await main.outbox.stop(supervised);
  });

  it("supervisor buffers bounded restart-window traffic when configured", async () => {
    async function behavior(msg: any, state: number) {
      if (msg?.kind === "actor-bus" && msg.topic === "crash") {
        throw new Error("behavior crashed");
      }
      if (msg?.kind === "actor-bus" && msg.topic === "inc") return state + 1;
      return state;
    }

    (globalThis as any).currentMainTask = behavior;
    const name = nextActorName();
    const supervised = supervisor(
      () => actor(name, behavior, 0),
      { maxRestarts: 2, restartDelay: 25, capacity: 2 },
    );

    main.outbox.send(supervised, "crash", undefined);
    await pause(5);
    expect(supervised.running).toBeFalse();

    main.outbox.send(supervised, "inc", undefined);
    const state$ = main.outbox.request<any, number>(supervised, "state", undefined);
    expect(supervised.pending).toBe(2);

    expect(await state$).toBe(1);
    expect(supervised.pending).toBe(0);
    expect(supervised.capacity).toBe(2);

    await main.outbox.stop(supervised);
  });

  it("supervisor rejects restart-window ingress beyond capacity", async () => {
    async function behavior(msg: any, state: number) {
      if (msg?.kind === "actor-bus" && msg.topic === "crash") {
        throw new Error("behavior crashed");
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;
    const name = nextActorName();
    const supervised = supervisor(
      () => actor(name, behavior, 0),
      { maxRestarts: 1, restartDelay: 25, capacity: 1 },
    );

    main.outbox.send(supervised, "crash", undefined);
    await pause(5);

    const first = main.outbox.request(supervised, "first", undefined);
    await expectAsync(
      main.outbox.request(supervised, "overflow", undefined)
    ).toBeRejectedWithError(/capacity exceeded/);

    await expectAsync(first).toBeResolved();
    await main.outbox.stop(supervised);
  });

  it("cancels a request while it is buffered for supervisor restart", async () => {
    async function behavior(msg: any, state: number) {
      if (msg?.kind === "actor-bus" && msg.topic === "crash") {
        throw new Error("behavior crashed");
      }
      if (typeof msg === "number") return state + msg;
      return state;
    }

    (globalThis as any).currentMainTask = behavior;
    const name = nextActorName();
    const supervised = supervisor(
      () => actor(name, behavior, 0),
      { maxRestarts: 1, restartDelay: 25, capacity: 2 },
    );

    main.outbox.send(supervised, "crash", undefined);
    await pause(5);

    const controller = new AbortController();
    const pending = main.outbox.request(supervised, "add", 5, controller.signal);
    expect(supervised.pending).toBe(1);
    controller.abort(new ContextCancelledError("cancel buffered request"));

    await expectAsync(pending).toBeRejectedWithError(ContextCancelledError, "cancel buffered request");
    expect(supervised.pending).toBe(0);

    await pause(35);
    expect(await main.outbox.request(supervised, "state", undefined)).toBe(0);
    await main.outbox.stop(supervised);
  });


  it("rejects replacement generations that change the supervised actor name", async () => {
    async function behavior(msg: any, state: number) {
      return msg === "state" ? state : state;
    }

    (globalThis as any).currentMainTask = behavior;
    const name = nextActorName();
    const wrongName = `${name}-wrong`;
    let generations = 0;

    const supervised = supervisor(
      () => {
        generations += 1;
        if (generations === 2) return actor(wrongName, behavior, 99);
        return actor(name, behavior, 7);
      },
      { maxRestarts: 2 },
    );

    (globalThis as any).lastMockWorker.emitError(new Error("restart"));
    await pause(35);

    expect(generations).toBe(3);
    expect(supervised.restarts).toBe(2);
    expect(supervised.running).toBeTrue();
    expect(await main.outbox.request(name, "state", "state")).toBe(7);
    await expectAsync(main.outbox.request(wrongName, "state", "state")).toBeRejectedWithError(
      /Unknown actor target/,
    );

    await main.outbox.stop(supervised);
  });

  it("keeps lifecycle observation attached when buffered ingress fails during restart flush", async () => {
    async function behavior(msg: any, state: number) {
      return msg === "state" ? state : state;
    }

    (globalThis as any).currentMainTask = behavior;
    const name = nextActorName();
    const supervised = supervisor(
      () => actor(name, behavior, 11),
      { maxRestarts: 2, restartDelay: 10, capacity: 1 },
    );

    (globalThis as any).lastMockWorker.emitError(new Error("first generation failed"));
    await pause(2);
    main.outbox.send(supervised, "queued", "value");
    expect(supervised.pending).toBe(1);

    (globalThis as any).actorPostMessageError = (msg: any) =>
      msg.type === "notify" ? new Error("flush transport failed") : undefined;

    await pause(35);
    delete (globalThis as any).actorPostMessageError;

    expect(supervised.restarts).toBe(2);
    expect(supervised.running).toBeTrue();
    expect(supervised.pending).toBe(0);
    expect(await main.outbox.request(supervised, "state", "state")).toBe(11);

    await main.outbox.stop(supervised);
  });

  it("supervisor retries replacement factory failures within the restart budget", async () => {
    async function behavior(_msg: any, state: number) {
      return state;
    }

    (globalThis as any).currentMainTask = behavior;
    const name = nextActorName();
    let generations = 0;
    const supervised = supervisor(
      () => {
        generations += 1;
        if (generations === 2) throw new Error("replacement creation failed");
        return actor(name, behavior, 0);
      },
      { maxRestarts: 2 },
    );

    (globalThis as any).lastMockWorker.emitError(new Error("generation failed"));
    await pause(30);

    expect(generations).toBe(3);
    expect(supervised.restarts).toBe(2);
    expect(supervised.running).toBeTrue();

    await main.outbox.stop(supervised);
  });


});
````

## File: projects/libraries/swiftly/src/tests/worker.spec.ts
````typescript
import {
  createDefaultMessageHandler,
  generateTaskId,
  type PendingTaskMap,
  type WorkerProtocolMessage,
} from "../lib/worker";
import { createTaskRunner } from "../lib/worker/runner";
import { scheduleWorkerTimer } from "../lib/worker/timer";
import { idescribe } from "./env.spec";

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

class MockWorker {
  static instances: MockWorker[] = [];
  static postMessageError: unknown = null;

  onmessage: ((event: MessageEvent<any>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  private timers = new Map<number, ReturnType<typeof setTimeout>>();

  readonly listeners = new Map<string, Array<(event: any) => void>>();
  readonly url: string;
  readonly options: WorkerOptions | undefined;
  readonly sentMessages: WorkerProtocolMessage[] = [];
  readonly sentTransfers: Transferable[][] = [];
  terminated = false;
  __id?: number;

  constructor(url: string, options?: WorkerOptions) {
    this.url = url;
    this.options = options;
    MockWorker.instances.push(this);
  }

  addEventListener(type: string, listener: (event: any) => void) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: any) => void) {
    const listeners = this.listeners.get(type);
    if (!listeners) return;
    const index = listeners.indexOf(listener);
    if (index >= 0) listeners.splice(index, 1);
  }

  postMessage(message: WorkerProtocolMessage | any, transfer: Transferable[] = []) {
    if (MockWorker.postMessageError !== null) {
      throw MockWorker.postMessageError;
    }

    this.sentMessages.push(message);
    this.sentTransfers.push([...transfer]);

    if (message?.type === "set" && typeof message.id === "number") {
      const handle = setTimeout(() => {
        this.timers.delete(message.id);
        this.onmessage?.({
          data: { type: "elapsed", id: message.id },
        } as MessageEvent<any>);
      }, message.ms);
      this.timers.set(message.id, handle);
    } else if (message?.type === "clear" && typeof message.id === "number") {
      const handle = this.timers.get(message.id);
      if (handle !== undefined) {
        clearTimeout(handle);
        this.timers.delete(message.id);
      }
    }
  }

  terminate() {
    this.terminated = true;
    for (const handle of this.timers.values()) clearTimeout(handle);
    this.timers.clear();
    this.onmessage = null;
    this.onerror = null;
  }

  dispatch(message: WorkerProtocolMessage) {
    const event = { data: message } as MessageEvent<WorkerProtocolMessage>;
    for (const listener of [...(this.listeners.get("message") || [])]) {
      listener(event);
    }
  }

  dispatchError(error: unknown, message = "worker failed") {
    const event = {
      error,
      message,
    } as ErrorEvent;
    for (const listener of [...(this.listeners.get("error") || [])]) {
      listener(event);
    }
  }
}

idescribe("worker helpers", () => {
  let originalWorker: any;
  let warnSpy: jasmine.Spy;

  beforeAll(() => {
    originalWorker = (globalThis as any).Worker;
    (globalThis as any).Worker = MockWorker;
  });

  beforeEach(() => {
    MockWorker.instances.length = 0;
    MockWorker.postMessageError = null;
    warnSpy = spyOn(console, "warn");
  });

  afterAll(() => {
    (globalThis as any).Worker = originalWorker;
  });

  describe("createDefaultMessageHandler", () => {
    it("resolves and rejects pending tasks, including fallback worker errors", async () => {
      const pendingTasks: PendingTaskMap = new Map();
      const worker = {} as Worker;
      const handler = createDefaultMessageHandler(worker, pendingTasks);

      let resolvedValue: unknown;
      let rejectedError: Error | undefined;
      pendingTasks.set("ok", {
        workerId: 1,
        resolve: (value) => {
          resolvedValue = value;
        },
        reject: () => fail("response should not reject"),
      });
      pendingTasks.set("bad", {
        workerId: 1,
        resolve: () => fail("error should not resolve"),
        reject: (error) => {
          rejectedError = error;
        },
      });

      handler({ data: { workerId: 1, taskId: "ok", type: "response", payload: 42 } } as any);
      handler({ data: { workerId: 1, taskId: "bad", type: "error", error: "   " } } as any);
      handler({ data: { workerId: 1, taskId: "missing", type: "response", payload: 99 } } as any);

      expect(resolvedValue).toBe(42);
      expect(rejectedError?.message).toBe("Unknown worker error");
      expect(pendingTasks.has("ok")).toBeFalse();
      expect(pendingTasks.has("bad")).toBeFalse();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("routes request and notify hooks and warns when hooks fail or are missing", async () => {
      const pendingTasks: PendingTaskMap = new Map();
      const worker = {} as Worker;
      const onRequest = jasmine.createSpy("onRequest").and.resolveTo();
      const onWorkerMessage = jasmine.createSpy("onWorkerMessage").and.resolveTo();
      const handler = createDefaultMessageHandler(worker, pendingTasks, {
        onRequest,
        onWorkerMessage,
      });

      const requestMessage = { workerId: 1, taskId: "r", type: "request", payload: "rq" } as const;
      const notifyMessage = { workerId: 1, taskId: "n", type: "notify", payload: "nt" } as const;

      handler({ data: requestMessage } as any);
      handler({ data: notifyMessage } as any);
      await flush();

      expect(onRequest).toHaveBeenCalledWith(requestMessage);
      expect(onWorkerMessage).toHaveBeenCalledWith(notifyMessage);

      const failingHandler = createDefaultMessageHandler(worker, pendingTasks, {
        onRequest: async () => {
          throw new Error("request hook boom");
        },
        onWorkerMessage: async () => {
          throw new Error("notify hook boom");
        },
      });

      failingHandler({ data: requestMessage } as any);
      failingHandler({ data: notifyMessage } as any);
      await flush();

      const defaultHandler = createDefaultMessageHandler(worker, pendingTasks);
      defaultHandler({ data: requestMessage } as any);
      defaultHandler({ data: notifyMessage } as any);
      defaultHandler({ data: { workerId: 1, taskId: "u", type: "stopped" } } as any);

      expect(warnSpy.calls.allArgs().map(args => String(args[0]))).toEqual([
        "Worker request hook failed:",
        "Worker message hook failed:",
        "Unhandled worker request:",
        "Unhandled worker message:",
        "Unknown message type from worker:",
      ]);
    });
  });


  describe("module worker invariant", () => {
    it("creates task workers as native ES module workers", async () => {
      const runner = createTaskRunner<number, number>({
        name: "module-runner",
        main: (value: number) => value,
        functions: [],
        generateWorkerScript: () => "module-worker-script",
      });

      const pending = runner.run(1);
      await flush();

      const worker = MockWorker.instances[0];
      expect(worker.options?.type).toBe("module");

      const message = worker.sentMessages[0];
      worker.dispatch({ ...message, type: "response", payload: 1 });
      await expectAsync(pending).toBeResolvedTo(1);
      await runner.dispose();
    });

    it("creates the shared timer worker as a native ES module worker", () => {
      const timer = scheduleWorkerTimer(10000, () => fail("timer should not elapse"));
      const worker = MockWorker.instances[0];

      expect(worker.options?.type).toBe("module");

      timer.cancel();
    });
  });

  describe("worker script ownership", () => {
    it("acquires blob URLs lazily and releases them only after worker use", async () => {
      const createUrl = spyOn(URL, "createObjectURL").and.returnValue("blob:swiftly-lazy");
      const revokeUrl = spyOn(URL, "revokeObjectURL");

      const unused = createTaskRunner<number, number>({
        name: "unused-runner",
        main: (value: number) => value,
        functions: [],
        generateWorkerScript: () => "unused-lazy-worker-script",
      });

      expect(createUrl).not.toHaveBeenCalled();
      await unused.dispose();
      expect(createUrl).not.toHaveBeenCalled();
      expect(revokeUrl).not.toHaveBeenCalled();

      const used = createTaskRunner<number, number>({
        name: "used-runner",
        main: (value: number) => value,
        functions: [],
        generateWorkerScript: () => "used-lazy-worker-script",
      });
      const pending = used.run(1);
      await flush();

      expect(createUrl).toHaveBeenCalledTimes(1);
      const worker = MockWorker.instances[MockWorker.instances.length - 1];
      const message = worker.sentMessages[0];
      worker.dispatch({ ...message, type: "response", payload: 1 });
      await expectAsync(pending).toBeResolvedTo(1);
      await used.close();

      expect(revokeUrl).toHaveBeenCalledWith("blob:swiftly-lazy");
    });

;
  });

  describe("createTaskRunner", () => {
    const createRunner = (name = "runner") =>
      createTaskRunner<number, number>({
        name,
        main: (value: number) => value,
        functions: [],
        generateWorkerScript: () => "runner-worker-script",
      });

    it("creates workers lazily for concurrent demand and reuses idle workers", async () => {
      const runner = createRunner();

      const first = runner.run(1);
      const second = runner.run(2);
      const third = runner.run(3);
      await flush();

      expect(MockWorker.instances.length).toBe(3);

      MockWorker.instances.forEach((worker, index) => {
        const message = worker.sentMessages[0];
        worker.dispatch({ ...message, type: "response", payload: index + 10 });
      });

      await expectAsync(first).toBeResolvedTo(10);
      await expectAsync(second).toBeResolvedTo(11);
      await expectAsync(third).toBeResolvedTo(12);

      const reused = runner.run(4);
      await flush();
      expect(MockWorker.instances.length).toBe(3);
      const reusedWorker = MockWorker.instances.find(worker => worker.sentMessages.length === 2)!;
      const message = reusedWorker.sentMessages[1];
      reusedWorker.dispatch({ ...message, type: "response", payload: 40 });
      await expectAsync(reused).toBeResolvedTo(40);

      await runner.dispose();
    });

    it("queues submissions when maxWorkers is reached", async () => {
      const runner = createTaskRunner<number, number>({
        name: "bounded-runner",
        maxWorkers: 1,
        main: (value: number) => value,
        functions: [],
        generateWorkerScript: () => "runner-worker-script",
      });

      const first = runner.run(1);
      const second = runner.run(2);
      await flush();

      expect(MockWorker.instances.length).toBe(1);
      const worker = MockWorker.instances[0];
      expect(worker.sentMessages.length).toBe(1);

      const firstMessage = worker.sentMessages[0];
      worker.dispatch({ ...firstMessage, type: "response", payload: 10 });
      await expectAsync(first).toBeResolvedTo(10);

      await flush();
      expect(worker.sentMessages.length).toBe(2);

      const secondMessage = worker.sentMessages[1];
      worker.dispatch({ ...secondMessage, type: "response", payload: 20 });
      await expectAsync(second).toBeResolvedTo(20);

      await runner.dispose();
    });

    it("isolates worker failure from concurrent submissions", async () => {
      const runner = createRunner("failure-runner");
      const failed = runner.run(1);
      const healthy = runner.run(2);
      await flush();

      const failedWorker = MockWorker.instances[0];
      const healthyWorker = MockWorker.instances[1];

      failedWorker.dispatchError(new Error("worker boom"));
      await expectAsync(failed).toBeRejectedWithError("worker boom");

      const message = healthyWorker.sentMessages[0];
      healthyWorker.dispatch({ ...message, type: "response", payload: 20 });
      await expectAsync(healthy).toBeResolvedTo(20);

      expect(failedWorker.terminated).toBeTrue();
      await runner.dispose();
    });

    it("cancels one active submission by retiring only its worker", async () => {
      const runner = createRunner("cancel-runner");
      const controller = new AbortController();

      const cancelled = runner.run(1, controller.signal);
      const healthy = runner.run(2);
      await flush();

      const cancelledWorker = MockWorker.instances[0];
      const healthyWorker = MockWorker.instances[1];

      controller.abort(new Error("cancel task"));
      await expectAsync(cancelled).toBeRejectedWithError("cancel task");
      expect(cancelledWorker.terminated).toBeTrue();

      const message = healthyWorker.sentMessages[0];
      healthyWorker.dispatch({ ...message, type: "response", payload: 22 });
      await expectAsync(healthy).toBeResolvedTo(22);

      await runner.dispose();
    });

    it("passes transfer ownership when a submission is posted", async () => {
      const runner = createTaskRunner<ArrayBuffer, number>({
        name: "transfer-runner",
        main: (value: ArrayBuffer) => value.byteLength,
        functions: [],
        generateWorkerScript: () => "runner-worker-script",
      });
      const buffer = new ArrayBuffer(16);
      const pending = runner.run(buffer, { transfer: [buffer] });
      await flush();

      const worker = MockWorker.instances[0];
      expect(worker.sentTransfers[0]).toEqual([buffer]);
      const message = worker.sentMessages[0];
      worker.dispatch({ ...message, type: "response", payload: 16 });

      await expectAsync(pending).toBeResolvedTo(16);
      await runner.dispose();
    });

    it("close drains all admitted submissions then releases every worker", async () => {
      const runner = createRunner("closing-runner");
      const first = runner.run(1);
      const second = runner.run(2);
      await flush();

      const closing = runner.close();
      await expectAsync(runner.run(3)).toBeRejectedWithError("closing-runner is closed");

      MockWorker.instances.forEach((worker, index) => {
        const message = worker.sentMessages[0];
        worker.dispatch({ ...message, type: "response", payload: index + 1 });
      });

      await expectAsync(first).toBeResolvedTo(1);
      await expectAsync(second).toBeResolvedTo(2);
      await expectAsync(closing).toBeResolved();
      expect(MockWorker.instances.every(worker => worker.terminated)).toBeTrue();
    });

    it("dispose immediately rejects all active submissions and settles close", async () => {
      const runner = createRunner("dispose-runner");
      const first = runner.run(1);
      const second = runner.run(2);
      await flush();

      const closing = runner.close();
      await runner.dispose();

      await expectAsync(first).toBeRejectedWithError(/finalized before the worker task completed/);
      await expectAsync(second).toBeRejectedWithError(/finalized before the worker task completed/);
      await expectAsync(closing).toBeResolved();
      expect(MockWorker.instances.every(worker => worker.terminated)).toBeTrue();
    });

    it("wraps worker construction and postMessage failures", async () => {
      const originalWorkerCtor = (globalThis as any).Worker;

      class ThrowingWorker {
        constructor() {
          throw new Error("worker ctor error");
        }
      }

      (globalThis as any).Worker = ThrowingWorker;
      const ctorRunner = createRunner("ctor-runner");
      await expectAsync(ctorRunner.run(1)).toBeRejectedWithError("worker ctor error");
      await ctorRunner.dispose();

      (globalThis as any).Worker = originalWorkerCtor;
      MockWorker.postMessageError = new Error("postMessage boom");
      const postRunner = createRunner("post-runner");
      await expectAsync(postRunner.run(1)).toBeRejectedWithError("postMessage boom");
      await postRunner.dispose();
    });
  });

  describe("generateTaskId", () => {
    it("uses crypto.randomUUID when available and falls back otherwise", () => {
      const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
      const randomUUID = crypto.randomUUID;

      spyOn(crypto, "randomUUID").and.returnValue("uuid-value" as any);
      expect(generateTaskId()).toBe("uuid-value");

      if (cryptoDescriptor?.configurable) {
        Object.defineProperty(globalThis, "crypto", {
          value: { ...crypto, randomUUID: undefined },
          configurable: true,
        });
      } else {
        Object.defineProperty(crypto, "randomUUID", {
          value: undefined,
          configurable: true,
        });
      }

      const fallback = generateTaskId();
      expect(fallback).toContain("-");

      if (cryptoDescriptor?.configurable) {
        Object.defineProperty(globalThis, "crypto", cryptoDescriptor);
      } else {
        Object.defineProperty(crypto, "randomUUID", {
          value: randomUUID,
          configurable: true,
        });
      }
    });
  });

  describe("worker timer lifecycle", () => {
    it("fails remaining timers coherently when timer cancellation cannot post", async () => {
      let otherError: Error | undefined;

      const first = scheduleWorkerTimer(1000, () => fail("first timer should be cancelled"));
      scheduleWorkerTimer(
        1000,
        () => fail("second timer should fail with the worker"),
        (error) => {
          otherError = error;
        },
      );

      MockWorker.postMessageError = new Error("timer post failed");

      expect(first.cancel()).toBeTrue();
      expect(otherError?.message).toBe("timer post failed");
      expect(MockWorker.instances[0].terminated).toBeTrue();
    });


    it("mass cancellation releases the shared timer worker exactly after the last timer", () => {
      const timers = Array.from({ length: 200 }, () =>
        scheduleWorkerTimer(10000, () => fail("cancelled timer elapsed")),
      );

      expect(MockWorker.instances.length).toBe(1);
      const timerWorker = MockWorker.instances[0];

      for (let index = 0; index < timers.length - 1; index++) {
        expect(timers[index].cancel()).toBeTrue();
        expect(timerWorker.terminated).toBeFalse();
      }

      expect(timers[timers.length - 1].cancel()).toBeTrue();
      expect(timerWorker.terminated).toBeTrue();

      for (const timer of timers) {
        expect(timer.cancel()).toBeFalse();
      }
    });

    it("notifies every pending timer even when one failure callback throws", () => {
      const notified: string[] = [];
      let queuedThrow: (() => void) | undefined;
      const queueMicrotaskSpy = spyOn(globalThis, "queueMicrotask").and.callFake((callback: VoidFunction) => {
        queuedThrow = callback;
      });

      scheduleWorkerTimer(
        1000,
        () => fail("timer should fail"),
        () => {
          notified.push("first");
          throw new Error("failure callback exploded");
        },
      );
      scheduleWorkerTimer(
        1000,
        () => fail("timer should fail"),
        () => {
          notified.push("second");
        },
      );
      scheduleWorkerTimer(
        1000,
        () => fail("timer should fail"),
        () => {
          notified.push("third");
        },
      );

      const timerWorker = MockWorker.instances[0] as any;

      expect(() =>
        timerWorker.onerror({
          error: new Error("timer worker failed"),
          message: "timer worker failed",
        }),
      ).not.toThrow();

      expect(notified).toEqual(["first", "second", "third"]);
      expect(timerWorker.terminated).toBeTrue();
      expect(queueMicrotaskSpy).toHaveBeenCalled();
      expect(queuedThrow).toBeDefined();
      expect(() => queuedThrow?.()).toThrowError("failure callback exploded");
    });

    it("releases an idle timer worker even when the elapsed callback throws", () => {
      scheduleWorkerTimer(
        1,
        () => {
          throw new Error("elapsed callback exploded");
        },
      );

      const timerWorker = MockWorker.instances[0] as any;
      const setMessage = timerWorker.sentMessages[0] as any;

      expect(() =>
        timerWorker.onmessage({
          data: { type: "elapsed", id: setMessage.id },
        }),
      ).toThrowError("elapsed callback exploded");

      expect(timerWorker.terminated).toBeTrue();
    });

    it("ignores stale timer worker errors after the worker has been released", () => {
      const timer = scheduleWorkerTimer(1000, () => {});
      const oldWorker = MockWorker.instances[0] as any;

      expect(timer.cancel()).toBeTrue();
      expect(oldWorker.terminated).toBeTrue();

      let failed = false;
      const current = scheduleWorkerTimer(
        1000,
        () => {},
        () => {
          failed = true;
        },
      );

      oldWorker.onerror?.({
        error: new Error("stale failure"),
        message: "stale failure",
      });

      expect(failed).toBeFalse();
      current.cancel();
    });
  });


});
````

## File: projects/libraries/swiftly/src/lib/abstractions/actor.ts
````typescript
import {
    background,
    channel,
    ChannelClosedError,
    ContextCancelledError,
    createAbortError,
    otherwise,
    operation,
    receive,
    select,
    send,
    sleep,
    withCancel,
    withDeadline,
    withTimeout,
} from "../utils";
import { acquireBlobUrl, releaseBlobUrl } from "../worker/blob";
import type { WorkerProtocolMessage } from "../worker/messages";
import { createModuleWorker } from "../worker/module";
import { buildActorWorkerRuntime } from "../worker/runtimes";
import { ACTOR_CONCURRENCY_RUNTIME } from "../worker/concurrency";
import { buildWorkerScript } from "../worker/script";
import type { Actor, ActorExit, ActorOptions, Supervisor, SupervisorOptions } from "../worker/types";
import {
  clearActorBusListeners,
  createActorBusMessage,
  dispatchActorBusMessage,
  getActorInternals,
  getActorRequestHandler,
  isActorBusMessage,
  normalizeActorBusTargets,
  registerActorBusTarget,
  resolveActorBusTarget,
  resolveActorTarget,
  setActorInternals,
  subscribeActorBus,
  tryActorInternals,
  unregisterActorBusTarget,
} from "./bus";
import type {
  ActorBusDispatchOptions,
  ActorBusHandler,
  ActorBusMessage,
  ActorBusTarget,
} from "./bus";
export type { Actor, ActorExit, ActorOptions, Supervisor, SupervisorOptions } from "../worker/types";
export { supervisor } from "./supervisor";
export {
  createActorBusMessage,
  isActorBusMessage,
  registerActorRequestHandler,
  unregisterActorRequestHandler,
} from "./bus";
export type {
  ActorBus,
  ActorBusDispatchOptions,
  ActorBusHandler,
  ActorBusMessage,
  ActorBusSender,
  ActorBusTarget,
  ActorMessageContext,
  ActorRequestHandler,
} from "./bus";

/**
 * Concurrency utils injected into actor workers.
 *
 * These are the worker-side coroutine primitives available inside
 * `actor((msg, state, utils) => ...)`.
 *
 * They mirror the standalone concurrency API, but are pre-injected into the
 * actor worker so behaviors can coordinate background tasks without importing
 * anything from the main thread.
 *
 * - `channel(capacity?)`: create a worker-local async channel
 * - `receive(ch, name?)` / `send(ch, value, name?)`: build `select(...)` cases
 * - `otherwise(name?)`: default `select(...)` branch
 * - `operation(run, name?)`: cancellable async `select(...)` contender
 * - `select(cases, ctx?)`: race channel and async operations fairly
 * - `background()`: root cancellation context
 * - `withCancel/withTimeout/withDeadline(...)`: derive cancellable contexts
 * - `sleep(ms, signal?)`: suspend on the actor worker event loop
 * - `ChannelClosedError` / `ContextCancelledError`: worker-side error classes
 */
export type WorkerConcurrency = {
  channel: typeof channel;
  receive: typeof receive;
  send: typeof send;
  otherwise: typeof otherwise;
  operation: typeof operation;
  select: typeof select;
  background: typeof background;
  withCancel: typeof withCancel;
  withTimeout: typeof withTimeout;
  withDeadline: typeof withDeadline;
  sleep: typeof sleep;
  ChannelClosedError: typeof ChannelClosedError;
  ContextCancelledError: typeof ContextCancelledError;
};

/**
 * Outbox API exposed to actor workers.
 *
 * This handles targeted requests plus direct sends.
 */
export type WorkerOutbox<Q = any, D = any> = {
  /** Sends a request to one named target and awaits a response. Use `"main"` for the source actor's main-thread side. */
  request: (to: ActorBusTarget, topic: string, payload: Q) => Promise<D>;
  /** Sends a direct bus message to one or more named actor targets. */
  send: <T = any>(to: ActorBusTarget, topic: string, payload: T) => void;
};

/**
 * Inbox API for receiving messages routed to the actor worker.
 *
 * This includes direct messages from `main.outbox.send(...)` as well as actor-bus
 * deliveries routed through `main.bus`.
 */
export type WorkerInbox<Incoming = any> = {
  /** Receives the next message routed to this actor, or `undefined` if the inbox closes. */
  listen: (signal?: AbortSignal) => Promise<Incoming | undefined>;
};

/**
 * Main-thread communication interface.
 *
 * `Initiator` describes the public shape of `main` so that consumers can
 * reference it explicitly rather than deriving it via `typeof main`.
 */
export interface Initiator {
  outbox: {
    /** Broadcasts a topic payload to every named actor through the actor bus. */
    publish<T = any>(topic: string, payload: T, options?: ActorBusDispatchOptions): void;

    /** Sends a one-way bus message to one or more named actor targets. */
    send<T = any>(to: Actor | string | string[], topic: string, payload: T, options?: Pick<ActorBusDispatchOptions, "from">): void;

    /** Sends a request to an actor and awaits the response. */
    request<Q = any, D = any>(to: Actor | string, topic: string, payload: Q, signal?: AbortSignal): Promise<D>;

    /** Stops the actor, terminates its worker, and releases resources. */
    stop(actor: Actor | string): Promise<void>;
  };

  inbox: {
    /** Subscribes to all actor-bus messages. */
    subscribe(handler: ActorBusHandler): () => void;
    /** Clears all global and direct bus listeners. */
    clear(): void;
  };
}

export type WorkerUtils<Q = any, D = any, Incoming = any, ToMain = any> = {
  concurrency: WorkerConcurrency;
  outbox: WorkerOutbox<Q, D>;
  inbox: WorkerInbox<Incoming>;
};

/**
 * Actor behavior signature for autonomous entity mode.
 *
 * Receives a message, the current state, and worker utilities.
 * Returns the new state (or a Promise resolving to it).
 */
export interface ActorBehavior<S = any, Q = any, D = any, Incoming = any> {
  (msg: Incoming, state: S, utils: WorkerUtils<Q, D, Incoming>): Promise<S> | S;
}




const ACTOR_TERMINATION_TIMEOUT_MS = 100;
const ACTOR_STOPPED_ERROR_MESSAGE = "Actor stopped";
let actorGenerationCounter = 0;

type PendingActorRequest<S> = {
  resolve: (value: S) => void;
  reject: (error: Error) => void;
  cleanup?: () => void;
};

const toErrorMessage = (
  error: unknown,
  fallback = "Actor request failed"
): string => (error instanceof Error ? error.message : error ? String(error) : fallback);

function postActorResponse(
  sourceActor: Actor,
  worker: Worker,
  message: Pick<WorkerProtocolMessage, "workerId" | "taskId" | "requestId"> &
    ({ type: "response"; payload: unknown } | { type: "error"; error: string })
): boolean {
  if (!sourceActor.running) {
    return false;
  }

  try {
    worker.postMessage(message);
    return true;
  } catch (error) {
    console.warn("Actor request response transport failed:", error);
    return false;
  }
}

function handleRequest<Q>(
  message: WorkerProtocolMessage,
  sourceActor: Actor,
  worker: Worker
) {
  const { workerId, taskId, requestId, payload, topic } = message;
  const targets = normalizeActorBusTargets(message.to);

  if (targets.length !== 1) {
    postActorResponse(sourceActor, worker, {
      workerId,
      taskId,
      requestId,
      type: "error",
      error: "Actor request requires exactly one target",
    });
    return;
  }

  const targetName = targets[0];
  const handler = getActorRequestHandler(targetName);

  if (!handler) {
    postActorResponse(sourceActor, worker, {
      workerId,
      taskId,
      requestId,
      type: "error",
      error: `No actor request handler registered for "${targetName}"`,
    });
    return;
  }

  if (!topic) {
    postActorResponse(sourceActor, worker, {
      workerId,
      taskId,
      requestId,
      type: "error",
      error: "Actor request requires a topic",
    });
    return;
  }

  try {
    const result = handler(topic, payload as Q, {
      from: sourceActor.name,
      to: message.to,
      topic,
    });
    Promise.resolve(result)
      .then((resolved) => {
        postActorResponse(sourceActor, worker, {
          workerId,
          taskId,
          requestId,
          type: "response",
          payload: resolved,
        });
      })
      .catch((err) => {
        postActorResponse(sourceActor, worker, {
          workerId,
          taskId,
          requestId,
          type: "error",
          error: toErrorMessage(err),
        });
      });
  } catch (err) {
    postActorResponse(sourceActor, worker, {
      workerId,
      taskId,
      requestId,
      type: "error",
      error: toErrorMessage(err),
    });
  }
}

/**
 * Creates an autonomous behavior-mode actor.
 *
 * `actor(name, behavior, initialState, ...helpers)` eagerly creates one
 * stable named actor worker and returns its handle.
 *
 * @example
 * ```ts
 * const counter = actor(
 *   "counter",
 *   (msg, state) =>
 *     msg.kind === "actor-bus" && msg.topic === "inc"
 *       ? state + msg.payload.n
 *       : state,
 *   0,
 * );
 * const value = await main.outbox.request(counter, "inc", { n: 2 });
 * await main.outbox.stop(counter);
 * ```
 */
export function actor<S = any, Q = any, D = any, FromMain = any>(
  name: string,
  behavior: ActorBehavior<S, Q, D, FromMain>,
  initialState?: S,
  ...helpers: (Function | string)[]
): Actor;
export function actor<S = any, Q = any, D = any, FromMain = any>(
  name: string,
  behavior: ActorBehavior<S, Q, D, FromMain>,
  initialState: S | undefined,
  options: ActorOptions,
  ...helpers: (Function | string)[]
): Actor;
export function actor<S = any, Q = any, D = any, FromMain = any>(
  name: string,
  behavior: ActorBehavior<S, Q, D, FromMain>,
  initialState?: S,
  optionsOrHelper?: ActorOptions | Function | string,
  ...remainingHelpers: (Function | string)[]
): Actor {
  const options =
    optionsOrHelper &&
    typeof optionsOrHelper === "object" &&
    !Array.isArray(optionsOrHelper)
      ? optionsOrHelper as ActorOptions
      : {};
  const helpers =
    typeof optionsOrHelper === "function" || typeof optionsOrHelper === "string"
      ? [optionsOrHelper, ...remainingHelpers]
      : remainingHelpers;

  return createActor(name, behavior, initialState, options, helpers);
}

function createActor<S = any, Q = any, D = any, FromMain = any>(
  name: string,
  behavior: ActorBehavior<S, Q, D, FromMain>,
  initialState: S | undefined,
  options: ActorOptions,
  helpers: (Function | string)[]
): Actor {
  if (!name || typeof name !== "string") {
    throw new Error("Actor name must be a non-empty string");
  }

  const capacity = options.capacity;
  if (capacity !== undefined && (!Number.isInteger(capacity) || capacity < 0)) {
    throw new RangeError("actor capacity must be a non-negative integer");
  }

  const functionHelpers = helpers.filter((h): h is Function => typeof h === "function");
  const stringHelpers = helpers.filter((h): h is string => typeof h === "string");

  const workerScript = buildWorkerScript({
    helpers: [ACTOR_CONCURRENCY_RUNTIME, ...stringHelpers],
    main: behavior as any,
    functions: functionHelpers,
    runtime: buildActorWorkerRuntime(capacity),
  });

  const blobUrl = acquireBlobUrl(workerScript);
  const actorWorkerId = ++actorGenerationCounter;
  const actorTaskId = `actor:${actorWorkerId}`;

  let worker: Worker | null = null;
  let running = false;
  let dropped = 0;
  let nextRequestId = 1;
  const pendingRequests = new Map<string, PendingActorRequest<S>>();
  let shutdown$: Promise<void> | null = null;
  let finishShutdown: (() => void) | null = null;
  let shouldReleaseBlobUrl = false;
  let hasReleasedBlobUrl = false;
  let requestedExit: ActorExit = { reason: "stopped" };
  let hasSettledDone = false;
  let resolveDone!: (exit: ActorExit) => void;
  const done = new Promise<ActorExit>((resolve) => {
    resolveDone = resolve;
  });

  const settleDone = () => {
    if (hasSettledDone) {
      return;
    }

    hasSettledDone = true;
    resolveDone(requestedExit);
  };

  try {
    worker = createModuleWorker(blobUrl);
  } catch (error) {
    releaseBlobUrl(workerScript);
    throw error;
  }

  (worker as any).__id = actorWorkerId;
  running = true;

  let actorRef: Actor;

  const releaseWorkerScript = () => {
    if (!shouldReleaseBlobUrl || hasReleasedBlobUrl) {
      return;
    }

    hasReleasedBlobUrl = true;
    releaseBlobUrl(workerScript);
  };

  const rejectPendingRequests = (reason: string | Error = ACTOR_STOPPED_ERROR_MESSAGE) => {
    if (pendingRequests.size === 0) {
      return;
    }

    const error = typeof reason === "string" ? new Error(reason) : reason;
    for (const { reject, cleanup } of pendingRequests.values()) {
      cleanup?.();
      reject(error);
    }

    pendingRequests.clear();
  };

  const takePendingRequest = (requestId: string) => {
    const pending = pendingRequests.get(requestId);
    if (!pending) return undefined;
    pendingRequests.delete(requestId);
    pending.cleanup?.();
    return pending;
  };

  const postToWorker = (
    target: Worker,
    message: Omit<WorkerProtocolMessage, "workerId">
  ) => {
    target.postMessage({
      workerId: actorWorkerId,
      ...message,
    });
  };

  const shutdown = (releaseBlobUrlOnExit: boolean, exit: ActorExit = { reason: "stopped" }) => {
    shouldReleaseBlobUrl ||= releaseBlobUrlOnExit;
    if (!shutdown$) {
      requestedExit = exit;
    }

    if (shutdown$) {
      releaseWorkerScript();
      return shutdown$;
    }

    running = false;
    rejectPendingRequests(exit.reason === "error" ? exit.error : ACTOR_STOPPED_ERROR_MESSAGE);
    unregisterActorBusTarget(actorRef);

    const activeWorker = worker;
    if (!activeWorker) {
      releaseWorkerScript();
      settleDone();
      return Promise.resolve();
    }

    shutdown$ = new Promise<void>((resolve) => {
      let settled = false;

      const finalizeShutdown = () => {
        if (settled) {
          return;
        }

        settled = true;
        finishShutdown = null;
        activeWorker.removeEventListener("message", handleMessage);
        activeWorker.removeEventListener("error", handleError);
        activeWorker.terminate();
        if (worker === activeWorker) {
          worker = null;
        }
        releaseWorkerScript();
        settleDone();
        resolve();
      };

      const timeoutId = setTimeout(finalizeShutdown, ACTOR_TERMINATION_TIMEOUT_MS);
      finishShutdown = () => {
        clearTimeout(timeoutId);
        finalizeShutdown();
      };

      try {
        postToWorker(activeWorker, {
          taskId: actorTaskId,
          type: "stop",
        });
      } catch {
        finishShutdown();
      }
    });

    return shutdown$;
  };

  const failActor = (error: Error): void => {
    if (!running && shutdown$) return;
    running = false;
    rejectPendingRequests(error);
    unregisterActorBusTarget(actorRef);
    void shutdown(true, { reason: "error", error });
  };

  const handleMessage = (event: MessageEvent<WorkerProtocolMessage>) => {
    const msg = event.data;

    if (
      msg.workerId !== actorWorkerId ||
      msg.taskId !== actorTaskId
    ) {
      return;
    }

    const { type, payload, requestId } = msg;

    if (type === "response" && requestId) {
      takePendingRequest(requestId)?.resolve(payload);
    } else if (type === "error" && requestId) {
      takePendingRequest(requestId)?.reject(
        new Error(msg.error ?? "Actor request failed"),
      );
    } else if (type === "error" && !requestId) {
      failActor(new Error(msg.error ?? "Actor behavior failed"));
    } else if (type === "overflow") {
      if (!running) return;
      dropped += 1;
      console.warn(`Actor "${name}" mailbox capacity exceeded; message dropped`);
    } else if (type === "request") {
      if (!running || !worker) return;
      handleRequest(msg, actorRef, worker);
    } else if (type === "notify") {
      if (!running) {
        return;
      }
      if (isActorBusMessage(payload)) {
        dispatchActorBusMessage(payload, { fromActor: actorRef });
        return;
      }
      // Non-bus notify payloads are ignored; behaviors receive messages via the inbox listen cycle.
    } else if (type === "stopped") {
      running = false;
      rejectPendingRequests();
      if (finishShutdown) {
        finishShutdown();
      } else {
        void shutdown(true);
      }
    }
  };

  const handleError = (event: ErrorEvent) => {
    if (!running) {
      return;
    }

    const error =
      event.error instanceof Error
        ? event.error
        : new Error(event.message || "Actor worker failed");

    failActor(error);
  };

  const actor: Actor = {
    name,

    get running() {
      return running;
    },

    get mailboxCapacity() {
      return capacity;
    },

    get dropped() {
      return dropped;
    },

    done,
  };

  actorRef = actor;

  worker.addEventListener("message", handleMessage);
  worker.addEventListener("error", handleError);

  try {
    postToWorker(worker, {
      taskId: actorTaskId,
      payload: initialState,
      mailboxCapacity: capacity,
      type: "init",
    });
  } catch (error) {
    worker.removeEventListener("message", handleMessage);
    worker.removeEventListener("error", handleError);
    worker.terminate();
    worker = null;
    running = false;
    hasReleasedBlobUrl = true;
    releaseBlobUrl(workerScript);
    throw error;
  }

  registerActorBusTarget(name, actorRef);

  const internals = {
    stop() {
      return shutdown(true);
    },
    post(msg: FromMain) {
      if (!worker || !running) {
        console.warn("Actor is not running; message dropped");
        return;
      }

      try {
        postToWorker(worker, {
          taskId: actorTaskId,
          payload: msg,
          type: "notify",
        });
      } catch (reason) {
        const error = reason instanceof Error ? reason : new Error(String(reason));
        void shutdown(true, { reason: "error", error });
        throw error;
      }
    },

    request(topic: string, msg: FromMain, signal?: AbortSignal): Promise<S> {
      if (!worker || !running) {
        return Promise.reject(new Error("Actor stopped"));
      }
      if (signal?.aborted) {
        return Promise.reject(createAbortError(signal));
      }

      const id = String(nextRequestId++);
      return new Promise((resolve, reject) => {
        const onAbort = () => {
          const pending = takePendingRequest(id);
          if (!pending) return;
          reject(createAbortError(signal));
        };
        const cleanup = () => signal?.removeEventListener("abort", onAbort);

        pendingRequests.set(id, { resolve, reject, cleanup });
        signal?.addEventListener("abort", onAbort, { once: true });

        try {
          postToWorker(worker!, {
            taskId: actorTaskId,
            payload: msg,
            requestId: id,
            type: "request",
            topic,
          });
        } catch (reason) {
          pendingRequests.delete(id);
          cleanup();
          const error = reason instanceof Error ? reason : new Error(String(reason));
          reject(error);
          void shutdown(true, { reason: "error", error });
        }
      });
    },
  };

  setActorInternals(actor, internals);

  return actor;
}



export const main: Initiator = {
  outbox: {
    /** Broadcasts a topic payload to every named actor through the actor bus. */
    publish<T = any>(
      topic: string,
      payload: T,
      options?: ActorBusDispatchOptions
    ): void {
      dispatchActorBusMessage(
        createActorBusMessage(topic, payload, { from: options?.from ?? "main" }),
        { includeSelf: options?.includeSelf }
      );
    },

    /** Sends a one-way bus message to one or more named actor targets. */
    send<T = any>(
      to: Actor | string | string[],
      topic: string,
      payload: T,
      options?: Pick<ActorBusDispatchOptions, "from">
    ): void {
      dispatchActorBusMessage(
        createActorBusMessage(topic, payload, { from: options?.from ?? "main", to: resolveActorBusTarget(to) as ActorBusTarget }),
        {}
      );
    },

    /** Sends a request to an actor and awaits the response. */
    request<Q = any, D = any>(to: Actor | string, topic: string, payload: Q, signal?: AbortSignal): Promise<D> {
      const target = resolveActorTarget(to);
      if (!target) {
        return Promise.reject(new Error(`Unknown actor target "${String(to)}"`));
      }

      return getActorInternals(target).request(topic, payload, signal);
    },

    /** Stops the actor, terminates its worker, and releases resources. */
    stop(actor: Actor | string): Promise<void> {
      const target = resolveActorTarget(actor);
      if (!target) {
        return Promise.reject(new Error(`Unknown actor target "${String(actor)}"`));
      }

      return getActorInternals(target).stop();
    },
  },

  inbox: {
    subscribe: subscribeActorBus,

    clear: () => {
      clearActorBusListeners();
    },
  },
};
````

## File: projects/libraries/swiftly/README.md
````markdown
# Swiftly

Concurrent JavaScript built around workers, structured task ownership, channels, actors, and cancellation.

Swiftly treats concurrency as a programming model rather than exposing Web Workers as application infrastructure. Worker-backed computation, coordination, cancellation, and long-lived actors share one small set of primitives.

For a concept-by-concept guide to ownership, boundaries, and when to use each primitive, see [`concepts.md`](../../../docs/concepts.md).

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

The number `4` is the only concurrency policy in this example. The group owns a
FIFO admission queue: at most four children execute at once, and queued child
operations have not called `hash.run()` yet. Therefore at most four hash calls
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
await result.catch(() => undefined);

// Equivalent options form, also used when transferring ownership.
const otherController = new AbortController();
const otherResult = parse.run(source, { signal: otherController.signal });
otherController.abort();
await otherResult.catch(() => undefined);
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
  if (message.kind === 'actor-bus' && message.topic === 'inc') return state + 1;
  return state;
}, 0);

const value = await main.outbox.request(counter, 'inc', undefined);
await main.outbox.stop(counter);

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

await main.outbox.request(service, "refresh", undefined);
await main.outbox.stop(service);

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
await result.catch(() => undefined);
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
const workers = group();
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

      const result = await process(next.value, signal);
      await output.send(result, signal);
    }
  });
}

await Promise.all(inputs.map((job) => input.send(job)));
input.close();

try {
  await workers.wait();
} finally {
  output.close();
}

const results = await consume;
```

The composition remains explicit: channel capacity bounds data in flight,
the number of spawned workers bounds parallel processing, `group()` owns worker
lifetime and failure propagation, and coroutine owns only worker execution and
reuse.


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

`dispose()` means **terminate now**. Active work is rejected and worker resources
are released immediately. Worker-script blob URLs are acquired
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
post where Swiftly owns the list. A submission transfers its objects only when
it is posted to a worker, so cancellation before worker execution leaves its
transferables owned by the caller.

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

Coroutine workers are regression-tested for lifecycle pressure: graceful close
allows already-admitted active work to finish, while `dispose()` may escalate an
in-progress close and settle the close promise without stranding callers.


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

Stress coverage exercises repeated select cancellation, context cancellation
chains, and mass timer cancellation to verify that cancellation leaves no channel
waiters or timer workers behind.


## Timer host isolation

The shared timer runtime binds its cached worker to the host `Worker`
constructor that created it. If the host changes while the timer runtime is
idle—for example between isolated browser test environments—the old worker is
discarded rather than reused across environments.

Test worker mocks implement the same `set` / `clear` timer protocol as the real
timer worker, so actor restart delays, context timeouts, and direct timer tests
exercise the same scheduling semantics.
````
