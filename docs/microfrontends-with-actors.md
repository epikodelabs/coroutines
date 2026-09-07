# Runtime Isolation Without Microfrontends

*The isolation you want doesn’t require another frontend application*

Microfrontends are often attractive in theory.

Clear boundaries. Independent teams. Less shared state.

But in many cases, teams still deploy the entire product together.

That raises a useful question:

**If features are not deployed independently, do they need to be separate applications?**

Deployment isolation may not be the actual requirement.

What may be needed instead is **runtime isolation**.

Actors can provide that separation with considerably less architectural overhead.

## Give the Feature Its Own Boundary

A shopping cart usually ends up in global state. Components dispatch, selectors read, effects run—and the cart slowly becomes entangled with everything else.

With `@epikodelabs/coroutines` we can put it behind an actor in its own Web Worker:

```text
Angular                    Cart Actor
   │                           │
   │ main.outbox               │
   ├──────────────────────────►│  private state
   │ main.inbox                │
   │◄──────────────────────────┤
```

The behavior stays tiny:

```ts
type CartState = { items: Item[]; total: number };

function cartBehavior(msg: any, state: CartState): CartState {
  if (msg.topic === "add") {
    const item: Item = msg.payload;
    return {
      items: [...state.items, item],
      total: state.total + item.price,
    };
  }
  return state;
}

const cart = actor("cart", cartBehavior, { items: [], total: 0 });
```

Angular never sees the state. It only talks to the cart:

```ts
main.outbox.send(cart, "add", item);

const snapshot = await main.outbox.request(cart, "snapshot", undefined);
```

No shared reference. No accidental mutation.  
The boundary is physical—another worker—not a README promise.

## Angular already has the missing piece

How do actors belong to the UI?  
Angular’s hierarchical DI.

A feature provides its actor exactly where it should live:

```ts
export const CART = new InjectionToken<ActorRef<CartState>>("CART");

@Component({
  selector: "app-cart",
  providers: [provideActor(CART, createCartActor)],
  template: `
    <app-cart-items />
    <app-cart-summary />
  `,
})
export class CartComponent {}
```

`provideActor` is almost nothing:

```ts
function provideActor<T>(
  token: InjectionToken<ActorRef<T>>,
  factory: () => ActorRef<T>,
): Provider {
  return {
    provide: token,
    useFactory: () => {
      const destroyRef = inject(DestroyRef);
      const ref = factory();
      destroyRef.onDestroy(() => main.outbox.stop(ref));
      return ref;
    },
  };
}
```

Feature appears → actor starts.  
Feature disappears → actor stops.

Angular owns the visual lifetime.  
The actor owns the state and behavior.

No global cart that lives forever. No `resetCart()` after navigation.

## Components stop sharing state

A child doesn’t need the cart’s state. It only needs permission to talk to it:

```ts
@Component({
  selector: "app-add-to-cart",
  template: `<button (click)="add()">Add to cart</button>`,
})
export class AddToCartComponent {
  private readonly cart = inject(CART);
  @Input({ required: true }) item!: Item;

  add() {
    main.outbox.send(this.cart, "add", this.item);
  }
}
```

Instead of “here is my state, please be careful,” you get “here is how you talk to me.”

That’s the boundary most teams actually want.

## Don’t create an actor for every component

These are real Web Workers.  
Button → Actor, Icon → Actor would be missing the point.

Rule of thumb:

> **One actor per independently stateful feature boundary.**

Checkout might look like:

```text
CheckoutPage
├── CartActor
├── ShippingActor
└── PaymentActor
```

Dozens of Angular components can live underneath.  
The component tree describes what the user sees.  
Actors define who owns behavior and state.

## Routes make the lifetime natural

Navigate to `/orders` → Angular creates the feature → OrdersActor starts.  
Navigate away → Angular destroys the feature → the worker stops.

Route lifetime, state lifetime, and background work line up without global cleanup actions.

## Isolation is not supervision

Actors give a real failure boundary:

```text
Application
├── SearchActor            ✓
├── CartActor              ✓
├── RecommendationsActor   ✕
└── CheckoutActor          ✓
```

Different workers, separate state.  
But isolation is not automatic recovery. Restart policies still have to be designed.

The worker isolates the feature. What happens after a crash is an application decision.

## Testing becomes boring (in a good way)

Behavior is just:

```ts
(message, state) => nextState
```

Most logic can be tested without Angular, without DOM, without a worker.  
Feed a message and state, assert the result. Keep a few integration tests for the boundary.

## Do actors replace microfrontends?

Microfrontends solve independent deployment.  
If teams truly need separate release trains, multiple frameworks, or third-party embedding, use that.

But if everything ships together, splitting into multiple frontend applications just to stop features from sharing state is often solving the wrong problem.

Actors give you:

- private feature state  
- explicit communication  
- isolated background work  
- feature-owned lifetime  
- worker-level failure boundaries  

without turning one product into several applications.

## The resulting shape

```text
AppComponent
├── SessionActor
├── NotificationsActor
└── RouterOutlet
     ├── SearchPage → SearchActor
     └── CheckoutPage
          ├── CartActor
          ├── ShippingActor
          └── PaymentActor
```

Angular still does components, templates, routing, rendering, DI.  
Actors own state, behavior, and boundaries.

No second frontend hiding inside the first.  
Just a stronger boundary where it actually helps.
