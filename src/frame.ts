import type { SectionFrame, SectionFrameInput, SectionPoint, Vec3 } from './types.js';

// Axes are normalized before this value is used, so this is dimensionless and
// independent of whether a consumer works in metres, millimetres, or another unit.
const FRAME_EPSILON = 1e-9;

/**
 * Normalizes and validates an explicit orthogonal drawing frame.
 *
 * Handedness is intentionally not enforced. A caller may mirror the view by
 * reversing one axis, but projection still requires all three axes to be
 * perpendicular so `u`, `v`, and `depth` remain independent coordinates.
 */
export function createSectionFrame(input: SectionFrameInput): SectionFrame {
  assertFiniteVec3(input.origin, 'origin');
  const uAxis = normalize(input.uAxis, 'uAxis');
  const vAxis = normalize(input.vAxis, 'vAxis');
  const depthAxis = normalize(input.depthAxis, 'depthAxis');
  if (Math.abs(dot(uAxis, vAxis)) > FRAME_EPSILON || Math.abs(dot(uAxis, depthAxis)) > FRAME_EPSILON || Math.abs(dot(vAxis, depthAxis)) > FRAME_EPSILON) {
    throw new RangeError('Section frame axes must be mutually perpendicular.');
  }
  return { origin: { ...input.origin }, uAxis, vAxis, depthAxis };
}

/** Projects one world-space point into the frame's drawing-plane coordinates. */
export function projectPoint(point: Vec3, frame: SectionFrame): SectionPoint {
  assertFiniteVec3(point, 'point');
  const delta = subtract(point, frame.origin);
  // depthAxis points away from the viewer, hence a smaller depth is nearer.
  return { u: dot(delta, frame.uAxis), v: dot(delta, frame.vAxis), depth: dot(delta, frame.depthAxis) };
}

function normalize(vector: Vec3, name: string): Vec3 {
  assertFiniteVec3(vector, name);
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (length < FRAME_EPSILON) throw new RangeError(`${name} must be non-zero.`);
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function assertFiniteVec3(vector: Vec3, name: string): void {
  if (![vector.x, vector.y, vector.z].every(Number.isFinite)) throw new RangeError(`${name} must contain finite coordinates.`);
}

function subtract(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function dot(a: Vec3, b: Vec3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
