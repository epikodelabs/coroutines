import { DecimalPipe } from '@angular/common';
import { Component, OnDestroy, signal } from '@angular/core';
import { FileSizePipe } from './file-size.pipe';
import { ImagePipelineService } from './image-pipeline.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [DecimalPipe, FileSizePipe],
  template: `
    <div class="app">
      <header class="header">
        <h1>🖼️ Smart Image Processor</h1>
        <p class="subtitle">Resize and convert images with group-bounded coroutines workers</p>
      </header>

      <section class="toolbar">
        @if (pipeline.jobs().length) {
          <div class="stats">
            <span class="pill">{{ pipeline.jobs().length }} files</span>
            @if (pipeline.doneCount()) {
              <span class="pill done">{{ pipeline.doneCount() }} done</span>
            }
            @if (pipeline.totalSaved() > 0) {
              <span class="pill saved">{{ pipeline.totalSaved() | filesize }} saved</span>
            }
          </div>
        }
        @if (pipeline.doneCount()) {
          <button class="btn btn-primary" (click)="pipeline.downloadAll()">⬇ Download all</button>
        }
        @if (pipeline.jobs().length) {
          <button class="btn btn-ghost" (click)="pipeline.clearAll()">Clear all</button>
        }
      </section>

      <section class="settings">
        <button class="settings-toggle" (click)="showSettings.set(!showSettings())">
          ⚙️ Settings
          <span class="chevron" [class.open]="showSettings()">▼</span>
        </button>
        <div class="settings-body" [class.collapsed]="!showSettings()">
          <div class="field">
            <label>Max width</label>
            <input type="range" min="200" max="3000" step="100"
                   [value]="pipeline.settings().maxWidth"
                   (input)="pipeline.updateSettings({ maxWidth: +$any($event.target).value })" />
            <span class="value">{{ pipeline.settings().maxWidth }} px</span>
          </div>
          <div class="field">
            <label>Max height</label>
            <input type="range" min="200" max="3000" step="100"
                   [value]="pipeline.settings().maxHeight"
                   (input)="pipeline.updateSettings({ maxHeight: +$any($event.target).value })" />
            <span class="value">{{ pipeline.settings().maxHeight }} px</span>
          </div>
          <div class="field">
            <label>Quality</label>
            <input type="range" min="0.1" max="1" step="0.05"
                   [value]="pipeline.settings().quality"
                   (input)="pipeline.updateSettings({ quality: +$any($event.target).value })" />
            <span class="value">{{ (pipeline.settings().quality * 100) | number:'1.0-0' }}%</span>
          </div>
          <div class="field">
            <label>Format</label>
            <select [value]="pipeline.settings().format"
                    (change)="pipeline.updateSettings({ format: $any($event.target).value })">
              <option value="image/jpeg">JPEG</option>
              <option value="image/png">PNG</option>
              <option value="image/webp">WebP</option>
            </select>
          </div>
          <div class="field checkbox">
            <label>
              <input type="checkbox"
                     [checked]="pipeline.settings().grayscale"
                     (change)="pipeline.updateSettings({ grayscale: $any($event.target).checked })" />
              Grayscale
            </label>
          </div>
        </div>
      </section>

      <section
        class="dropzone"
        [class.dragover]="dragOver()"
        (dragover)="onDragOver($event)"
        (dragleave)="onDragLeave($event)"
        (drop)="onDrop($event)"
        (click)="fileInput.click()"
      >
        <input #fileInput type="file" multiple accept="image/*" hidden (change)="onFiles($event)" />
        <div class="dropzone-content">
          <div class="icon">📁</div>
          <p><strong>Drop images here</strong> or click to browse</p>
          <p class="hint">JPG, PNG, WebP · Up to 50 MB each</p>
        </div>
      </section>

      @if (pipeline.jobs().length) {
        <section class="gallery">
          @for (job of pipeline.jobs(); track job.id) {
            <div class="card" [class.done]="job.state === 'done'" [class.error]="job.state === 'error'">
              <button class="card-close" (click)="pipeline.removeJob(job.id); $event.stopPropagation()">×</button>

              <div class="card-preview">
                <img [src]="job.resultUrl ?? job.originalUrl" [class.original]="!job.resultUrl" loading="lazy" />
                @if (job.state === 'processing') {
                  <div class="overlay">
                    <div class="spinner"></div>
                    <span class="stage">{{ job.progress.stage }} {{ job.progress.percent }}%</span>
                  </div>
                }
                @if (job.state === 'error') {
                  <div class="overlay error-overlay">
                    <span>⚠️ {{ job.error }}</span>
                  </div>
                }
              </div>

              <div class="card-info">
                <p class="filename" [title]="job.fileName">{{ job.fileName }}</p>
                @if (job.state === 'done' && job.result) {
                  <div class="metrics">
                    <span class="metric">{{ job.originalSize | filesize }}</span>
                    <span class="arrow">→</span>
                    <span class="metric">{{ job.result.finalSize | filesize }}</span>
                    <span class="badge saved">-{{ job.result.saved | filesize }}</span>
                    <span class="badge">{{ job.result.width }}×{{ job.result.height }}</span>
                  </div>
                }
                @if (job.state !== 'done') {
                  <div class="metrics">
                    <span class="metric">{{ job.originalSize | filesize }}</span>
                    <span class="status">{{ job.state }}</span>
                  </div>
                }
                @if (job.resultUrl) {
                  <a class="btn btn-sm btn-primary" [href]="job.resultUrl" [download]="'processed-' + job.fileName">
                    ⬇ Download
                  </a>
                }
              </div>
            </div>
          }
        </section>
      }

      @if (pipeline.jobs().length) {
        <footer class="footer">
          <p>Powered by <strong>coroutines</strong> · Web Worker image pipeline</p>
        </footer>
      }
    </div>
  `,
  styles: [`
    :host {
      --bg: #0f1117;
      --surface: #181b24;
      --surface-hover: #1e2230;
      --border: #2a2f3f;
      --text: #e2e5ec;
      --text-muted: #8b92a8;
      --accent: #5b8cff;
      --accent-hover: #4a7aee;
      --success: #3ddc84;
      --error: #ff5f5f;
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

    .toolbar {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 16px; gap: 12px; flex-wrap: wrap;
    }
    .stats { display: flex; gap: 8px; flex-wrap: wrap; }
    .pill {
      background: var(--surface); border: 1px solid var(--border);
      padding: 4px 12px; border-radius: 999px; font-size: 0.8rem; color: var(--text-muted);
    }
    .pill.done { color: var(--success); border-color: rgba(61,220,132,0.3); }
    .pill.saved { color: var(--accent); border-color: rgba(91,140,255,0.3); }

    .btn {
      cursor: pointer; border: none; border-radius: 8px; padding: 8px 16px;
      font-size: 0.85rem; font-weight: 500; transition: background 0.15s, transform 0.05s;
    }
    .btn:active { transform: scale(0.97); }
    .btn-ghost { background: transparent; color: var(--text-muted); border: 1px solid var(--border); }
    .btn-ghost:hover { background: var(--surface-hover); color: var(--text); }
    .btn-sm { padding: 5px 12px; font-size: 0.78rem; }
    .btn-primary { background: var(--accent); color: #fff; text-decoration: none; display: inline-block; }
    .btn-primary:hover { background: var(--accent-hover); }

    .settings { margin-bottom: 20px; }
    .settings-toggle {
      display: flex; align-items: center; gap: 8px; cursor: pointer;
      background: var(--surface); border: 1px solid var(--border);
      padding: 10px 16px; border-radius: var(--radius); width: 100%;
      color: var(--text); font-size: 0.9rem; font-weight: 500;
    }
    .chevron { margin-left: auto; transition: transform 0.2s; font-size: 0.7rem; }
    .chevron.open { transform: rotate(180deg); }
    .settings-body {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 16px; padding: 16px; background: var(--surface);
      border: 1px solid var(--border); border-top: none; border-radius: 0 0 var(--radius) var(--radius);
      transition: max-height 0.25s ease, opacity 0.2s ease, padding 0.2s ease;
      max-height: 400px; opacity: 1; overflow: hidden;
    }
    .settings-body.collapsed {
      max-height: 0; opacity: 0; padding-top: 0; padding-bottom: 0;
    }
    .field { display: flex; flex-direction: column; gap: 6px; }
    .field label { font-size: 0.8rem; color: var(--text-muted); font-weight: 500; }
    .field input[type="range"] { width: 100%; accent-color: var(--accent); }
    .field select {
      background: var(--bg); color: var(--text); border: 1px solid var(--border);
      padding: 6px 10px; border-radius: 6px; font-size: 0.85rem;
    }
    .field .value { font-size: 0.8rem; color: var(--text-muted); text-align: right; }
    .field.checkbox label { flex-direction: row; align-items: center; gap: 8px; cursor: pointer; color: var(--text); }
    .field.checkbox input { accent-color: var(--accent); width: 16px; height: 16px; }

    .dropzone {
      border: 2px dashed var(--border); border-radius: var(--radius);
      background: var(--surface); padding: 48px 24px; text-align: center;
      cursor: pointer; transition: border-color 0.2s, background 0.2s;
    }
    .dropzone:hover, .dropzone.dragover {
      border-color: var(--accent); background: rgba(91,140,255,0.05);
    }
    .dropzone-content .icon { font-size: 2.5rem; margin-bottom: 12px; }
    .dropzone-content p { margin: 4px 0; color: var(--text); }
    .dropzone-content .hint { font-size: 0.8rem; color: var(--text-muted); }

    .gallery {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 20px; margin-top: 28px;
    }
    .card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: var(--radius); overflow: hidden; position: relative;
      transition: transform 0.15s, box-shadow 0.15s;
    }
    .card:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.3); }
    .card-close {
      position: absolute; top: 8px; right: 8px; z-index: 2;
      width: 28px; height: 28px; border-radius: 50%;
      background: rgba(0,0,0,0.5); color: #fff; border: none;
      font-size: 1.1rem; line-height: 1; cursor: pointer; opacity: 0; transition: opacity 0.15s;
    }
    .card:hover .card-close { opacity: 1; }
    .card-close:hover { background: var(--error); }

    .card-preview { position: relative; height: 180px; background: #111; display: flex; align-items: center; justify-content: center; }
    .card-preview img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .card-preview img.original { opacity: 0.6; }
    .overlay {
      position: absolute; inset: 0; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 10px;
      background: rgba(0,0,0,0.6); color: #fff;
    }
    .spinner {
      width: 32px; height: 32px; border: 3px solid rgba(255,255,255,0.2);
      border-top-color: var(--accent); border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .stage { font-size: 0.8rem; text-transform: capitalize; }
    .error-overlay { background: rgba(200,50,50,0.25); color: var(--error); font-size: 0.8rem; padding: 12px; text-align: center; }

    .card-info { padding: 14px; }
    .filename { margin: 0 0 8px; font-size: 0.85rem; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .metrics { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
    .metric { font-size: 0.78rem; color: var(--text-muted); }
    .arrow { color: var(--text-muted); font-size: 0.7rem; }
    .badge { font-size: 0.7rem; background: var(--bg); padding: 2px 8px; border-radius: 4px; color: var(--text-muted); }
    .badge.saved { color: var(--success); background: rgba(61,220,132,0.1); }
    .status { font-size: 0.75rem; color: var(--accent); text-transform: capitalize; }

    .footer { text-align: center; margin-top: 32px; padding-top: 20px; border-top: 1px solid var(--border); }
    .footer p { color: var(--text-muted); font-size: 0.8rem; margin: 0; }
    .footer strong { color: var(--accent); }
  `],
})
export class ImageProcessorComponent implements OnDestroy {
  showSettings = signal(false);
  dragOver = signal(false);

  constructor(public pipeline: ImagePipelineService) {}

  onFiles(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files) {
      Array.from(input.files).forEach(f => this.pipeline.uploadFile(f));
      input.value = '';
    }
  }

  onDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    this.dragOver.set(true);
  }

  onDragLeave(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    this.dragOver.set(false);
  }

  onDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    this.dragOver.set(false);
    if (e.dataTransfer?.files) {
      Array.from(e.dataTransfer.files).forEach(f => this.pipeline.uploadFile(f));
    }
  }

  ngOnDestroy() {
    void this.pipeline.destroy();
  }
}