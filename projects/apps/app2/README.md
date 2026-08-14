# App 2 - Image Processor

Reactive image pipeline with `swinky` workers and group-bounded concurrency.

## What it demonstrates

- **Reactive image pipeline** - drag-and-drop to process to download
- **`group`** - bounds how many image jobs run at once
- **`coroutine`** - performs resize and encode in one worker task
- **Custom pipes** - `fileSize` formatting
- **Signal-based service state** - `ImagePipelineService` exposes jobs and settings

## Run

```bash
ng serve app2
```