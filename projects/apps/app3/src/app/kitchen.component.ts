import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import {
  KitchenService,
  KitchenStats,
  Order,
  OvenState,
} from './kitchen.service';

@Component({
  selector: 'app-kitchen',
  standalone: true,
  imports: [],
  template: `
    <div class="kitchen">
      <div class="controls">
        <button [disabled]="isRunning" (click)="runShift(morningOrders)">🌅 Morning Shift</button>
        <button [disabled]="isRunning" (click)="runShift(lunchOrders)">🌞 Lunch Rush</button>
        <button [disabled]="isRunning" (click)="runShift(afternoonOrders)">🌤️ Afternoon</button>
        <button [disabled]="isRunning" (click)="runShift(eveningOrders)">🌙 Evening Rush</button>
        <button [disabled]="isRunning" (click)="runFullDay()" class="primary">🍕 Full Day</button>
        <button [disabled]="!isRunning" (click)="closeKitchen()" class="danger">🚨 Close Kitchen</button>
      </div>

      <div class="stats">
        <div class="stat-card">
          <div class="stat-value">{{ stats.completed }}</div>
          <div class="stat-label">Completed</div>
        </div>

        <div class="stat-card">
          <div class="stat-value">{{ stats.cancelled }}</div>
          <div class="stat-label">Cancelled</div>
        </div>

        <div class="stat-card">
          <div class="stat-value">{{ stats.active }}</div>
          <div class="stat-label">Active</div>
        </div>

        <div class="stat-card revenue">
          <div class="stat-value">\${{ stats.revenue.toFixed(2) }}</div>
          <div class="stat-label">Revenue</div>
        </div>
      </div>

      <div class="ovens">
        @for (oven of ovens; track oven.id) {
          <div class="oven" [class.active]="oven.order">
            <div class="oven-header">{{ oven.id }}</div>

            <div class="oven-body">
              <div class="pizza-icon">{{ oven.order ? '🍕' : '❄️' }}</div>

              @if (oven.order) {
                <div class="oven-order">
                  <strong>{{ oven.order.item }}</strong>
                  <span>{{ oven.order.customer }}</span>
                </div>
              }

              @if (oven.stage) {
                <div class="oven-stage">{{ oven.stage }}</div>
              }
              @if (!oven.order) {
                <div class="oven-idle">Idle</div>
              }
            </div>
          </div>
        }
      </div>

      @if (isRunning && cancellableOrders.length > 0) {
        <div class="cancel-panel">
          <span>Cancel order:</span>

          @for (order of cancellableOrders; track order.id) {
            <button (click)="cancelOrder(order.id)">
              Cancel {{ order.customer }}'s {{ order.item }}
            </button>
          }
        </div>
      }

      <div class="log-panel">
        <div class="log-header">Event Log</div>

        <div class="log-entries">
          @for (entry of logEntries; track $index) {
            <div
              class="log-entry"
              [class]="entryClass(entry)"
            >
              {{ entry }}
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .kitchen {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      justify-content: center;
    }

    .controls button {
      padding: 10px 18px;
      border: none;
      border-radius: 8px;
      background: #2d2d44;
      color: #eee;
      font-size: 0.9rem;
      cursor: pointer;
      transition: all 0.2s;
    }

    .controls button:hover:not(:disabled) {
      background: #3d3d5c;
      transform: translateY(-1px);
    }

    .controls button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .controls button.primary {
      background: #d4a017;
      color: #1a1a2e;
      font-weight: bold;
    }

    .controls button.primary:hover:not(:disabled) {
      background: #e5b128;
    }

    .controls button.danger {
      background: #c0392b;
      color: white;
    }

    .controls button.danger:hover:not(:disabled) {
      background: #e74c3c;
    }

    .stats {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 15px;
    }

    @media (max-width: 600px) {
      .stats {
        grid-template-columns: repeat(2, 1fr);
      }
    }

    .stat-card {
      background: #16213e;
      border-radius: 12px;
      padding: 16px;
      text-align: center;
      border: 1px solid #0f3460;
    }

    .stat-card.revenue {
      border-color: #d4a017;
    }

    .stat-value {
      font-size: 1.8rem;
      font-weight: bold;
      color: #ffd700;
    }

    .stat-label {
      font-size: 0.8rem;
      color: #aaa;
      margin-top: 4px;
    }

    .ovens {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 15px;
    }

    @media (max-width: 600px) {
      .ovens {
        grid-template-columns: 1fr;
      }
    }

    .oven {
      background: #16213e;
      border-radius: 12px;
      overflow: hidden;
      border: 2px solid #0f3460;
      transition: border-color 0.3s;
    }

    .oven.active {
      border-color: #e67e22;
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% {
        box-shadow: 0 0 5px rgba(230, 126, 34, 0.3);
      }

      50% {
        box-shadow: 0 0 20px rgba(230, 126, 34, 0.6);
      }
    }

    .oven-header {
      background: #0f3460;
      padding: 10px;
      font-weight: bold;
      text-align: center;
      color: #eee;
    }

    .oven-body {
      padding: 20px;
      text-align: center;
      min-height: 120px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }

    .pizza-icon {
      font-size: 2.5rem;
    }

    .oven-order {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .oven-order strong {
      color: #ffd700;
    }

    .oven-order span {
      font-size: 0.85rem;
      color: #aaa;
    }

    .oven-stage {
      font-size: 0.8rem;
      color: #e67e22;
      font-style: italic;
    }

    .oven-idle {
      color: #7f8c8d;
      font-style: italic;
    }

    .cancel-panel {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      justify-content: center;
      background: #2d1f1f;
      border: 1px solid #5c2a2a;
      border-radius: 8px;
      padding: 12px;
    }

    .cancel-panel span {
      color: #e74c3c;
      font-size: 0.9rem;
    }

    .cancel-panel button {
      padding: 6px 12px;
      border: 1px solid #c0392b;
      border-radius: 6px;
      background: transparent;
      color: #e74c3c;
      font-size: 0.8rem;
      cursor: pointer;
    }

    .cancel-panel button:hover {
      background: #c0392b;
      color: white;
    }

    .log-panel {
      background: #0a0a14;
      border-radius: 12px;
      border: 1px solid #1a1a2e;
      overflow: hidden;
    }

    .log-header {
      background: #16213e;
      padding: 12px 16px;
      font-weight: bold;
      border-bottom: 1px solid #0f3460;
    }

    .log-entries {
      padding: 10px;
      font-family: 'Courier New', monospace;
      font-size: 0.8rem;
      line-height: 1.5;
    }

    .log-entry {
      padding: 3px 0;
      border-bottom: 1px solid #1a1a2e;
      color: #ccc;
      white-space: pre-wrap;
    }

    .log-entry.started {
      color: #3498db;
    }

    .log-entry.ready {
      color: #2ecc71;
    }

    .log-entry.cancelled {
      color: #e74c3c;
    }

    .log-entry.timeout {
      color: #e67e22;
    }

    .log-entry.closed {
      color: #ffd700;
      font-weight: bold;
    }
  `],
})
export class KitchenComponent implements OnInit, OnDestroy {
  ovens: OvenState[] = [];
  cancellableOrders: Order[] = [];
  stats: KitchenStats = {
    completed: 0,
    cancelled: 0,
    revenue: 0,
    active: 0,
  };
  logEntries: string[] = [];
  isRunning = false;

  morningOrders: Order[] = [
    { id: 'M1', item: 'Margherita', customer: 'John' },
    { id: 'M2', item: 'Pepperoni', customer: 'Sarah' },
    { id: 'M3', item: 'Hawaiian', customer: 'Mike' },
  ];

  lunchOrders: Order[] = [
    { id: 'L1', item: 'Quattro Formaggi', customer: 'Emma' },
    { id: 'L2', item: 'Diavola', customer: 'Luca' },
    { id: 'L3', item: 'Margherita', customer: 'Sophia' },
    { id: 'L4', item: 'Pepperoni', customer: 'Oliver' },
  ];

  afternoonOrders: Order[] = [
    { id: 'A1', item: 'Hawaiian', customer: 'Isabella' },
    { id: 'A2', item: 'Diavola', customer: 'Ethan' },
  ];

  eveningOrders: Order[] = [
    { id: 'E1', item: 'Diavola', customer: 'Marco' },
    { id: 'E2', item: 'Quattro Formaggi', customer: 'Giulia' },
    { id: 'E3', item: 'Pepperoni', customer: 'Antonio' },
    { id: 'E4', item: 'Margherita', customer: 'Francesca' },
    { id: 'E5', item: 'Hawaiian', customer: 'Roberto' },
  ];

  private readonly cleanups: Array<() => void> = [];
  private runningInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private kitchen: KitchenService, private cdr: ChangeDetectorRef) {}

  ngOnInit() {
    this.cleanups.push(
      this.kitchen.ovens$.subscribe((ovens: OvenState[]) => {
        this.ovens = ovens;
        this.cdr.detectChanges();
      }),
    );

    this.cleanups.push(
      this.kitchen.cancellableOrders$.subscribe((orders: Order[]) => {
        this.cancellableOrders = orders;
        this.cdr.detectChanges();
      }),
    );

    this.cleanups.push(
      this.kitchen.stats$.subscribe((stats: KitchenStats) => {
        this.stats = stats;
        this.cdr.detectChanges();
      }),
    );

    this.cleanups.push(
      this.kitchen.log$.subscribe((entry) => {
        if (!entry) {
          return;
        }
        this.logEntries.push(entry);

        if (this.logEntries.length > 200) {
          this.logEntries.shift();
        }
        this.cdr.detectChanges();
      }),
    );

    this.updateRunningState();

    this.runningInterval = setInterval(() => {
      this.updateRunningState();
      this.cdr.detectChanges();
    }, 250);
    this.cleanups.push(() => {
      if (this.runningInterval) {
        clearInterval(this.runningInterval);
        this.runningInterval = null;
      }
    });


  }

  ngOnDestroy() {
    while (this.cleanups.length > 0) {
      this.cleanups.pop()!();
    }
    void this.kitchen.destroy();
  }

  async runShift(orders: Order[]) {
    this.kitchen.resetState();
    this.logEntries = [];
    this.cdr.detectChanges();

    await this.kitchen.runShift(orders);

    this.updateRunningState();
    this.cdr.detectChanges();
  }

  async runFullDay() {
    this.kitchen.resetState();
    this.logEntries = [];
    this.cdr.detectChanges();

    await this.kitchen.runFullDay();

    this.updateRunningState();
    this.cdr.detectChanges();
  }

  cancelOrder(orderId: string) {
    this.kitchen.cancelOrder(orderId);
    this.cdr.detectChanges();
  }

  closeKitchen() {
    this.kitchen.closeKitchen();
    this.cdr.detectChanges();
  }

  private updateRunningState() {
    this.isRunning = this.kitchen.isRunning();
  }

  entryClass(entry: string): string {
    if (entry.includes('🍳 Started')) return 'started';
    if (entry.includes('✅ READY')) return 'ready';
    if (entry.includes('❌ CANCELLED')) return 'cancelled';
    if (entry.includes('⏰ TIMEOUT')) return 'timeout';
    if (entry.includes('🏁 Shift closed')) return 'closed';
    if (entry.includes('🚨 Kitchen closing')) return 'cancelled';
    if (entry.includes('🚫 Cancellation requested')) return 'cancelled';

    return '';
  }
}
