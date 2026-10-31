# Architecture & decisions

```
apps/cli/phosphor.ts                detect · profiles · simulate · setup · doctor · guide · native-host
apps/devtools-extension/            DevTools panel, background worker (native messaging, capture), live layer
engines/display-detection/          Engine 1 — raw facts → SourceDisplayProfile (edid.ts, build-profile.ts)
engines/display-reproduction/       Engine 2 — pixels + TargetDisplayProfile + ViewerContext → pixels (content.ts, stages.ts, pipeline.ts)
packages/profile-schema/            the only contract between the engines (types + provenance)
packages/colour-math/               matrices, Bradford, transfer functions, OKLab — shared, tested against references
packages/icc/                       ICC v2/v4 matrix/TRC reader + PNG iCCP extraction — used by detection and by the CLI's input stage
packages/display-profiles/          generic target profiles, every value sourced
native/macos-helper/main.swift      thin macOS fact dump (CoreGraphics, ColorSync ICC, AppKit, IOKit EDID) → JSON
tests/fixtures/                     littleCMS sRGB ICC, EDID builder, recorded helper report, clinical UI page
```

Dependency rule: engines import `packages/*` only, never each other. Engine 2 never sees a
`SourceDisplayProfile`; the caller reduces it to a `ViewerContext` (viewer white nits, mode).

## Decisions (and where the spec was changed)

1. **Native helper dumps, TypeScript interprets.** The helper is ~100 lines of Swift with no logic beyond
   API calls. All parsing (EDID, ICC), matching EDID↔display, and provenance live in TypeScript, where they
   are unit-tested on any OS. A recorded helper report replays anywhere: `detect --from report.json`.
   Swift over Rust: every API needed is an Apple framework; Rust would add FFI for no gain.
2. **Precedence OS > ICC > EDID**, each tagged. Luminance, contrast, panel bit depth and chroma are
   always `unknown` from software — the report says how to obtain them instead of guessing.
   Framebuffer, interface (EDID) and panel bit depths are three separate fields (spec §15.6).
3. **Own ~100-line colour kernel instead of Culori/Color.js/LittleCMS.** The pipeline needs 3×3 matrices,
   Bradford, sRGB/power curves and OKLab — all short, standard, and verified against published values
   (IEC sRGB matrix, Lindbloom Bradford, Ottosson OKLab, CSS Color 4 P3 sample). LittleCMS is used only as an
   independent writer of the test ICC profile. Revisit if ICC LUT-based (A2B) profiles become necessary.
4. **Stage order follows signal flow**, not the spec's §8.1 list — see `display-model.md`.
5. **FRC is a time-average (+2 bits)**, not spatial noise: a static frame cannot show temporal dithering
   honestly.
6. **Single package, Node ≥ 22.18 runs `.ts` directly** (type stripping): no build step, no bundler.
   Workspaces/separate npm packages can be split out when npm distribution (spec §10) actually happens.
7. **CPU first, memoised per unique colour.** UI screenshots have few unique colours, so this is fast. The
   per-pixel function is deterministic and stateless, so it ports 1:1 to a GLSL shader or a 3D LUT for the
   live DevTools view.

## Status

| Milestone | State |
|---|---|
| 1 Native detection | Verified on a MacBook Air (built-in panel, ICC v2 "Display" profile). External-monitor EDID path not yet run on hardware. |
| 2 Source profile | Done, tested |
| 3 Reproduction engine | Done, tested per stage and end to end |
| 4 Target profiles | 7 generic profiles; custom profiles (panel save/export/import, CLI `--target-file`) with validation. Specific monitor models need datasheet/measured data. |
| 5 DevTools panel | Done; end-to-end check in Chromium (`tests/browser/extension.check.ts`). Not yet tried in a real DevTools window on a Mac. |
| 6 Live reproduction | Done: model compiled to an SVG filter on the root element; 99–100% of pixels within 2/255 of the CPU engine in Chromium. |
| 7 Homebrew + setup | Formula with caveats; `phosphor setup` registers native messaging and guides Load unpacked. Chrome Web Store listing pending. |

## Decisions added in 0.2.0

8. **Live mode = the model compiled to a filter graph**, not an approximation: per-channel tables (quantise + tone
   response, on sRGB-encoded values) and one linearRGB colour matrix (primaries, white, luminance, black, viewer).
   Browsers keep 8 bits between filter primitives, so linear light is never stored between steps.
   Filter on `<html>` (exempt from the fixed-position containing-block rule) with `min-height: 100vh` so short pages
   keep their background inside the filter. Built with DOM APIs for Trusted Types pages; restores the page's own styles.
9. **Fixed extension ID** from a public key in the manifest (no private key exists), so the native host can name it.
10. **Setup copies the extension to `~/Library/Application Support/Phosphor/chrome-extension`** so a Load-unpacked
    install survives `brew upgrade`; the native host wrapper pins Homebrew `opt/` paths for the same reason.

## Next steps

1. Run the panel in a real DevTools window on macOS, and the helper with an external HDMI/DP monitor (EDID path).
2. Publish to the Chrome Web Store (developer account, privacy policy); set `STORE_URL` in `apps/cli/setup.ts`.
   Microsoft Edge Add-ons is a free alternative listing.
3. Specific monitor profiles from datasheets or colorimeter measurements (`manufacturer-spec` / `measured` provenance).
4. Findings (spec §9 E): flag status colours, borders and text whose contrast collapses on the selected target.
