# Phosphor

See how your interface reproduces on the displays your users actually have.
Phosphor models the *limitations* of a target display — luminance, contrast, gamut, tone response,
white point, bit depth, chroma — and shows the result on yours. It is not a vintage filter.

![Contact sheet](docs/contact-sheet.png)

## Install (Homebrew, macOS)

```bash
brew tap navajyoth-puthalath13/phosphor https://github.com/navajyoth-puthalath13/Phosphor
brew trust --formula navajyoth-puthalath13/phosphor/phosphor
brew install navajyoth-puthalath13/phosphor/phosphor
```

Homebrew refuses formulas from third-party taps until you trust them; `brew trust` above approves only this
one formula. Read `Formula/phosphor.rb` first if you want to see exactly what it runs.

This builds the CLI and compiles the native display helper (needs Xcode Command Line Tools, which Homebrew
already requires). Check the install with `brew test navajyoth-puthalath13/phosphor/phosphor`; update with `brew upgrade phosphor`;
remove with `brew uninstall phosphor && brew untap navajyoth-puthalath13/phosphor`.

### From source (development)

Requires Node ≥ 22.18.

```bash
git clone https://github.com/navajyoth-puthalath13/Phosphor.git
cd Phosphor          # skip if you are already in the folder
npm install          # installs dependencies and builds dist/
npm link             # puts `phosphor` on your PATH
native/macos-helper/build.sh   # macOS: build the display helper
```

Don't have both installed at once: `npm unlink -g phosphor` before `brew install`.

## Use

```bash
phosphor detect                    # what is known — and unknown — about your displays
phosphor detect --json             # the full Source Display Profile
phosphor profiles                  # list target displays
phosphor simulate shot.png -t budget-tn -o out.png --viewer-nits 400
```

`simulate` options: `--mode absolute|adapted`, `--only gamut,contrast`, `--disable luminance`.
Effects: `luminance, contrast, gamut, gamma, whitePoint, bitDepth, chroma`.

- Screenshots can be taken any way you like: an embedded colour profile (macOS tags screenshots with
  your display's, usually Display P3) is read and the image converted to sRGB first. Untagged PNGs are treated as sRGB.

Quick try on a Mac — capture the screen, then simulate it:

```bash
screencapture -x ~/Desktop/phosphor-test.png
phosphor simulate ~/Desktop/phosphor-test.png -t budget-tn -o ~/Desktop/phosphor-budget-tn.png --viewer-nits 400
open ~/Desktop/phosphor-test.png ~/Desktop/phosphor-budget-tn.png
```
- `--viewer-nits` is the brightness of the display you are looking at. Without it, brightness differences are
  not simulated (software cannot read it); everything else still is.

## Develop

```bash
npm test                 # unit + CLI smoke tests
npm run typecheck
npm run cli -- profiles   # run the CLI from source, no build needed
```

## Docs

- [docs/display-model.md](docs/display-model.md) — the colour model, stage by stage, and what is not modelled
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — layout, decisions, milestone status

## Development

Project skills live in `.claude/skills/` (Ponytail, addyosmani/agent-skills, Graphify). Graphify's CLI is
installed separately: `uv tool install graphifyy`.
