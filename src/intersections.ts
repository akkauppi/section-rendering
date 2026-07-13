import { projectPoint } from './frame.js';
import type { IntersectionSource, MeshInput, MeshIntersectionDiagnostics, MeshIntersectionOptions, MeshIntersectionResult, SectionEdge, SectionFrame, SurfaceIntersectionData, Vec3, WorldEdge } from './types.js';

type ValidatedOptions = Required<MeshIntersectionOptions>;

type Bounds = { min: Vec3; max: Vec3 };
type Vec2 = { x: number; y: number };

type Triangle<T> = {
  meshId: string;
  ownerId?: string;
  data?: T;
  faceIndex: number;
  triangleIndex: number;
  a: Vec3;
  b: Vec3;
  c: Vec3;
  normal: Vec3;
  bounds: Bounds;
};

type RawSegment<LeftData, RightData> = {
  a: Vec3;
  b: Vec3;
  left: Triangle<LeftData>;
  right: Triangle<RightData>;
};

type MergedSegment<LeftData, RightData> = {
  a: Vec3;
  b: Vec3;
  left: IntersectionSource<LeftData>;
  right: IntersectionSource<RightData>;
  contributingFacePairs: Array<[number, number]>;
};

type SweepEvent<T> = {
  coordinate: number;
  kind: 'start' | 'end';
  side: 'left' | 'right';
  triangle: Triangle<T>;
};

/**
 * Extracts visible-candidate interface segments where two separate meshes cross.
 *
 * This function does not perform a boolean operation or alter either mesh. It
 * finds only non-coplanar line intersections; a coplanar overlap is an area and
 * is recorded in diagnostics instead of being reduced to an arbitrary boundary.
 */
export function intersectMeshes<LeftData, RightData>(
  left: MeshInput<LeftData>,
  right: MeshInput<RightData>,
  options: MeshIntersectionOptions
): MeshIntersectionResult<LeftData, RightData> {
  if (!left.id || !right.id) throw new RangeError('Both meshes must have an id.');
  if (left.id === right.id) throw new RangeError('intersectMeshes requires two distinct mesh ids; self-intersection is not supported.');

  const settings = validateOptions(options);
  const diagnostics: MeshIntersectionDiagnostics = {
    triangleCount: 0,
    candidatePairCount: 0,
    testedPairCount: 0,
    degenerateTriangleCount: 0,
    coplanarPairCount: 0,
    pointContactCount: 0
  };
  const leftTriangles = triangulateMesh(left, settings, diagnostics);
  const rightTriangles = triangulateMesh(right, settings, diagnostics);
  diagnostics.triangleCount = leftTriangles.length + rightTriangles.length;

  const raw: RawSegment<LeftData, RightData>[] = [];
  for (const [leftTriangle, rightTriangle] of sweepCandidates(leftTriangles, rightTriangles, settings.distanceTolerance)) {
    diagnostics.candidatePairCount += 1;
    diagnostics.testedPairCount += 1;
    const result = intersectTriangles(leftTriangle, rightTriangle, settings);
    if (result.kind === 'coplanar') {
      diagnostics.coplanarPairCount += 1;
    } else if (result.kind === 'point') {
      diagnostics.pointContactCount += 1;
    } else if (result.kind === 'segment') {
      raw.push({ a: result.a, b: result.b, left: leftTriangle, right: rightTriangle });
    }
  }

  const merged = mergeSegments(raw, settings);
  return {
    segments: merged.map((segment) => ({
      id: interfaceId(segment, settings.distanceTolerance),
      ownerId: combinedOwnerId(segment.left.ownerId, segment.right.ownerId),
      data: {
        left: segment.left,
        right: segment.right,
        contributingFacePairs: segment.contributingFacePairs
      },
      a: segment.a,
      b: segment.b
    })),
    diagnostics
  };
}

/** Projects world-space interface segments so they can join ordinary SectionEdge candidates. */
export function projectWorldEdges<T>(edges: readonly WorldEdge<T>[], frame: SectionFrame): SectionEdge<T>[] {
  return edges.map((edge) => {
    if (!edge.id) throw new RangeError('World edge id is required.');
    return { id: edge.id, ownerId: edge.ownerId, data: edge.data, a: projectPoint(edge.a, frame), b: projectPoint(edge.b, frame) };
  });
}

function triangulateMesh<T>(mesh: MeshInput<T>, options: ValidatedOptions, diagnostics: MeshIntersectionDiagnostics): Triangle<T>[] {
  const vertices = mesh.vertices.map((vertex, index) => {
    assertFiniteVec3(vertex, `Mesh ${mesh.id} vertex ${index}`);
    return vertex;
  });
  const triangles: Triangle<T>[] = [];
  mesh.faces.forEach((face, faceIndex) => {
    if (face.length < 3) throw new RangeError(`Mesh ${mesh.id} face ${faceIndex} must contain at least three vertices.`);
    const indices = face.map((vertexIndex) => {
      if (!Number.isInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= vertices.length) throw new RangeError(`Mesh ${mesh.id} face ${faceIndex} contains an invalid vertex index.`);
      return vertexIndex;
    });
    validateFace(mesh.id, faceIndex, indices, vertices, options);
    // MeshInput permits convex polygons. A fan preserves their boundary while
    // giving the narrow phase a simple, well-defined triangle primitive.
    for (let index = 1; index < indices.length - 1; index += 1) {
      const a = vertices[indices[0]];
      const b = vertices[indices[index]];
      const c = vertices[indices[index + 1]];
      const rawNormal = cross(subtract(b, a), subtract(c, a));
      const normalLength = length(rawNormal);
      if (normalLength <= options.distanceTolerance * triangleScale(a, b, c)) {
        diagnostics.degenerateTriangleCount += 1;
        continue;
      }
      triangles.push({
        meshId: mesh.id,
        ownerId: mesh.ownerId,
        data: mesh.data,
        faceIndex,
        triangleIndex: index - 1,
        a,
        b,
        c,
        normal: scale(rawNormal, 1 / normalLength),
        bounds: boundsOf([a, b, c])
      });
    }
  });
  return triangles;
}

/** Rejects faces whose fan triangulation would change their intended surface. */
function validateFace(meshId: string, faceIndex: number, indices: readonly number[], vertices: readonly Vec3[], options: ValidatedOptions): void {
  let plane: { point: Vec3; normal: Vec3 } | undefined;
  for (let index = 1; index < indices.length - 1; index += 1) {
    const a = vertices[indices[0]];
    const b = vertices[indices[index]];
    const c = vertices[indices[index + 1]];
    const rawNormal = cross(subtract(b, a), subtract(c, a));
    const normalLength = length(rawNormal);
    if (normalLength > options.distanceTolerance * triangleScale(a, b, c)) {
      plane = { point: a, normal: scale(rawNormal, 1 / normalLength) };
      break;
    }
  }
  // Fully degenerate faces are retained as diagnostics during triangulation.
  if (!plane) return;

  for (const index of indices) {
    if (Math.abs(signedDistance(vertices[index], plane.point, plane.normal)) > options.distanceTolerance) {
      throw new RangeError(`Mesh ${meshId} face ${faceIndex} must be planar for interface extraction.`);
    }
  }
  for (let index = 0; index < indices.length; index += 1) {
    const previous = vertices[indices[(index + indices.length - 1) % indices.length]];
    const current = vertices[indices[index]];
    const next = vertices[indices[(index + 1) % indices.length]];
    const edgeLength = distance(previous, current);
    if (edgeLength <= options.distanceTolerance) throw new RangeError(`Mesh ${meshId} face ${faceIndex} contains a repeated adjacent vertex.`);
    const turnDistance = dot(cross(subtract(current, previous), subtract(next, current)), plane.normal) / edgeLength;
    if (turnDistance < -options.distanceTolerance) throw new RangeError(`Mesh ${meshId} face ${faceIndex} must be convex for interface extraction.`);
  }
}

/** Emits each left/right AABB candidate once using a genuine x-axis active set. */
function sweepCandidates<LeftData, RightData>(left: readonly Triangle<LeftData>[], right: readonly Triangle<RightData>[], tolerance: number): Array<[Triangle<LeftData>, Triangle<RightData>]> {
  const events: Array<SweepEvent<LeftData | RightData>> = [
    ...left.flatMap((triangle) => [
      { coordinate: triangle.bounds.min.x - tolerance, kind: 'start' as const, side: 'left' as const, triangle },
      { coordinate: triangle.bounds.max.x + tolerance, kind: 'end' as const, side: 'left' as const, triangle }
    ]),
    ...right.flatMap((triangle) => [
      { coordinate: triangle.bounds.min.x - tolerance, kind: 'start' as const, side: 'right' as const, triangle },
      { coordinate: triangle.bounds.max.x + tolerance, kind: 'end' as const, side: 'right' as const, triangle }
    ])
  ];
  events.sort((a, b) => a.coordinate - b.coordinate || (a.kind === b.kind ? 0 : a.kind === 'start' ? -1 : 1) || a.side.localeCompare(b.side));
  const activeLeft = new Set<Triangle<LeftData>>();
  const activeRight = new Set<Triangle<RightData>>();
  const candidates: Array<[Triangle<LeftData>, Triangle<RightData>]> = [];
  for (const event of events) {
    if (event.side === 'left') {
      const triangle = event.triangle as Triangle<LeftData>;
      if (event.kind === 'end') activeLeft.delete(triangle);
      else {
        for (const other of activeRight) if (boundsOverlap(triangle.bounds, other.bounds, tolerance)) candidates.push([triangle, other]);
        activeLeft.add(triangle);
      }
    } else {
      const triangle = event.triangle as Triangle<RightData>;
      if (event.kind === 'end') activeRight.delete(triangle);
      else {
        for (const other of activeLeft) if (boundsOverlap(other.bounds, triangle.bounds, tolerance)) candidates.push([other, triangle]);
        activeRight.add(triangle);
      }
    }
  }
  return candidates;
}

function intersectTriangles<LeftData, RightData>(left: Triangle<LeftData>, right: Triangle<RightData>, options: ValidatedOptions): { kind: 'none' | 'coplanar' | 'point' } | { kind: 'segment'; a: Vec3; b: Vec3 } {
  const normalsParallel = length(cross(left.normal, right.normal)) <= options.angularTolerance;
  const planeOffset = Math.abs(signedDistance(left.a, right.a, right.normal));
  if (normalsParallel) {
    return planeOffset <= options.distanceTolerance && coplanarTrianglesOverlap(left, right, options.distanceTolerance)
      ? { kind: 'coplanar' }
      : { kind: 'none' };
  }

  const points: Vec3[] = [];
  collectTrianglePlaneCrossings(left, right, options.distanceTolerance, points);
  collectTrianglePlaneCrossings(right, left, options.distanceTolerance, points);
  const unique = uniquePoints(points, options.distanceTolerance);
  if (unique.length < 2) return unique.length ? { kind: 'point' } : { kind: 'none' };

  const [a, b] = farthestPair(unique);
  return distance(a, b) <= options.minimumSegmentLength ? { kind: 'point' } : { kind: 'segment', ...canonicalSegment(a, b) };
}

/** Returns true only when coplanar triangles share area, not merely a vertex or edge. */
function coplanarTrianglesOverlap(left: Triangle<unknown>, right: Triangle<unknown>, tolerance: number): boolean {
  const axis = dominantAxis(left.normal);
  const subject = [left.a, left.b, left.c].map((point) => projectPlanePoint(point, axis));
  const clip = [right.a, right.b, right.c].map((point) => projectPlanePoint(point, axis));
  const orientation = signedArea2D(clip) >= 0 ? 1 : -1;
  let polygon = subject;
  for (let index = 0; index < clip.length; index += 1) {
    const a = clip[index];
    const b = clip[(index + 1) % clip.length];
    const next: Vec2[] = [];
    for (let pointIndex = 0; pointIndex < polygon.length; pointIndex += 1) {
      const previous = polygon[(pointIndex + polygon.length - 1) % polygon.length];
      const current = polygon[pointIndex];
      const previousInside = orientedLineDistance(previous, a, b, orientation) >= -tolerance;
      const currentInside = orientedLineDistance(current, a, b, orientation) >= -tolerance;
      if (previousInside !== currentInside) next.push(lineIntersection2D(previous, current, a, b));
      if (currentInside) next.push(current);
    }
    polygon = next;
    if (!polygon.length) return false;
  }
  const xs = polygon.map((point) => point.x);
  const ys = polygon.map((point) => point.y);
  const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), tolerance);
  return Math.abs(signedArea2D(polygon)) / 2 > tolerance * extent;
}

/** Collects source-triangle edge points that lie on the target triangle's plane and area. */
function collectTrianglePlaneCrossings(source: Triangle<unknown>, target: Triangle<unknown>, tolerance: number, output: Vec3[]): void {
  for (const [a, b] of triangleEdges(source)) {
    const hit = segmentPlaneIntersection(a, b, target.a, target.normal, tolerance);
    if (hit.kind === 'point' && pointInTriangle(hit.point, target, tolerance)) output.push(hit.point);
    if (hit.kind === 'coplanar-edge') {
      // A shared non-coplanar boundary edge lies in the opposite triangle's
      // plane. Retaining its in-triangle endpoints exposes that interface.
      if (pointInTriangle(a, target, tolerance)) output.push(a);
      if (pointInTriangle(b, target, tolerance)) output.push(b);
    }
  }
}

function segmentPlaneIntersection(a: Vec3, b: Vec3, planePoint: Vec3, planeNormal: Vec3, tolerance: number): { kind: 'none' | 'coplanar-edge' } | { kind: 'point'; point: Vec3 } {
  const distanceA = signedDistance(a, planePoint, planeNormal);
  const distanceB = signedDistance(b, planePoint, planeNormal);
  if (Math.abs(distanceA) <= tolerance && Math.abs(distanceB) <= tolerance) return { kind: 'coplanar-edge' };
  if ((distanceA > tolerance && distanceB > tolerance) || (distanceA < -tolerance && distanceB < -tolerance)) return { kind: 'none' };
  const denominator = distanceA - distanceB;
  if (Math.abs(denominator) <= Number.EPSILON) return { kind: 'none' };
  const t = distanceA / denominator;
  // t is unitless, whereas tolerance is a world-space length. Convert the
  // caller's tolerance to a segment-relative allowance before comparing them.
  const parameterTolerance = tolerance / Math.max(distance(a, b), tolerance);
  if (t < -parameterTolerance || t > 1 + parameterTolerance) return { kind: 'none' };
  return { kind: 'point', point: interpolate(a, b, clamp01(t)) };
}

function pointInTriangle(point: Vec3, triangle: Triangle<unknown>, tolerance: number): boolean {
  // Signed edge distances are measured in world units because the normal is
  // normalized. This keeps the tolerance meaningful for every triangle size.
  for (const [a, b] of triangleEdges(triangle)) {
    const signedEdgeDistance = dot(cross(subtract(b, a), subtract(point, a)), triangle.normal) / length(subtract(b, a));
    if (signedEdgeDistance < -tolerance) return false;
  }
  return true;
}

function mergeSegments<LeftData, RightData>(raw: readonly RawSegment<LeftData, RightData>[], options: ValidatedOptions): MergedSegment<LeftData, RightData>[] {
  const initial: MergedSegment<LeftData, RightData>[] = [];
  const exactSegments = new Map<string, MergedSegment<LeftData, RightData>>();
  for (const segment of raw) {
    const normalized = canonicalSegment(segment.a, segment.b);
    const left = sourceFromTriangle(segment.left);
    const right = sourceFromTriangle(segment.right);
    const key = segmentKey(left, right, normalized, options.distanceTolerance);
    const existing = exactSegments.get(key);
    if (existing) {
      addFacePair(existing.contributingFacePairs, [left.faceIndex, right.faceIndex]);
    } else {
      const merged: MergedSegment<LeftData, RightData> = { a: normalized.a, b: normalized.b, left, right, contributingFacePairs: [[left.faceIndex, right.faceIndex]] };
      initial.push(merged);
      exactSegments.set(key, merged);
    }
  }

  // Adjacent triangles commonly create consecutive pieces of the same physical
  // interface. Merge only touching, collinear pieces from the same mesh-owner pair.
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let leftIndex = 0; leftIndex < initial.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < initial.length; rightIndex += 1) {
        const left = initial[leftIndex];
        const right = initial[rightIndex];
        if (!sameSourcePair(left, right.left, right.right) || !canMerge(left, right, options)) continue;
        const [a, b] = farthestPair([left.a, left.b, right.a, right.b]);
        left.a = a;
        left.b = b;
        for (const pair of right.contributingFacePairs) addFacePair(left.contributingFacePairs, pair);
        initial.splice(rightIndex, 1);
        changed = true;
        break outer;
      }
    }
  }

  return initial
    .map((segment) => ({ ...segment, ...canonicalSegment(segment.a, segment.b), contributingFacePairs: [...segment.contributingFacePairs].sort(compareFacePairs) }))
    .sort(compareMergedSegments);
}

function canMerge<LeftData, RightData>(a: MergedSegment<LeftData, RightData>, b: MergedSegment<LeftData, RightData>, options: ValidatedOptions): boolean {
  const directionA = subtract(a.b, a.a);
  const directionB = subtract(b.b, b.a);
  const directionScale = length(directionA) * length(directionB);
  if (directionScale <= Number.EPSILON || length(cross(directionA, directionB)) > directionScale * options.angularTolerance) return false;
  const touching = [a.a, a.b].some((pointA) => [b.a, b.b].some((pointB) => distance(pointA, pointB) <= options.distanceTolerance));
  if (!touching) return false;
  return [b.a, b.b].every((point) => pointLineDistance(point, a.a, a.b) <= options.distanceTolerance);
}

function sourceFromTriangle<T>(triangle: Triangle<T>): IntersectionSource<T> {
  return { meshId: triangle.meshId, ownerId: triangle.ownerId, faceIndex: triangle.faceIndex, data: triangle.data };
}

function sameSourcePair<LeftData, RightData>(segment: MergedSegment<LeftData, RightData>, left: IntersectionSource<LeftData>, right: IntersectionSource<RightData>): boolean {
  return segment.left.meshId === left.meshId
    && segment.left.ownerId === left.ownerId
    && segment.right.meshId === right.meshId
    && segment.right.ownerId === right.ownerId;
}

function addFacePair(pairs: Array<[number, number]>, pair: [number, number]): void {
  if (!pairs.some(([left, right]) => left === pair[0] && right === pair[1])) pairs.push(pair);
}

function interfaceId<LeftData, RightData>(segment: MergedSegment<LeftData, RightData>, tolerance: number): string {
  const faces = segment.contributingFacePairs.map(([left, right]) => `${left}-${right}`).join(',');
  return `intersection:${segment.left.meshId}:${segment.right.meshId}:${faces}:${pointKey(segment.a, tolerance)}:${pointKey(segment.b, tolerance)}`;
}

function segmentKey<LeftData, RightData>(left: IntersectionSource<LeftData>, right: IntersectionSource<RightData>, segment: { a: Vec3; b: Vec3 }, tolerance: number): string {
  return `${left.meshId}:${left.ownerId ?? ''}:${right.meshId}:${right.ownerId ?? ''}:${pointKey(segment.a, tolerance)}:${pointKey(segment.b, tolerance)}`;
}

function pointKey(point: Vec3, tolerance: number): string {
  return `${Math.round(point.x / tolerance)},${Math.round(point.y / tolerance)},${Math.round(point.z / tolerance)}`;
}

function combinedOwnerId(left?: string, right?: string): string | undefined {
  if (!left && !right) return undefined;
  return `${left ?? 'unknown'}|${right ?? 'unknown'}`;
}

function triangleEdges(triangle: Pick<Triangle<unknown>, 'a' | 'b' | 'c'>): Array<[Vec3, Vec3]> {
  return [[triangle.a, triangle.b], [triangle.b, triangle.c], [triangle.c, triangle.a]];
}

function boundsOf(points: readonly Vec3[]): Bounds {
  return points.reduce<Bounds>((bounds, point) => ({
    min: { x: Math.min(bounds.min.x, point.x), y: Math.min(bounds.min.y, point.y), z: Math.min(bounds.min.z, point.z) },
    max: { x: Math.max(bounds.max.x, point.x), y: Math.max(bounds.max.y, point.y), z: Math.max(bounds.max.z, point.z) }
  }), { min: { ...points[0] }, max: { ...points[0] } });
}

function boundsOverlap(a: Bounds, b: Bounds, tolerance: number): boolean {
  return a.min.x <= b.max.x + tolerance && a.max.x + tolerance >= b.min.x
    && a.min.y <= b.max.y + tolerance && a.max.y + tolerance >= b.min.y
    && a.min.z <= b.max.z + tolerance && a.max.z + tolerance >= b.min.z;
}

function uniquePoints(points: readonly Vec3[], tolerance: number): Vec3[] {
  return points.reduce<Vec3[]>((result, point) => result.some((candidate) => distance(candidate, point) <= tolerance) ? result : [...result, point], []);
}

function farthestPair(points: readonly Vec3[]): [Vec3, Vec3] {
  let pair: [Vec3, Vec3] = [points[0], points[1]];
  let greatestDistance = distance(pair[0], pair[1]);
  for (let left = 0; left < points.length; left += 1) {
    for (let right = left + 1; right < points.length; right += 1) {
      const candidateDistance = distance(points[left], points[right]);
      if (candidateDistance > greatestDistance) {
        pair = [points[left], points[right]];
        greatestDistance = candidateDistance;
      }
    }
  }
  return pair;
}

function canonicalSegment(a: Vec3, b: Vec3): { a: Vec3; b: Vec3 } {
  return compareVec3(a, b) <= 0 ? { a, b } : { a: b, b: a };
}

function compareMergedSegments<LeftData, RightData>(a: MergedSegment<LeftData, RightData>, b: MergedSegment<LeftData, RightData>): number {
  return a.left.meshId.localeCompare(b.left.meshId)
    || a.right.meshId.localeCompare(b.right.meshId)
    || compareFacePairs(a.contributingFacePairs[0], b.contributingFacePairs[0])
    || compareVec3(a.a, b.a)
    || compareVec3(a.b, b.b);
}

function compareFacePairs(a: [number, number], b: [number, number]): number {
  return a[0] - b[0] || a[1] - b[1];
}

function compareVec3(a: Vec3, b: Vec3): number {
  return a.x - b.x || a.y - b.y || a.z - b.z;
}

function pointLineDistance(point: Vec3, lineA: Vec3, lineB: Vec3): number {
  const direction = subtract(lineB, lineA);
  const directionLength = length(direction);
  return directionLength <= Number.EPSILON ? distance(point, lineA) : length(cross(subtract(point, lineA), direction)) / directionLength;
}

function triangleScale(a: Vec3, b: Vec3, c: Vec3): number {
  return Math.max(distance(a, b), distance(b, c), distance(c, a), Number.MIN_VALUE);
}

function dominantAxis(normal: Vec3): 0 | 1 | 2 {
  const values = [Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z)];
  return values[0] >= values[1] && values[0] >= values[2] ? 0 : values[1] >= values[2] ? 1 : 2;
}

function projectPlanePoint(point: Vec3, axis: 0 | 1 | 2): Vec2 {
  return axis === 0 ? { x: point.y, y: point.z } : axis === 1 ? { x: point.x, y: point.z } : { x: point.x, y: point.y };
}

function signedArea2D(points: readonly Vec2[]): number {
  return points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + point.x * next.y - point.y * next.x;
  }, 0);
}

function orientedLineDistance(point: Vec2, a: Vec2, b: Vec2, orientation: number): number {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  return length <= Number.EPSILON ? -Infinity : orientation * ((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)) / length;
}

function lineIntersection2D(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denominator = r.x * s.y - r.y * s.x;
  if (Math.abs(denominator) <= Number.EPSILON) return a;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denominator;
  return { x: a.x + t * r.x, y: a.y + t * r.y };
}

function validateOptions(options: MeshIntersectionOptions): ValidatedOptions {
  const angularTolerance = options.angularTolerance ?? 1e-8;
  const minimumSegmentLength = options.minimumSegmentLength ?? options.distanceTolerance;
  if (![options.distanceTolerance, angularTolerance, minimumSegmentLength].every((value) => Number.isFinite(value) && value > 0)) {
    throw new RangeError('Mesh intersection tolerances must be positive finite numbers.');
  }
  return { distanceTolerance: options.distanceTolerance, angularTolerance, minimumSegmentLength };
}

function assertFiniteVec3(point: Vec3, name: string): void {
  if (![point.x, point.y, point.z].every(Number.isFinite)) throw new RangeError(`${name} must contain finite coordinates.`);
}

function signedDistance(point: Vec3, planePoint: Vec3, normal: Vec3): number { return dot(subtract(point, planePoint), normal); }
function subtract(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function scale(vector: Vec3, factor: number): Vec3 { return { x: vector.x * factor, y: vector.y * factor, z: vector.z * factor }; }
function interpolate(a: Vec3, b: Vec3, t: number): Vec3 { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }; }
function dot(a: Vec3, b: Vec3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
function distance(a: Vec3, b: Vec3): number { return length(subtract(a, b)); }
function length(vector: Vec3): number { return Math.hypot(vector.x, vector.y, vector.z); }
function cross(a: Vec3, b: Vec3): Vec3 { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }; }
function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
