import type { Actor } from "../worker/types";

export type ActorBusTarget = string | string[];
export type ActorBusSender = string;

export type ActorBusMessage<T = any> = {
  kind: "actor-bus";
  topic: string;
  payload: T;
  from?: ActorBusSender;
  to?: ActorBusTarget;
};

export type ActorBusDispatchOptions = {
  from?: ActorBusSender;
  includeSelf?: boolean;
};

export type ActorBusHandler<T = any> = (
  message: ActorBusMessage<T>
) => void | Promise<void>;

export interface ActorBus {
  publish: <T = any>(
    topic: string,
    payload: T,
    options?: ActorBusDispatchOptions
  ) => void;
  send: <T = any>(
    to: ActorBusTarget,
    topic: string,
    payload: T,
    options?: Pick<ActorBusDispatchOptions, "from">
  ) => void;
  dispatch: <T = any>(
    message: ActorBusMessage<T>,
    options?: Pick<ActorBusDispatchOptions, "includeSelf">
  ) => void;
  listen: {
    <T = any>(handler: ActorBusHandler<T>): () => void;
    <T = any>(name: string, handler: ActorBusHandler<T>): () => void;
  };
  clear: () => void;
}

export type ActorMessageContext = {
  from?: string;
  to?: ActorBusTarget;
  topic?: string;
};

export type ActorRequestHandler<Q = any, D = any> = (
  topic: string,
  request: Q,
  message: ActorMessageContext
) => Promise<D> | D;

export type ActorInternals = {
  stop(): Promise<void>;
  post(msg: any): void;
  request(topic: string, msg: any, signal?: AbortSignal): Promise<any>;
};

type ActorBusRegistration = {
  actor: Actor;
  name: string;
};

const actorRequestHandlers = new Map<string, ActorRequestHandler<any, any>>();
const actorBusRegistrationsById = new Map<string, ActorBusRegistration>();
const actorBusRegistrationsByActor = new Map<Actor, ActorBusRegistration>();
const actorBusDirectListeners = new Map<string, Set<ActorBusHandler>>();
const actorBusListeners = new Set<ActorBusHandler>();
const actorInternalsMap = new WeakMap<Actor, ActorInternals>();

export function registerActorRequestHandler<Q = any, D = any>(
  name: string,
  handler: ActorRequestHandler<Q, D>
): () => void {
  actorRequestHandlers.set(name, handler);
  return () => actorRequestHandlers.delete(name);
}

export function unregisterActorRequestHandler(name: string): void {
  actorRequestHandlers.delete(name);
}

export const getActorRequestHandler = (
  name: string,
): ActorRequestHandler<any, any> | undefined => actorRequestHandlers.get(name);

export function createActorBusMessage<T = any>(
  topic: string,
  payload: T,
  options?: { from?: string; to?: ActorBusTarget }
): ActorBusMessage<T> {
  return {
    kind: "actor-bus",
    topic,
    payload,
    from: options?.from,
    to: options?.to,
  };
}

export function isActorBusMessage<T = any>(
  value: unknown
): value is ActorBusMessage<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as ActorBusMessage<T>).kind === "actor-bus" &&
    typeof (value as ActorBusMessage<T>).topic === "string"
  );
}

export const normalizeActorBusTargets = (to?: ActorBusTarget): string[] =>
  !to ? [] : Array.isArray(to) ? [...to] : [to];

export const resolveActorTarget = (
  actorOrName: Actor | string,
): Actor | undefined =>
  typeof actorOrName === "string"
    ? actorBusRegistrationsById.get(actorOrName)?.actor
    : actorOrName;

export const resolveActorBusTarget = (
  to: Actor | string | string[],
): string | string[] =>
  Array.isArray(to) ? to : typeof to === "string" ? to : to.name;

export const setActorInternals = (
  actor: Actor,
  internals: ActorInternals,
): void => {
  actorInternalsMap.set(actor, internals);
};

export const getActorInternals = (actor: Actor): ActorInternals => {
  const internals = actorInternalsMap.get(actor);
  if (!internals) {
    throw new Error(`Actor "${actor.name}" is unavailable`);
  }
  return internals;
};

export const tryActorInternals = (
  actor: Actor,
): ActorInternals | undefined => actorInternalsMap.get(actor);

export const warnAsyncActorBusFailure = (scope: string, error: unknown) => {
  console.warn(`${scope} failed:`, error);
};

const deliverActorBusMessage = (
  actor: Actor,
  message: ActorBusMessage,
): void => {
  try {
    tryActorInternals(actor)?.post(message);
  } catch (error) {
    warnAsyncActorBusFailure("Actor bus delivery", error);
  }
};

const notifyActorBusSubscribers = (message: ActorBusMessage): void => {
  const directHandlers = message.to
    ? normalizeActorBusTargets(message.to)
        .flatMap((name) => [...(actorBusDirectListeners.get(name) ?? [])])
    : [];
  const handlers = [...actorBusListeners, ...directHandlers];

  for (const handler of handlers) {
    Promise.resolve(handler(message)).catch((error) => {
      warnAsyncActorBusFailure("Actor bus subscriber", error);
    });
  }
};

export function unregisterActorBusTarget(idOrActor: string | Actor): void {
  const registration =
    typeof idOrActor === "string"
      ? actorBusRegistrationsById.get(idOrActor)
      : actorBusRegistrationsByActor.get(idOrActor);

  if (!registration) return;

  actorBusRegistrationsById.delete(registration.name);
  actorBusRegistrationsByActor.delete(registration.actor);
}

export function registerActorBusTarget(
  name: string,
  actor: Actor,
): () => void {
  const existingRegistration = actorBusRegistrationsById.get(name);
  if (existingRegistration && existingRegistration.actor !== actor) {
    throw new Error(`Actor name "${name}" is already registered`);
  }

  unregisterActorBusTarget(actor);

  const registration = { actor, name };
  actorBusRegistrationsById.set(name, registration);
  actorBusRegistrationsByActor.set(actor, registration);

  return () => unregisterActorBusTarget(actor);
}

export function clearActorBusListeners(): void {
  actorBusDirectListeners.clear();
  actorBusListeners.clear();
  actorRequestHandlers.clear();
}

export function dispatchActorBusMessage<T = any>(
  message: ActorBusMessage<T>,
  options?: { fromActor?: Actor; includeSelf?: boolean },
): void {
  const from =
    message.from ??
    (options?.fromActor
      ? actorBusRegistrationsByActor.get(options.fromActor)?.name ??
        options.fromActor.name
      : undefined);

  const routedMessage =
    from && message.from !== from ? { ...message, from } : message;

  notifyActorBusSubscribers(routedMessage);

  const targets = normalizeActorBusTargets(routedMessage.to);
  if (targets.length > 0) {
    const seen = new Set<string>();
    for (const target of targets) {
      if (seen.has(target)) continue;
      seen.add(target);
      const registration = actorBusRegistrationsById.get(target);
      if (registration) {
        deliverActorBusMessage(registration.actor, routedMessage);
      }
    }
    return;
  }

  for (const registration of actorBusRegistrationsById.values()) {
    if (
      routedMessage.from &&
      !options?.includeSelf &&
      registration.name === routedMessage.from
    ) {
      continue;
    }
    deliverActorBusMessage(registration.actor, routedMessage);
  }
}

export const subscribeActorBus = (
  handler: ActorBusHandler,
): (() => void) => {
  actorBusListeners.add(handler);
  return () => actorBusListeners.delete(handler);
};
