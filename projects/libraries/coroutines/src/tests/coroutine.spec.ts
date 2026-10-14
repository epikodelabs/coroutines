import {
  coroutine,
  group,
  GroupClosedError,
} from "../public-api";
import { idescribe } from "./env";

idescribe('coroutine', () => {
  it('creates an immutable definition with no executor surface', () => {
    const mainTask = (x: number) => x + 1;
    const def = coroutine(mainTask);

    expect(Object.isFrozen(def)).toBeTrue();
    expect(Object.keys(def)).toEqual([]);
    expect('run' in def).toBeFalse();
    expect('close' in def).toBeFalse();
    expect('dispose' in def).toBeFalse();
    expect('size' in def).toBeFalse();
    expect('main' in def).toBeFalse();
    expect('helpers' in def).toBeFalse();
    expect('functions' in def).toBeFalse();
  });

  it('creates distinct definitions for the same task', () => {
    const mainTask = (x: number) => x;
    expect(coroutine(mainTask)).not.toBe(coroutine(mainTask));
  });

  it('accepts trailing helper functions and options without throwing', () => {
    const mainTask = (x: number) => x;

    function helperNamed() {
      return 1;
    }

    expect(() => coroutine(mainTask, helperNamed)).not.toThrow();
    expect(() => coroutine(mainTask, { helpers: ["const snippet = 1;"] })).not.toThrow();
    expect(() => coroutine(mainTask, helperNamed, { helpers: [] })).not.toThrow();
  });

  it('requires a task function', () => {
    expect(() => coroutine(undefined as any)).toThrow();
  });

  it('rejects non-definitions at the executor boundary', () => {
    const work = group();
    expect(() => (work.executor as any)({ run: async () => 1 })).toThrowError(
      TypeError,
      /requires a definition created by coroutine\(\) or compose\(\)/,
    );
  });

  it('rejects executor creation after the group closed', async () => {
    const def = coroutine((x: number) => x);
    const work = group();
    await work.settle();

    expect(() => work.executor(def)).toThrowError(GroupClosedError);
  });

  it('executes a definition through a group-owned executor', async () => {
    const def = coroutine((x: number) => x + 1);
    const work = group();
    const run = work.executor(def);

    await expectAsync(run.run(41)).toBeResolvedTo(42);
    await work.settle();
  });
});
