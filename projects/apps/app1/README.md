# App 1 - Julia Set Explorer

Fractal renderer using `swiftly` coroutine workers.

## What it demonstrates

- **`coroutine`** - offloads Julia set pixel batches to reusable Web Workers
- **`group`** - bounds concurrent row batches explicitly
- **Progressive rendering** - row batches draw to canvas as workers complete
- **Interactive parameters** - presets, c (Re/Im), color palette
- **Reactive UI** - `ChangeDetectorRef.detectChanges()` for smooth progress updates

## Run

```bash
ng serve app1
```

## Controls

- **Presets** - Douady rabbit, Spiral, Dendrite, San Marco, Cauliflower, Circle
- **c = Re + Im** - live sliders that re-render on input
- **Palette** - Electric, Fire, Ocean, Grayscale, Sunset
- **Reset** - restores defaults
