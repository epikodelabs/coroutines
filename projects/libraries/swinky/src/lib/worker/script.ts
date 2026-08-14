import type { CoroutineScript } from "./types";

/**
 * Internal bootstrap required by transpiled async/generator code inside worker
 * tasks and injected helper functions.
 */
const ASYNC_WORKER_BOOTSTRAP = `var __defProp=Object.defineProperty,__defProps=Object.defineProperties,__getOwnPropDescs=Object.getOwnPropertyDescriptors,__getOwnPropSymbols=Object.getOwnPropertySymbols,__hasOwnProp=Object.prototype.hasOwnProperty,__propIsEnum=Object.prototype.propertyIsEnumerable,__knownSymbol=(r,e)=>(e=Symbol[r])?e:Symbol.for("Symbol."+r),__defNormalProp=(r,e,o)=>e in r?__defProp(r,e,{enumerable:!0,configurable:!0,writable:!0,value:o}):r[e]=o,__spreadValues=(r,e)=>{for(var o in e||={})__hasOwnProp.call(e,o)&&__defNormalProp(r,o,e[o]);if(__getOwnPropSymbols)for(var o of __getOwnPropSymbols(e))__propIsEnum.call(e,o)&&__defNormalProp(r,o,e[o]);return r},__spreadProps=(r,e)=>__defProps(r,__getOwnPropDescs(e)),__async=(r,e,o)=>new Promise((t,n)=>{var a=r=>{try{s(o.next(r))}catch(e){n(e)}},p=r=>{try{s(o.throw(r))}catch(e){n(e)}},s=r=>r.done?t(r.value):Promise.resolve(r.value).then(a,p);s((o=o.apply(r,e)).next())}),__await=function(r,e){this[0]=r,this[1]=e},__asyncGenerator=(r,e,o)=>{var t=(r,e,n,a)=>{try{var p=o[r](e),s=(e=p.value)instanceof __await,l=p.done;Promise.resolve(s?e[0]:e).then(o=>s?t("return"===r?r:"next",e[1]?{done:o.done,value:o.value}:o,n,a):n({value:o,done:l})).catch(r=>t("throw",r,n,a))}catch(y){a(y)}},n=r=>a[r]=e=>new Promise((o,n)=>t(r,e,o,n)),a={};return o=o.apply(r,e),a[__knownSymbol("asyncIterator")] =()=>a,n("next"),n("throw"),n("return"),a};`;

const TRANSFER_WORKER_BOOTSTRAP = `
const __workerUtils = Object.freeze({
  transfer(value, ...transferables) {
    const seen = new Set();
    for (const item of transferables) {
      if (seen.has(item)) {
        throw new TypeError("transfer list contains the same transferable more than once");
      }
      seen.add(item);
    }

    return {
      __transferResult: true,
      value,
      transfer: transferables,
    };
  },
});`;

const NAMED_FUNCTION_DECLARATION_RE =
  /^(async\s+)?function(?:\s+[A-Za-z_$][\w$]*)\s*\(/;
const METHOD_SHORTHAND_RE =
  /^(async\s+)?([A-Za-z_$][\w$]*)\s*\(/;

const normalizeCallableSource = (fn: Function): string => {
  const source = fn.toString().trim();

  if (source.startsWith("function") || source.startsWith("async function")) {
    return source;
  }

  const methodMatch = METHOD_SHORTHAND_RE.exec(source);
  if (!methodMatch) {
    return source;
  }

  const [, asyncPrefix = "", name] = methodMatch;
  return source.replace(
    METHOD_SHORTHAND_RE,
    `${asyncPrefix}function ${name}(`,
  );
};

const serializeDependencyFunction = (fn: Function, index: number): string => {
  const source = normalizeCallableSource(fn);
  if (NAMED_FUNCTION_DECLARATION_RE.test(source)) {
    return source;
  }

  const bindingName = fn.name || `__helper${index}`;
  return `const ${bindingName} = ${source};`;
};

/**
 * Serializes helper and task functions for worker-script injection.
 */
export function serializeFunction(fn: Function): string {
  return normalizeCallableSource(fn);
}

/**
 * Derives the string representation of a `CoroutineScript` from its
 * function source(s).  This is the single source-of-truth for how
 * `main` and `functions` are turned into worker-transmittable code.
 */
export function serializeScript<T, R>(script: CoroutineScript<T, R>): {
  code: string;
  deps: string[];
} {
  return {
    code: script.main.toString(),
    deps: (script.functions || []).map((f, index) =>
      serializeDependencyFunction(f, index),
    ),
  };
}

const joinScriptSections = (sections: string[]): string =>
  sections
    .map((section) => section.trim())
    .filter((section) => section.length > 0)
    .join("\n\n");

/**
 * Builds a worker script from:
 * - internal async bootstrap
 * - user-supplied helper snippets
 * - serialized helper functions
 * - the main task function
 * - the runtime wrapper
 *
 * The generated blob is executed as an ES module worker. Native module syntax
 * inside serialized task code, including absolute dynamic `import()`, is left
 * untouched and resolved by the browser.
 */
export function buildWorkerScript({
  helpers,
  main,
  functions,
  runtime,
}: {
  helpers?: string[];
  main: Function;
  functions: Function[];
  runtime: string;
}): string {
  const helperSections = [ASYNC_WORKER_BOOTSTRAP, TRANSFER_WORKER_BOOTSTRAP, ...(helpers || [])];
  const dependencySection = functions
    .map((fn, index) => serializeDependencyFunction(fn, index))
    .join("\n");
  const mainSection = `const __mainTask = ${serializeFunction(main)};`;

  return joinScriptSections([
    ...helperSections,
    dependencySection,
    mainSection,
    runtime,
  ]);
}