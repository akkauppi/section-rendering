import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderThreeSectionSvg } from './demo.js';
import { renderThreeScenePreviewSvg } from './scenePreview.js';

const directory = dirname(fileURLToPath(import.meta.url));
const outputs = [
  { path: resolve(directory, '../../fixtures/three-scene.svg'), content: renderThreeScenePreviewSvg() },
  { path: resolve(directory, '../../fixtures/three-section.svg'), content: renderThreeSectionSvg() }
];
for (const output of outputs) {
  writeFileSync(output.path, `${output.content}\n`, 'utf8');
  console.log(`Wrote ${output.path}`);
}
