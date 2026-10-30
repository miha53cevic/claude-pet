import claude from './claude.js';
import clawd from './clawd.js';
import blob from './blob.js';
import ghost from './ghost.js';

const FORMS: Record<string, PetForm> = { claude, clawd, blob, ghost };

export function getForm(name: string): PetForm {
  return FORMS[name] || claude;
}
