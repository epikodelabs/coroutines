import {
  background,
  channel,
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
// Imported from the source file: the symbol is internal and stripped from the
// published declarations.
import { CHANNEL_INTERNALS } from "../lib/utils/channel";
import {
  defineChannelSuite,
  defineContextSuite,
  defineOperationSelectionSuite,
  defineSelectionSuite,
  type ConcurrencyParityApi,
} from "./helpers/concurrency-parity";

// The public API is the reference implementation. The same suites run against
// the string-based worker runtime in concurrency-runtime.spec.ts.
const publicConcurrencyApi: ConcurrencyParityApi = {
  channel,
  receive,
  send,
  otherwise,
  operation,
  select,
  background,
  withCancel,
  withTimeout,
  withDeadline,
  ChannelClosedError,
  ContextCancelledError,
  createAbortError,
};

defineChannelSuite(publicConcurrencyApi);
defineContextSuite(publicConcurrencyApi);
defineSelectionSuite(publicConcurrencyApi);
defineOperationSelectionSuite(publicConcurrencyApi);

describe("selection internals", () => {
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

describe("coordination primitives stress", () => {
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
});
