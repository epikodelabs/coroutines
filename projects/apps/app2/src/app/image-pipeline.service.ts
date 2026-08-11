import { computed, Injectable, signal } from '@angular/core';
import { ActorBusMessage, actor, main } from '@epikodelabs/swiftly';
import { zipSync } from 'fflate';
import {
  compressImage,
  CompressOutput,
  DEFAULT_SETTINGS,
  FileTask,
  JobProgress,
  ProcessedResult,
  ProcessingSettings,
  ProcessInput,
  resizeImage,
  ResizeOutput,
} from './image-processing.utils';

export interface ImageJob {
  id: string;
  fileName: string;
  state: 'queued' | 'processing' | 'done' | 'error';
  progress: JobProgress;
  originalSize: number;
  originalUrl: string;
  resultUrl?: string;
  result?: ProcessedResult;
  error?: string;
  settings: ProcessingSettings;
}

@Injectable({ providedIn: 'root' })
export class ImagePipelineService {
  readonly settings = signal<ProcessingSettings>({ ...DEFAULT_SETTINGS });
  readonly jobs = signal<ImageJob[]>([]);
  readonly doneCount = computed(() => this.jobs().filter((job) => job.state === 'done').length);
  readonly totalSaved = computed(() =>
    this.jobs()
      .filter((job) => job.state === 'done')
      .reduce((sum, job) => sum + (job.result?.saved ?? 0), 0),
  );
  readonly isProcessing = computed(() => this.jobs().some((job) => job.state === 'processing'));

  private readonly queue: FileTask[] = [];
  private queueActive = false;
  private destroyed = false;
  private readonly inboxUnsubscribe: () => void;

  private readonly resizeActor = actor<ResizeOutput, any, any, ProcessInput>(
    'image-resize',
    (msg: ProcessInput, _state: any, utils: any) => resizeImage(msg, utils),
    null!,
    resizeImage,
  );

  private readonly compressActor = actor<CompressOutput, any, any, ResizeOutput>(
    'image-compress',
    (msg: ResizeOutput, _state: any, utils: any) => compressImage(msg, utils),
    null!,
    compressImage,
  );

  constructor() {
    this.inboxUnsubscribe = main.inbox.subscribe((message: ActorBusMessage<any>) => {
      if (message.topic !== 'progress') {
        return;
      }

      const progress = message.payload as JobProgress;
      if (!progress.taskId) {
        return;
      }

      this.jobs.update((list) =>
        list.map((job) =>
          job.id === progress.taskId
            ? { ...job, progress, state: 'processing' as const }
            : job,
        ),
      );
    });
  }

  uploadFile(file: File): void {
    const id = crypto.randomUUID();
    const url = URL.createObjectURL(file);

    this.jobs.update((list) => [
      ...list,
      {
        id,
        fileName: file.name,
        state: 'queued',
        progress: { stage: 'idle', percent: 0 },
        originalSize: file.size,
        originalUrl: url,
        settings: { ...this.settings() },
      },
    ]);

    this.queue.push({ file, id });
    void this.drainQueue();
  }

  removeJob(id: string): void {
    this.jobs.update((list) => {
      const job = list.find((entry) => entry.id === id);
      if (job?.resultUrl) {
        URL.revokeObjectURL(job.resultUrl);
      }
      if (job?.originalUrl) {
        URL.revokeObjectURL(job.originalUrl);
      }
      return list.filter((entry) => entry.id !== id);
    });
  }

  clearAll(): void {
    for (const job of this.jobs()) {
      if (job.resultUrl) {
        URL.revokeObjectURL(job.resultUrl);
      }
      if (job.originalUrl) {
        URL.revokeObjectURL(job.originalUrl);
      }
    }

    this.jobs.set([]);
  }

  updateSettings(patch: Partial<ProcessingSettings>): void {
    this.settings.update((current) => ({ ...current, ...patch }));
  }

  async downloadAll(): Promise<void> {
    const doneJobs = this.jobs().filter((job) => job.state === 'done' && job.resultUrl);
    if (doneJobs.length === 0) {
      return;
    }

    const files: Record<string, Uint8Array> = {};
    const seen = new Set<string>();

    for (const job of doneJobs) {
      const ext =
        job.result?.format === 'image/png'
          ? 'png'
          : job.result?.format === 'image/webp'
            ? 'webp'
            : 'jpg';
      const base = job.fileName.replace(/\.[^.]+$/, '') || 'image';
      let fileName = `${base}.${ext}`;
      let counter = 1;

      while (seen.has(fileName)) {
        fileName = `${base}-${counter}.${ext}`;
        counter++;
      }

      seen.add(fileName);
      const response = await fetch(job.resultUrl!);
      const buffer = await response.arrayBuffer();
      files[fileName] = new Uint8Array(buffer);
    }

    const zipped = zipSync(files, { level: 0 });
    const blob = new Blob([zipped], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `processed-images-${new Date().toISOString().slice(0, 10)}.zip`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  async destroy(): Promise<void> {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.queue.length = 0;
    this.inboxUnsubscribe();

    await Promise.all([
      main.outbox.stop(this.resizeActor),
      main.outbox.stop(this.compressActor),
    ]);

    this.clearAll();
  }

  private async drainQueue(): Promise<void> {
    if (this.queueActive || this.destroyed) {
      return;
    }

    this.queueActive = true;

    try {
      while (this.queue.length > 0 && !this.destroyed) {
        const task = this.queue.shift()!;

        if (!task.file.type.startsWith('image/')) {
          this.jobs.update((list) =>
            list.map((job) =>
              job.id === task.id
                ? { ...job, state: 'error' as const, error: 'Only image files are supported.' }
                : job,
            ),
          );
          continue;
        }

        await this.processTask(task);
      }
    } finally {
      this.queueActive = false;
      if (this.queue.length > 0 && !this.destroyed) {
        void this.drainQueue();
      }
    }
  }

  private async processTask(task: FileTask): Promise<void> {
    this.jobs.update((list) =>
      list.map((job) =>
        job.id === task.id
          ? { ...job, state: 'processing' as const, progress: { stage: 'idle', percent: 0 } }
          : job,
      ),
    );

    try {
      const { arrayBuffer } = await this.readFile(task.file);
      const settings = this.settings();
      const input: ProcessInput = {
        blob: arrayBuffer,
        width: settings.maxWidth,
        height: settings.maxHeight,
        quality: settings.quality,
        format: settings.format,
        grayscale: settings.grayscale,
        taskId: task.id,
        originalSize: task.file.size,
        fileName: task.file.name,
      };

      const output = await this.runPipeline(input);
      if (this.destroyed) {
        return;
      }

      const finalBlob = new Blob([output.finalBlob], { type: input.format });
      const url = URL.createObjectURL(finalBlob);
      const result: ProcessedResult = {
        id: input.taskId,
        fileName: input.fileName,
        url,
        originalSize: input.originalSize,
        resizedSize: output.resizedSize,
        finalSize: output.compressedSize,
        saved: input.originalSize - output.compressedSize,
        width: output.width,
        height: output.height,
        format: input.format,
      };

      this.jobs.update((list) =>
        list.map((job) =>
          job.id === input.taskId
            ? {
                ...job,
                state: 'done' as const,
                resultUrl: url,
                result,
                progress: { stage: 'idle' as const, percent: 100 },
              }
            : job,
        ),
      );
    } catch (error) {
      if (this.destroyed) {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      this.jobs.update((list) =>
        list.map((job) =>
          job.id === task.id
            ? { ...job, state: 'error' as const, error: message }
            : job,
        ),
      );
    }
  }

  private async readFile(file: File): Promise<{ arrayBuffer: ArrayBuffer }> {
    return {
      arrayBuffer: await file.arrayBuffer(),
    };
  }

  private async runPipeline(input: ProcessInput): Promise<CompressOutput> {
    const resized = await main.outbox.request<ProcessInput, ResizeOutput>(
      this.resizeActor,
      'process',
      input,
    );
    return main.outbox.request<ResizeOutput, CompressOutput>(
      this.compressActor,
      'process',
      resized,
    );
  }
}