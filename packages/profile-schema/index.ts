// Shared contract between Engine 1 (detection) and Engine 2 (reproduction).
// Neither engine imports the other; both import only this file.

export const SCHEMA_VERSION = 1;

/** Where a value came from. Spec §7 "Data sources". */
export type Provenance =
  | 'os'                 // directly reported by the operating system
  | 'edid'               // EDID / DisplayID block (manufacturer-written, not measured)
  | 'icc'                // the active ICC profile (a calibration or a vendor default)
  | 'manufacturer-spec'  // published datasheet for the model, not this unit
  | 'measured'           // instrument measurement of this physical unit
  | 'user'               // typed in by the user
  | 'estimated'          // engineering estimate; must carry a note saying why
  | 'unknown';

export type Confidence = 'high' | 'medium' | 'low' | 'none';

/** A characteristic plus how much we trust it. `value` is null when unknown — never guessed. */
export interface Sourced<T> {
  value: T | null;
  unit?: string;
  source: Provenance;
  confidence: Confidence;
  note?: string;
}

export const unknown = <T>(note: string, unit?: string): Sourced<T> =>
  ({ value: null, unit, source: 'unknown', confidence: 'none', note });

/** CIE 1931 xy chromaticity. */
export interface XY { x: number; y: number }
export interface Primaries { red: XY; green: XY; blue: XY }

export type ToneResponse =
  | { type: 'srgb' }                       // IEC 61966-2-1 piecewise curve
  | { type: 'gamma'; gamma: number }       // pure power law
  | { type: 'parametric'; params: number[]; approxGamma: number } // ICC parametricCurveType
  | { type: 'table'; points: number; approxGamma: number }       // sampled ICC curve
  ;

export interface SourceDisplayProfile {
  schemaVersion: typeof SCHEMA_VERSION;
  kind: 'source';
  identity: {
    displayId: number;
    name: Sourced<string>;
    manufacturerPnpId: Sourced<string>;   // 3-letter PNP id, e.g. "DEL"
    productCode: Sourced<number>;
    serialNumber: Sourced<number>;
    builtIn: boolean;
    main: boolean;
    manufactureYear: Sourced<number>;
  };
  geometry: {
    pixels: { width: number; height: number };
    points: { width: number; height: number };
    physicalSizeMm: Sourced<{ width: number; height: number }>;
    refreshRateHz: Sourced<number>;
  };
  colourProfile: null | {
    description: string | null;
    iccVersion: string;
    deviceClass: string;
    colourSpace: string;
    osColourSpaceName: string | null;
  };
  characteristics: {
    luminance: Sourced<number>;           // peak white, cd/m²
    contrastRatio: Sourced<number>;       // white:black, e.g. 1000 means 1000:1
    gamut: Sourced<Primaries>;
    toneResponse: Sourced<ToneResponse>;
    whitePoint: Sourced<XY>;
    framebufferBitsPerComponent: Sourced<number>; // what the OS renders into
    interfaceBitsPerComponent: Sourced<number>;   // what the link carries (EDID)
    panelBitsPerComponent: Sourced<number>;       // what the panel physically resolves
    chroma: Sourced<number>;              // picture-mode saturation gain; not detectable from software
    edrHeadroom: Sourced<number>;         // macOS extended dynamic range (1 = SDR only)
  };
  detection: {
    tool: string;
    platform: string;
    timestamp: string;
    warnings: string[];
  };
}

/** Physical model of a target display. All fields required: a target is a hypothesis, fully stated. */
export interface TargetDisplayProfile {
  schemaVersion: typeof SCHEMA_VERSION;
  kind: 'target';
  id: string;
  name: string;
  technology: 'reference' | 'crt' | 'tn-lcd' | 'ips-lcd' | 'va-lcd' | 'oled' | 'custom';
  backlight?: 'ccfl' | 'w-led' | 'none';
  /** Does the host OS colour-manage content into this display's gamut? Most Windows office setups: no. */
  colourManaged: boolean;
  luminance: Sourced<number>;            // cd/m²
  contrastRatio: Sourced<number>;        // Infinity allowed (ideal black)
  primaries: Sourced<Primaries>;
  whitePoint: Sourced<XY>;
  toneResponse: Sourced<{ type: 'srgb' } | { type: 'gamma'; gamma: number }>;
  bitDepth: Sourced<number>;             // panel bits per component
  dithering: 'none' | 'frc';             // frc = panel uses temporal dithering to fake +2 bits
  chroma: Sourced<number>;               // picture-processing saturation gain, 1 = neutral
  assumptions: string[];
}
