# Changelog

All notable changes to `@epikodelabs/coroutines` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.4] - 2026-10-14

### Fixed

- `compose()` now runs mixed chains of coroutine scripts and task runners
  strictly in argument order (previously all worker stages ran before all
  runners, contradicting the type contract), and the composed runner exposes
  the `size` required by its type.
- Supervisor buffered ingress now rejects with typed errors —
  `ActorStoppedError` for stopped supervisors and the new
  `SupervisorBusyError` for restart-window and capacity rejections — instead
  of plain `Error`/`ContextCancelledError`; `request()` routes through the
  shared capacity policy; the restart `AbortController` is only created when
  a restart delay is actually awaited.
- Actor `utils.inbox.listen()` now **consumes** messages: each bus message is
  delivered exactly once — either to a waiting `listen()` or as the next
  behavior invocation — removing the mailbox-mirror desync race.
- New `utils.reply(value)` lets behaviors answer requests without cloning the
  whole state back; request rejections carry an error name through the worker
  protocol so typed errors rehydrate by class instead of by message matching.
- Actor worker serialization errors no longer suggest `coroutine(task, …)`;
  the duplicated error serializer is shared with a per-runtime hint.
- `select()` rejects channels that do not support select with `RangeError`
  (was `ContextCancelledError`); the misplaced `select` JSDoc is attached to
  the right declaration.
- The worker runtime string (`ACTOR_CONCURRENCY_RUNTIME`) is aligned with the
  main-thread implementation — deferred select operation starts and the
  `withTimeout` watchdog — and is now guarded by parity tests running the
  shared channel/context/select suites against it.
- README: broken npm docs link, missing `registerActorRequestHandler`
  documentation, incomplete error-type list, a wait-group sample that hung on
  rejection, and a streaming sample with unbounded pending sends.

### Added

- `SupervisorBusyError`.
- Public exports that were missing from the entry point: `Coroutine`,
  `TaskRunner`, `ActorStopOptions`.
- `stripInternal` in the production build removes `CHANNEL_INTERNALS` and the
  internal `Select*` types from the shipped declarations.

### Changed

- Actor and coroutine test suites now execute the real worker runtime strings
  through a shared harness instead of hand-maintained protocol mocks.
- Removed dead code: `worker/scheduler.ts`, `WorkerProtocolHandler`, the
  `createMessageHandler` runner option, the `ActorBus` interface.
- `compose` moved to the abstractions barrel.
- Package metadata: description, MIT license, and repository fields added;
  the library ships a LICENSE file.

## [1.0.3] - 2026-10-12

### Added

- Typed concurrency errors — `GroupClosedError`, `RunnerClosedError`,
  `ActorStoppedError`, and `ActorMailboxOverflowError` — with unchanged
  message text so callers can branch with `instanceof`.
- `waitGroup()` export.
- Worker serialization hints: a worker `ReferenceError` for a function that
  was not passed as a helper now names the missing function and explains how
  to serialize it.
- Actor stop draining: `main.outbox.stop(actor, { drain: true })` lets the
  behavior finish every already-admitted mailbox message before exiting.
- Idle worker reaping: `idleTimeout` terminates workers that stay idle, and
  the runner exposes `size` for observability.

### Fixed

- Browser test-suite coverage restored, and actor tests aligned with the bus
  envelope contract.

### Changed

- Package keywords refined.
