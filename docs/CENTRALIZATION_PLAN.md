# Rendering Centralization Plan

## Decision

Centralize reusable rendering mechanics, not complete product-specific section pipelines. This package remains the neutral boundary between source geometry and drawing/export primitives.

Applications own what belongs in a section, its semantics, clipping rules, annotations, sheet layout, and visual language. The shared package owns only deterministic transformations that remain useful without those decisions.

## Target Layers

1. **Core** — explicit section frames, mesh projection, mesh-to-mesh non-coplanar interface extraction, edge visibility, tolerances, and stable source metadata. This is the current public API.
2. **Three.js adapter** — a future `@antti/section-rendering/three` export that converts transformed indexed `BufferGeometry` into the core mesh input. `three` remains an optional peer dependency. It must not traverse scenes, load assets, or decide which objects belong in a section.
3. **DXF writer** — the next shared addition. It should expose a small document builder for units, layers, linetypes, lines, polylines, and text, then serialize valid ASCII DXF. Callers retain layer names, colours, entity selection, dimensions, hatches, and title content.
4. **Vector/SVG adapter** — defer until two callers can share a framework-neutral vector document. A future adapter may serialize lines, polylines, polygons, groups, and text to SVG, but must not own a UI framework, page layout, labels, symbols, or drawing style policy.

## Delivery Order

1. Keep extending the core only when a second caller needs the same geometry operation.
2. Extract and test the DXF writer against a neutral primitive document; migrate each caller through a local mapping adapter and preserve its output snapshots.
3. Add the optional Three.js adapter when both callers have a direct transformed-`BufferGeometry` conversion need.
4. Consider a vector document and SVG serializer only after both rendering paths demonstrate matching primitive and viewport requirements.

## Boundaries And Verification

- Do not add a single `renderSection(scene)` API: it would mix domain selection, cut generation, annotation, styling, and export policy.
- Keep semantic clipping such as terrain, envelopes, openings, construction layers, and visibility policy in the caller unless it is demonstrably domain-neutral.
- Treat SVG and DXF as independent render targets of the same caller-owned render model; the package may share their primitive writers, not their product-specific content.
- For every extraction, add core unit tests plus caller-level golden SVG/DXF snapshots and verify that only plumbing—not output intent—moves into the package.
