'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = __dirname;
const read = (name) => fs.readFileSync(path.join(root, 'src', name), 'utf8');
const pieces = [
  ['/*__STYLES__*/', 'styles.css'],
  ['/*__CORE__*/', 'core.js'],
  ['/*__PPTX__*/', 'pptx.js'],
  ['/*__APP__*/', 'app.js'],
];

let html = read('index.html');
for (const [marker, name] of pieces) {
  const count = html.split(marker).length - 1;
  if (count !== 1) {
    throw new Error(`Expected exactly one ${marker} in src/index.html; found ${count}.`);
  }
  const source = read(name);
  if (name.endsWith('.js')) {
    new vm.Script(source, { filename: `src/${name}` });
    if (/<\/script\s*[>/]/i.test(source)) {
      throw new Error(`src/${name} contains a closing script tag. Escape it before embedding.`);
    }
  }
  // A replacement callback preserves literal dollar sequences in source code.
  html = html.replace(marker, () => source);
}

if (/\/\*__(?:STYLES|CORE|PPTX|APP)__\*\//.test(html)) {
  throw new Error('An unresolved build marker remains in the output.');
}

const license = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8').trim();
if (!/<!doctype html>/i.test(html) || !/<head>/i.test(html)) {
  throw new Error('src/index.html must contain an HTML doctype and a head element.');
}
// Keep it inside documentElement so portable project saves retain the license.
html = html.replace(/<head>/i, (head) => `${head}\n<!--\n${license}\n-->`);

const output = path.join(root, 'autoWaveform.html');
fs.writeFileSync(output, html, 'utf8');
console.log(`Built ${path.basename(output)} (${(Buffer.byteLength(html, 'utf8') / 1024).toFixed(1)} KiB).`);
