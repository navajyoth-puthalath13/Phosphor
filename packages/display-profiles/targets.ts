// Generic target display profiles. These are hypotheses about a *class* of display, not any one unit:
// every value is 'standard' (from a published standard) or 'estimated' with the reason in `note`.
// Display technology is a starting point, not a guarantee — two IPS panels can differ more than IPS vs VA.

import type { Sourced, TargetDisplayProfile, Primaries, XY } from '../profile-schema/index.ts';
import { SRGB, DISPLAY_P3, D65, daylightXY } from '../colour-math/index.ts';

const std = <T>(value: T, note: string, unit?: string): Sourced<T> => ({ value, source: 'standard', confidence: 'high', unit, note });
const est = <T>(value: T, note: string, unit?: string): Sourced<T> => ({ value, source: 'estimated', confidence: 'low', unit, note });

const base = { schemaVersion: 1 as const, kind: 'target' as const };
const nits = 'cd/m²', xy = 'CIE 1931 xy';
const gamma22 = { type: 'gamma' as const, gamma: 2.2 };

// Typical "45% NTSC" W-LED TN laptop/office panel primaries, rounded from common datasheet values.
export const NTSC45: Primaries = { red: { x: 0.58, y: 0.34 }, green: { x: 0.33, y: 0.555 }, blue: { x: 0.155, y: 0.12 } };
export const SMPTE_C: Primaries = { red: { x: 0.63, y: 0.34 }, green: { x: 0.31, y: 0.595 }, blue: { x: 0.155, y: 0.07 } };
const cool = (k: number): XY => daylightXY(k);

export const TARGETS: TargetDisplayProfile[] = [
  {
    ...base, id: 'srgb-reference', name: 'Ideal sRGB display (identity check)', technology: 'reference', colourManaged: false,
    luminance: std(80, 'IEC 61966-2-1 reference display luminance', nits),
    contrastRatio: std(Infinity, 'idealised zero black (the standard\'s flare model is not applied)', ':1'),
    primaries: std(SRGB, 'IEC 61966-2-1', xy),
    whitePoint: std(D65, 'IEC 61966-2-1 (D65)', xy),
    toneResponse: std({ type: 'srgb' as const }, 'IEC 61966-2-1 piecewise curve'),
    bitDepth: std(8, '8 bits per component', 'bits'), dithering: 'none',
    chroma: std(1, 'neutral'),
    assumptions: ['Reproduces the input unchanged when viewed at the same luminance; used to verify the pipeline.'],
  },
  {
    ...base, id: 'office-ips', name: 'Standard office IPS monitor (W-LED)', technology: 'ips-lcd', backlight: 'w-led', colourManaged: false,
    luminance: est(250, 'common datasheet value for 22–24" office IPS monitors', nits),
    contrastRatio: est(1000, 'typical IPS static contrast', ':1'),
    primaries: est(SRGB, 'office IPS panels commonly target ~sRGB with W-LED backlights', xy),
    whitePoint: est(D65, 'assumes the factory 6500 K preset is in use', xy),
    toneResponse: est(gamma22, 'nominal 2.2 target'),
    bitDepth: est(6, 'many office IPS panels are 6-bit + FRC', 'bits'), dithering: 'frc',
    chroma: est(1, 'standard picture mode'),
    assumptions: ['Windows-style unmanaged pipeline: sRGB values are sent to the panel as-is.'],
  },
  {
    ...base, id: 'budget-tn', name: 'Budget office TN LCD (narrow gamut)', technology: 'tn-lcd', backlight: 'w-led', colourManaged: false,
    luminance: est(200, 'budget monitors are specified at 200–250 cd/m²; aged units measure lower', nits),
    contrastRatio: est(600, 'TN panels are specified ~1000:1 but typically measure 500–800:1', ':1'),
    primaries: est(NTSC45, 'typical "45% NTSC" W-LED TN datasheet primaries', xy),
    whitePoint: est(cool(7500), 'budget panels often ship with a cool white; 7500 K daylight locus assumed', xy),
    toneResponse: est(gamma22, 'nominal 2.2; TN gamma also varies with vertical viewing angle (not modelled)'),
    bitDepth: est(6, 'budget TN panels are 6-bit', 'bits'), dithering: 'frc',
    chroma: est(1, 'standard picture mode'),
    assumptions: ['Viewed head-on: TN viewing-angle shifts are not modelled yet.', 'Unmanaged pipeline (no ICC profile in use).'],
  },
  {
    ...base, id: 'older-ccfl-lcd', name: 'Older CCFL office LCD (c. 2005–2010)', technology: 'tn-lcd', backlight: 'ccfl', colourManaged: false,
    luminance: est(180, 'specified ~300 cd/m² when new; CCFL output falls substantially over its life', nits),
    contrastRatio: est(450, 'period TN panels measured roughly 300–600:1', ':1'),
    primaries: est(SMPTE_C, 'CCFL backlights gave roughly sRGB-sized gamuts; SMPTE-C used as the stand-in', xy),
    whitePoint: est(cool(7000), 'aged CCFL whites drift; 7000 K assumed', xy),
    toneResponse: est(gamma22, 'nominal 2.2'),
    bitDepth: est(6, 'many panels of this era were 6-bit, some without FRC', 'bits'), dithering: 'none',
    chroma: est(1, 'standard picture mode'),
    assumptions: ['Represents a tired, uncalibrated unit, not a specific model.', 'No FRC: shows 6-bit banding as the worst case.'],
  },
  {
    ...base, id: 'office-va', name: 'Office VA monitor', technology: 'va-lcd', backlight: 'w-led', colourManaged: false,
    luminance: est(250, 'common VA office monitor specification', nits),
    contrastRatio: est(3000, 'VA static contrast is typically 2500–3000:1', ':1'),
    primaries: est(SRGB, '~sRGB gamut assumed', xy),
    whitePoint: est(D65, 'factory 6500 K preset assumed', xy),
    toneResponse: est(gamma22, 'nominal 2.2 (off-axis gamma shift not modelled)'),
    bitDepth: est(8, 'many VA office panels are 8-bit', 'bits'), dithering: 'none',
    chroma: est(1, 'standard picture mode'),
    assumptions: ['Head-on viewing.'],
  },
  {
    ...base, id: 'oled-wide-unmanaged', name: 'OLED, wide gamut, not colour-managed', technology: 'oled', backlight: 'none', colourManaged: false,
    luminance: est(250, 'full-screen white on OLED monitors is limited by ABL to roughly 200–300 cd/m²', nits),
    contrastRatio: est(1_000_000, 'self-emissive; black is effectively 0 in a dark room', ':1'),
    primaries: est(DISPLAY_P3, 'P3-class gamut typical of OLED panels', xy),
    whitePoint: est(D65, 'D65', xy),
    toneResponse: est(gamma22, 'nominal 2.2'),
    bitDepth: est(10, '10-bit panel', 'bits'), dithering: 'none',
    chroma: est(1, 'standard picture mode'),
    assumptions: ['No OS colour management: sRGB content is stretched to the wide gamut and looks over-saturated.', 'ABL varies with picture content; a fixed full-field value is used.'],
  },
  {
    ...base, id: 'crt-9300k', name: 'CRT computer monitor (9300 K preset)', technology: 'crt', backlight: 'none', colourManaged: false,
    luminance: est(100, 'CRT computer monitors were typically run at 80–120 cd/m²', nits),
    contrastRatio: est(200, 'ANSI (checkerboard) contrast; glass flare limits it far below full-on/off figures', ':1'),
    primaries: est(SMPTE_C, 'P22 phosphors, close to SMPTE-C (SMPTE RP 145)', xy),
    whitePoint: est(cool(9300), 'many PC CRTs shipped with a 9300 K default preset', xy),
    toneResponse: est({ type: 'gamma' as const, gamma: 2.5 }, 'native CRT electro-optical response ≈ 2.35–2.55'),
    bitDepth: est(8, 'analogue input from an 8-bit VGA DAC', 'bits'), dithering: 'none',
    chroma: est(1, 'neutral'),
    assumptions: ['Colorimetry only: scanlines, curvature, convergence and blur are not modelled (decorative without a calibrated optical model).'],
  },
  {
    ...base, id: 'mono-lcd', name: 'Monochrome (black-and-white) LCD', technology: 'ips-lcd', backlight: 'w-led', colourManaged: false, monochrome: true,
    luminance: est(250, 'general-purpose monochrome panels; medical greyscale displays run brighter (not this profile)', nits),
    contrastRatio: est(1000, 'typical IPS static contrast', ':1'),
    primaries: est(SRGB, 'irrelevant once the signal is reduced to one grey value; kept for a well-defined matrix', xy),
    whitePoint: est(D65, '"clear-base" neutral white assumed', xy),
    toneResponse: est(gamma22, 'nominal 2.2; DICOM greyscale (GSDF) calibration is not modelled'),
    bitDepth: est(8, '8-bit grey', 'bits'), dithering: 'none',
    chroma: est(1, 'colour is removed by the monochrome conversion'),
    assumptions: ['Colour is reduced to Rec. 601 luma (0.299 R′ + 0.587 G′ + 0.114 B′), so colours of equal luma become the same grey.'],
  },
  {
    ...base, id: 'e-paper', name: 'E-paper (e-ink) display', technology: 'e-paper', backlight: 'none', colourManaged: false, monochrome: true,
    luminance: est(72, 'reflective: white = illuminance × reflectance / π = 500 lux × ~0.45 / π for office lighting; front light off', nits),
    contrastRatio: est(15, 'e-paper reflectance contrast is typically ~10–20:1', ':1'),
    primaries: est(SRGB, 'irrelevant for a greyscale panel', xy),
    whitePoint: est(cool(5000), 'reflective white takes the colour of the room light; 5000 K office lighting assumed', xy),
    toneResponse: est(gamma22, 'waveform-dependent; nominal 2.2 assumed'),
    bitDepth: est(4, '16 grey levels is typical', 'bits'), dithering: 'none',
    chroma: est(1, 'colour is removed by the monochrome conversion'),
    assumptions: ['Greyscale e-paper (not colour Kaleido panels).', 'Refresh flashing and ghosting are not modelled.', 'Brightness scales with room lighting; 500 lux assumed.'],
  },
  {
    ...base, id: 'plasma', name: 'Plasma display', technology: 'plasma', backlight: 'none', colourManaged: false,
    luminance: est(120, 'full-white luminance is held down by power limiting (ABL), typically ~100–150 cd/m²', nits),
    contrastRatio: est(3000, 'in-room (ANSI-like) contrast; full-on/full-off figures are far higher', ':1'),
    primaries: est(SRGB, 'plasma phosphors are close to Rec. 709 / sRGB', xy),
    whitePoint: est(D65, 'calibrated picture mode assumed', xy),
    toneResponse: est(gamma22, 'nominal 2.2'),
    bitDepth: est(8, '8-bit drive', 'bits'), dithering: 'none',
    chroma: est(1, 'standard picture mode'),
    assumptions: ['ABL depends on picture content; a fixed full-white value is used.', 'Sub-field dithering noise and image retention are not modelled.'],
  },
  {
    ...base, id: 'mini-led', name: 'Mini-LED LCD (wide gamut, colour-managed)', technology: 'ips-lcd', backlight: 'mini-led', colourManaged: true,
    luminance: est(500, 'typical SDR full-screen white for Mini-LED laptops and monitors', nits),
    contrastRatio: est(20000, 'with local dimming on mixed content; full-on/full-off figures are higher', ':1'),
    primaries: est(DISPLAY_P3, 'P3-class quantum-dot or KSF backlight', xy),
    whitePoint: est(D65, 'D65', xy),
    toneResponse: est(gamma22, 'nominal 2.2'),
    bitDepth: est(10, '10-bit panel', 'bits'), dithering: 'none',
    chroma: est(1, 'standard picture mode'),
    assumptions: ['The OS colour-manages it (as macOS does), so sRGB content is not over-saturated.', 'Blooming around bright objects (local-dimming zones) is not modelled.'],
  },
];

export const getTarget = (id: string) => TARGETS.find(t => t.id === id);
