import * as THREE from 'three';
import { classifyVisibility, createSectionFrame, intersectMeshes, projectMesh, projectWorldEdges, suppressCoincidentHiddenFragments, type MeshInput, type SectionEdge, type SectionFace, type Visibility } from '../../src/index.js';
import { meshInputFromThreeMesh } from './threeMeshInput.js';

export type DemoSource = 'wall' | 'slab' | 'rail' | 'screen' | 'frontScreen';
type DemoEdgeData = { kind: 'edge'; source: DemoSource } | { kind: 'interface'; relation: 'wall-slab' };

export type DemoLine = {
  kind: DemoEdgeData['kind'];
  visibility: Visibility;
  a: { u: number; v: number };
  b: { u: number; v: number };
};

export type ThreeSectionDemo = {
  lines: DemoLine[];
  svg: string;
};

const TOLERANCES = { planar: 1e-6, depth: 1e-5 };

/** Creates the shared Three.js source scene used by both checked-in SVG views. */
export function createDemoMeshes(): Record<DemoSource, THREE.Mesh> {
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(8, 5));
  wall.name = 'wall';
  wall.position.set(0, 0, 1);

  const slab = new THREE.Mesh(new THREE.PlaneGeometry(8, 3));
  slab.name = 'slab';
  slab.rotation.x = -Math.PI / 2;
  slab.rotateOnWorldAxis(new THREE.Vector3(0, 0, 1), -0.18);
  slab.position.set(0, -0.9, 0.5);

  const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.3));
  screen.name = 'screen';
  screen.rotation.z = 0.055;
  screen.position.set(0, -0.2, -0.6);

  const frontScreen = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 0.42));
  frontScreen.name = 'front-screen';
  frontScreen.rotation.z = -0.09;
  // This band crosses the wall/slab interface in section as well as the other
  // screen in the oblique preview, so both views demonstrate foreground depth.
  frontScreen.position.set(0, -0.75, -1.25);

  const rail = new THREE.Mesh(new THREE.PlaneGeometry(6, 0.22));
  rail.name = 'rail';
  rail.position.set(0, -0.2, 0.4);

  return { wall, slab, rail, screen, frontScreen };
}

/** Builds the public, abstract wall/slab/screen example without WebGL or a DOM. */
export function createThreeSectionDemo(): ThreeSectionDemo {
  const { wall, slab, rail, screen, frontScreen } = createDemoMeshes();
  const meshInputs: Record<DemoSource, MeshInput<DemoEdgeData>> = {
    wall: meshInputFromThreeMesh(wall, { id: 'wall', ownerId: 'wall', data: { kind: 'edge' as const, source: 'wall' as const } }),
    slab: meshInputFromThreeMesh(slab, { id: 'slab', ownerId: 'slab', data: { kind: 'edge' as const, source: 'slab' as const } }),
    rail: meshInputFromThreeMesh(rail, { id: 'rail', ownerId: 'rail', data: { kind: 'edge' as const, source: 'rail' as const } }),
    screen: meshInputFromThreeMesh(screen, { id: 'screen', ownerId: 'screen', data: { kind: 'edge' as const, source: 'screen' as const } }),
    frontScreen: meshInputFromThreeMesh(frontScreen, { id: 'front-screen', ownerId: 'front-screen', data: { kind: 'edge' as const, source: 'frontScreen' as const } })
  };
  const frame = createSectionFrame({
    origin: { x: 0, y: 0, z: 0 },
    uAxis: { x: 1, y: 0, z: 0 },
    vAxis: { x: 0, y: 1, z: 0 },
    depthAxis: { x: 0, y: 0, z: 1 }
  });
  const projections = Object.values(meshInputs).map((mesh) => ({
    projection: projectMesh(mesh, frame),
    boundaryEdgeIds: outerBoundaryEdgeIds(mesh)
  }));

  // The relationship is explicit: nothing attempts to intersect every mesh pair.
  const interfaces = projectWorldEdges(intersectMeshes(meshInputs.wall, meshInputs.slab, { distanceTolerance: 1e-6 }).segments, frame)
    .map((edge) => ({ ...edge, data: { kind: 'interface' as const, relation: 'wall-slab' as const } }));
  const edges: SectionEdge<DemoEdgeData>[] = [
    // BufferGeometry is triangular. The caller selects its drawing features, so
    // this example keeps only its outer boundaries instead of triangle diagonals.
    // A declared interface also takes drawing priority over a coincident source
    // boundary, otherwise the ordinary boundary could visually continue through
    // an occluder after the interface itself becomes hidden.
    ...projections.flatMap(({ projection, boundaryEdgeIds }) => projection.edges.filter((edge) => boundaryEdgeIds.has(edge.id) && !coincidesWithAny(edge, interfaces))),
    ...interfaces
  ];
  const faces: SectionFace<DemoEdgeData>[] = projections.flatMap(({ projection }) => projection.faces);
  const fragments = suppressCoincidentHiddenFragments(classifyVisibility(edges, faces, { tolerances: TOLERANCES }), TOLERANCES.planar);
  const lines = fragments
    .filter((fragment) => Math.hypot(fragment.a.u - fragment.b.u, fragment.a.v - fragment.b.v) > TOLERANCES.planar)
    .map((fragment) => ({
      kind: fragment.data?.kind ?? 'edge',
      visibility: fragment.visibility,
      a: { u: fragment.a.u, v: fragment.a.v },
      b: { u: fragment.b.u, v: fragment.b.v }
    }));
  return { lines, svg: renderSvg(lines) };
}

export function renderThreeSectionSvg(): string {
  return createThreeSectionDemo().svg;
}

function outerBoundaryEdgeIds(mesh: MeshInput<DemoEdgeData>): Set<string> {
  const counts = new Map<string, number>();
  for (const face of mesh.faces) {
    face.forEach((vertex, index) => {
      const next = face[(index + 1) % face.length];
      const key = vertex < next ? `${vertex}:${next}` : `${next}:${vertex}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
  }
  return new Set([...counts].filter(([, count]) => count === 1).map(([key]) => `${mesh.id}:edge:${key}`));
}

/** Returns true when an ordinary projected edge is the same drawing feature as an interface. */
function coincidesWithAny(edge: SectionEdge<DemoEdgeData>, interfaces: readonly SectionEdge<DemoEdgeData>[]): boolean {
  return interfaces.some((candidate) => segmentContains(edge.a, edge.b, candidate.a)
    && segmentContains(edge.a, edge.b, candidate.b));
}

function segmentContains(a: { u: number; v: number }, b: { u: number; v: number }, point: { u: number; v: number }): boolean {
  const dx = b.u - a.u;
  const dy = b.v - a.v;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= TOLERANCES.planar * TOLERANCES.planar) return false;
  const cross = dx * (point.v - a.v) - dy * (point.u - a.u);
  if (Math.abs(cross) > TOLERANCES.planar * Math.sqrt(lengthSquared)) return false;
  const parameter = ((point.u - a.u) * dx + (point.v - a.v) * dy) / lengthSquared;
  return parameter >= -TOLERANCES.planar && parameter <= 1 + TOLERANCES.planar;
}

function renderSvg(lines: readonly DemoLine[]): string {
  const points = lines.flatMap((line) => [line.a, line.b]);
  const minU = Math.min(...points.map((point) => point.u));
  const maxU = Math.max(...points.map((point) => point.u));
  const minV = Math.min(...points.map((point) => point.v));
  const maxV = Math.max(...points.map((point) => point.v));
  const padding = 0.65;
  const width = 960;
  const height = 560;
  const drawing = { left: 70, top: 90, width: 820, height: 390 };
  const scale = Math.min(drawing.width / (maxU - minU + padding * 2), drawing.height / (maxV - minV + padding * 2));
  const usedWidth = (maxU - minU + padding * 2) * scale;
  const usedHeight = (maxV - minV + padding * 2) * scale;
  const left = drawing.left + (drawing.width - usedWidth) / 2;
  const top = drawing.top + (drawing.height - usedHeight) / 2;
  const x = (u: number) => left + (u - minU + padding) * scale;
  const y = (v: number) => top + usedHeight - (v - minV + padding) * scale;
  const number = (value: number) => Number(value.toFixed(2));
  const lineSvg = (line: DemoLine) => {
    const className = `${line.kind} ${line.visibility}`;
    return `<line class="${className}" x1="${number(x(line.a.u))}" y1="${number(y(line.a.v))}" x2="${number(x(line.b.u))}" y2="${number(y(line.b.v))}"/>`;
  };
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="title description">`,
    `<title id="title">Three.js to orthographic section linework</title>`,
    `<desc id="description">An abstract wall and slab interface, with a foreground screen that creates dashed hidden lines.</desc>`,
    `<style>.edge{stroke:#1f2937;stroke-width:1.8;fill:none;stroke-linecap:round}.edge.hidden{stroke:#8b96a5;stroke-dasharray:7 5}.interface{stroke:#0f766e;stroke-width:3.2;fill:none;stroke-linecap:round}.interface.hidden{stroke:#5f9e98;stroke-dasharray:8 5}.frame{fill:#fff;stroke:#d6dde6;stroke-width:1}.label{font-family:ui-sans-serif,system-ui,sans-serif;fill:#334155}.small{font-size:14px}.title{font-size:24px;font-weight:700}</style>`,
    `<rect width="100%" height="100%" fill="#f8fafc"/>`,
    `<text class="label title" x="70" y="46">Three.js → section linework → SVG</text>`,
    `<text class="label small" x="70" y="70">Explicit wall/slab interface · orthographic projection · hidden lines retained</text>`,
    `<rect class="frame" x="${drawing.left}" y="${drawing.top}" width="${drawing.width}" height="${drawing.height}" rx="8"/>`,
    ...lines.map(lineSvg),
    `<line class="edge" x1="70" y1="520" x2="100" y2="520"/><text class="label small" x="110" y="525">visible edge</text>`,
    `<line class="edge hidden" x1="250" y1="520" x2="280" y2="520"/><text class="label small" x="290" y="525">hidden edge</text>`,
    `<line class="interface" x1="420" y1="520" x2="450" y2="520"/><text class="label small" x="460" y="525">declared interface</text>`,
    `</svg>`
  ].join('\n');
}
