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
  | "stopped";

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
