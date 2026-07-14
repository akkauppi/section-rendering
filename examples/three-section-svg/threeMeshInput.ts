import * as THREE from 'three';
import type { MeshInput } from '../../src/types.js';

export type ThreeMeshInputOptions<T> = {
  id: string;
  ownerId?: string;
  data?: T;
};

/**
 * Example-only bridge from one transformed Three.js mesh to the neutral core.
 *
 * It intentionally does not traverse a scene or infer application semantics.
 * Materials, groups, draw ranges, normals, and UVs are likewise caller concerns;
 * this helper always reads the geometry's complete triangle list.
 */
export function meshInputFromThreeMesh<T>(mesh: THREE.Mesh<THREE.BufferGeometry>, options: ThreeMeshInputOptions<T>): MeshInput<T> {
  if (!options.id) throw new RangeError('A stable mesh id is required.');
  const position = mesh.geometry.getAttribute('position');
  if (!position || position.itemSize < 3) throw new RangeError(`Three mesh ${options.id} requires a position attribute with three components.`);

  mesh.updateWorldMatrix(true, false);
  const point = new THREE.Vector3();
  const vertices = Array.from({ length: position.count }, (_, index) => {
    point.set(position.getX(index), position.getY(index), position.getZ(index)).applyMatrix4(mesh.matrixWorld);
    if (![point.x, point.y, point.z].every(Number.isFinite)) throw new RangeError(`Three mesh ${options.id} contains a non-finite transformed vertex.`);
    return { x: point.x, y: point.y, z: point.z };
  });

  const index = mesh.geometry.getIndex();
  const triangleIndices = index
    ? Array.from({ length: index.count }, (_, item) => index.getX(item))
    : Array.from({ length: position.count }, (_, item) => item);
  if (!triangleIndices.length || triangleIndices.length % 3 !== 0) throw new RangeError(`Three mesh ${options.id} must contain complete triangles.`);

  const faces: number[][] = [];
  for (let item = 0; item < triangleIndices.length; item += 3) {
    const face = triangleIndices.slice(item, item + 3);
    if (face.some((vertexIndex) => !Number.isInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= vertices.length)) {
      throw new RangeError(`Three mesh ${options.id} contains an invalid triangle index.`);
    }
    faces.push(face);
  }
  return { id: options.id, ownerId: options.ownerId, data: options.data, vertices, faces };
}
