/**
 * Kitchen Simulation Service — Actor-based Pizza Bakery Demo
 *
 * Architecture:
 *   • Cashier actor  : receives orders, forwards to chef via actor bus
 *   • Chef actor     : receives orders from cashier, requests recipes and
 *                      oven bakes from main thread, emits lifecycle events
 *   • Oven coroutines: worker-backed baking operations
 *
 * Communication flow:
 *   UI → Cashier : main.outbox.send(cashier, 'runShift' | 'cancel' | 'close', payload)
 *   Cashier → Chef : utils.outbox.send('chef', 'cook' | 'cancel', ...)
 *   Chef → Main    : utils.outbox.request('main', 'recipe', item) fetches recipe
 *                    utils.outbox.request('main', 'bake', { order, recipe }) dispatches to oven
 *                    utils.outbox.send('main', topic, event) pushes live events
 */
import { Injectable } from '@angular/core';
import { ActorBusMessage, actor, coroutine, main, registerActorRequestHandler, WorkerUtils } from '@epikodelabs/swiftly';
import { atom } from '../../../shared/simple-atom';

export type Order = { id: string; item: string; customer: string };

export type Recipe = {
  item: string;
  ingredients: string[];
  bakeMs: number;
};

export type KitchenMessage =
  | { type: 'runShift'; orders: Order[] }
  | { type: 'cancel'; orderId: string }
  | { type: 'close'; cancelQueued?: boolean };

export type KitchenEvent =
  | { type: 'started'; order: Order; oven: string }
  | { type: 'stage'; order: Order; stage: string; oven: string }
  | { type: 'ready'; order: Order; oven: string; price: number }
  | { type: 'cancelled'; order: Order; reason: string; oven: string }
  | { type: 'timeout'; order: Order; oven: string }
  | { type: 'closed'; completed: number; cancelled: number; totalRevenue: number };

export type OvenState = {
  id: string;
  order: Order | null;
  stage: string | null;
};

export type KitchenStats = {
  completed: number;
  cancelled: number;
  revenue: number;
  active: number;
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const recipes = new Map<string, Recipe>([
  ['Margherita', { item: 'Margherita', ingredients: ['tomato', 'mozzarella', 'basil'], bakeMs: 3000 }],
  ['Pepperoni', { item: 'Pepperoni', ingredients: ['tomato', 'mozzarella', 'pepperoni'], bakeMs: 3500 }],
  ['Hawaiian', { item: 'Hawaiian', ingredients: ['tomato', 'mozzarella', 'ham', 'pineapple'], bakeMs: 3200 }],
  ['Quattro Formaggi', { item: 'Quattro Formaggi', ingredients: ['mozzarella', 'gorgonzola', 'parmesan', 'ricotta'], bakeMs: 2800 }],
  ['Diavola', { item: 'Diavola', ingredients: ['tomato', 'mozzarella', 'spicy salami', 'chili'], bakeMs: 3800 }],
]);

const prices = new Map<string, number>([
  ['Margherita', 12.99],
  ['Pepperoni', 14.99],
  ['Hawaiian', 13.99],
  ['Quattro Formaggi', 15.99],
  ['Diavola', 16.99],
]);

// ===== OVEN COROUTINES =====
async function ovenBakeTask(task: { order: Order; recipe: Recipe }) {
  await new Promise(r => setTimeout(r, task.recipe.bakeMs));
  return task;
}

const ovens = [
  { id: 'Oven #1', worker: coroutine(ovenBakeTask), busy: false },
  { id: 'Oven #2', worker: coroutine(ovenBakeTask), busy: false },
  { id: 'Oven #3', worker: coroutine(ovenBakeTask), busy: false },
];

type OvenSlot = (typeof ovens)[number];
type OvenReservation = { ovenId: string };
type BakeRequest = { ovenId: string; order: Order; recipe: Recipe };
type BakeResult = { ovenId: string; price: number };

const reservedOvens = new Map<string, OvenSlot>();
const ovenWaitQueue: Array<(oven: OvenSlot) => void> = [];

function emitKitchenEvent(
  utils: WorkerUtils<any, any, any, KitchenEvent>,
  event: KitchenEvent
) {
  utils.outbox.send('main', event.type, event);
}

function releaseOvenSlot(oven: OvenSlot) {
  const next = ovenWaitQueue.shift();
  if (next) {
    next(oven);
    return;
  }

  oven.busy = false;
}

async function reserveOven(): Promise<OvenReservation> {
  const idleOven = ovens.find((oven) => !oven.busy);
  const oven = idleOven
    ? idleOven
    : await new Promise<OvenSlot>((resolve) => {
        ovenWaitQueue.push(resolve);
      });

  oven.busy = true;
  reservedOvens.set(oven.id, oven);
  return { ovenId: oven.id };
}

function releaseReservedOven(ovenId: string) {
  const oven = reservedOvens.get(ovenId);
  if (!oven) {
    return false;
  }

  reservedOvens.delete(ovenId);
  releaseOvenSlot(oven);
  return true;
}

async function bakeOnReservedOven(request: BakeRequest): Promise<BakeResult> {
  const oven = reservedOvens.get(request.ovenId);
  if (!oven) {
    throw new Error(`Oven "${request.ovenId}" is not reserved`);
  }

  try {
    await oven.worker.run({ order: request.order, recipe: request.recipe });
    return { ovenId: oven.id, price: prices.get(request.order.item) ?? 10 };
  } finally {
    reservedOvens.delete(oven.id);
    releaseOvenSlot(oven);
  }
}

// ===== CHEF ACTOR =====
interface ChefState {
  activeTasks: number;
  completedCount: number;
  cancelledCount: number;
  totalRevenue: number;
  closing: boolean;
  cancelQueued: boolean;
  closedSent: boolean;
  cancelledIds: Set<string>;
}

function checkClosed(state: ChefState, utils: WorkerUtils<any, any, any, KitchenEvent>) {
  if (state.closing && state.activeTasks === 0 && !state.closedSent) {
    state.closedSent = true;
    emitKitchenEvent(utils, {
      type: 'closed',
      completed: state.completedCount,
      cancelled: state.cancelledCount,
      totalRevenue: state.totalRevenue,
    } as KitchenEvent);
  }
}

async function chefBehavior(
  msg: any,
  state: ChefState,
  utils: WorkerUtils<any, any, any, KitchenEvent>
) {
  // Handle bus messages from cashier
  if (msg.kind === 'actor-bus') {
    if (msg.topic === 'cook') {
      const order = msg.payload as Order;
      state.activeTasks++;

      // Fire-and-forget cooking task
      (async () => {
        let reservedOvenId: string | null = null;
        const cancelOrder = async (reason: string, oven = 'N/A') => {
          if (reservedOvenId) {
            await utils.outbox.request('main', 'release-oven', { ovenId: reservedOvenId });
            reservedOvenId = null;
          }

          state.activeTasks--;
          state.cancelledCount++;
          emitKitchenEvent(utils, {
            type: 'cancelled',
            order,
            reason,
            oven,
          } as KitchenEvent);
          checkClosed(state, utils);
        };

        try {
          if (state.cancelledIds.has(order.id)) {
            await cancelOrder('Cancelled before start');
            return;
          }

          if (state.cancelQueued) {
            await cancelOrder('Cancelled because the kitchen is closing');
            return;
          }

          const recipe = await utils.outbox.request('main', 'recipe', order.item) as Recipe | undefined;
          if (!recipe) throw new Error(`No recipe for ${order.item}`);

          if (state.cancelledIds.has(order.id)) {
            await cancelOrder('Cancelled before oven assignment');
            return;
          }

          if (state.cancelQueued) {
            await cancelOrder('Cancelled because the kitchen is closing');
            return;
          }

          const reservation = await utils.outbox.request('main', 'reserve-oven', { order }) as OvenReservation;
          reservedOvenId = reservation.ovenId;

          if (state.cancelledIds.has(order.id)) {
            await cancelOrder('Cancelled while waiting for an oven', reservedOvenId);
            return;
          }

          if (state.cancelQueued) {
            await cancelOrder('Cancelled because the kitchen is closing', reservedOvenId);
            return;
          }

          emitKitchenEvent(utils, {
            type: 'started',
            order,
            oven: reservedOvenId,
          } as KitchenEvent);
          emitKitchenEvent(utils, {
            type: 'stage',
            order,
            stage: 'Baking...',
            oven: reservedOvenId,
          } as KitchenEvent);

          const bakeResult = await utils.outbox.request('main', 'bake', {
            ovenId: reservedOvenId,
            order,
            recipe,
          }) as BakeResult;
          reservedOvenId = null;
          state.activeTasks--;
          state.completedCount++;
          state.totalRevenue += bakeResult.price;
          emitKitchenEvent(utils, {
            type: 'ready',
            order,
            oven: bakeResult.ovenId,
            price: bakeResult.price,
          } as KitchenEvent);
          checkClosed(state, utils);
        } catch (err: any) {
          await cancelOrder(err?.message ?? String(err), reservedOvenId ?? 'N/A');
        }
      })();
    }

    if (msg.topic === 'cancel') {
      state.cancelledIds.add(msg.payload as string);
    }

    if (msg.topic === 'close') {
      state.closing = true;
      state.cancelQueued = Boolean(msg.payload?.cancelQueued);
      state.closedSent = false;
      checkClosed(state, utils);
    }

    return state;
  }

  return state;
}

const chef = actor('chef', chefBehavior, {
  activeTasks: 0,
  completedCount: 0,
  cancelledCount: 0,
  totalRevenue: 0,
  closing: false,
  cancelQueued: false,
  closedSent: false,
  cancelledIds: new Set<string>(),
}, emitKitchenEvent, checkClosed);

registerActorRequestHandler('main', async (topic: string, payload: unknown) => {
  if (topic === 'recipe' && typeof payload === 'string') {
    return recipes.get(payload);
  }
  if (topic === 'reserve-oven') {
    return reserveOven();
  }
  if (topic === 'release-oven') {
    const request = payload as { ovenId: string };
    return { released: releaseReservedOven(request.ovenId) };
  }
  const bakeTask = payload as BakeRequest;
  if (topic === 'bake') {
    return bakeOnReservedOven(bakeTask);
  }
  throw new Error(`Unknown request payload: ${JSON.stringify(payload)}`);
});

// ===== CASHIER ACTOR =====
const cashier = actor('cashier', async function cashier(
  msg: any,
  state: { closing: boolean },
  utils: WorkerUtils<any, any, any, any>
) {
  if (msg.kind === 'actor-bus' && msg.topic === 'runShift') {
    const payload = msg.payload as { orders: Order[] };
    for (const order of payload.orders) {
      utils.outbox.send('chef', 'cook', order);
    }
    utils.outbox.send('chef', 'close', { cancelQueued: false });
  }

  if (msg.kind === 'actor-bus' && msg.topic === 'cancel') {
    utils.outbox.send('chef', 'cancel', msg.payload as string);
  }

  if (msg.kind === 'actor-bus' && msg.topic === 'close') {
    utils.outbox.send('chef', 'close', { cancelQueued: (msg.payload as any)?.cancelQueued ?? true });
  }

  return state;
}, { closing: false });

@Injectable({ providedIn: 'root' })
export class KitchenService {
  private events = atom<KitchenEvent>();
  events$ = this.events;

  private ovens = atom<OvenState[]>([
    { id: 'Oven #1', order: null, stage: null },
    { id: 'Oven #2', order: null, stage: null },
    { id: 'Oven #3', order: null, stage: null },
  ]);
  ovens$ = this.ovens;

  private cancellableOrders = atom<Order[]>([]);
  cancellableOrders$ = this.cancellableOrders;

  private stats = atom<KitchenStats>({
    completed: 0,
    cancelled: 0,
    revenue: 0,
    active: 0,
  });
  stats$ = this.stats;

  private log = atom<string>();
  log$ = this.log;

  private running = false;
  private fullDayClosing = false;
  private inFullDay = false;
  private onMessageUnsubscribe: (() => void) | null = null;
  private destroyed = false;

  constructor() {
    this.onMessageUnsubscribe = main.inbox.subscribe((message: ActorBusMessage<any>) => {
      if (message.from !== 'chef') {
        return;
      }

      const event = message.payload as KitchenEvent;
      this.events.next(event);
      this.handleEvent(event);
    });
  }

  private handleEvent(event: KitchenEvent) {
    const ovens = [...this.ovens.value];
    const stats = this.stats.value;
    const time = new Date().toLocaleTimeString();

    const oven = 'oven' in event
      ? ovens.find(entry => entry.id === event.oven)
      : undefined;

    switch (event.type) {
      case 'started':
        if (oven) {
          oven.order = event.order;
          oven.stage = 'Preparing...';
        }
        this.log.next(
          `[${time}] 🍳 Started: ${event.order.item} for ${event.order.customer} (${event.oven})`
        );
        this.stats.next({ ...stats, active: stats.active + 1 });
        break;

      case 'stage':
        if (oven) oven.stage = event.stage;
        this.log.next(
          `[${time}] 📍 ${event.stage} - ${event.order.item} (${event.oven})`
        );
        break;

      case 'ready':
        if (oven) {
          oven.order = null;
          oven.stage = null;
        }
        this.removeCancellableOrder(event.order.id);
        this.log.next(
          `[${time}] ✅ READY! ${event.order.item} for ${event.order.customer} (${event.oven})`
        );
        this.stats.next({
          ...stats,
          completed: stats.completed + 1,
          revenue: stats.revenue + event.price,
          active: Math.max(0, stats.active - 1),
        });
        break;

      case 'cancelled':
        if (oven) {
          oven.order = null;
          oven.stage = null;
        }
        this.removeCancellableOrder(event.order.id);
        this.log.next(
          `[${time}] ❌ CANCELLED: ${event.order.item} for ${event.order.customer} - ${event.reason} (${event.oven})`
        );
        this.stats.next({
          ...stats,
          cancelled: stats.cancelled + 1,
          active: oven ? Math.max(0, stats.active - 1) : stats.active,
        });
        break;

      case 'timeout':
        if (oven) {
          oven.order = null;
          oven.stage = null;
        }
        this.removeCancellableOrder(event.order.id);
        this.log.next(
          `[${time}] ⏰ TIMEOUT: ${event.order.item} got burnt! (${event.oven})`
        );
        this.stats.next({
          ...stats,
          cancelled: stats.cancelled + 1,
          active: Math.max(0, stats.active - 1),
        });
        break;

      case 'closed':
        this.cancellableOrders.next([]);
        this.log.next(
          `[${time}] 🏁 Shift closed! Completed: ${event.completed}, Cancelled: ${event.cancelled}, Revenue: $${event.totalRevenue.toFixed(2)}`
        );
        this.stats.next({ ...this.stats.value, active: 0 });
        if (!this.inFullDay) {
          this.running = false;
        }
        break;
    }

    this.ovens.next(ovens);
  }

  async runShift(
    orders: Order[],
    options: { accumulate?: boolean; internal?: boolean } = {}
  ): Promise<{ completed: number; cancelled: number; revenue: number } | undefined> {
    if (!options.internal && this.running) return;

    if (!options.internal) {
      this.running = true;
    }

    if (options.accumulate) {
      this.resetOvens();
    } else {
      this.resetState();
    }

    this.cancellableOrders.next([...orders]);

    this.log.next(`--- Starting shift with ${orders.length} orders ---`);

    return new Promise((resolve) => {
      let resolved = false;

      const unsub = main.inbox.subscribe((message: ActorBusMessage<any>) => {
        if (message.from !== 'chef') {
          return;
        }

        const event = message.payload as KitchenEvent;
        if (event.type === 'closed' && !resolved) {
          resolved = true;
          unsub();
          if (!options.internal) {
            this.running = false;
          }
          resolve({
            completed: event.completed,
            cancelled: event.cancelled,
            revenue: event.totalRevenue,
          });
        }
      });

      main.outbox.send(cashier, 'runShift', { orders });
    });
  }

  async runFullDay(): Promise<void> {
    if (this.running) return;

    const shifts = [
      {
        name: '🌅 Morning Shift',
        orders: [
          { id: 'M1', item: 'Margherita', customer: 'John' },
          { id: 'M2', item: 'Pepperoni', customer: 'Sarah' },
          { id: 'M3', item: 'Hawaiian', customer: 'Mike' },
        ],
      },
      {
        name: '🌞 Lunch Rush',
        orders: [
          { id: 'L1', item: 'Quattro Formaggi', customer: 'Emma' },
          { id: 'L2', item: 'Diavola', customer: 'Luca' },
          { id: 'L3', item: 'Margherita', customer: 'Sophia' },
          { id: 'L4', item: 'Pepperoni', customer: 'Oliver' },
        ],
      },
      {
        name: '🌤️ Afternoon',
        orders: [
          { id: 'A1', item: 'Hawaiian', customer: 'Isabella' },
          { id: 'A2', item: 'Diavola', customer: 'Ethan' },
        ],
      },
      {
        name: '🌙 Evening Rush',
        orders: [
          { id: 'E1', item: 'Diavola', customer: 'Marco' },
          { id: 'E2', item: 'Quattro Formaggi', customer: 'Giulia' },
          { id: 'E3', item: 'Pepperoni', customer: 'Antonio' },
          { id: 'E4', item: 'Margherita', customer: 'Francesca' },
          { id: 'E5', item: 'Hawaiian', customer: 'Roberto' },
        ],
      },
    ];

    this.fullDayClosing = false;
    this.inFullDay = true;
    this.running = true;
    this.resetState();

    this.log.next('\n=== Full Day Started ===');

    for (const shift of shifts) {
      if (this.fullDayClosing) break;

      this.log.next(`\n=== ${shift.name} ===`);

      await this.runShift(shift.orders, { accumulate: true, internal: true });

      if (this.fullDayClosing) break;

      await delay(1000);
    }

    this.cancellableOrders.next([]);

    this.log.next('\n=== Full Day Complete ===');

    this.inFullDay = false;
    this.running = false;

    const stats = this.stats.value;

    this.log.next(
      `📊 FULL DAY SUMMARY: ✅ ${stats.completed} completed, ❌ ${stats.cancelled} cancelled, 💰 $${stats.revenue.toFixed(2)}`
    );
  }

  cancelOrder(orderId: string) {
    if (!this.running) return;

    main.outbox.send(cashier, 'cancel', orderId);
    this.log.next(`🚫 Cancellation requested for order ${orderId}`);
  }

  closeKitchen() {
    if (!this.running) return;

    this.fullDayClosing = true;
    main.outbox.send(cashier, 'close', undefined);
    this.log.next('🚨 Kitchen closing requested — active ovens finish, queued orders are cancelled');
  }

  resetOvens() {
    this.ovens.next([
      { id: 'Oven #1', order: null, stage: null },
      { id: 'Oven #2', order: null, stage: null },
      { id: 'Oven #3', order: null, stage: null },
    ]);
  }

  resetState() {
    this.resetOvens();
    this.cancellableOrders.next([]);
    this.stats.next({
      completed: 0,
      cancelled: 0,
      revenue: 0,
      active: 0,
    });
  }

  private removeCancellableOrder(orderId: string) {
    this.cancellableOrders.next(
      this.cancellableOrders.value.filter(order => order.id !== orderId)
    );
  }

  async destroy() {
    if (this.destroyed) return;

    this.destroyed = true;
    this.onMessageUnsubscribe?.();
    this.onMessageUnsubscribe = null;

    await Promise.all([
      main.outbox.stop(cashier),
      main.outbox.stop(chef),
      ...ovens.map(o => o.worker.dispose()),
    ]);
  }

  isRunning() {
    return this.running;
  }

  isDestroyed() {
    return this.destroyed;
  }
}