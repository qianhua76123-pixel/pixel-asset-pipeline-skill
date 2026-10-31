#!/usr/bin/env node
/** Compare classic v0.2 sampling with the v0.3 fringe/coverage recipe. No network. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(HERE, 'pixel_local.mjs');

function argumentsFor(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!flag.startsWith('--')) throw Error('Unknown argument: ' + flag);
    const key = flag.slice(2);
    if (!['samples', 'out', 'palette-file'].includes(key)) throw Error('Unknown argument: ' + flag);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw Error('Missing value for ' + flag);
    options[key] = value;
  }
  if (!options.samples || !options.out) throw Error('Usage: pixel_benchmark.mjs --samples DIR --out DIR [--palette-file FILE]');
  return options;
}

function metricsOf(data, width, height, palette) {
  const opaque = new Uint8Array(width * height), keys = new Int32Array(width * height);
  let pink = 0, pinkEdge = 0, visible = 0, isolated = 0, inPalette = 0;
  const colors = new Set();
  const allowed = palette ? new Set(palette) : null;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = y * width + x, i = p * 4;
    if (data[i + 3] < 128) continue;
    opaque[p] = 1; visible++;
    const key = data[i] << 16 | data[i + 1] << 8 | data[i + 2];
    keys[p] = key; colors.add(key);
    if (allowed?.has(key)) inPalette++;
    if (data[i] - data[i + 1] > 40 && data[i + 2] - data[i + 1] > 30) {
      pink++;
      let edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      if (!edge) for (const step of [1, -1, width, -width]) if (data[(p + step) * 4 + 3] < 128) edge = true;
      if (edge) pinkEdge++;
    }
  }
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const p = y * width + x;
    if (!opaque[p]) continue;
    if ([[0, 1], [1, 0], [0, -1], [-1, 0]].every(([dx, dy]) => opaque[p + dy * width + dx] && keys[p + dy * width + dx] !== keys[p])) isolated++;
  }
  return {
    width, height, visible, colors: colors.size, pink, pinkEdge, isolated,
    isolatedRatio: visible ? +(isolated / visible).toFixed(3) : 0,
    ...(allowed ? { inPalette: visible ? +(inPalette / visible).toFixed(3) : 0 } : {}),
  };
}

async function loadPalette(filename) {
  if (!filename) return null;
  const text = await fs.readFile(filename, 'utf8'), colors = [];
  for (const line of text.split(/\r?\n/)) {
    const hex = line.trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{6}$/.test(hex)) colors.push(parseInt(hex, 16));
  }
  return colors;
}

function run(input, out, args) {
  const child = spawnSync(process.execPath, [cli, 'run', '--input', input, '--output-dir', out, ...args], { encoding: 'utf8' });
  if (child.status) throw Error(child.stderr || child.stdout);
  return path.join(out, 'sprite.png');
}

async function decode(filename) {
  const decoded = await sharp(filename).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: decoded.info.width, height: decoded.info.height, data: decoded.data };
}

async function onBackground(sprite, background, scale) {
  const { width, height, data } = sprite;
  const rgb = Buffer.alloc(width * height * 3);
  for (let p = 0, i = 0; p < width * height; p++, i += 4) {
    const use = data[i + 3] >= 128;
    rgb[p * 3] = use ? data[i] : background[0];
    rgb[p * 3 + 1] = use ? data[i + 1] : background[1];
    rgb[p * 3 + 2] = use ? data[i + 2] : background[2];
  }
  return sharp(rgb, { raw: { width, height, channels: 3 } }).resize(width * scale, height * scale, { kernel: 'nearest' }).png().toBuffer();
}

async function sideBySide(left, right) {
  const a = sharp(left), b = sharp(right);
  const am = await a.metadata(), bm = await b.metadata();
  const height = Math.max(am.height, bm.height), width = am.width + bm.width + 8;
  return sharp({ create: { width, height, channels: 3, background: '#f4f1ea' } })
    .composite([{ input: left, left: 0, top: 0 }, { input: right, left: am.width + 8, top: 0 }]).png().toBuffer();
}

function edgeWindow(sprite) {
  const { width, height, data } = sprite;
  let y0 = 0, x0 = 0;
  for (let y = 0; y < height && !y0; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] >= 128) { y0 = y; x0 = x; break; }
  const top = Math.max(0, y0 - 8), left = Math.max(0, x0 - 8);
  const cropW = Math.min(72, width - left), cropH = Math.min(72, height - top);
  const dataOut = Buffer.alloc(cropW * cropH * 4);
  for (let y = 0; y < cropH; y++) dataOut.set(data.subarray(((top + y) * width + left) * 4, ((top + y) * width + left + cropW) * 4), y * cropW * 4);
  return { width: cropW, height: cropH, data: dataOut };
}

async function main() {
  const options = argumentsFor(process.argv.slice(2));
  const samples = path.resolve(options.samples), out = path.resolve(options.out);
  const palette = await loadPalette(options['palette-file']);
  const sizes = JSON.parse(await fs.readFile(path.join(samples, 'sizes.json'), 'utf8').catch(() => '{}'));
  await fs.rm(out, { recursive: true, force: true });
  await fs.mkdir(path.join(out, 'comparisons'), { recursive: true });
  const names = (await fs.readdir(samples)).filter(name => name.endsWith('.png')).map(name => name.replace(/\.png$/, '')).sort();
  const report = {};
  for (const name of names) {
    const input = path.join(samples, name + '.png');
    const meta = await sharp(input).metadata();
    const full = `${meta.width}x${meta.height}`, game = sizes[name];
    const beforeFull = await decode(run(input, path.join(out, 'work', name, 'before-full'), ['--size', full, '--background', 'chroma', '--key', '#fd02fd', '--keyer', 'classic', '--sampler', 'center', '--palette', '96', '--cleanup', 'off']));
    const afterFull = await decode(run(input, path.join(out, 'work', name, 'after-full'), ['--size', full, '--background', 'chroma', '--key', '#fd02fd', '--crop']));
    const row = { beforeFull: metricsOf(beforeFull.data, beforeFull.width, beforeFull.height), afterFull: metricsOf(afterFull.data, afterFull.width, afterFull.height) };
    await fs.writeFile(path.join(out, 'comparisons', `key_${name}.png`), await sideBySide(await onBackground(edgeWindow(beforeFull), [24, 28, 30], 4), await onBackground(edgeWindow(afterFull), [24, 28, 30], 4)));
    if (game) {
      const beforeGame = await decode(run(input, path.join(out, 'work', name, 'before-game'), ['--size', game, '--background', 'chroma', '--key', '#fd02fd', '--keyer', 'classic', '--sampler', 'center', '--palette', '96', '--cleanup', 'off']));
      const afterGame = await decode(run(input, path.join(out, 'work', name, 'after-game'), ['--size', game, '--background', 'chroma', '--key', '#fd02fd', '--crop']));
      row.beforeGame = metricsOf(beforeGame.data, beforeGame.width, beforeGame.height);
      row.afterGame = metricsOf(afterGame.data, afterGame.width, afterGame.height, palette ?? undefined);
      const scale = Math.max(4, Math.min(10, Math.floor(360 / Math.max(afterGame.height, 1))));
      await fs.writeFile(path.join(out, 'comparisons', `pix_${name}.png`), await sideBySide(await onBackground(beforeGame, [24, 28, 30], scale), await onBackground(afterGame, [24, 28, 30], scale)));
      if (palette) {
        const locked = await decode(run(input, path.join(out, 'work', name, 'palette'), ['--size', game, '--background', 'chroma', '--key', '#fd02fd', '--crop', '--palette-file', path.resolve(options['palette-file'])]));
        row.sharedPalette = metricsOf(locked.data, locked.width, locked.height, palette);
      }
    }
    report[name] = row;
    console.log(name, JSON.stringify(row));
  }
  await fs.writeFile(path.join(out, 'metrics.json'), JSON.stringify(report, null, 2) + '\n');
  return { ok: true, samples: names, out };
}

main().then(value => process.stdout.write(JSON.stringify(value) + '\n')).catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
