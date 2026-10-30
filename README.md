# Screen Quality

See how your interface reproduces on the displays your users actually have.
Screen Quality models the *limitations* of a target display — luminance, contrast, gamut, tone response,
white point, bit depth, chroma — and shows the result on yours. It is not a vintage filter.

![Contact sheet](docs/contact-sheet.png)

## Install

Requires Node ≥ 22.18. Display detection additionally needs macOS with Xcode Command Line Tools
(`xcode-select --install`). Homebrew packaging is a later milestone; until then install from GitHub:

```bash
npm install -g github:navajyoth-puthalath13/Phosphor
```

On macOS, build the native display helper once:

```bash
(cd "$(npm root -g)/screen-quality/native/macos-helper" && ./build.sh)
```

## Use

```bash
screen-quality detect                    # what is known — and unknown — about your displays
screen-quality detect --json             # the full Source Display Profile
screen-quality profiles                  # list target displays
screen-quality simulate shot.png -t budget-tn -o out.png --viewer-nits 400
```

`simulate` options: `--mode absolute|adapted`, `--only gamut,contrast`, `--disable luminance`.
Effects: `luminance, contrast, gamut, gamma, whitePoint, bitDepth, chroma`.

- Export screenshots as **sRGB** (Chrome: DevTools → ⌘⇧P → "Capture screenshot" is sRGB-tagged on most setups).
- `--viewer-nits` is the brightness of the display you are looking at. Without it, brightness differences are
  not simulated (software cannot read it); everything else still is.

## Develop

```bash
git clone https://github.com/navajyoth-puthalath13/Phosphor && cd Phosphor
npm install          # also builds dist/
npm test             # unit + CLI smoke tests
npm run sq -- profiles   # run the CLI from source, no build needed
```

## Docs

- [docs/display-model.md](docs/display-model.md) — the colour model, stage by stage, and what is not modelled
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — layout, decisions, milestone status

## Development

Project skills live in `.claude/skills/` (Ponytail, addyosmani/agent-skills, Graphify). Graphify's CLI is
installed separately: `uv tool install graphifyy`.
