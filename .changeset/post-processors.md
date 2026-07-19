---
"turnover": minor
---

Add container post-processors — the instance-wrapping seam for method-level AOP.

- **`Container.addPostProcessor((instance, token) => instance | wrapper)`** (or **`createApp({ postProcessors })`**) inspects each freshly constructed class instance and returns it, or a wrapper such as a `Proxy`.
- Processors **chain** in registration order, and a returned wrapper is **cached** so later resolves get it. Registered before any construction.
- The raw instance is cached first, so re-entrant resolution during construction doesn't loop and self-invocation reaches the unwrapped object.
- This is the low-level seam that general method-level advice will be built on. Exposes `PostProcessor` and `Container.addPostProcessor`.
