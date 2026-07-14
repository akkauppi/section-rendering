import { describe, expect, it } from 'vitest';
import { classifyVisibility, createSectionFrame, intersectMeshes, projectMesh, projectPoint, projectWorldEdges, suppressCoincidentHiddenFragments } from '../src/index.js';

const tolerances = { planar: 1e-6, depth: 0.05 };

describe('section frames', () => {
  it('projects through an arbitrary orthogonal frame', () => {
    const frame = createSectionFrame({ origin: { x: 10, y: 20, z: 30 }, uAxis: { x: 0, y: 1, z: 0 }, vAxis: { x: 0, y: 0, z: 1 }, depthAxis: { x: 1, y: 0, z: 0 } });
    expect(projectPoint({ x: 13, y: 22, z: 34 }, frame)).toEqual({ u: 2, v: 4, depth: 3 });
  });

  it('rejects a non-orthogonal frame', () => {
    expect(() => createSectionFrame({ origin: { x: 0, y: 0, z: 0 }, uAxis: { x: 1, y: 0, z: 0 }, vAxis: { x: 1, y: 1, z: 0 }, depthAxis: { x: 0, y: 0, z: 1 } })).toThrow(/perpendicular/);
  });
});

describe('mesh projection', () => {
  it('deduplicates shared polygon boundaries without adding diagonals', () => {
    const frame = createSectionFrame({ origin: { x: 0, y: 0, z: 0 }, uAxis: { x: 1, y: 0, z: 0 }, vAxis: { x: 0, y: 1, z: 0 }, depthAxis: { x: 0, y: 0, z: 1 } });
    const mesh = projectMesh({ id: 'quad', vertices: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }], faces: [[0, 1, 2, 3]] }, frame);
    expect(mesh.edges.map((edge) => edge.id)).toEqual(['quad:edge:0:1', 'quad:edge:1:2', 'quad:edge:2:3', 'quad:edge:0:3']);
  });
});

describe('visibility classification', () => {
  const face = { id: 'near-face', ownerId: 'near', vertices: [{ u: 2, v: 0, depth: 1 }, { u: 8, v: 0, depth: 1 }, { u: 8, v: 10, depth: 1 }, { u: 2, v: 10, depth: 1 }] };

  it('splits a partially occluded edge into visible and hidden fragments', () => {
    const fragments = classifyVisibility([{ id: 'far-edge', ownerId: 'far', a: { u: 0, v: 5, depth: 2 }, b: { u: 10, v: 5, depth: 2 } }], [face], { tolerances });
    expect(fragments.map((fragment) => fragment.visibility)).toEqual(['visible', 'hidden', 'visible']);
    expect(fragments[1]).toMatchObject({ a: { u: 2, v: 5 }, b: { u: 8, v: 5 }, t0: 0.2, t1: 0.8 });
  });

  it('ignores non-overlapping faces without changing exact visibility', () => {
    const farFaces = Array.from({ length: 40 }, (_, index) => ({
      id: `far-${index}`,
      vertices: [{ u: 1000 + index * 20, v: 0, depth: 1 }, { u: 1010 + index * 20, v: 0, depth: 1 }, { u: 1010 + index * 20, v: 10, depth: 1 }, { u: 1000 + index * 20, v: 10, depth: 1 }]
    }));
    const fragments = classifyVisibility([{ id: 'far-edge', a: { u: 0, v: 5, depth: 2 }, b: { u: 10, v: 5, depth: 2 } }], [face, ...farFaces], { tolerances });
    expect(fragments.map((fragment) => ({ visibility: fragment.visibility, a: fragment.a.u, b: fragment.b.u }))).toEqual([
      { visibility: 'visible', a: 0, b: 2 },
      { visibility: 'hidden', a: 2, b: 8 },
      { visibility: 'visible', a: 8, b: 10 }
    ]);
  });

  it('keeps a coplanar boundary edge visible and supports caller occlusion policy', () => {
    const edge = { id: 'same-owner', ownerId: 'near', a: { u: 2, v: 0, depth: 1.01 }, b: { u: 8, v: 0, depth: 1.01 } };
    expect(classifyVisibility([edge], [face], { tolerances }).every((fragment) => fragment.visibility === 'visible')).toBe(true);
    const hidden = classifyVisibility([{ ...edge, a: { ...edge.a, depth: 2 }, b: { ...edge.b, depth: 2 } }], [face], { tolerances, shouldOcclude: () => false });
    expect(hidden.every((fragment) => fragment.visibility === 'visible')).toBe(true);
  });

  it('keeps visibility classification invariant when coordinates and linear tolerances scale together', () => {
    const run = (factor: number) => classifyVisibility(
      [{ id: 'far', a: { u: 0, v: 5 * factor, depth: 2 * factor }, b: { u: 10 * factor, v: 5 * factor, depth: 2 * factor } }],
      [{ id: 'near', vertices: [{ u: 2 * factor, v: 0, depth: factor }, { u: 8 * factor, v: 0, depth: factor }, { u: 8 * factor, v: 10 * factor, depth: factor }, { u: 2 * factor, v: 10 * factor, depth: factor }] }],
      { tolerances: { planar: 1e-6 * factor, depth: 0.05 * factor } }
    ).map((fragment) => fragment.visibility);
    expect(run(0.001)).toEqual(['visible', 'hidden', 'visible']);
    expect(run(1_000_000)).toEqual(['visible', 'hidden', 'visible']);
  });

  it('suppresses hidden fragments covered by a visible fragment', () => {
    const fragments = suppressCoincidentHiddenFragments([
      { edgeId: 'near', a: { u: 0, v: 0, depth: 1 }, b: { u: 10, v: 0, depth: 1 }, t0: 0, t1: 1, visibility: 'visible' as const },
      { edgeId: 'far', a: { u: 0, v: 0, depth: 2 }, b: { u: 10, v: 0, depth: 2 }, t0: 0, t1: 1, visibility: 'hidden' as const }
    ], tolerances.planar);
    expect(fragments.map((fragment) => fragment.edgeId)).toEqual(['near']);
  });

  it('uses linear tolerance consistently near long segment endpoints', () => {
    const fragments = suppressCoincidentHiddenFragments([
      { edgeId: 'near', a: { u: 0, v: 0, depth: 1 }, b: { u: 10, v: 0, depth: 1 }, t0: 0, t1: 1, visibility: 'visible' as const },
      { edgeId: 'far', a: { u: 0, v: 0, depth: 2 }, b: { u: 10.0005, v: 0, depth: 2 }, t0: 0, t1: 1, visibility: 'hidden' as const }
    ], 0.001);
    expect(fragments.map((fragment) => fragment.edgeId)).toEqual(['near']);
  });

  it('does not suppress a hidden fragment when a visible bounding box only overlaps it', () => {
    const fragments = suppressCoincidentHiddenFragments([
      { edgeId: 'near-diagonal', a: { u: 0, v: 0, depth: 1 }, b: { u: 10, v: 10, depth: 1 }, t0: 0, t1: 1, visibility: 'visible' as const },
      { edgeId: 'far-horizontal', a: { u: 2, v: 5, depth: 2 }, b: { u: 8, v: 5, depth: 2 }, t0: 0, t1: 1, visibility: 'hidden' as const }
    ], tolerances.planar);
    expect(fragments.map((fragment) => fragment.edgeId)).toEqual(['near-diagonal', 'far-horizontal']);
  });
});

describe('surface intersections', () => {
  const options = { distanceTolerance: 1e-6 };
  const horizontal = {
    id: 'horizontal',
    ownerId: 'floor',
    vertices: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 0, y: 4, z: 0 }],
    faces: [[0, 1, 2]]
  };

  it('extracts the world-space line where two non-coplanar triangles cross', () => {
    const vertical = {
      id: 'vertical',
      ownerId: 'wall',
      vertices: [{ x: 1, y: -1, z: -1 }, { x: 1, y: 5, z: -1 }, { x: 1, y: 0, z: 1 }],
      faces: [[0, 1, 2]]
    };
    const result = intersectMeshes(horizontal, vertical, options);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]).toMatchObject({
      ownerId: 'floor|wall',
      a: { x: 1, y: 0, z: 0 },
      b: { x: 1, y: 2.5, z: 0 },
      data: { contributingFacePairs: [[0, 0]] }
    });
  });

  it('retains a shared boundary between differently oriented surfaces', () => {
    const wall = {
      id: 'wall',
      vertices: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 0, y: 0, z: 2 }],
      faces: [[0, 1, 2]]
    };
    const floor = {
      id: 'floor',
      vertices: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 0, y: 2, z: 0 }],
      faces: [[0, 1, 2]]
    };
    expect(intersectMeshes(floor, wall, options).segments[0]).toMatchObject({ a: { x: 0, y: 0, z: 0 }, b: { x: 2, y: 0, z: 0 } });
  });

  it('reports point contact and coplanar overlap without inventing linework', () => {
    const pointContact = {
      id: 'point-contact',
      vertices: [{ x: 0, y: 0, z: -1 }, { x: 0, y: -2, z: 1 }, { x: 0, y: 0, z: 1 }],
      faces: [[0, 1, 2]]
    };
    const pointResult = intersectMeshes(horizontal, pointContact, options);
    expect(pointResult.segments).toHaveLength(0);
    expect(pointResult.diagnostics.pointContactCount).toBe(1);

    const coplanar = { ...horizontal, id: 'coplanar' };
    const coplanarResult = intersectMeshes(horizontal, coplanar, options);
    expect(coplanarResult.segments).toHaveLength(0);
    expect(coplanarResult.diagnostics.coplanarPairCount).toBe(1);
  });

  it('does not report coplanar triangles that only share a boundary', () => {
    const adjacent = {
      id: 'adjacent',
      vertices: [{ x: 4, y: 0, z: 0 }, { x: 0, y: 4, z: 0 }, { x: 4, y: 4, z: 0 }],
      faces: [[0, 1, 2]]
    };
    const result = intersectMeshes(horizontal, adjacent, options);
    expect(result.diagnostics.candidatePairCount).toBe(1);
    expect(result.diagnostics.coplanarPairCount).toBe(0);
  });

  it('is independent of source-face winding and gives stable interface IDs', () => {
    const vertical = {
      id: 'vertical-stable',
      vertices: [{ x: 1, y: -1, z: -1 }, { x: 1, y: 5, z: -1 }, { x: 1, y: 0, z: 1 }],
      faces: [[0, 1, 2]]
    };
    const reversed = { ...vertical, id: 'vertical-reversed', faces: [[2, 1, 0]] };
    const first = intersectMeshes(horizontal, vertical, options).segments[0];
    const second = intersectMeshes(horizontal, vertical, options).segments[0];
    expect(intersectMeshes(horizontal, reversed, options).segments[0]).toMatchObject({ a: first.a, b: first.b });
    expect(second.id).toBe(first.id);
  });

  it('rejects non-planar and concave polygon faces before extraction', () => {
    const nonPlanar = {
      id: 'non-planar',
      vertices: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 2, z: 0.1 }, { x: 0, y: 2, z: 0 }],
      faces: [[0, 1, 2, 3]]
    };
    const concave = {
      id: 'concave',
      vertices: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 2, y: 2, z: 0 }, { x: 0, y: 2, z: 0 }],
      faces: [[0, 1, 2, 3, 4]]
    };
    expect(() => intersectMeshes(nonPlanar, horizontal, options)).toThrow(/planar/);
    expect(() => intersectMeshes(concave, horizontal, options)).toThrow(/convex/);
  });

  it('merges interface pieces created by convex polygon triangulation', () => {
    const floor = {
      id: 'floor-quad',
      vertices: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 2, z: 0 }, { x: 0, y: 2, z: 0 }],
      faces: [[0, 1, 2, 3]]
    };
    const wall = {
      id: 'wall-quad',
      vertices: [{ x: 1, y: -1, z: -1 }, { x: 1, y: 3, z: -1 }, { x: 1, y: 3, z: 1 }, { x: 1, y: -1, z: 1 }],
      faces: [[0, 1, 2, 3]]
    };
    const result = intersectMeshes(floor, wall, options);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]).toMatchObject({ a: { x: 1, y: 0, z: 0 }, b: { x: 1, y: 2, z: 0 } });
  });

  it('skips degenerate triangles and projects extracted edges for visibility', () => {
    const degenerate = {
      id: 'degenerate',
      vertices: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }],
      faces: [[0, 1, 2]]
    };
    expect(intersectMeshes(degenerate, horizontal, options).diagnostics.degenerateTriangleCount).toBe(1);

    const vertical = {
      id: 'projected-wall',
      vertices: [{ x: 1, y: -1, z: -1 }, { x: 1, y: 5, z: -1 }, { x: 1, y: 0, z: 1 }],
      faces: [[0, 1, 2]]
    };
    const edges = projectWorldEdges(intersectMeshes(horizontal, vertical, options).segments, createSectionFrame({
      origin: { x: 0, y: 0, z: 0 },
      uAxis: { x: 1, y: 0, z: 0 },
      vAxis: { x: 0, y: 1, z: 0 },
      depthAxis: { x: 0, y: 0, z: 1 }
    }));
    expect(edges[0]).toMatchObject({ a: { u: 1, v: 0, depth: 0 }, b: { u: 1, v: 2.5, depth: 0 } });
  });

  it('uses broad-phase bounds to avoid unrelated triangle pairs', () => {
    const left = {
      id: 'left-grid',
      vertices: [
        { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 },
        { x: 10, y: 0, z: 0 }, { x: 11, y: 0, z: 0 }, { x: 10, y: 1, z: 0 },
        { x: 20, y: 0, z: 0 }, { x: 21, y: 0, z: 0 }, { x: 20, y: 1, z: 0 }
      ],
      faces: [[0, 1, 2], [3, 4, 5], [6, 7, 8]]
    };
    const right = {
      id: 'right-grid',
      vertices: [
        { x: 0.25, y: -1, z: -1 }, { x: 0.25, y: 2, z: -1 }, { x: 0.25, y: 0, z: 1 },
        { x: 10.25, y: -1, z: -1 }, { x: 10.25, y: 2, z: -1 }, { x: 10.25, y: 0, z: 1 },
        { x: 20.25, y: -1, z: -1 }, { x: 20.25, y: 2, z: -1 }, { x: 20.25, y: 0, z: 1 }
      ],
      faces: [[0, 1, 2], [3, 4, 5], [6, 7, 8]]
    };
    const result = intersectMeshes(left, right, options);
    expect(result.diagnostics.candidatePairCount).toBe(3);
    expect(result.diagnostics.candidatePairCount).toBeLessThan(9);
  });
});
