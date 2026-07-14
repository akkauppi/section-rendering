# Architecture

`@antti/section-rendering` is a domain-neutral geometry package. It projects finite mesh geometry into an explicit section frame, splits candidate lines against projected faces, and labels each fragment visible or hidden.

It can also extract non-coplanar interface segments between two separate convex, planar polygon meshes. These world-space segments can be projected and passed through the same visibility classifier as ordinary mesh edges. Coplanar overlap remains an area-level concern: only positive-area overlap is reported through intersection diagnostics, never converted to arbitrary linework. Non-planar and concave faces are rejected before fan triangulation so extraction cannot silently reinterpret their surface.

The package does not own model semantics, cut-solid generation, terrain masking, annotations, drawing sheets, SVG layout, DXF layers, or Three.js objects. Consumers map their data to the neutral types and decide how to render returned fragments.

Depth is relative to the section frame: smaller values are nearer to the viewer. Every visibility call requires planar and depth tolerances in the consumer's own unit system, so millimetre and metre models remain independent. Linear tolerances are always lengths; angular tolerances compare normalized directions; edge-parameter tolerances are unitless. This separation avoids numerical behaviour changing merely because the caller changes model scale.

Visibility first rejects face/edge pairs whose projected, tolerance-expanded bounding boxes cannot meet. All retained candidates use the same exact boundary, polygon, and depth predicates as the unfiltered path, so this broad phase does not change fragment output.

Interface candidate discovery uses an x-axis active-set sweep with y/z AABB rejection. Narrow-phase output is canonicalized and merged only when collinear segments touch within tolerance. Result IDs are derived from canonical source and endpoint data rather than iteration position.

The v0.1 API intentionally replaces the prototype `x`/`z` API. No compatibility aliases are provided. Three.js, SVG, and DXF adapters are deferred until a consumer has a direct reusable adapter need.

The proposed adapter boundaries and extraction order are recorded in [Rendering Centralization Plan](./CENTRALIZATION_PLAN.md).
