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