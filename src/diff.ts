import { createRequire } from "node:module";
import type pixelmatchFn from "pixelmatch" with { "resolution-mode": "import" };
import { PNG } from "pngjs";
import { round } from "./util";

/** The published ESM dependency is bundled as CJS during build for all Node20 releases. */
const requireFromHere = createRequire(__filename);
const pixelmatch: typeof pixelmatchFn = requireFromHere("../vendor/pixelmatch.cjs").default;

export interface ImageDiffOptions {
  /** pixelmatch colour-distance threshold (0–1). Default 0.1. */
  threshold?: number;
  includeAntiAliasing?: boolean;
  /** Ignore subtle alpha differences. Default true. */
  alpha?: number;
}

export interface ImageDiffResult {
  width: number;
  height: number;
  before: { width: number; height: number };
  after: { width: number; height: number };
  changedPixels: number;
  totalPixels: number;
  /** 0–1 */
  diffRatio: number;
  /** 0–100, rounded to 3 decimals */
  diffPercent: number;
  sizeMismatch: boolean;
  diffPng: Buffer;
}

/**
 * Compare two PNG buffers and produce the diff image plus a change ratio.
 *
 * When the two captures have different dimensions (a section was added, or a
 * full-page screenshot grew), both are padded onto a common canvas and
 * `sizeMismatch` is set so the report can say why.
 */
export function comparePngs(
  beforeBuffer: Buffer,
  afterBuffer: Buffer,
  options: ImageDiffOptions = {},
): ImageDiffResult {
  const before = PNG.sync.read(beforeBuffer);
  const after = PNG.sync.read(afterBuffer);

  const width = Math.max(before.width, after.width);
  const height = Math.max(before.height, after.height);
  const sizeMismatch =
    before.width !== after.width || before.height !== after.height;

  const canvasA = padTo(before, width, height, 255, 255, 255, 255);
  const canvasB = padTo(after, width, height, 255, 255, 255, 255);
  const diff = new PNG({ width, height });

  const changedPixels = pixelmatch(
    canvasA.data,
    canvasB.data,
    diff.data,
    width,
    height,
    {
      threshold: options.threshold ?? 0.1,
      includeAA: options.includeAntiAliasing ?? false,
      alpha: options.alpha ?? 0.1,
      diffColor: [255, 0, 90],
      aaColor: [255, 214, 0],
    },
  );

  const totalPixels = width * height;
  const diffRatio = totalPixels === 0 ? 0 : changedPixels / totalPixels;

  return {
    width,
    height,
    before: { width: before.width, height: before.height },
    after: { width: after.width, height: after.height },
    changedPixels,
    totalPixels,
    diffRatio,
    diffPercent: round(diffRatio * 100, 3),
    sizeMismatch,
    diffPng: PNG.sync.write(diff),
  };
}

/** A solid PNG, handy for tests and for "no baseline yet" placeholders. */
export function solidPng(
  width: number,
  height: number,
  color: [number, number, number, number] = [255, 255, 255, 255],
): Buffer {
  const png = new PNG({ width, height });
  const [r, g, b, a] = color;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (width * y + x) << 2;
      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = a;
    }
  }
  return PNG.sync.write(png);
}

/** Paint a rectangle onto a solid PNG (for building fixtures deterministically). */
export function pngWithRect(
  width: number,
  height: number,
  rect: { x: number; y: number; w: number; h: number },
  color: [number, number, number, number] = [0, 0, 0, 255],
  background: [number, number, number, number] = [255, 255, 255, 255],
): Buffer {
  const png = new PNG({ width, height });
  const [br, bg, bb, ba] = background;
  const [r, g, b, a] = color;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (width * y + x) << 2;
      const inside =
        x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
      png.data[idx] = inside ? r : br;
      png.data[idx + 1] = inside ? g : bg;
      png.data[idx + 2] = inside ? b : bb;
      png.data[idx + 3] = inside ? a : ba;
    }
  }
  return PNG.sync.write(png);
}

function padTo(
  source: PNG,
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
  a: number,
): PNG {
  if (source.width === width && source.height === height) return source;
  const out = new PNG({ width, height });
  out.data.fill(0);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (width * y + x) << 2;
      const inSource = x < source.width && y < source.height;
      if (inSource) {
        const srcIdx = (source.width * y + x) << 2;
        out.data[idx] = source.data[srcIdx] ?? r;
        out.data[idx + 1] = source.data[srcIdx + 1] ?? g;
        out.data[idx + 2] = source.data[srcIdx + 2] ?? b;
        out.data[idx + 3] = source.data[srcIdx + 3] ?? a;
      } else {
        out.data[idx] = r;
        out.data[idx + 1] = g;
        out.data[idx + 2] = b;
        out.data[idx + 3] = a;
      }
    }
  }
  return out;
}
