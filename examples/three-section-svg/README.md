# Three.js section SVG example

This is a self-contained, Node-runnable example of one transformed Three.js mesh at a time becoming neutral `MeshInput`, then orthographic linework and SVG. It also makes a source-scene SVG through a Three.js `PerspectiveCamera`, so the geometry is understandable before reading the section result.

It deliberately declares the wall/slab interface instead of intersecting every mesh pair. Two foreground screens demonstrate hidden fragments: the long narrow front screen occludes the other screen as well as the wall, slab, and rail. The resulting section image is projection-style linework, not a solid-cut operation.

From a source checkout, run `npm run render:three-section-demo` at the repository root to refresh `fixtures/three-scene.svg` and `fixtures/three-section.svg`. This example is not included in the npm package.
