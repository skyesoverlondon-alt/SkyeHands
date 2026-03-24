# SkyDexia 2.6 Self-Contained Contract

## Purpose

This contract defines what it means for SkyDexia 2.6 to be self-contained while still belonging to the connected SkyeCDE environment.

## Core clarification

These two things are not opposites:
- self-contained IDEia folders
- connected SkyeCDE environment

They should coexist.

The correct rule is:
- an IDEia must boot independently from its own folder
- when launched inside SkyeCDE, it should automatically attach to the shared environment

## Contract 1: independent boot

A zipped or exported SkyDexia 2.6 folder must still be able to:
- open its own shell
- load its own workspace snapshot model
- present its own autonomous and controlled modes
- save its own project state
- stage or record release actions even if external services are unavailable

If any of those require sibling folders in order to exist, the contract is broken.

## Contract 2: product ownership

The visible product must be SkyDexia, not Theia.

That means:
- product language is SkyDexia language
- menus, dock, workflow, and operator concepts come from the product contract
- Theia-derived capabilities are subsumed under the product and not exposed as stock host identity

## Contract 3: autonomous core ownership

SkyDexia 2.6 must itself own:
- workspace snapshot state
- active-file and workspace intelligence state
- autonomous pass settings
- controlled-versus-autonomous mode switching
- operation staging
- apply and save flow
- operator memory and local directives

These may use host services, but the product must own the contract.

## Contract 4: shared environment shell

The modified Theia launcher should serve as the environment shell for SkyDexia 2.6.

That shell may provide:
- editor and workspace UI primitives
- terminal and task surfaces
- process and runtime hosting
- extension hooks
- environment bootstrap helpers

But the shell should not decide whether the product is alive.

## Contract 5: connected SkyeCDE attach

When SkyDexia 2.6 runs inside SkyeCDE, it should automatically attach to shared environment services such as:
- launcher and runtime helpers
- catalog and app-discovery services
- cross-IDEia launch routing
- shared sovereign and gate surfaces
- shared delivery and deployment adapters

That attachment is the default behavior in the full environment.

But it is still attachment, not life support.

## Contract 6: service degradation

If GitHub, Netlify, Cloudflare, shared launcher services, or other system adapters are unavailable, SkyDexia 2.6 must degrade like this:
- workspace and autonomous core stay alive
- save and state continuity stay alive
- pending release actions become deferred, queued, or locally recorded
- operator can still inspect and continue local work

The product should lose external reach, not internal life.

## Contract 7: packaging

Every IDEia folder should contain everything required for its own identity and core boot path:
- product shell entry
- product-owned styling
- product-owned state model
- product-owned autonomy contract
- product-owned docs and runbooks
- optional adapters for connected-system attach

This is what makes portable export meaningful.

## Contract 8: Codespaces-class threshold

SkyDexia 2.6 becomes a Codespaces-class replacement only when it can do all of the following as one product:
- boot the environment shell
- provision or restore a working project state
- run autonomous workspace work
- start and inspect runtimes
- keep persistent save continuity
- expose ports or runtime URLs
- recover from failure or restart
- ship from the same coherent workspace state

The modified Theia launcher helps host this, but the product must own the full contract.

## Contract 9: relationship to SkyDex

SkyDexia 2.6 is not a separate product identity invented from scratch.

It is:
- original SkyDex product behavior
- upgraded to inhabit a Theia-derived environment shell
- made portable and independently bootable
- made attachable to the full SkyeCDE environment by default

## Operational test

SkyDexia 2.6 passes this contract only if all of these statements are true:
- this folder boots by itself
- the core workspace and agent functions remain alive without sibling folders
- running inside SkyeCDE automatically enhances the product
- removing the shared system does not kill the core product
- release adapters act on the same saved workspace state as the autonomous core

If those are all true, the architecture is correct.
