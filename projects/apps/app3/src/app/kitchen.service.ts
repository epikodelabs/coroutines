/**
 * Kitchen Simulation Service — structured concurrency + actor routing demo.
 *
 * The cashier actor only routes commands. The Angular service owns every cook
 * operation through a bounded `group()`, and each oven coroutine owns worker
 * execution. No actor behavior launches detached asynchronous work.
 */
import { Injectable, computed, signal } from '@angular/core';
import {
  Actor,
  ActorBusMessage,
  TaskGroup,
  actor,
  coroutine,
  group,
  main,
  WorkerUtils,
} from '@epikodelabs/swinky';

export type Order = { id: string; item: string; customer: string };

export type Recipe = {
  item: string;
  ingredients: string[];
  bakeMs: number;
};

export type KitchenEvent =
  | { type: 'started'; order: Order; oven: string }
  | { type: 'stage'; order: Order; stage: string; oven: string }
  | { type: 'ready'; order: Order; oven: string; price: number }
  | { type: 'cancelled'; order: Order; reason: string; oven: string }
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

export type KitchenLogEntry = {
  text: string;
  kind: 'normal' | 'started' | 'ready' | 'cancelled' | 'closed';
};

function createOvenCoroutine() {
  return coroutine(ovenBakeTask);
}

type OvenWorker = {
  id: string;
  worker: ReturnType<typeof createOvenCoroutine>;
};

const RECIPES = new Map<string, Recipe>([
  ['Margherita', { item: 'Margherita', ingredients: ['tomato', 'mozzarella', 'basil'], bakeMs: 3000 }],
  ['Pepperoni', { item: 'Pepperoni', ingredients: ['tomato', 'mozzarella', 'pepperoni'], bakeMs: 3500 }],
  ['Hawaiian', { item: 'Hawaiian', ingredients: ['tomato', 'mozzarella', 'ham', 'pineapple'], bakeMs: 3200 }],
  ['Quattro Formaggi', { item: 'Quattro Formaggi', ingredients: ['mozzarella', 'gorgonzola', 'parmesan', 'ricotta'], bakeMs: 2800 }],
  ['Diavola', { item: 'Diavola', ingredients: ['tomato', 'mozzarella', 'spicy salami', 'chili'], bakeMs: 3800 }],
]);

const PRICES = new Map<string, number>([
  ['Margherita', 12.99],
  ['Pepperoni', 14.99],
  ['Hawaiian', 13.99],
  ['Quattro Formaggi', 15.99],
  ['Diavola', 16.99],
]);

async function ovenBakeTask(task: { order: Order; recipe: Recipe }) {
  await new Promise<void>((resolve) => setTimeout(resolve, task.recipe.bakeMs));
  return task;
}

function cashierBehavior(
  msg: any,
  state: { routed: number },
  utils: WorkerUtils<any, any, any, any>,
) {
  if (msg.kind !== 'actor-bus') return state;

  if (msg.topic === 'runShift') {
    const orders = (msg.payload as { orders: Order[] }).orders;
    for (const order of orders) {
      utils.outbox.send('main', 'cook', order);
      state.routed++;
    }
    utils.outbox.send('main', 'shift-routed', { count: orders.length });
  }

  if (msg.topic === 'cancel') {
    utils.outbox.send('main', 'cancel', msg.payload as string);
  }

  if (msg.topic === 'close') {
    utils.outbox.send('main', 'close', msg.payload ?? { cancelQueued: true });
  }

  return state;
}

const EMPTY_OVENS = (): OvenState[] => [
  { id: 'Oven #1', order: null, stage: null },
  { id: 'Oven #2', order: null, stage: null },
  { id: 'Oven #3', order: null, stage: null },
];

@Injectable({ providedIn: 'root' })
export class KitchenService {
  readonly ovens = signal<OvenState[]>(EMPTY_OVENS());
  readonly cancellableOrders = signal<Order[]>([]);
  readonly stats = signal<KitchenStats>({ completed: 0, cancelled: 0, revenue: 0, active: 0 });
  readonly logEntries = signal<KitchenLogEntry[]>([]);
  readonly running = signal(false);
  readonly isProcessing = computed(() => this.running() || this.stats().active > 0);

  private readonly ovenWorkers: OvenWorker[] = [
    { id: 'Oven #1', worker: createOvenCoroutine() },
    { id: 'Oven #2', worker: createOvenCoroutine() },
    { id: 'Oven #3', worker: createOvenCoroutine() },
  ];
  private readonly freeOvens: OvenWorker[] = [...this.ovenWorkers];
  private readonly orderControllers = new Map<string, AbortController>();
  private readonly startedOrders = new Set<string>();

  private cashier: Actor;
  private currentWork: TaskGroup | null = null;
  private routedResolve: (() => void) | null = null;
  private onMessageUnsubscribe: (() => void) | null = null;
  private fullDayClosing = false;
  private destroyed = false;

  constructor() {
    this.cashier = actor('cashier', cashierBehavior, { routed: 0 });
    this.onMessageUnsubscribe = main.inbox.subscribe((message: ActorBusMessage<any>) => {
      if (message.from !== 'cashier') return;

      if (message.topic === 'cook') {
        this.enqueueOrder(message.payload as Order);
      } else if (message.topic === 'cancel') {
        this.cancelOrderNow(message.payload as string);
      } else if (message.topic === 'close') {
        this.closeQueuedOrders(Boolean(message.payload?.cancelQueued ?? true));
      } else if (message.topic === 'shift-routed') {
        this.routedResolve?.();
        this.routedResolve = null;
      }
    });
  }

  async runShift(
    orders: Order[],
    options: { accumulate?: boolean; internal?: boolean } = {},
  ): Promise<{ completed: number; cancelled: number; revenue: number } | undefined> {
    if (this.destroyed || (!options.internal && this.running())) return;

    if (!options.internal) this.running.set(true);
    if (options.accumulate) this.resetOvens();
    else this.resetState();

    if (!options.internal) this.fullDayClosing = false;
    this.cancellableOrders.set([...orders]);
    this.appendLog(`--- Starting shift with ${orders.length} orders ---`);

    const work = group({ concurrency: this.ovenWorkers.length });
    this.currentWork = work;

    const routed = new Promise<void>((resolve) => {
      this.routedResolve = resolve;
    });
    main.outbox.send(this.cashier, 'runShift', { orders });
    await routed;

    const report = await work.settle();
    if (this.currentWork === work) this.currentWork = null;

    const stats = this.stats();
    this.cancellableOrders.set([]);
    this.appendLog(
      `🏁 Shift closed! Completed: ${stats.completed}, Cancelled: ${stats.cancelled}, Revenue: $${stats.revenue.toFixed(2)}`,
      'closed',
    );

    if (!options.internal) this.running.set(false);
    if (report.error && !this.fullDayClosing) throw report.error;

    return { completed: stats.completed, cancelled: stats.cancelled, revenue: stats.revenue };
  }

  async runFullDay(): Promise<void> {
    if (this.destroyed || this.running()) return;

    const shifts: Array<{ name: string; orders: Order[] }> = [
      { name: '🌅 Morning Shift', orders: [
        { id: 'M1', item: 'Margherita', customer: 'John' },
        { id: 'M2', item: 'Pepperoni', customer: 'Sarah' },
        { id: 'M3', item: 'Hawaiian', customer: 'Mike' },
      ] },
      { name: '🌞 Lunch Rush', orders: [
        { id: 'L1', item: 'Quattro Formaggi', customer: 'Emma' },
        { id: 'L2', item: 'Diavola', customer: 'Luca' },
        { id: 'L3', item: 'Margherita', customer: 'Sophia' },
        { id: 'L4', item: 'Pepperoni', customer: 'Oliver' },
      ] },
      { name: '🌤️ Afternoon', orders: [
        { id: 'A1', item: 'Hawaiian', customer: 'Isabella' },
        { id: 'A2', item: 'Diavola', customer: 'Ethan' },
      ] },
      { name: '🌙 Evening Rush', orders: [
        { id: 'E1', item: 'Diavola', customer: 'Marco' },
        { id: 'E2', item: 'Quattro Formaggi', customer: 'Giulia' },
        { id: 'E3', item: 'Pepperoni', customer: 'Antonio' },
        { id: 'E4', item: 'Margherita', customer: 'Francesca' },
        { id: 'E5', item: 'Hawaiian', customer: 'Roberto' },
      ] },
    ];

    this.running.set(true);
    this.fullDayClosing = false;
    this.resetState();
    this.appendLog('=== Full Day Started ===');

    try {
      for (const shift of shifts) {
        if (this.fullDayClosing) break;
        this.appendLog(`=== ${shift.name} ===`);
        await this.runShift(shift.orders, { accumulate: true, internal: true });
      }
    } finally {
      this.cancellableOrders.set([]);
      this.running.set(false);
    }

    const stats = this.stats();
    this.appendLog(
      `📊 FULL DAY SUMMARY: ✅ ${stats.completed} completed, ❌ ${stats.cancelled} cancelled, 💰 $${stats.revenue.toFixed(2)}`,
    );
  }

  cancelOrder(orderId: string): void {
    if (!this.running()) return;
    main.outbox.send(this.cashier, 'cancel', orderId);
    this.appendLog(`🚫 Cancellation requested for order ${orderId}`, 'cancelled');
  }

  closeKitchen(): void {
    if (!this.running()) return;
    this.fullDayClosing = true;
    main.outbox.send(this.cashier, 'close', { cancelQueued: true });
    this.appendLog('🚨 Kitchen closing requested — active ovens finish, queued orders are cancelled', 'cancelled');
  }

  resetState(): void {
    this.resetOvens();
    this.cancellableOrders.set([]);
    this.stats.set({ completed: 0, cancelled: 0, revenue: 0, active: 0 });
    this.logEntries.set([]);
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;

    this.currentWork?.cancel(new Error('Kitchen service destroyed'));
    await this.currentWork?.settle();
    this.currentWork = null;

    for (const controller of this.orderControllers.values()) controller.abort('Kitchen service destroyed');
    this.orderControllers.clear();

    this.onMessageUnsubscribe?.();
    this.onMessageUnsubscribe = null;

    await Promise.all([
      main.outbox.stop(this.cashier),
      ...this.ovenWorkers.map(({ worker }) => worker.dispose()),
    ]);
  }

  private enqueueOrder(order: Order): void {
    const work = this.currentWork;
    if (!work || !work.accepting) return;

    const controller = new AbortController();
    this.orderControllers.set(order.id, controller);

    void work.spawn((groupSignal) => {
      const signal = AbortSignal.any([groupSignal, controller.signal]);
      return this.processOrder(order, signal);
    }).catch(() => undefined);
  }

  private async processOrder(order: Order, signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
      this.finishCancelled(order, 'Cancelled before start');
      return;
    }

    const oven = this.freeOvens.shift();
    if (!oven) throw new Error('No oven slot available for admitted kitchen work');

    this.startedOrders.add(order.id);
    this.updateOven(oven.id, order, 'Preparing...');
    this.stats.update((stats) => ({ ...stats, active: stats.active + 1 }));
    this.appendLog(`🍳 Started: ${order.item} for ${order.customer} (${oven.id})`, 'started');

    try {
      const recipe = RECIPES.get(order.item);
      if (!recipe) throw new Error(`No recipe for ${order.item}`);

      this.updateOven(oven.id, order, 'Baking...');
      this.appendLog(`📍 Baking... - ${order.item} (${oven.id})`);

      await oven.worker.run({ order, recipe }, signal);
      const price = PRICES.get(order.item) ?? 10;

      this.stats.update((stats) => ({
        ...stats,
        completed: stats.completed + 1,
        revenue: stats.revenue + price,
        active: Math.max(0, stats.active - 1),
      }));
      this.appendLog(`✅ READY! ${order.item} for ${order.customer} (${oven.id})`, 'ready');
      this.removeCancellableOrder(order.id);
    } catch (error) {
      const reason = signal.aborted
        ? 'Cancelled'
        : error instanceof Error ? error.message : String(error);
      this.stats.update((stats) => ({
        ...stats,
        cancelled: stats.cancelled + 1,
        active: Math.max(0, stats.active - 1),
      }));
      this.appendLog(`❌ CANCELLED: ${order.item} for ${order.customer} - ${reason} (${oven.id})`, 'cancelled');
      this.removeCancellableOrder(order.id);
    } finally {
      this.updateOven(oven.id, null, null);
      this.freeOvens.push(oven);
      this.startedOrders.delete(order.id);
      this.orderControllers.delete(order.id);
    }
  }

  private cancelOrderNow(orderId: string): void {
    this.orderControllers.get(orderId)?.abort(`Order ${orderId} cancelled`);
  }

  private closeQueuedOrders(cancelQueued: boolean): void {
    if (!cancelQueued) return;
    for (const [orderId, controller] of this.orderControllers) {
      if (!this.startedOrders.has(orderId)) controller.abort('Kitchen is closing');
    }
  }

  private finishCancelled(order: Order, reason: string): void {
    this.stats.update((stats) => ({ ...stats, cancelled: stats.cancelled + 1 }));
    this.appendLog(`❌ CANCELLED: ${order.item} for ${order.customer} - ${reason} (N/A)`, 'cancelled');
    this.removeCancellableOrder(order.id);
    this.orderControllers.delete(order.id);
  }

  private updateOven(id: string, order: Order | null, stage: string | null): void {
    this.ovens.update((ovens) => ovens.map((oven) => oven.id === id ? { ...oven, order, stage } : oven));
  }

  private resetOvens(): void {
    this.ovens.set(EMPTY_OVENS());
  }

  private removeCancellableOrder(orderId: string): void {
    this.cancellableOrders.update((orders) => orders.filter((order) => order.id !== orderId));
  }

  private appendLog(text: string, kind: KitchenLogEntry['kind'] = 'normal'): void {
    const time = new Date().toLocaleTimeString();
    this.logEntries.update((entries) => [...entries.slice(-199), { text: `[${time}] ${text}`, kind }]);
  }
}
