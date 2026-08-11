# App 2 — Julia Set Explorer

Dedicated fractal renderer using `swiftly` compute workers.

## What it demonstrates

- **`compute`** — offloads Julia set pixel batches to a pooled Web Worker
- **Progressive rendering** — row batches draw to canvas as workers complete
- **Interactive parameters** — presets, c (Re/Im), color palette
- **Reactive UI** — `ChangeDetectorRef.detectChanges()` for smooth progress updates

## Run

```bash
ng serve app2
```

## Controls

- **Presets** — Douady rabbit, Spiral, Dendrite, San Marco, Cauliflower, Circle
- **c = Re + Im** — live sliders that re-render on input
- **Palette** — Electric, Fire, Ocean, Grayscale, Sunset
- **Reset** — restores defaults
