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
