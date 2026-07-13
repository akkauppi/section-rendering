/** A finite point in application/world coordinates. Units are owned by the caller. */
export type Vec3 = { x: number; y: number; z: number };

/** A point in a drawing's section space. Smaller depth is closer to the viewer. */
export type SectionPoint = { u: number; v: number; depth: number };

export type SectionFrameInput = {
  /** World-space point that maps to u=0, v=0, depth=0. */
  origin: Vec3;
  /** Drawing-horizontal direction. Length is normalized by createSectionFrame. */
  uAxis: Vec3;
  /** Drawing-vertical direction. Length is normalized by createSectionFrame. */
  vAxis: Vec3;
  /** Points from the drawing plane away from the viewer. */
  depthAxis: Vec3;
};

/** A validated frame whose axes have unit length. */
export type SectionFrame = SectionFrameInput & {
  uAxis: Vec3;
  vAxis: Vec3;
  depthAxis: Vec3;
};

export type SectionEdge<T = unknown> = {
  /** Stable within the caller's source model; copied to every output fragment. */
  id: string;
  /** Optional grouping identity. It has no built-in visibility semantics. */
  ownerId?: string;
  /** Caller-owned metadata passed through without inspection. */
  data?: T;
  a: SectionPoint;
  b: SectionPoint;
};

export type SectionFace<T = unknown> = {
  id: string;
  /** Optional grouping identity. It has no built-in visibility semantics. */
  ownerId?: string;
  /** Caller-owned metadata available to custom occlusion policy. */
  data?: T;
  /** Ordered boundary vertices. Triangles and convex, depth-planar polygons are supported. */
  vertices: readonly SectionPoint[];
};

export type Visibility = 'visible' | 'hidden';

export type VisibilityFragment<T = unknown> = {
  /** ID of the original unsplit edge. */
  edgeId: string;
  ownerId?: string;
  data?: T;
  a: SectionPoint;
  b: SectionPoint;
  /** Inclusive parameter interval on the original edge, where a=0 and b=1. */
  t0: number;
  t1: number;
  visibility: Visibility;
};

export type VisibilityTolerances = {
  /** Drawing-plane tolerance, in the caller's coordinate unit. */
  planar: number;
  /** Depth tolerance, in the caller's coordinate unit. */
  depth: number;
  /** Parallel/collinearity tolerance for normalized directions. Defaults to 1e-8. */
  angular?: number;
  /** Optional edge-parameter merge tolerance. Defaults to 1e-9. */
  parameter?: number;
};

export type OcclusionContext<EdgeData = unknown, FaceData = unknown> = {
  edge: SectionEdge<EdgeData>;
  face: SectionFace<FaceData>;
  point: SectionPoint;
  /** Face depth interpolated at `point` in the drawing plane. */
  faceDepth: number;
  /** Useful for policies that retain source edges lying on their own face. */
  onFaceBoundary: boolean;
};

export type ClassifyVisibilityOptions<EdgeData = unknown, FaceData = unknown> = {
  tolerances: VisibilityTolerances;
  /** Return false to retain a fragment that the face would otherwise hide. */
  shouldOcclude?: (context: OcclusionContext<EdgeData, FaceData>) => boolean;
};

export type MeshInput<T = unknown> = {
  /** Used as the prefix for deterministic projected face and edge IDs. */
  id: string;
  ownerId?: string;
  data?: T;
  vertices: readonly Vec3[];
  /** Ordered face vertex indices. Interface extraction requires convex, planar faces. */
  faces: readonly (readonly number[])[];
};

export type ProjectedMesh<T = unknown> = {
  /** Unique topological boundaries collected from every input face. */
  edges: SectionEdge<T>[];
  /** One projected face for every input face, in the same order. */
  faces: SectionFace<T>[];
};

/** A finite world-space segment that can later be projected into a SectionFrame. */
export type WorldEdge<T = unknown> = {
  id: string;
  ownerId?: string;
  data?: T;
  a: Vec3;
  b: Vec3;
};

/** Identifies one source face that contributed to an extracted interface. */
export type IntersectionSource<T = unknown> = {
  meshId: string;
  ownerId?: string;
  faceIndex: number;
  data?: T;
};

/** Caller metadata retained on an interface segment extracted from two meshes. */
export type SurfaceIntersectionData<LeftData = unknown, RightData = unknown> = {
  left: IntersectionSource<LeftData>;
  right: IntersectionSource<RightData>;
  /** All original polygon-face pairs merged into this continuous segment. */
  contributingFacePairs: Array<[number, number]>;
};

export type MeshIntersectionOptions = {
  /** World-space distance tolerance, in the caller's coordinate unit. */
  distanceTolerance: number;
  /** Parallel/collinearity tolerance for normalized directions. Defaults to 1e-8. */
  angularTolerance?: number;
  /** Shorter results are treated as point contact. Defaults to distanceTolerance. */
  minimumSegmentLength?: number;
};

export type MeshIntersectionDiagnostics = {
  /** Number of valid triangles considered after degenerate input is skipped. */
  triangleCount: number;
  candidatePairCount: number;
  testedPairCount: number;
  degenerateTriangleCount: number;
  /** Coplanar overlap is an area, so v0.1 reports it instead of inventing an edge. */
  coplanarPairCount: number;
  /** Zero-length touch events are reported but not returned as drawing edges. */
  pointContactCount: number;
};

export type MeshIntersectionResult<LeftData = unknown, RightData = unknown> = {
  segments: WorldEdge<SurfaceIntersectionData<LeftData, RightData>>[];
  diagnostics: MeshIntersectionDiagnostics;
};
