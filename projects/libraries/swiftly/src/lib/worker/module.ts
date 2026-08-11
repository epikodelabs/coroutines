/**
 * Creates a Swiftly worker as a native ES module worker.
 *
 * All Swiftly-owned workers use the same construction path so ordinary module
 * features such as dynamic `import()` are available consistently.
 */
export function createModuleWorker(url: string): Worker {
  return new Worker(url, { type: "module" });
}
