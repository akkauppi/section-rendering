import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createThreeSectionDemo, renderThreeSectionSvg } from '../examples/three-section-svg/demo.js';
import { renderThreeScenePreviewSvg } from '../examples/three-section-svg/scenePreview.js';
import { meshInputFromThreeMesh } from '../examples/three-section-svg/threeMeshInput.js';

describe('Three.js section SVG example', () => {
  it('converts indexed geometry through parent and mesh transforms', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    geometry.setIndex([0, 1, 2]);
    const parent = new THREE.Group();
    parent.position.set(2, 3, 4);
    const mesh = new THREE.Mesh(geometry);
    mesh.position.set(10, 0, 0);
    parent.add(mesh);

    const input = meshInputFromThreeMesh(mesh, { id: 'transformed' });
    expect(input.vertices).toEqual([{ x: 12, y: 3, z: 4 }, { x: 13, y: 3, z: 4 }, { x: 12, y: 4, z: 4 }]);
    expect(input.faces).toEqual([[0, 1, 2]]);
  });

  it('converts non-indexed triangles and rejects malformed geometry', () => {
    const nonIndexed = new THREE.BufferGeometry();
    nonIndexed.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0, 1, 0, 0, 0, 1, 0,
      1, 0, 0, 1, 1, 0, 0, 1, 0
    ], 3));
    expect(meshInputFromThreeMesh(new THREE.Mesh(nonIndexed), { id: 'non-indexed' }).faces).toEqual([[0, 1, 2], [3, 4, 5]]);

    expect(() => meshInputFromThreeMesh(new THREE.Mesh(new THREE.BufferGeometry()), { id: 'missing-position' })).toThrow(/position attribute/);
    const invalidIndex = new THREE.BufferGeometry();
    invalidIndex.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    invalidIndex.setIndex([0, 1, 3]);
    expect(() => meshInputFromThreeMesh(new THREE.Mesh(invalidIndex), { id: 'invalid-index' })).toThrow(/invalid triangle index/);
  });

  it('demonstrates visible, hidden, and explicitly declared interface linework', () => {
    const demo = createThreeSectionDemo();
    expect(demo.lines.some((line) => line.kind === 'edge' && line.visibility === 'visible')).toBe(true);
    expect(demo.lines.some((line) => line.kind === 'edge' && line.visibility === 'hidden')).toBe(true);
    expect(demo.lines.some((line) => line.kind === 'interface' && line.visibility === 'visible')).toBe(true);
    expect(demo.lines.some((line) => line.kind === 'interface' && line.visibility === 'hidden')).toBe(true);
  });

  it('matches the checked-in README fixtures', () => {
    const fixtures = [
      { path: '../fixtures/three-scene.svg', render: renderThreeScenePreviewSvg },
      { path: '../fixtures/three-section.svg', render: renderThreeSectionSvg }
    ];
    for (const fixture of fixtures) {
      const fixturePath = fileURLToPath(new URL(fixture.path, import.meta.url));
      expect(`${fixture.render()}\n`).toBe(readFileSync(fixturePath, 'utf8'));
    }
  });
});
