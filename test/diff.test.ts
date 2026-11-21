import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { comparePngs, pngWithRect, solidPng } from "../src/diff";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("comparePngs", () => {
  it("reports zero change for identical captures", () => {
    const image = solidPng(64, 48);
    const result = comparePngs(image, image);
    expect(result.changedPixels).toBe(0);
    expect(result.diffPercent).toBe(0);
    expect(result.sizeMismatch).toBe(false);
    expect(result.totalPixels).toBe(64 * 48);
    expect(result.diffPng.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  });

  it("counts the pixels inside a changed rectangle", () => {
    const before = solidPng(100, 100);
    const after = pngWithRect(100, 100, { x: 0, y: 0, w: 10, h: 10 }, [0, 0, 255, 255]);
    const result = comparePngs(before, after);
    expect(result.changedPixels).toBe(100);
    expect(result.diffPercent).toBeCloseTo(1, 5);
    expect(result.sizeMismatch).toBe(false);
  });

  it("does not flag a colour change below the pixelmatch threshold", () => {
    const before = solidPng(20, 20, [255, 255, 255, 255]);
    const after = solidPng(20, 20, [250, 250, 250, 255]);
    const result = comparePngs(before, after, { threshold: 0.5 });
    expect(result.changedPixels).toBe(0);
  });

  it("pads captures whose height changed with the page background", () => {
    const before = solidPng(40, 40);
    const after = solidPng(40, 80);
    const result = comparePngs(before, after);
    expect(result.sizeMismatch).toBe(true);
    expect(result.before).toEqual({ width: 40, height: 40 });
    expect(result.after).toEqual({ width: 40, height: 80 });
    expect(result.height).toBe(80);
    // The extra area is white, same as the padding, so nothing is marked changed.
    expect(result.changedPixels).toBe(0);
    expect(result.diffPercent).toBe(0);
  });

  it("counts content that appeared below the old fold", () => {
    const before = solidPng(40, 40);
    const after = pngWithRect(40, 80, { x: 0, y: 40, w: 40, h: 40 }, [0, 0, 255, 255]);
    const result = comparePngs(before, after);
    expect(result.sizeMismatch).toBe(true);
    expect(result.changedPixels).toBe(40 * 40);
    expect(result.diffPercent).toBeCloseTo(50, 5);
  });

  it("writes a diff image at the padded size", () => {
    const before = solidPng(30, 30);
    const after = solidPng(30, 60);
    const result = comparePngs(before, after);
    const diff = PNG.sync.read(result.diffPng);
    expect(diff.width).toBe(30);
    expect(diff.height).toBe(60);
  });
});
