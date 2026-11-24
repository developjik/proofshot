import type { SceneSpec, SceneStep } from './types';
import { normalizeRoute } from './util';

/** One bounded grammar for JSON config and direct API callers. No scripts/eval. */
export function normalizeScenes(value: unknown): SceneSpec[] {
  if (!Array.isArray(value)) throw new Error('proofshot: scenes must be an array');
  const names = new Set<string>();
  return value.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('proofshot: each scene must be an object');
    const scene = raw as Record<string, unknown>;
    if (typeof scene.name !== 'string' || !scene.name.trim() || names.has(scene.name)) throw new Error('proofshot: scene names must be non-empty and unique');
    names.add(scene.name);
    if (typeof scene.route !== 'string' || !scene.route.trim()) throw new Error('proofshot: scene route must be a non-empty local route');
    if (/^[a-z]+:|^\/\/|\\/i.test(scene.route)) throw new Error('proofshot: scene route must be a local path');
    if (!Array.isArray(scene.steps) || scene.steps.length > 100) throw new Error('proofshot: scene steps must be an array of at most 100 actions');
    const steps: SceneStep[] = scene.steps.map((rawStep: unknown) => {
      if (!rawStep || typeof rawStep !== 'object' || Array.isArray(rawStep)) throw new Error('proofshot: invalid scene step');
      const step = rawStep as Record<string, unknown>;
      if (!['click', 'fill', 'press', 'wait'].includes(step.action as string)) throw new Error('proofshot: scene step action must be click, fill, press, or wait');
      const selector = typeof step.selector === 'string' && step.selector.trim() ? step.selector : undefined;
      const text = typeof step.text === 'string' && step.text.trim() ? step.text : undefined;
      if ((!selector && !text) || (selector && text)) throw new Error('proofshot: each scene step needs exactly one selector or text');
      if ((step.action === 'fill' || step.action === 'press') && typeof step.value !== 'string') throw new Error('proofshot: fill/press steps need a string value');
      if (step.timeoutMs !== undefined && (typeof step.timeoutMs !== 'number' || !Number.isFinite(step.timeoutMs) || step.timeoutMs <= 0 || step.timeoutMs > 30000)) throw new Error('proofshot: scene timeoutMs must be between 1 and 30000');
      return { action: step.action as SceneStep['action'], ...(selector ? { selector } : { text }), ...(typeof step.value === 'string' ? { value: step.value } : {}), ...(typeof step.timeoutMs === 'number' ? { timeoutMs: step.timeoutMs } : {}) };
    });
    if (scene.expect !== undefined && (typeof scene.expect !== 'string' || !scene.expect.trim())) throw new Error('proofshot: scene expect must be a non-empty selector');
    return { name: scene.name, route: normalizeRoute(scene.route), steps, ...(typeof scene.expect === 'string' ? { expect: scene.expect } : {}) };
  });
}
