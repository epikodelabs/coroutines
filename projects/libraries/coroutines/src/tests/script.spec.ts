import { buildCoroutineWorkerRuntime } from "../lib/worker/runtimes";
import { buildWorkerScript } from "../lib/worker/script";

describe("worker module scripts", () => {
  it("preserves ordinary absolute dynamic imports inside coroutine tasks", () => {
    const task = new Function(
      "value",
      'return import("https://cdn.example.invalid/normalize.js").then(module => module.normalize(value));',
    );

    const script = buildWorkerScript({
      main: task,
      functions: [],
      runtime: buildCoroutineWorkerRuntime(),
    });

    expect(script).toContain(
      'import("https://cdn.example.invalid/normalize.js")',
    );
  });

  it("does not rewrite import expressions through a Coroutines-specific loader", () => {
    const task = new Function(
      'return import("https://cdn.example.invalid/math.js").then(module => module.default);',
    );

    const script = buildWorkerScript({
      main: task,
      functions: [],
      runtime: buildCoroutineWorkerRuntime(),
    });

    expect(script).not.toContain("importWorkerModule");
    expect(script).not.toContain("__import");
  });

  it("binds named arrow-function helpers into worker scope", () => {
    const helper = (value: number) => value + 1;

    const script = buildWorkerScript({
      main: function main(value: number) {
        return helper(value);
      },
      functions: [helper],
      runtime: buildCoroutineWorkerRuntime(),
    });

    expect(script).toContain("const helper =");
  });

  it("normalizes method shorthand helpers into function declarations", () => {
    const helper = {
      transform(value: number) {
        return value + 1;
      },
    }.transform;

    const script = buildWorkerScript({
      main: function main(value: number) {
        return helper(value);
      },
      functions: [helper],
      runtime: buildCoroutineWorkerRuntime(),
    });

    expect(script).toContain("function transform(");
  });
});