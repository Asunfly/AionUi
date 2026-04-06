# MCP Apps Host Shell Notes

## Current State

The current MCP Apps integration uses a mixed host/app model:

- **AionUi host shell** creates the outer card container, loading overlay, and sandboxed `iframe`.
- **The MCP server UI resource** provides the HTML/CSS/JS rendered inside the `iframe`.

This means the outer shell is controlled by AionUi, while the inner toolbar and interaction controls usually belong to the MCP App itself.

## Verified Findings

### Handshake Root Cause

The draw.io MCP App initializes immediately via `app.connect()` from inside the returned HTML page.
The previous host implementation connected `AppBridge` only after the `iframe` `load` event, which caused the first `ui/initialize` message to race and get dropped.

The fix was to connect the host bridge before the app page fully loads, then navigate the `iframe` to the fetched blob URL.

### Ownership Boundaries

- The outer `iframe` shell is ours.
- The inner app content is returned by the MCP server.
- Buttons like `Open in draw.io`, `Copy to Clipboard`, and `Fullscreen` are expected to come from the returned MCP App HTML, not from AionUi.

### Current UX Gap

The shell currently has a weak layout contract with large diagrams:

- height is effectively constrained by a fixed max-height strategy
- width is only passively handled by `w-full`
- `overflow-hidden` on the outer shell can clip useful inner content placement
- bottom action buttons may only become visible after the diagram expands enough or after manual scrolling

## Phase Plan

### Phase 1 — Host Shell Adaptive Layout

Goal: make the MCP App shell feel native enough for day-to-day use without touching arbitrary app HTML.

Scope:

- replace the fixed vertical sizing strategy with viewport-aware dynamic sizing
- keep the app visible at natural height for smaller content
- cap very tall apps against viewport height and fall back to scroll when needed
- improve horizontal behavior for wide diagrams so content is not awkwardly clipped
- refine the outer shell styling so the embedded app feels more integrated with AionUi
- ensure bottom toolbars/actions remain reachable without requiring accidental extra expansion

Non-goals:

- rewriting third-party MCP App HTML
- forcing theme parity inside arbitrary embedded apps
- introducing app-specific adapters yet

### Phase 2 — Host Theme / Context Injection Evaluation

Goal: determine whether MCP Apps can consume host-provided theme data in a reliable, generic way.

Evaluation questions:

- does the target MCP App consume host context or host styles from the MCP Apps bridge?
- can AionUi safely provide semantic theme tokens or display-mode hints without breaking existing apps?
- can we make draw.io look closer to AionUi through host context alone?

Important caveat:

This phase is exploratory. We should not assume arbitrary MCP Apps will honor injected theme variables.

### Phase 3 — Adapter / Native Renderer Evaluation

Goal: evaluate whether selected high-value apps should have first-class renderers instead of raw iframe embedding.

Current recommendation:

- **Do not** parse and re-render arbitrary MCP-returned HTML as the default strategy.
- Arbitrary HTML re-rendering is high-risk for compatibility, security, protocol semantics, and maintenance.
- Prefer keeping the generic path as sandboxed `iframe` rendering.
- If needed, build **app-specific adapters** for a small number of known tools where structured results are predictable.

Examples where adapters may be reasonable later:

- draw.io diagrams
- chart renderers
- PDF/document viewers

## Recommended Next Step

Proceed with **Phase 1** first.

This gives immediate UX improvement while preserving the generic MCP Apps model and keeping risk low.
