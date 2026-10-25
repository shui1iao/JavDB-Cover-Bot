// Compatibility lookup into the same Python wheel as the website. No JS table.
import { coreSync } from './catalog-core.js';
export function getTrustedChineseActorName(name = '') {
  return coreSync('names', [String(name || '')])[0] || '';
}

// Read-only compatibility view populated from the installed shared artifact.
export const ACTRESS_NAME_FIXES = new Map(coreSync('name-table'));
