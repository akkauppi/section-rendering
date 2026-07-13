import { projectPoint } from './frame.js';
import type { MeshInput, ProjectedMesh, SectionFrame } from './types.js';

/**
 * Projects an indexed polygon mesh into section space.
 *
 * Edge identity is topological: an edge is keyed by its two vertex indices, not
 * by coordinate equality. This deduplicates shared face boundaries while keeping
 * intentionally separate vertices separate. The direction stored for a shared
 * edge is whichever direction is encountered on the first face.
 *
 * Faces are projected as supplied. In particular, this function does not
 * triangulate polygons and therefore does not invent diagonal candidate edges.
 */
export function projectMesh<T>(mesh: MeshInput<T>, frame: SectionFrame): ProjectedMesh<T> {
  if (!mesh.id) throw new RangeError('Mesh id is required.');
  const points = mesh.vertices.map((vertex) => projectPoint(vertex, frame));
  const edges = new Map<string, ProjectedMesh<T>['edges'][number]>();
  const faces = mesh.faces.map((face, faceIndex) => {
    if (face.length < 3) throw new RangeError(`Mesh face ${faceIndex} must contain at least three vertices.`);
    const vertices = face.map((vertexIndex) => {
      if (!Number.isInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= points.length) throw new RangeError(`Mesh face ${faceIndex} contains an invalid vertex index.`);
      return points[vertexIndex];
    });
    face.forEach((vertex, index) => {
      const next = face[(index + 1) % face.length];
      if (vertex === next) throw new RangeError(`Mesh face ${faceIndex} contains a zero-length edge.`);
      // Sort only for the lookup key. Preserve the first face's endpoint order
      // in the public edge so output remains stable for a stable input mesh.
      const [low, high] = vertex < next ? [vertex, next] : [next, vertex];
      const key = `${low}:${high}`;
      if (!edges.has(key)) edges.set(key, { id: `${mesh.id}:edge:${key}`, ownerId: mesh.ownerId, data: mesh.data, a: points[vertex], b: points[next] });
    });
    return { id: `${mesh.id}:face:${faceIndex}`, ownerId: mesh.ownerId, data: mesh.data, vertices };
  });
  return { edges: [...edges.values()], faces };
}
