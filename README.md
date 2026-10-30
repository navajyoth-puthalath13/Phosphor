# Screen Quality

See how your interface reproduces on the displays your users actually have.
Screen Quality models the *limitations* of a target display — luminance, contrast, gamut, tone response,
white point, bit depth, chroma — and shows the result on yours. It is not a vintage filter.

![Contact sheet](docs/contact-sheet.png)

## Requirements

Node ≥ 22.18 (runs TypeScript directly). Display detection needs macOS + Xcode Command Line Tools.

```bash
npm install
npm test
```

## Use

```bash
native/macos-helper/build.sh                        # macOS: build the display helper
node apps/cli/screen-quality.ts detect              # what is known — and unknown — about your display
node apps/cli/screen-quality.ts profiles            # list target displays
node apps/cli/screen-quality.ts simulate shot.png -t budget-tn -o out.png --viewer-nits 400
```

`simulate` options: `--mode absolute|adapted`, `--only gamut,contrast`, `--disable luminance`.
Export screenshots as sRGB.

## Docs

- [docs/display-model.md](docs/display-model.md) — the colour model, stage by stage, and what is not modelled
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — layout, decisions, milestone status

## Development

Project skills live in `.claude/skills/` (Ponytail, addyosmani/agent-skills, Graphify). Graphify's CLI is
installed separately: `uv tool install graphifyy`.
