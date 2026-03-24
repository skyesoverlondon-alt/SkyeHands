# SkyDexia 2.6 Autonomy Audit

## Executive verdict

Current SkyDex proves a real bounded autonomous product contract.

Current SkyDexia does not yet preserve that contract cleanly enough.

SkyDexia 2.6 therefore must be treated as a reset, not a patch.

## Source-of-truth baseline from original SkyDex

The original SkyDex product contract already includes all of the following:
- full workspace import and snapshot state
- workspace intelligence and active-file awareness
- bounded multi-pass autonomous execution
- staged operations with controlled and autonomous modes
- auto-apply and auto-save in autonomous mode
- release actions executed from the same saved workspace state
- explicit auth, SKNore, iteration, and operation-budget boundaries

## Current-state findings

### Finding 1: original SkyDex is product-first and autonomy-first
Severity: critical

Original SkyDex describes itself as a workspace IDE, release lane, and bounded autonomous agent surface.

It is not merely a prompt shell. It owns:
- workspace state
- agent mode selection
- multi-pass execution
- auto-apply and save
- release continuity

### Finding 2: current SkyDexia became launcher-first
Severity: critical

Current SkyDexia shifted core work into shared bridge-backed routes and lane shell plumbing.

That produces useful live controls, but it weakens the product contract because the product no longer clearly owns:
- the autonomous pass loop
- the workspace snapshot model
- the save/apply continuity path
- the release continuity path

### Finding 3: self-contained export rule is not met strongly enough
Severity: critical

For a portable IDEia folder, the exported lane should still boot and remain meaningfully alive by itself.

Current SkyDexia depends too much on shared layer code and launcher bridge behavior to satisfy that rule as a clean product contract.

### Finding 4: connected-system and self-contained behavior were mixed together incorrectly
Severity: high

The SkyeCDE environment should absolutely connect the IDEias together.

That does not conflict with self-contained folders.

The correct interpretation is:
- when launched inside SkyeCDE, the IDEia should auto-attach to the shared system
- when exported alone, the IDEia should still boot and retain its core workspace and agent behavior

Connected by default is good.
Dependent for life is not.

### Finding 5: Theia shell capability was treated as sufficient by itself
Severity: high

A modified Theia launcher can host a Codespaces-class environment.

But that only becomes true when the product also owns:
- workspace provisioning
- runtime bootstrap
- save continuity
- environment state and recovery
- release continuity
- portable packaging behavior

The shell alone is not the replacement.
The shell plus the product-owned environment contract is the replacement.

## Audit matrix

| Capability | Original SkyDex | Current SkyDexia | SkyDexia 2.6 target |
| --- | --- | --- | --- |
| Product-first identity | strong | weak-to-medium | strong |
| Workspace ownership | strong | medium | strong |
| Autonomous pass loop ownership | strong | weak | strong |
| Auto-apply and save continuity | strong | medium | strong |
| Release actions on same saved state | strong | medium | strong |
| Self-contained exportability | medium-to-strong | weak | strong |
| Connected-system attachment | medium | medium | strong |
| Theia environment subsumed under product identity | n/a | weak | strong |
| Codespaces-class environment readiness | partial | partial | strong |

## What SkyDexia 2.6 must preserve from SkyDex

1. The workspace snapshot is the source of truth.
2. Autonomous execution is a first-class product feature.
3. Controlled mode and autonomous mode are both explicit and intentional.
4. Auto-save happens from the same workspace state the agent edited.
5. Release actions operate on that same state.
6. Boundaries remain explicit: auth, SKNore, pass caps, and operation budgets.

## What SkyDexia 2.6 must add beyond SkyDex

1. Theia-derived environment shell under SkyDexia product identity.
2. Stronger runtime and project boot orchestration.
3. Cleaner independent export contract.
4. Optional shared-system attach to SkyeCDE services.
5. Cleaner separation between core life support and external adapters.

## Reset directives

1. Rebuild from SkyDex product behavior, not from current SkyDexia shell behavior.
2. Treat shared launchers, bridges, GitHub, Netlify, and Cloudflare as adapters.
3. Keep independent boot viable from this folder alone.
4. Let SkyeCDE attachment happen automatically when the larger environment is present.
5. Do not let that attachment define whether SkyDexia 2.6 is alive.

## Final audit conclusion

The user’s intended architecture is coherent.

The current SkyDexia lane is not yet that architecture.

SkyDexia 2.6 should therefore be built as a product-first reset whose core can stand alone and whose connection to SkyeCDE enhances it instead of keeping it alive.
