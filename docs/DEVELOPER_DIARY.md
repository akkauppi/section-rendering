# Developer Diary

## 2026-07-13: First reusable visibility core

- Replaced the local axis-specific prototype with a buildable, declaration-emitting ESM package.
- Made the drawing frame, section-space coordinates, units, and tolerances explicit.
- Kept visibility independent of each application's semantic clipping and rendering choices.
- Migrated two distinct section-rendering pipelines to the same core contract.
- Recorded the follow-on centralization boundary: shared geometry and primitive writers, with drawing semantics and presentation retained by callers.
- Added mesh-to-mesh interface extraction for non-coplanar surfaces, including diagnostics for degenerate, point-contact, and coplanar cases.

## 2026-07-13: Numerical and input-contract hardening

- Separated linear, angular, and normalized edge-parameter tolerances; added scale-regression coverage for hidden-line classification.
- Made interface extraction validate convex, planar source faces and treat fully degenerate faces as diagnostics.
- Replaced the one-sided candidate scan with an active-set broad-phase sweep.
- Tightened coplanar diagnostics to positive-area overlap only, avoiding false reports for triangles that merely touch.
- Made interface IDs independent of output-array order and documented the numerical contract for consumers.

## 2026-07-14: Three.js-to-SVG integration example

- Added a Node-runnable abstract wall/slab/screen example that turns transformed Three.js triangles into core mesh input, plus an oblique source-scene preview and deterministic README SVGs.
- Kept the Three.js conversion, mesh-feature selection, explicit interface relation, and SVG styling outside the public package API.
- Added adapter-transform and fixture tests, plus CI checks that prevent the generated SVG from becoming stale.

## 2026-07-15: Git-consumable package build

- Added a `prepare` lifecycle that compiles `dist` when the package is installed from an immutable Git commit.
- Kept npm publication disabled; the initial consumers can pin reviewed Git commits while the pre-1.0 API continues to evolve.
- Revalidated typechecking and the test suite before updating the EspooGML consumer.
