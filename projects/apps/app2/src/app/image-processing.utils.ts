import type { WorkerTaskResult, WorkerTaskUtils } from '@epikodelabs/swiftly';

export interface FileTask {
  file: File;
  id: string;
  settings: ProcessingSettings;
}

export interface ProcessingSettings {
  maxWidth: number;
  maxHeight: number;
  quality: number;
  format: 'image/jpeg' | 'image/png' | 'image/webp';
  grayscale: boolean;
}

export const DEFAULT_SETTINGS: ProcessingSettings = {
  maxWidth: 1200,
  maxHeight: 1200,
  quality: 0.85,
  format: 'image/jpeg',
  grayscale: false,
};

export interface ProcessInput {
  blob: ArrayBuffer;
  width: number;
  height: number;
  quality: number;
  format: string;
  grayscale: boolean;
  taskId: string;
  originalSize: number;
  fileName: string;
}

export interface ProcessOutput extends ProcessInput {
  finalBlob: ArrayBuffer;
  resizedSize: number;
  compressedSize: number;
}

export interface JobProgress {
  stage: 'processing' | 'idle';
  percent: number;
  taskId?: string;
}

export interface ProcessedResult {
  id: string;
  fileName: string;
  url: string;
  originalSize: number;
  resizedSize: number;
  finalSize: number;
  saved: number;
  width: number;
  height: number;
  format: string;
}

/**
 * Resizes and encodes an image inside one worker task.
 */
export async function processImage(
  data: ProcessInput,
  utils: WorkerTaskUtils,
): Promise<WorkerTaskResult<ProcessOutput>> {
  const imageBitmap = await createImageBitmap(new Blob([data.blob]));
  const ratio = Math.min(data.width / imageBitmap.width, data.height / imageBitmap.height, 1);
  const width = Math.round(imageBitmap.width * ratio);
  const height = Math.round(imageBitmap.height * ratio);

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D context');

  if (data.grayscale) {
    ctx.filter = 'grayscale(100%)';
  }

  ctx.drawImage(imageBitmap, 0, 0, width, height);
  imageBitmap.close();

  const outputBlob = await canvas.convertToBlob({ type: data.format, quality: data.quality });
  const finalBlob = await outputBlob.arrayBuffer();

  return utils.transfer(
    {
      ...data,
      width,
      height,
      finalBlob,
      resizedSize: outputBlob.size,
      compressedSize: outputBlob.size,
    },
    finalBlob,
  );
}