import { DecimalPipe } from '@angular/common';
import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { coroutine, group } from '@epikodelabs/swiftly';

interface JuliaPreset {
  name: string;
  cr: number;
  ci: number;
  zoom: number;
}

const PRESETS: JuliaPreset[] = [
  { name: 'Douady rabbit', cr: -0.123, ci: 0.745, zoom: 220 },
  { name: 'Spiral', cr: -0.8, ci: 0.156, zoom: 200 },
  { name: 'Dendrite', cr: 0, ci: 1, zoom: 160 },
  { name: 'San Marco', cr: -0.75, ci: 0, zoom: 190 },
  { name: 'Cauliflower', cr: -0.391, ci: -0.587, zoom: 200 },
  { name: 'Circle', cr: -0.7, ci: 0.27015, zoom: 180 },
];

const PALETTES = ['Electric', 'Fire', 'Ocean', 'Grayscale', 'Sunset'] as const;
type Palette = typeof PALETTES[number];

type BatchParams = {
  width: number;
  height: number;
  startY: number;
  endY: number;
  cr: number;
  ci: number;
  zoom: number;
  maxIterations: number;
  palette: string;
};

type Pixel = { i: number; r: number; g: number; b: number };

const juliaBatchWorker = (params: BatchParams): Pixel[] => {
  const { width, height, startY, endY, cr, ci, zoom, maxIterations, palette } = params;
  const cx = width / 2;
  const cy = height / 2;

  const julia = (zx: number, zy: number): number => {
    let x = zx, y = zy;
    for (let i = 0; i < maxIterations; i++) {
      const x2 = x * x, y2 = y * y;
      if (x2 + y2 > 4) return i;
      const tmp = x2 - y2 + cr;
      y = 2 * x * y + ci;
      x = tmp;
    }
    return maxIterations;
  };

  const getColor = (iter: number): [number, number, number] => {
    if (iter === maxIterations) return [0, 0, 0];
    const t = iter / maxIterations;
    switch (palette) {
      case 'Fire':
        return [Math.round(t * 255), Math.round(t * t * 128), 0];
      case 'Ocean':
        return [0, Math.round(t * 160), Math.round(t * t * 255)];
      case 'Grayscale': {
        const v = Math.round(t * 255);
        return [v, v, v];
      }
      case 'Sunset':
        return [Math.round(t * 255), Math.round((1 - t) * 100), Math.round((1 - t * 0.5) * 200)];
      case 'Electric':
      default: {
        const hue = (t * 360) % 360;
        const sat = 0.9;
        const val = 1.0;
        const c = val * sat;
        const hx = c * (1 - Math.abs((hue / 60) % 2 - 1));
        const m = val - c;
        let r = 0, g = 0, b = 0;
        if (hue < 60) { r = c; g = hx; b = 0; }
        else if (hue < 120) { r = hx; g = c; b = 0; }
        else if (hue < 180) { r = 0; g = c; b = hx; }
        else if (hue < 240) { r = 0; g = hx; b = c; }
        else if (hue < 300) { r = hx; g = 0; b = c; }
        else { r = c; g = 0; b = hx; }
        return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
      }
    }
  };

  const pixels: Pixel[] = [];
  for (let y = startY; y < endY; y++) {
    for (let x = 0; x < width; x++) {
      const x0 = (x - cx) / zoom;
      const y0 = (y - cy) / zoom;
      const iter = julia(x0, y0);
      const [r, g, b] = getColor(iter);
      pixels.push({ i: y * width + x, r, g, b });
    }
  }
  return pixels;
};

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [DecimalPipe, FormsModule],
  template: `
    <div class="app">
      <header class="header">
        <h1>🔥 Julia Set Explorer</h1>
        <p class="subtitle">Reactive fractal rendering with swiftly workers</p>
      </header>

      <main class="grid">
        <!-- Settings: presets, c values, palette -->
        <section class="card wide">
          <div class="card-header">
            <h2>Settings</h2>
            <span class="badge">coroutine worker</span>
          </div>
          <p class="tooltip">Choose a preset or adjust c manually. Rendering is offloaded to reusable coroutine workers with group-bounded concurrency.</p>

          <div class="settings-body">
            <div class="preset-row">
              <span class="label">Presets:</span>
              @for (p of presets; track p.name) {
                <button
                  [class.active]="selectedPreset === p.name"
                  (click)="loadPreset(p)"
                >{{ p.name }}</button>
              }
            </div>

            <div class="c-row">
              <span class="label">c =</span>
              <span class="sub-label">Re</span>
              <input type="range" min="-1.5" max="1.5" step="0.001" [(ngModel)]="cr" (input)="drawJulia()" />
              <span class="value">{{ cr | number:'1.3' }}</span>
              <span class="sub-label">Im</span>
              <input type="range" min="-1.5" max="1.5" step="0.001" [(ngModel)]="ci" (input)="drawJulia()" />
              <span class="value">{{ ci | number:'1.3' }}i</span>
            </div>

            <div class="palette-row">
              <span class="label">Palette</span>
              <select [(ngModel)]="palette" (change)="drawJulia()">
                @for (p of palettes; track p) {
                  <option [value]="p">{{ p }}</option>
                }
              </select>
              <button class="reset" (click)="reset()">Reset</button>
            </div>
          </div>
        </section>

        <!-- Julia Set Canvas -->
        <section class="card wide">
          <div class="card-header">
            <h2>Julia Set</h2>
            <span class="badge">coroutine + worker</span>
          </div>
          <p class="tooltip">Canvas rows are rendered through a reusable worker coroutine.</p>

          <div class="julia-controls">
            <button (click)="drawJulia()" [disabled]="generating">{{ generating ? 'Rendering…' : 'Generate' }}</button>
            @if (elapsed > 0) {
              <span class="julia-meta">Elapsed: {{ elapsed | number:'1.0-0' }} ms</span>
            }
          </div>

          <div class="julia-canvas-wrap">
            <canvas #juliaCanvas width="1000" height="1000"></canvas>
            @if (generating) {
              <div class="julia-overlay">
                <div class="julia-progress-bar">
                  <div class="julia-progress-fill" [style.width.%]="progress"></div>
                </div>
                <span class="julia-progress-text">{{ progress | number:'1.0-0' }}%</span>
              </div>
            }
          </div>
        </section>
      </main>

      <footer class="footer">
        <p>Powered by <strong>swiftly</strong> · Worker-first concurrency for TypeScript</p>
      </footer>
    </div>
  `,
  styles: [`
    :host {
      --bg: #f6f7f9;
      --surface: #ffffff;
      --surface-hover: #f0f1f4;
      --border: #e2e4e9;
      --text: #1a1d26;
      --text-muted: #6b7280;
      --accent: #2563eb;
      --accent-hover: #1d4ed8;
      --success: #16a34a;
      --warning: #d97706;
      --error: #dc2626;
      --radius: 12px;
      display: block;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    .app { max-width: 1200px; margin: 0 auto; padding: 32px 24px; }

    .header { text-align: center; margin-bottom: 28px; }
    .header h1 { font-size: 2rem; font-weight: 700; margin: 0 0 6px; letter-spacing: -0.5px; }
    .subtitle { color: var(--text-muted); font-size: 0.95rem; margin: 0; }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 20px;
    }
    .grid .wide { grid-column: 1 / -1; }

    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .card-header h2 { margin: 0; font-size: 1.05rem; font-weight: 600; }
    .badge {
      font-size: 0.7rem;
      background: rgba(37,99,235,0.10);
      color: var(--accent);
      padding: 3px 10px;
      border-radius: 999px;
      font-weight: 500;
      white-space: nowrap;
    }

    .tooltip { color: var(--text-muted); font-size: 0.8rem; margin: 0; }

    .settings-body { display: flex; flex-direction: column; gap: 16px; }
    .preset-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .preset-row button {
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 8px 16px;
      border-radius: 20px;
      cursor: pointer;
      font-size: 0.85rem;
      transition: all 0.15s;
    }
    .preset-row button:hover { border-color: var(--accent); background: var(--surface-hover); }
    .preset-row button.active { background: var(--accent); color: #fff; border-color: var(--accent); }

    .c-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .c-row input[type="range"] { width: 160px; accent-color: var(--accent); }
    .label { font-size: 0.9rem; color: var(--text-muted); }
    .sub-label { font-size: 0.8rem; color: var(--text-muted); }
    .value { font-size: 0.9rem; color: var(--text); min-width: 50px; font-weight: 500; }

    .palette-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .palette-row select {
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 8px 12px;
      border-radius: 8px;
      font-size: 0.9rem;
      cursor: pointer;
    }
    .reset {
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 8px 16px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 0.85rem;
    }
    .reset:hover { background: var(--surface-hover); }

    .julia-controls { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .julia-controls button {
      background: var(--accent); color: #fff; border: none; border-radius: 8px;
      padding: 8px 16px; font-size: 0.85rem; font-weight: 500; cursor: pointer;
      transition: background 0.15s;
    }
    .julia-controls button:hover:not(:disabled) { background: var(--accent-hover); }
    .julia-controls button:disabled { opacity: 0.5; cursor: not-allowed; }
    .julia-meta { font-size: 0.85rem; color: var(--text-muted); }

    .julia-canvas-wrap { position: relative; display: flex; justify-content: center; }
    .julia-canvas-wrap canvas {
      background: #000; border: 1px solid var(--border); border-radius: 8px;
      max-width: 100%; height: auto; image-rendering: pixelated;
    }
    .julia-overlay {
      position: absolute; inset: 0; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 8px;
      background: rgba(0,0,0,0.5); border-radius: 8px;
    }
    .julia-progress-bar {
      width: 200px; height: 6px; background: var(--border); border-radius: 3px; overflow: hidden;
    }
    .julia-progress-fill { height: 100%; background: var(--accent); transition: width 0.1s linear; }
    .julia-progress-text { font-size: 0.8rem; color: #fff; font-weight: 500; }

    .footer { text-align: center; margin-top: 32px; padding-top: 20px; border-top: 1px solid var(--border); }
    .footer p { color: var(--text-muted); font-size: 0.8rem; margin: 0; }
    .footer strong { color: var(--accent); }
  `],
})
export class AppComponent implements AfterViewInit, OnDestroy {
  constructor(private cdr: ChangeDetectorRef) {}

  @ViewChild('juliaCanvas') juliaCanvas!: ElementRef<HTMLCanvasElement>;

  presets = PRESETS;
  palettes = [...PALETTES];
  selectedPreset = PRESETS[0].name;

  cr = PRESETS[0].cr;
  ci = PRESETS[0].ci;
  zoom = PRESETS[0].zoom;
  maxIterations = 80;
  palette: Palette = 'Electric';

  generating = false;
  progress = 0;
  elapsed = 0;

  private runner = coroutine<BatchParams, Pixel[]>(juliaBatchWorker);
  private abortController: AbortController | null = null;
  private renderGeneration = 0;

  ngAfterViewInit(): void {
    this.drawJulia();
  }

  ngOnDestroy(): void {
    this.abortController?.abort();
    void this.runner.dispose();
  }

  loadPreset(p: JuliaPreset): void {
    this.selectedPreset = p.name;
    this.cr = p.cr;
    this.ci = p.ci;
    this.zoom = p.zoom;
    this.drawJulia();
  }

  reset(): void {
    this.selectedPreset = PRESETS[0].name;
    this.cr = PRESETS[0].cr;
    this.ci = PRESETS[0].ci;
    this.zoom = PRESETS[0].zoom;
    this.palette = 'Electric';
    this.drawJulia();
  }

  async drawJulia(): Promise<void> {
    const canvas = this.juliaCanvas?.nativeElement;
    if (!canvas) return;

    this.abortController?.abort();
    this.abortController = new AbortController();
    const generation = ++this.renderGeneration;
    const signal = this.abortController.signal;

    const ctx = canvas.getContext('2d')!;
    const w = canvas.width;
    const h = canvas.height;
    const imageData = ctx.createImageData(w, h);
    const data = imageData.data;

    this.generating = true;
    this.progress = 0;
    this.elapsed = 0;
    const start = performance.now();

    const batchHeight = 30;
    const totalBatches = Math.ceil(h / batchHeight);
    let completed = 0;

    const { cr, ci, zoom, maxIterations, palette } = this;

    const work = group({
      concurrency: Math.max(1, navigator.hardwareConcurrency || 4),
      signal,
    });

    const promises = [];
    for (let y = 0; y < h; y += batchHeight) {
      promises.push(
        work.spawn((childSignal) =>
          this.runner.run({
            width: w, height: h,
            startY: y, endY: Math.min(y + batchHeight, h),
            cr, ci, zoom, maxIterations, palette,
          }, childSignal)
        )
      );
    }

    try {
      await Promise.all(
        promises.map(async (p) => {
          if (signal.aborted || generation !== this.renderGeneration) return;
          const pixels = await p;
          if (signal.aborted || generation !== this.renderGeneration) return;

          for (const pix of pixels) {
            const idx = pix.i * 4;
            data[idx] = pix.r;
            data[idx + 1] = pix.g;
            data[idx + 2] = pix.b;
            data[idx + 3] = 255;
          }

          if (signal.aborted || generation !== this.renderGeneration) return;

          completed++;
          this.progress = (completed / totalBatches) * 100;
          this.cdr.detectChanges();
          ctx.putImageData(imageData, 0, 0);
        })
      );
      await work.wait();
    } catch {
      // aborted or error
    }

    if (!signal.aborted && generation === this.renderGeneration) {
      this.elapsed = performance.now() - start;
      this.generating = false;
      this.cdr.detectChanges();
    }
  }
}
