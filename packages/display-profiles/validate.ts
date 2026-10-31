// Validates a target profile coming from outside (an imported or saved custom profile JSON).
// Contrast may be null: JSON cannot hold Infinity, and the engine reads null contrast as an ideal black.

import type { Sourced, TargetDisplayProfile, XY } from '../profile-schema/index.ts';
import { gamutArea } from '../colour-math/index.ts';

const TECH = ['reference', 'crt', 'tn-lcd', 'ips-lcd', 'va-lcd', 'oled', 'custom'];
const SOURCES = ['os', 'edid', 'icc', 'standard', 'manufacturer-spec', 'measured', 'user', 'estimated', 'unknown'];

export function validateTarget(input: unknown): TargetDisplayProfile {
  const errors: string[] = [];
  const o = (input ?? {}) as Record<string, any>;
  const need = (ok: boolean, msg: string) => { if (!ok) errors.push(msg); };
  const num = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
  const sourced = (k: string, check: (v: any) => boolean, what: string, nullable = false) => {
    const s = o[k] as Sourced<unknown> | undefined;
    if (!s || typeof s !== 'object') return errors.push(`${k}: missing`);
    need(SOURCES.includes(s.source as string), `${k}.source: unknown provenance "${s.source}"`);
    need((nullable && s.value == null) || (s.value != null && check(s.value)), `${k}.value: ${what}`);
  };
  const xy = (p: XY) => !!p && num(p.x, 0.0001, 0.9999) && num(p.y, 0.0001, 0.9999) && p.x + p.y <= 1 + 1e-9; // z ≥ 0; spectral primaries (P3, Rec.2020 red) have x + y = 1

  need(o.kind === 'target', 'kind: must be "target"');
  need(typeof o.id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(o.id), 'id: lowercase letters, digits and dashes');
  need(typeof o.name === 'string' && o.name.trim().length > 0 && o.name.length <= 120, 'name: 1–120 characters');
  need(TECH.includes(o.technology), `technology: one of ${TECH.join(', ')}`);
  need(typeof o.colourManaged === 'boolean', 'colourManaged: true or false');
  need(o.dithering === 'none' || o.dithering === 'frc', 'dithering: "none" or "frc"');
  need(Array.isArray(o.assumptions) && o.assumptions.every((a: unknown) => typeof a === 'string'), 'assumptions: list of strings');
  sourced('luminance', v => num(v, 1, 10000), '1–10000 cd/m²');
  sourced('contrastRatio', v => num(v, 1, 1e9), '1–1e9, or null for an ideal black', true);
  sourced('primaries', p => xy(p?.red) && xy(p?.green) && xy(p?.blue) && gamutArea(p) > 0.005, 'three valid xy chromaticities forming a real triangle');
  sourced('whitePoint', xy, 'a valid xy chromaticity');
  sourced('toneResponse', t => t?.type === 'srgb' || (t?.type === 'gamma' && num(t.gamma, 1, 4)), '{"type":"srgb"} or {"type":"gamma","gamma":1–4}');
  sourced('bitDepth', v => Number.isInteger(v) && v >= 4 && v <= 12, 'whole number 4–12');
  sourced('chroma', v => num(v, 0, 3), '0–3');

  if (errors.length) throw new Error(`invalid target profile:\n  - ${errors.join('\n  - ')}`);
  return { ...(o as TargetDisplayProfile), schemaVersion: 1 };
}
