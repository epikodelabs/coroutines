// utils/image-processing.utils.ts

export interface FileTask {
  file: File;
  id: string;
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

export interface ResizeOutput extends ProcessInput {
  resizedBlob: ArrayBuffer;
  resizedSize: number;
}

export interface CompressOutput extends ResizeOutput {
  finalBlob: ArrayBuffer;
  compressedSize: number;
}

export interface JobProgress {
  stage: 'resize' | 'compress' | 'idle';
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
 * Resizes an image using OffscreenCanvas inside a Web Worker.
 */
export async function resizeImage(
  data: ProcessInput,
  utils: { outbox: { send: (to: string, topic: string, payload: JobProgress) => void } }
): Promise<ResizeOutput> {
  utils.outbox.send('main', 'progress', { stage: 'resize', percent: 10, taskId: data.taskId });

  const imageBitmap = await createImageBitmap(new Blob([data.blob]));
  const ratio = Math.min(data.width / imageBitmap.width, data.height / imageBitmap.height, 1);
  const w = Math.round(imageBitmap.width * ratio);
  const h = Math.round(imageBitmap.height * ratio);

  utils.outbox.send('main', 'progress', { stage: 'resize', percent: 40, taskId: data.taskId });

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D context');

  if (data.grayscale) {
    ctx.filter = 'grayscale(100%)';
  }

  ctx.drawImage(imageBitmap, 0, 0, w, h);
  imageBitmap.close();

  utils.outbox.send('main', 'progress', { stage: 'resize', percent: 80, taskId: data.taskId });

  const outputBlob = await canvas.convertToBlob({ type: data.format, quality: data.quality });
  const resizedBlob = await outputBlob.arrayBuffer();

  utils.outbox.send('main', 'progress', { stage: 'resize', percent: 100, taskId: data.taskId });

  return {
    ...data,
    width: w,
    height: h,
    resizedBlob,
    resizedSize: outputBlob.size,
  };
}

/**
 * Re-encodes the resized image at the target quality/format.
 */
export async function compressImage(
  data: ResizeOutput,
  utils: { outbox: { send: (to: string, topic: string, payload: JobProgress) => void } }
): Promise<CompressOutput> {
  utils.outbox.send('main', 'progress', { stage: 'compress', percent: 10, taskId: data.taskId });

  const imageBitmap = await createImageBitmap(new Blob([data.resizedBlob]));

  utils.outbox.send('main', 'progress', { stage: 'compress', percent: 40, taskId: data.taskId });

  const canvas = new OffscreenCanvas(data.width, data.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D context');

  ctx.drawImage(imageBitmap, 0, 0);
  imageBitmap.close();

  utils.outbox.send('main', 'progress', { stage: 'compress', percent: 70, taskId: data.taskId });

  const outputBlob = await canvas.convertToBlob({ type: data.format, quality: data.quality });
  const finalBlob = await outputBlob.arrayBuffer();

  utils.outbox.send('main', 'progress', { stage: 'compress', percent: 100, taskId: data.taskId });

  return {
    ...data,
    finalBlob,
    compressedSize: outputBlob.size,
  };
}
