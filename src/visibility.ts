import type { ClassifyVisibilityOptions, OcclusionContext, SectionEdge, SectionFace, SectionPoint, VisibilityFragment, VisibilityTolerances } from './types.js';

/**
 * Splits every candidate edge at projected face boundaries, then classifies the
 * resulting intervals by comparing their midpoint depth with every covering face.
 *
 * Splitting first matters: within one interval, the midpoint is either inside or
 * outside each face. Output order follows input edge order and increasing `t` on
 * each edge, which makes results deterministic for deterministic inputs.
 */
export function classifyVisibility<EdgeData, FaceData = EdgeData>(
  edges: readonly SectionEdge<EdgeData>[],
  faces: readonly SectionFace<FaceData>[],
  options: ClassifyVisibilityOptions<EdgeData, FaceData>
): VisibilityFragment<EdgeData>[] {
  const tolerances = validateTolerances(options.tolerances);
  faces.forEach((face) => assertFace(face));
  return edges.flatMap((edge) => {
    assertEdge(edge);
    // Include the original endpoints so an edge with no face intersections
    // still produces exactly one fragment.
    const parameters = uniqueSorted([0, 1, ...faces.flatMap((face) => faceIntersections(edge, face, tolerances))], tolerances.parameter);
    return parameters.slice(1).flatMap((end, index) => {
      const start = parameters[index];
      if (end - start <= tolerances.parameter) return [];
      const a = pointOnEdge(edge, start);
      const b = pointOnEdge(edge, end);
      // A midpoint is sufficient after boundary splitting. Depth varies linearly
      // on both the edge and a planar occluder face.
      const point = pointOnEdge(edge, (start + end) / 2);
      const hidden = faces.some((face) => occludes(edge, face, point, options.shouldOcclude, tolerances));
      return [{ edgeId: edge.id, ownerId: edge.ownerId, data: edge.data, a, b, t0: start, t1: end, visibility: hidden ? 'hidden' : 'visible' }];
    });
  });
}

/**
 * Removes hidden fragments completely covered by visible fragments at the same
 * drawing-plane location. Depth is deliberately ignored: the visible line is the
 * only one that should be drawn when two projected fragments coincide.
 */
export function suppressCoincidentHiddenFragments<T>(fragments: readonly VisibilityFragment<T>[], planarTolerance: number): VisibilityFragment<T>[] {
  if (!Number.isFinite(planarTolerance) || planarTolerance <= 0) throw new RangeError('planarTolerance must be a positive finite number.');
  return fragments.filter((fragment) => fragment.visibility !== 'hidden' || !fragments.some((visible) => visible.visibility === 'visible' && segmentContains(visible.a, visible.b, fragment.a, planarTolerance) && segmentContains(visible.a, visible.b, fragment.b, planarTolerance)));
}

function occludes<EdgeData, FaceData>(edge: SectionEdge<EdgeData>, face: SectionFace<FaceData>, point: SectionPoint, shouldOcclude: ClassifyVisibilityOptions<EdgeData, FaceData>['shouldOcclude'], tolerances: Required<VisibilityTolerances>): boolean {
  if (!pointInPolygon(point, face.vertices, tolerances.planar)) return false;
  const faceDepth = depthAt(point, face.vertices, tolerances.planar);
  // depthAxis points away from the viewer, so the face hides only points that
  // are farther away by more than the caller's depth tolerance.
  if (!Number.isFinite(faceDepth) || point.depth <= faceDepth + tolerances.depth) return false;
  const context: OcclusionContext<EdgeData, FaceData> = { edge, face, point, faceDepth, onFaceBoundary: onBoundary(point, face.vertices, tolerances.planar) };
  // Policy is consulted only after the face is known to geometrically occlude.
  return shouldOcclude?.(context) ?? true;
}

function faceIntersections(edge: SectionEdge<unknown>, face: SectionFace<unknown>, tolerances: Required<VisibilityTolerances>): number[] {
  return face.vertices.flatMap((vertex, index) => segmentIntersectionParameter(edge.a, edge.b, vertex, face.vertices[(index + 1) % face.vertices.length], tolerances.angular, tolerances.parameter) ?? []);
}

function depthAt(point: Pick<SectionPoint, 'u' | 'v'>, vertices: readonly SectionPoint[], planarTolerance: number): number {
  // Interpret a convex polygon as a triangle fan rooted at vertex 0. Callers
  // must pre-triangulate non-convex faces, as documented by SectionFace.
  for (let index = 1; index < vertices.length - 1; index += 1) {
    const value = barycentricDepth(point, vertices[0], vertices[index], vertices[index + 1], planarTolerance);
    if (Number.isFinite(value)) return value;
  }
  return Number.NaN;
}

function barycentricDepth(point: Pick<SectionPoint, 'u' | 'v'>, a: SectionPoint, b: SectionPoint, c: SectionPoint, planarTolerance: number): number {
  const denominator = cross(b.u - a.u, b.v - a.v, c.u - a.u, c.v - a.v);
  const scale = Math.max(distance2D(a, b), distance2D(b, c), distance2D(c, a));
  if (scale <= planarTolerance || Math.abs(denominator) <= planarTolerance * scale) return Number.NaN;
  // These are barycentric weights, not the section-space u/v coordinates.
  const weightB = cross(point.u - a.u, point.v - a.v, c.u - a.u, c.v - a.v) / denominator;
  const weightC = cross(b.u - a.u, b.v - a.v, point.u - a.u, point.v - a.v) / denominator;
  const weightA = 1 - weightB - weightC;
  const weightTolerance = planarTolerance / scale;
  return weightB < -weightTolerance || weightC < -weightTolerance || weightA < -weightTolerance
    ? Number.NaN
    : a.depth * weightA + b.depth * weightB + c.depth * weightC;
}

function pointOnEdge(edge: SectionEdge<unknown>, t: number): SectionPoint {
  return {
    u: edge.a.u + (edge.b.u - edge.a.u) * t,
    v: edge.a.v + (edge.b.v - edge.a.v) * t,
    depth: edge.a.depth + (edge.b.depth - edge.a.depth) * t
  };
}

function segmentContains(a: SectionPoint, b: SectionPoint, point: SectionPoint, tolerance: number): boolean {
  const collinear = pointLineDistance2D(point, a, b) <= tolerance;
  const betweenEndpoints = isWithinSegmentExtent(point, a, b, tolerance);
  return collinear && betweenEndpoints;
}

/** Ray-casting point-in-polygon test; points on the boundary count as inside. */
function pointInPolygon(point: Pick<SectionPoint, 'u' | 'v'>, vertices: readonly SectionPoint[], tolerance: number): boolean {
  let inside = false;
  for (let index = 0, previous = vertices.length - 1; index < vertices.length; previous = index, index += 1) {
    const a = vertices[index];
    const b = vertices[previous];
    if (onSegment(point, a, b, tolerance)) return true;
    const crossesRay = (a.v > point.v) !== (b.v > point.v)
      && point.u < ((b.u - a.u) * (point.v - a.v)) / ((b.v - a.v) || tolerance) + a.u;
    if (crossesRay) inside = !inside;
  }
  return inside;
}

function onBoundary(point: Pick<SectionPoint, 'u' | 'v'>, vertices: readonly SectionPoint[], tolerance: number): boolean {
  return vertices.some((vertex, index) => onSegment(point, vertex, vertices[(index + 1) % vertices.length], tolerance));
}

function onSegment(point: Pick<SectionPoint, 'u' | 'v'>, a: SectionPoint, b: SectionPoint, tolerance: number): boolean {
  const collinear = pointLineDistance2D(point, a, b) <= tolerance;
  const betweenEndpoints = isWithinSegmentExtent(point, a, b, tolerance);
  return collinear && betweenEndpoints;
}

/**
 * Returns the parameter on segment a-b where it crosses c-d.
 * Parallel and collinear segments return no split; coincident output fragments
 * are handled separately by suppressCoincidentHiddenFragments.
 */
function segmentIntersectionParameter(a: SectionPoint, b: SectionPoint, c: SectionPoint, d: SectionPoint, angularTolerance: number, parameterTolerance: number): number | undefined {
  const rU = b.u - a.u;
  const rV = b.v - a.v;
  const sU = d.u - c.u;
  const sV = d.v - c.v;
  const denominator = cross(rU, rV, sU, sV);
  const lengthProduct = Math.hypot(rU, rV) * Math.hypot(sU, sV);
  if (lengthProduct <= Number.EPSILON || Math.abs(denominator) <= lengthProduct * angularTolerance) return undefined;

  const qU = c.u - a.u;
  const qV = c.v - a.v;
  const t = cross(qU, qV, sU, sV) / denominator;
  const u = cross(qU, qV, rU, rV) / denominator;
  if (t < -parameterTolerance || t > 1 + parameterTolerance || u < -parameterTolerance || u > 1 + parameterTolerance) return undefined;
  return Math.max(0, Math.min(1, t));
}

function cross(aU: number, aV: number, bU: number, bV: number): number {
  return aU * bV - aV * bU;
}

/** Sorts split positions and collapses numerically equivalent intersections. */
function uniqueSorted(values: readonly number[], tolerance: number): number[] {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const result: number[] = [];
  for (const value of sorted) {
    if (!result.length || Math.abs(result[result.length - 1] - value) > tolerance) result.push(value);
  }
  return result;
}

function assertEdge(edge: SectionEdge<unknown>): void {
  if (!edge.id) throw new RangeError('Section edge id is required.');
  assertPoint(edge.a, 'Section edge start');
  assertPoint(edge.b, 'Section edge end');
}

function assertFace(face: SectionFace<unknown>): void {
  if (!face.id || face.vertices.length < 3) throw new RangeError('Section face id and at least three vertices are required.');
  face.vertices.forEach((point) => assertPoint(point, 'Section face vertex'));
}

function assertPoint(point: SectionPoint, name: string): void {
  if (![point.u, point.v, point.depth].every(Number.isFinite)) throw new RangeError(`${name} must contain finite coordinates.`);
}

function pointLineDistance2D(point: Pick<SectionPoint, 'u' | 'v'>, a: SectionPoint, b: SectionPoint): number {
  const length = distance2D(a, b);
  return length <= Number.EPSILON ? Math.hypot(point.u - a.u, point.v - a.v) : Math.abs(cross(point.u - a.u, point.v - a.v, b.u - a.u, b.v - a.v)) / length;
}

function distance2D(a: Pick<SectionPoint, 'u' | 'v'>, b: Pick<SectionPoint, 'u' | 'v'>): number {
  return Math.hypot(a.u - b.u, a.v - b.v);
}

/** Tests extent with a unitless segment parameter, derived from linear tolerance. */
function isWithinSegmentExtent(point: Pick<SectionPoint, 'u' | 'v'>, a: SectionPoint, b: SectionPoint, tolerance: number): boolean {
  const directionU = b.u - a.u;
  const directionV = b.v - a.v;
  const length = Math.hypot(directionU, directionV);
  if (length <= tolerance) return distance2D(point, a) <= tolerance;
  const parameter = ((point.u - a.u) * directionU + (point.v - a.v) * directionV) / (length * length);
  const parameterTolerance = tolerance / length;
  return parameter >= -parameterTolerance && parameter <= 1 + parameterTolerance;
}

function validateTolerances(input: VisibilityTolerances): Required<VisibilityTolerances> {
  // `parameter` operates on the normalized 0..1 edge interval and is therefore
  // unitless. Planar and depth tolerances remain in caller-owned model units.
  const parameter = input.parameter ?? 1e-9;
  const angular = input.angular ?? 1e-8;
  if (![input.planar, input.depth, angular, parameter].every((value) => Number.isFinite(value) && value > 0)) {
    throw new RangeError('Visibility tolerances must be positive finite numbers.');
  }
  return { planar: input.planar, depth: input.depth, angular, parameter };
}
