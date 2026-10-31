// Turns the raw macOS helper report into Source Display Profiles with provenance on every value.
// Precedence: OS > ICC > EDID for each field; anything none of them states stays `unknown`.

import {
  SCHEMA_VERSION, unknown, type Sourced, type SourceDisplayProfile,
} from '../../packages/profile-schema/index.ts';
import { parseEdid, type Edid } from './edid.ts';
import { parseIcc, type IccInfo } from '../../packages/icc/index.ts';

/** Exact JSON contract of native/macos-helper/main.swift. */
export interface HelperReport {
  helper: string;
  helperVersion: string;
  macOS: string;
  displays: HelperDisplay[];
  edidsBase64: string[];
}
export interface HelperDisplay {
  id: number; main: boolean; builtIn: boolean;
  vendor: number; model: number; serial: number;
  name?: string;
  pixels?: { width: number; height: number };
  points?: { width: number; height: number };
  refreshHz?: number;
  mm?: { width: number; height: number };
  colourSpaceName?: string;
  iccBase64?: string;
  bitsPerSample?: number;
  edrMaxPotential?: number;
}

const s = <T>(value: T, source: Sourced<T>['source'], confidence: Sourced<T>['confidence'], unit?: string, note?: string): Sourced<T> =>
  ({ value, source, confidence, ...(unit && { unit }), ...(note && { note }) });

// CGDisplayVendorNumber uses the EDID manufacturer encoding: three 5-bit letters.
export const pnpFromVendor = (v: number) => [10, 5, 0].map(sh => String.fromCharCode(64 + ((v >> sh) & 31))).join('');

export function buildSourceProfiles(report: HelperReport, now = new Date()): SourceDisplayProfile[] {
  const edids: Edid[] = [];
  const globalWarnings: string[] = [];
  for (const b64 of report.edidsBase64) {
    try { edids.push(parseEdid(Buffer.from(b64, 'base64'))); }
    catch (e) { globalWarnings.push(`ignored unreadable EDID: ${(e as Error).message}`); }
  }
  return report.displays.map(d => buildOne(d, edids, report, globalWarnings, now));
}

function buildOne(d: HelperDisplay, edids: Edid[], r: HelperReport, globalWarnings: string[], now: Date): SourceDisplayProfile {
  const warnings = [...globalWarnings];

  const candidates = edids.filter(e => e.manufacturerId === d.vendor && e.productCode === d.model);
  const edid = candidates.find(e => d.serial && e.serialNumber === d.serial) ?? (candidates.length === 1 ? candidates[0] : undefined);
  if (!edid) warnings.push(candidates.length > 1
    ? 'several identical monitors connected and serials do not disambiguate; EDID not used'
    : d.builtIn ? 'no EDID exposed (normal for built-in Apple panels)' : 'no matching EDID found in the IORegistry');

  let icc: IccInfo | null = null;
  if (d.iccBase64) {
    try { icc = parseIcc(Buffer.from(d.iccBase64, 'base64')); }
    catch (e) { warnings.push(`ICC profile unreadable: ${(e as Error).message}`); }
  }
  if (icc && !icc.primaries) warnings.push('ICC profile is not matrix/TRC; gamut not derived from it');
  if (icc?.trcsDiffer) warnings.push('ICC per-channel tone curves differ; reporting the green channel');

  const iccNote = 'from the active ICC profile — a calibration result or a vendor default, not a live measurement';
  const edidNote = 'nominal value written by the manufacturer into EDID, not a measurement of this unit';

  const pick = <T>(iccV: T | null | undefined, edidV: T | null | undefined, unit: string | undefined, missing: string): Sourced<T> =>
    iccV != null ? s(iccV, 'icc', 'medium', unit, iccNote)
      : edidV != null ? s(edidV, 'edid', 'low', unit, edidNote)
        : unknown<T>(missing, unit);

  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'source',
    identity: {
      displayId: d.id,
      name: d.name ? s(d.name, 'os', 'high') : edid?.name ? s(edid.name, 'edid', 'high') : unknown('no name reported'),
      manufacturerPnpId: d.vendor ? s(pnpFromVendor(d.vendor), 'os', 'high') : unknown('vendor not reported'),
      productCode: d.model ? s(d.model, 'os', 'high') : unknown('model not reported'),
      serialNumber: d.serial ? s(d.serial, 'os', 'high') : unknown('serial not reported'),
      builtIn: d.builtIn,
      main: d.main,
      manufactureYear: edid?.manufactureYear ? s(edid.manufactureYear, 'edid', 'high') : unknown('only available from EDID'),
    },
    geometry: {
      pixels: d.pixels ?? { width: 0, height: 0 },
      points: d.points ?? { width: 0, height: 0 },
      physicalSizeMm: d.mm ? s(d.mm, 'os', 'medium', 'mm', 'reported by macOS (itself derived from EDID or panel data)')
        : edid?.imageSizeMm ? s(edid.imageSizeMm, 'edid', 'medium', 'mm') : unknown('not reported', 'mm'),
      refreshRateHz: d.refreshHz ? s(d.refreshHz, 'os', 'high', 'Hz') : unknown('macOS reports 0 for this mode', 'Hz'),
    },
    colourProfile: icc && {
      description: icc.description,
      iccVersion: icc.version,
      deviceClass: icc.deviceClass,
      colourSpace: icc.colourSpace,
      osColourSpaceName: d.colourSpaceName ?? null,
    },
    characteristics: {
      luminance: icc?.luminance != null
        ? s(icc.luminance, 'icc', 'low', 'cd/m²', "'lumi' tag in the ICC profile; the backlight setting may differ now")
        : unknown('physical luminance cannot be read by software; measure with a colorimeter or enter it manually', 'cd/m²'),
      contrastRatio: unknown('black level is not reported by any OS API; measure or enter manually', ':1'),
      gamut: pick(icc?.primaries, edid?.primaries, 'CIE 1931 xy', 'neither ICC nor EDID describe primaries'),
      toneResponse: pick(icc?.toneResponse, edid?.gamma != null ? { type: 'gamma' as const, gamma: edid.gamma } : null, undefined, 'no tone curve available'),
      whitePoint: pick(icc?.whitePoint, edid?.whitePoint, 'CIE 1931 xy', 'no white point available'),
      framebufferBitsPerComponent: d.bitsPerSample ? s(d.bitsPerSample, 'os', 'high', 'bits', 'what macOS renders into, not what the panel resolves') : unknown('not reported', 'bits'),
      interfaceBitsPerComponent: edid?.interfaceBitsPerComponent ? s(edid.interfaceBitsPerComponent, 'edid', 'medium', 'bits', 'link bit depth declared in EDID 1.4') : unknown('requires EDID 1.4 from a digital display', 'bits'),
      panelBitsPerComponent: unknown('no OS API exposes panel bit depth (6-bit+FRC panels advertise 8-bit); use the datasheet', 'bits'),
      chroma: unknown('picture-mode saturation lives in the monitor OSD and is invisible to the computer'),
      edrHeadroom: d.edrMaxPotential ? s(d.edrMaxPotential, 'os', 'high', '× SDR white') : unknown('not reported'),
    },
    detection: {
      tool: `${r.helper} ${r.helperVersion}`,
      platform: `macOS ${r.macOS}`,
      timestamp: now.toISOString(),
      warnings,
    },
  };
}
