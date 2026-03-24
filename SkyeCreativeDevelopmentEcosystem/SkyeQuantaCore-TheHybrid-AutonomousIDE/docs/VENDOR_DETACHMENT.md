# Vendor Detachment Status

## What Is Done

- Imported the current OpenHands source into `platform/agent-core`
- Imported the current Theia source into `platform/ide-core`
- Established this directory as the new platform root
- Added Skyes Over London product identity at the root
- Added a product-owned shell launcher under `apps/skyequanta-shell`
- Moved bootstrap, doctor, and start entry points to the new root

## What This Achieves

The new project no longer depends on `/workspaces/SkyeHands/SkyeVendors` as the only place where source code lives. The imported copies here are now the working baseline for future changes.

## What Still Blocks Deleting `SkyeVendors`

1. Full build validation has not yet been completed from this new root.
2. Visible upstream naming still exists inside imported code and documentation.
3. Integration glue between the IDE layer and agent layer still needs to be implemented in `apps/skyequanta-shell`.
4. Deprecated OpenHands V0 surfaces still exist inside imported code and must stay internal or be removed from product-owned entry points.
5. Any hardcoded paths in local scripts still need to be updated to point at this new root.

## Recommended Sequence

1. Validate standalone builds from `platform/ide-core` and `platform/agent-core` through `npm run bootstrap`, `npm run doctor`, and `npm run start`.
2. Keep the root contract on the V1 backend path and avoid deprecated OpenHands V0 launch flows.
3. Rebrand visible product surfaces and environment names.
4. Implement the first IDE-to-agent bridge in the shell.
5. Remove the vendor folder only after the new root is the only execution path in use.