# App 3 - Kitchen

Real-time kitchen simulation combining actor routing, structured task ownership, and worker-backed oven coroutines.

## What it demonstrates

- **Actor routing** - a service-owned cashier actor routes kitchen commands without detached async work
- **`group({ concurrency: 3 })`** - owns the cook queue and admits at most three orders at once
- **`coroutine`** - each oven executes its bake operation in a reusable worker
- **Cancellation** - queued orders can be cancelled before they acquire an oven; active orders can be cancelled through their task signal
- **Angular signals** - kitchen state and logs update without polling or manual change detection

## Run

```bash
ng serve app3
```
