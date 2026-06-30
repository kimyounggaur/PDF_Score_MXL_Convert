# Eval Harness

Add five regression cases under `eval/dataset`:

- `vector1/input.pdf` plus `ground_truth.musicxml`
- `scan_clean1/input.pdf` plus `ground_truth.musicxml`
- `scan_clean2/input.pdf` plus `ground_truth.musicxml`
- `lyrics_chords1/input.pdf` plus `ground_truth.musicxml`
- `polyphony1/input.pdf` plus `ground_truth.musicxml`

Run:

```bash
npm run eval
```

The current harness records the dataset shape and baseline file. Plug in MV2H, TEDn, and MusicDiff wrappers in `eval/metrics` when those external tools are installed.
