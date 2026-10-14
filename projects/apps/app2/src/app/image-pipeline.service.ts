import { computed, Injectable, signal } from '@angular/core';
import { coroutine, group } from '@epikodelabs/coroutines';
import { zipSync } from 'fflate';
import {
  DEFAULT_SETTINGS,
  FileTask,
  JobProgress,
  processImage,
  ProcessedResult,
  ProcessingSettings,
  ProcessInput,
  ProcessOutput,
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

  private destroyed = false;
  private readonly processor = coroutine<ProcessInput, ProcessOutput>(processImage);
  private readonly pool = group();
  private readonly executor = this.pool.executor(this.processor);
  private readonly work = group({
    concurrency: Math.max(
      1,
      Math.min(typeof navigator === 'undefined' ? 4 : (navigator.hardwareConcurrency || 4), 4),
    ),
  });

  uploadFile(file: File): void {
    if (this.destroyed) {
      return;
    }

    const id = crypto.randomUUID();
    const url = URL.createObjectURL(file);
    const settings = { ...this.settings() };

    this.jobs.update((list) => [
      ...list,
      {
        id,
        fileName: file.name,
        state: 'queued',
        progress: { stage: 'idle', percent: 0 },
        originalSize: file.size,
        originalUrl: url,
        settings,
      },
    ]);

    void this.work.spawn((signal) =>
      this.processTask({ file, id, settings }, signal)
    ).catch(() => undefined);
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
    this.work.cancel(new Error('Image pipeline destroyed'));
    await this.work.settle();
    this.pool.cancel();

    this.clearAll();
  }

  private async processTask(task: FileTask, signal: AbortSignal): Promise<void> {
    this.jobs.update((list) =>
      list.map((job) =>
        job.id === task.id
          ? { ...job, state: 'processing' as const, progress: { stage: 'processing', percent: 5 } }
          : job,
      ),
    );

    if (!task.file.type.startsWith('image/')) {
      this.jobs.update((list) =>
        list.map((job) =>
          job.id === task.id
            ? { ...job, state: 'error' as const, error: 'Only image files are supported.' }
            : job,
        ),
      );
      return;
    }

    try {
      const arrayBuffer = await task.file.arrayBuffer();
      this.setJobProgress(task.id, { stage: 'processing', percent: 20 });

      const input: ProcessInput = {
        blob: arrayBuffer,
        width: task.settings.maxWidth,
        height: task.settings.maxHeight,
        quality: task.settings.quality,
        format: task.settings.format,
        grayscale: task.settings.grayscale,
        taskId: task.id,
        originalSize: task.file.size,
        fileName: task.file.name,
      };

      const output = await this.executor.run(input, signal);
      if (this.destroyed || signal.aborted) {
        return;
      }

      this.setJobProgress(task.id, { stage: 'processing', percent: 90 });
      if (!this.jobs().some((job) => job.id === input.taskId)) {
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
                progress: { stage: 'idle', percent: 100 },
              }
            : job,
        ),
      );
    } catch (error) {
      if (this.destroyed || signal.aborted) {
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

  private setJobProgress(taskId: string, progress: JobProgress): void {
    this.jobs.update((list) =>
      list.map((job) =>
        job.id === taskId
          ? { ...job, progress, state: 'processing' as const }
          : job,
      ),
    );
  }
}