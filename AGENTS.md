# Pixel Asset Pipeline Skill

Keep the skill folder independently installable. A copied skill must not depend on files outside its directory.

- `skills/pixel-asset-pipeline/SKILL.md` is the agent entry point. Keep instructions and capability claims aligned with executable behavior.
- The skill's `scripts/pixel_local.mjs` runs independent algorithms. Its `scripts/pixel_studio.py` is a client for an existing service.
- Preserve source provenance and upstream notices. Do not add model weights, user artwork, credentials or bundled native dependencies.
- Preserve complete frames, padding, hard alpha and single-pass completion guards. Do not replace grid sampling with smooth resizing or recursively refine outputs.
- Test actual PNGs, structural invariants and job recovery. Service tests stay isolated; no paid generation or implicit production changes.
- Terrain guidance remains reference-only until seam checking, rule generation and engine export are implemented and tested.

Use root package scripts and the Python unittest suite. Commit each completed logical change as a self-contained unit.
