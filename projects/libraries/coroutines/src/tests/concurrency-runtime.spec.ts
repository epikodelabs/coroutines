import { ACTOR_CONCURRENCY_RUNTIME } from "../lib/worker/concurrency";
import {
  defineChannelSuite,
  defineContextSuite,
  defineOperationSelectionSuite,
  defineSelectionSuite,
  type ConcurrencyParityApi,
} from "./helpers/concurrency-parity";

/**
 * Runs the shared channel/context/select suites against the string-based
 * worker runtime, which is a hand-maintained copy of the public concurrency
 * API. Any drift between the two implementations fails here.
 */
describe("worker concurrency runtime", () => {
  // The runtime string is plain ES evaluated inside an actor worker; running
  // it through `new Function` reproduces that environment's global scope.
  const __concurrency = new Function(
    ACTOR_CONCURRENCY_RUNTIME + "\nreturn __concurrency;",
  )() as any;

  const runtimeApi: ConcurrencyParityApi = {
    channel: __concurrency.channel,
    receive: __concurrency.receive,
    send: __concurrency.send,
    otherwise: __concurrency.otherwise,
    operation: __concurrency.operation,
    select: (cases, ctx) => __concurrency.select(cases, ctx),
    background: __concurrency.background,
    withCancel: __concurrency.withCancel,
    withTimeout: __concurrency.withTimeout,
    withDeadline: __concurrency.withDeadline,
    ChannelClosedError: __concurrency.ChannelClosedError,
    ContextCancelledError: __concurrency.ContextCancelledError,
    createAbortError: (signal?: AbortSignal) => {
      const reason = signal?.reason;
      if (reason instanceof Error) return reason;
      return new __concurrency.ContextCancelledError(
        reason ? String(reason) : undefined,
      );
    },
  };

  defineChannelSuite(runtimeApi);
  defineContextSuite(runtimeApi);
  defineSelectionSuite(runtimeApi);
  defineOperationSelectionSuite(runtimeApi);
});
