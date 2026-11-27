// Generates public/contentExperiments.js (a classic script exposing window.MMMExp) from lib/contentExperiments.mjs, so the browser and the server run the SAME pure functions.
// `node tools/gen-public-experiments.mjs` writes the file; the unit test regenerates it in memory and fails if the committed copy drifts.
import fs from 'node:fs';
export function generate(src) {
  const names = [...src.matchAll(/^export (?:const|function) ([A-Za-z_]+)/gm)].map((m) => m[1]);
  const body = src.replace(/^export /gm, '');
  return `// GENERATED from lib/contentExperiments.mjs by tools/gen-public-experiments.mjs — do not edit by hand (tests/home2/test_content_experiments.mjs checks it has not drifted).\n(function () {\n'use strict';\n${body}\nwindow.MMMExp = { ${names.join(', ')} };\n})();\n`;
}
if ((process.argv[1] || '').endsWith('gen-public-experiments.mjs')) { const root = new URL('../', import.meta.url).pathname; fs.writeFileSync(root + 'public/contentExperiments.js', generate(fs.readFileSync(root + 'lib/contentExperiments.mjs', 'utf8'))); console.log('written'); }
