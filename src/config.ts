// Shared config helpers. Used by the Electron app AND the plain-node scripts,
// so this file must not import electron.
import * as fs from 'node:fs';
import * as path from 'node:path';

export const DEFAULT_PORT = 47821;

// Keep in sync with resolvePort in scripts/hooks-spec.js (duplicated so the
// plain-JS scripts don't depend on the TypeScript sources).
export function resolvePort(env: NodeJS.ProcessEnv = process.env): number {
  const p = parseInt(env.CLAUDE_PET_PORT || '', 10);
  return Number.isInteger(p) && p > 0 && p < 65536 ? p : DEFAULT_PORT;
}

export interface PetConfig {
  form: string;
  scale: number;
  wander: WanderMode;
  chime: ChimeLevel;
  /** how many pet copies are on screen (1-4) */
  petCount: number;
  /** saved positions of the clone windows (index 0 = second pet) */
  extraPositions: Array<{ x: number; y: number } | null>;
  /** null means "default corner" */
  position: { x: number; y: number } | null;
  /** path prefix; sessions outside it are ignored */
  projectFilter: string | null;
  /** renderer palette override, e.g. { body: '#d97757' } */
  palette: Partial<PetPalette> | null;
}

const DEFAULTS: PetConfig = {
  form: 'claude',
  scale: 1,
  wander: 'off',
  chime: 'off',
  petCount: 1,
  extraPositions: [],
  position: null,
  projectFilter: null,
  palette: null,
};

export class ConfigStore {
  private file: string;
  private data: PetConfig;

  constructor(dir: string) {
    this.file = path.join(dir, 'config.json');
    this.data = { ...DEFAULTS };
    try {
      Object.assign(this.data, JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch {
      /* first run or corrupt file — defaults win */
    }
    // migrate the pre-adventure boolean wander setting
    const w = this.data.wander as unknown;
    if (typeof w === 'boolean') this.data.wander = w ? 'drift' : 'off';
    // migrate the pre-volume boolean chime setting
    const c = this.data.chime as unknown;
    if (typeof c === 'boolean') this.data.chime = c ? 'normal' : 'off';
  }

  get<K extends keyof PetConfig>(key: K): PetConfig[K] {
    return this.data[key];
  }

  set<K extends keyof PetConfig>(key: K, value: PetConfig[K]): void {
    this.data[key] = value;
    this.save();
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2) + '\n');
      fs.renameSync(tmp, this.file);
    } catch {
      /* cosmetic app — never crash over prefs */
    }
  }
}
