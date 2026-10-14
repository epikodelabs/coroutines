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
  /** Typed error class name carried alongside `error` for rehydration. */
  errorName?: string;
  requestId?: string;
  /** Direct actor or main-thread request/message target. */
  to?: string | string[];
  /** Topic tag for targeted actor requests/messages. */
  topic?: string;
  /** Internal actor mailbox capacity supplied during init. */
  mailboxCapacity?: number;
  /** Stop flag: finish already-admitted mailbox messages before exiting. */
  drain?: boolean;
};

/**
 * Pending task resolvers keyed by worker task id.
 */
export type PendingTaskMap = Map<
  string,
  { workerId: number; resolve: (value: any) => void; reject: (error: Error) => void }
>;

/**
 * Creates the default main-thread worker message handler.
 */
export function createDefaultMessageHandler(pendingTasks: PendingTaskMap) {
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
      default:
        console.warn("Unknown message type from worker:", msg);
        break;
    }
  };
}