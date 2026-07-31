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
