import * as THREE from 'three';
import { intersectMeshes } from '../../src/index.js';
import { createDemoMeshes, type DemoSource } from './demo.js';
import { meshInputFromThreeMesh } from './threeMeshInput.js';

type SceneStyle = { fill: string; stroke: string; label: string };

const DRAW_ORDER: DemoSource[] = ['wall', 'slab', 'rail', 'screen', 'frontScreen'];
const STYLES: Record<DemoSource, SceneStyle> = {
  wall: { fill: '#dbeafe', stroke: '#2563eb', label: 'wall' },
  slab: { fill: '#d1fae5', stroke: '#047857', label: 'sloped slab' },
  rail: { fill: '#fde68a', stroke: '#b45309', label: 'rail' },
  screen: { fill: '#e5e7eb', stroke: '#475569', label: 'screen' },
  frontScreen: { fill: '#c4b5fd', stroke: '#6d28d9', label: 'front screen — occludes' }
};

type ProjectedPoint = { x: number; y: number };
type ProjectedMesh = { source: DemoSource; faces: ProjectedPoint[][]; outline: ProjectedPoint[] };

/**
 * Produces a deterministic, oblique source-scene preview using Three.js mesh
 * transforms and a PerspectiveCamera. SVG keeps the README asset portable;
 * this deliberately does not require a WebGL canvas or a headless GPU.
 */
export function renderThreeScenePreviewSvg(): string {
  const meshes = createDemoMeshes();
  const camera = new THREE.PerspectiveCamera(38, 960 / 560, 0.1, 100);
  camera.position.set(8.5, 6.5, -11);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();

  const projected = DRAW_ORDER.map((source) => projectDemoPlane(meshes[source], source, camera));
  const interfaceLines = intersectMeshes(
    meshInputFromThreeMesh(meshes.wall, { id: 'wall' }),
    meshInputFromThreeMesh(meshes.slab, { id: 'slab' }),
    { distanceTolerance: 1e-6 }
  ).segments.map((segment) => [projectWorldPoint(segment.a, camera), projectWorldPoint(segment.b, camera)]);
  const points = [...projected.flatMap((mesh) => mesh.outline), ...interfaceLines.flat()];
  const bounds = points.reduce((result, point) => ({
    minX: Math.min(result.minX, point.x), maxX: Math.max(result.maxX, point.x),
    minY: Math.min(result.minY, point.y), maxY: Math.max(result.maxY, point.y)
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  const drawing = { left: 60, top: 94, width: 840, height: 370 };
  const padding = 0.12;
  const scale = Math.min(drawing.width / (bounds.maxX - bounds.minX + padding * 2), drawing.height / (bounds.maxY - bounds.minY + padding * 2));
  const usedWidth = (bounds.maxX - bounds.minX + padding * 2) * scale;
  const usedHeight = (bounds.maxY - bounds.minY + padding * 2) * scale;
  const left = drawing.left + (drawing.width - usedWidth) / 2;
  const top = drawing.top + (drawing.height - usedHeight) / 2;
  const point = ({ x, y }: ProjectedPoint) => `${number(left + (x - bounds.minX + padding) * scale)},${number(top + usedHeight - (y - bounds.minY + padding) * scale)}`;
  const polygon = (points: readonly ProjectedPoint[]) => points.map(point).join(' ');
  const line = (points: readonly ProjectedPoint[]) => points.map(point).join(' ');
  const renderMesh = ({ source, faces, outline }: ProjectedMesh) => {
    const style = STYLES[source];
    return [
      ...faces.map((face) => `<polygon points="${polygon(face)}" fill="${style.fill}"/>`),
      `<polygon class="mesh" points="${polygon(outline)}" fill="none" stroke="${style.stroke}"/>`
    ];
  };
  const background = projected.filter(({ source }) => source !== 'screen' && source !== 'frontScreen');
  const occluders = projected.filter(({ source }) => source === 'screen' || source === 'frontScreen');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 560" width="960" height="560" role="img" aria-labelledby="title description">`,
    `<title id="title">Oblique Three.js source geometry for the section example</title>`,
    `<desc id="description">A wall, tilted slab, rail, and two foreground screens viewed from an oblique Three.js camera. The long narrow front screen hides parts of the other geometry.</desc>`,
    `<style>.frame{fill:#fff;stroke:#d6dde6;stroke-width:1}.label{font-family:ui-sans-serif,system-ui,sans-serif;fill:#334155}.title{font-size:24px;font-weight:700}.small{font-size:14px}.mesh{stroke-width:2;stroke-linejoin:round}.interface{stroke:#0f766e;stroke-width:3.2;stroke-linecap:round}</style>`,
    `<rect width="100%" height="100%" fill="#f8fafc"/>`,
    `<text class="label title" x="60" y="46">Three.js source scene</text>`,
    `<text class="label small" x="60" y="70">Perspective camera, about 35° off the section axis · teal is the wall/slab intersection · violet is the front occluder</text>`,
    `<rect class="frame" x="${drawing.left}" y="${drawing.top}" width="${drawing.width}" height="${drawing.height}" rx="8"/>`,
    ...background.flatMap(renderMesh),
    ...interfaceLines.map((points) => `<polyline class="interface" points="${line(points)}" fill="none"/>`),
    ...occluders.flatMap(renderMesh),
    ...DRAW_ORDER.map((source, index) => {
      const style = STYLES[source];
      const x = 60 + index * 176;
      return `<rect x="${x}" y="506" width="18" height="12" rx="2" fill="${style.fill}" stroke="${style.stroke}"/><text class="label small" x="${x + 26}" y="517">${style.label}</text>`;
    }),
    `</svg>`
  ].join('\n');
}

/** Projects this fixed rectangular-plane scene; it is not a general Three.js SVG renderer. */
function projectDemoPlane(mesh: THREE.Mesh, source: DemoSource, camera: THREE.PerspectiveCamera): ProjectedMesh {
  mesh.updateWorldMatrix(true, false);
  const position = mesh.geometry.getAttribute('position');
  if (!position || position.itemSize < 3) throw new RangeError(`${mesh.name} needs a position attribute.`);
  const index = mesh.geometry.getIndex();
  if (position.count !== 4 || index?.count !== 6) throw new RangeError(`${mesh.name} must be the example's two-triangle rectangular plane.`);
  const vertices = Array.from({ length: position.count }, (_, index) => new THREE.Vector3(position.getX(index), position.getY(index), position.getZ(index)).applyMatrix4(mesh.matrixWorld));
  const indices = Array.from({ length: index.count }, (_, offset) => index.getX(offset));
  const project = (vertex: THREE.Vector3): ProjectedPoint => {
    const point = vertex.clone().project(camera);
    return { x: point.x, y: point.y };
  };
  const faces = Array.from({ length: indices.length / 3 }, (_, faceIndex) => indices.slice(faceIndex * 3, faceIndex * 3 + 3).map((vertexIndex) => project(vertices[vertexIndex])));
  // PlaneGeometry's outer loop is stable and avoids exposing its internal triangle diagonal.
  const outline = [vertices[0], vertices[1], vertices[position.count - 1], vertices[position.count - 2]].map(project);
  return { source, faces, outline };
}

function projectWorldPoint(point: { x: number; y: number; z: number }, camera: THREE.PerspectiveCamera): ProjectedPoint {
  const projected = new THREE.Vector3(point.x, point.y, point.z).project(camera);
  return { x: projected.x, y: projected.y };
}

function number(value: number): number {
  return Number(value.toFixed(2));
}
