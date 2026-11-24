// Neon Vela — make.fun gta6-01 entry program (Node 22, standard library only).
//
// The game itself lives in game/: a three.js open-world crime game set in Vela City, a golden-hour
// coastal city with four districts, ten story missions, six weapons, a 5-star police dispatch,
// a hireable crew, three street races, three drive-in garages, a synthesized car radio and autosave.
// It is plain static files and loads nothing from the network.
//
// This program packages the entry: it mirrors game/ and screenshots/ into the output directory and
// writes dossier.json with the kit's buildDossier (vendor/makefun-game.ts, kept unchanged).
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts      (the grader uses /output)
// Play locally with `node serve.ts`, then open http://localhost:8080.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoDir = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** Copy one top-level folder of the repository into the output directory, if it exists. */
function mirror(name: string): void {
  const from = join(repoDir, name);
  const to = join(outDir, name);
  mkdirSync(to, { recursive: true });
  if (existsSync(from)) cpSync(from, to, { recursive: true });
}

mkdirSync(outDir, { recursive: true });
mirror('game');
mirror('screenshots');

// dossier.json is what the judge reads. These caps match the scorer's gate (reference/gate.json):
// text_max_bytes trims the source text; the rest make buildDossier refuse an entry the scorer
// would refuse — over 4 screenshots or one over 256 KiB, over 993 entries or 48 MiB under game/,
// or any game/ path longer than 1000 bytes.
const caps = {
  text_max_bytes: 160 * 1024,
  screenshots: { max: 4, max_bytes: 256 * 1024 },
  game_max_files: 993,
  game_max_bytes: 48 * 1024 * 1024,
  game_path_max_bytes: 1000,
};
const dossier = buildDossier(outDir, caps);
writeFileSync(join(outDir, 'dossier.json'), dossier);
console.log(`Neon Vela packaged into ${outDir}: game/, screenshots/, dossier.json`);
