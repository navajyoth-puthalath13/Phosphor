# Phosphor

See how your interface reproduces on the displays your users actually have.

A screen you design on (say a MacBook's Display P3 panel) can be far better than the budget office monitor,
old CCFL LCD or CRT your users sit in front of. Phosphor models the **limitations** of a target display —
luminance, contrast, gamut, tone response, white point, bit depth and chroma — and shows the result on yours,
so you can catch labels that vanish, borders that merge and status colours that stop being distinguishable.
It is not a vintage filter: every effect comes from a physical display model, and every value says where it came from.

![The clinical test page reproduced on six target displays](docs/contact-sheet.png)

## Install (Homebrew, macOS)

```bash
brew tap navajyoth-puthalath13/phosphor https://github.com/navajyoth-puthalath13/Phosphor
brew trust --formula navajyoth-puthalath13/phosphor/phosphor
brew install navajyoth-puthalath13/phosphor/phosphor
```

- `brew trust` is required: Homebrew refuses formulas from third-party taps until you approve them. It approves
  only this one formula — read [`Formula/phosphor.rb`](Formula/phosphor.rb) first if you want to see what it runs.
- The install builds the CLI and compiles the native display helper, so it needs **up-to-date Xcode Command Line
  Tools**. If Homebrew says *"Your Command Line Tools are too outdated"*, update them in
  System Settings → General → Software Update, or reinstall them:
  ```bash
  sudo rm -rf /Library/Developer/CommandLineTools
  sudo xcode-select --install
  ```
- Check the install: `brew test navajyoth-puthalath13/phosphor/phosphor`
- Update: `brew update && brew upgrade navajyoth-puthalath13/phosphor/phosphor`
- Remove: `brew uninstall phosphor && brew untap navajyoth-puthalath13/phosphor`

## Use

```bash
phosphor detect                    # what is known — and unknown — about your displays
phosphor detect --json             # the full Source Display Profile
phosphor profiles                  # list target displays
phosphor simulate shot.png -t budget-tn -o out.png --viewer-nits 400
```

Quick try on a Mac — capture the screen, simulate it, compare (flip between the two with the arrow keys in Preview):

```bash
screencapture -x ~/Desktop/phosphor-test.png
phosphor simulate ~/Desktop/phosphor-test.png -t budget-tn -o ~/Desktop/phosphor-budget-tn.png --viewer-nits 400
open ~/Desktop/phosphor-test.png ~/Desktop/phosphor-budget-tn.png
```

**`simulate` options**

| Option | Meaning |
|---|---|
| `-t, --target <id>` | target display (see below) |
| `--viewer-nits N` | brightness of the display *you* are looking at. Software can't read it, so without it brightness differences are not simulated (everything else still is). |
| `--mode absolute\|adapted` | `absolute` (default): the light that would reach your eye side by side. `adapted`: as if your eye had adapted to the target's own white and brightness. |
| `--only a,b` / `--disable a,b` | effects: `luminance, contrast, gamut, gamma, whitePoint, bitDepth, chroma` |

Screenshots may carry a colour profile (macOS tags them with your display's, usually Display P3); Phosphor reads
it and converts the image to sRGB first. Untagged PNGs are treated as sRGB.

**Target displays** — generic classes, not specific models; every value is from a standard or an estimate with its reason in
[`packages/display-profiles/targets.ts`](packages/display-profiles/targets.ts):

| `--target` | Display | Key limitations |
|---|---|---|
| `srgb-reference` | Ideal sRGB display | none — identity check |
| `office-ips` | Standard office IPS (W-LED) | 250 nits, 1000:1 |
| `budget-tn` | Budget office TN LCD | 200 nits, 600:1, ~45% NTSC gamut, cool 7500 K white |
| `older-ccfl-lcd` | Older CCFL office LCD (2005–2010) | 180 nits, 450:1, 6-bit without FRC (banding) |
| `office-va` | Office VA monitor | 250 nits, 3000:1 |
| `oled-wide-unmanaged` | Wide-gamut OLED, not colour-managed | over-saturates sRGB content |
| `crt-9300k` | CRT monitor, 9300 K preset | 100 nits, 200:1, gamma 2.5, bluish white |

**What `detect` reports.** Identity, resolution, refresh rate, colour profile, gamut, tone curve, white point and
framebuffer depth — each tagged with its source (OS, ICC profile, EDID) and confidence. Luminance, contrast,
physical panel bit depth and picture-mode saturation are reported as **unknown**: no software API exposes them,
and Phosphor never guesses.

## What's new

**0.1.0** — first installable release.

- **Renamed** from *Screen Quality* to **Phosphor**: the command is `phosphor`, the formula `phosphor`, the helper `phosphor-helper`.
- **Homebrew formula**: `brew install` builds the CLI and compiles the Swift display helper; `brew test` checks it end to end.
- **Verified on real hardware** (MacBook Air, macOS 27). Fixed on the way:
  - the Swift helper didn't compile (an obsolete AppKit call);
  - the white point of macOS's ICC v2 profiles was corrected twice, showing a D65 panel as ~10,000 K;
  - macOS screenshots are Display P3, not sRGB — they are now converted (error was up to 49/255 per channel).
- **Install fixes**: the CLI printed nothing when installed via npm's symlink, global installs couldn't run
  TypeScript from `node_modules`, and the built file wasn't executable. All covered by tests now.
- **Engine 1 — detection**: EDID and ICC (v2 + v4) parsing, provenance and confidence on every value.
- **Engine 2 — reproduction**: physically ordered colour pipeline, each stage tested against reference values;
  seven generic target profiles.

## How it's built

```
apps/cli/                     the phosphor command (detect · profiles · simulate)
engines/display-detection/    Engine 1: raw display facts → Source Display Profile
engines/display-reproduction/ Engine 2: pixels + target profile → simulated pixels
packages/                     shared: profile schema, colour math, ICC reader, target profiles
native/macos-helper/          Swift helper that reads CoreGraphics, ColorSync and IOKit (EDID)
Formula/phosphor.rb           Homebrew formula
```

The two engines never import each other; both depend only on `packages/`. A code map generated with
[Graphify](https://github.com/Graphify-Labs/graphify) shows that structure — colour clusters are communities,
the colour-math core sits in the middle:

![Phosphor code graph by Graphify](docs/code-graph.png)

Details: [docs/display-model.md](docs/display-model.md) (the colour model, stage by stage, and what is not
modelled) · [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (decisions and milestone status).

## Develop

Requires Node ≥ 22.18 (it runs TypeScript directly).

```bash
git clone https://github.com/navajyoth-puthalath13/Phosphor.git
cd Phosphor
npm install                      # dependencies + builds dist/
npm test                         # 66 unit, real-hardware and CLI tests
npm run typecheck
npm run cli -- profiles          # run the CLI from source
native/macos-helper/build.sh     # macOS: build the display helper
```

To use a source checkout as your `phosphor` command, run `npm link` (and `npm unlink -g phosphor` before
installing with Homebrew, so the two don't clash).

Explore the code graph interactively:

```bash
uv tool install graphifyy
graphify extract . --code-only && graphify cluster-only .
open graphify-out/graph.html
```

Project agent skills live in `.claude/skills/`: Ponytail, addyosmani/agent-skills and Graphify.

## Status

Detection, the reproduction engine, the CLI and the Homebrew install work. Not yet built: the Chrome DevTools
panel, live (non-screenshot) reproduction, and Native Messaging setup. Results show the *likely* degradation for
a class of display — they are visual-testing insights, not a physical measurement or accessibility certification.
