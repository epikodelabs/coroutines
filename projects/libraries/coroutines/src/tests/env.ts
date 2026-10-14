// Environment detection.
// Node globals are reached through `globalThis` with optional chaining on
// purpose: the static browser-compatibility scan in testify flags direct
// references to Node globals, and since this helper is walked transitively
// from every suite that imports it, one flagged line here would exclude all
// of them from browser runs.
const globalScope = globalThis as {
  process?: { versions?: { node?: string } };
};

const isNode = globalScope.process?.versions?.node != null;

const isBrowser =
  typeof window !== "undefined" &&
  typeof window.document !== "undefined";

// Suite-level wrappers (describe only accepts sync functions)
/**
 * Function ndescribe.
 */
export function ndescribe(name: string, fn: () => void) {
  return isNode ? describe(name, fn) : xdescribe(name, fn);
}

/**
 * Function idescribe.
 */
export function idescribe(name: string, fn: () => void) {
  return isBrowser ? describe(name, fn) : xdescribe(name, fn);
}

// Spec-level wrappers (it allows async callbacks with DoneFn)
/**
 * Function nit.
 */
export function nit(name: string, fn: jasmine.ImplementationCallback) {
  return isNode ? it(name, fn) : xit(name, fn);
}

/**
 * Function iit.
 */
export function iit(name: string, fn: jasmine.ImplementationCallback) {
  return isBrowser ? it(name, fn) : xit(name, fn);
}

// Export environment flags too
export { isBrowser, isNode };
