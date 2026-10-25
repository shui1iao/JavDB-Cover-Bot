// Category presentation only. Actor/title/code formatting intentionally stays separate.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const bytes = readFileSync(new URL('./category-policy.v2.json', import.meta.url));
export const CATEGORY_POLICY_SHA256 = '0ed52ba0ce3b0f21e54591aa5f5c4768bcbf90ce76690e92b5d3421a8fb5a0c3';
if (createHash('sha256').update(bytes).digest('hex') !== CATEGORY_POLICY_SHA256) {
  throw new Error('Category policy hash mismatch');
}
export const categoryPolicy = JSON.parse(bytes);
const categories = new Map(categoryPolicy.categories.map(category => [category.canonical_id, category]));
const dropped = new Set(categoryPolicy.drop.map(category => category.raw_name));

export function normalizeCategoryTags(tags = []) {
  const result = [];
  for (const value of tags) {
    if (!value) continue;
    const raw = String(value).trim();
    if (!raw || dropped.has(raw)) continue;
    // Only exact, approved raw members are semantic inputs; never search aliases.
    const id = categoryPolicy.raw_to_canonical_id[raw];
    const label = categories.get(id)?.original_label ?? raw;
    if (!result.includes(label)) result.push(label);
  }
  return result;
}

export function categoryHashTag(label = '') {
  const raw = String(label).trim();
  const id = categoryPolicy.raw_to_canonical_id[raw];
  // Shared unicode-LMN-underscore-v1 codec, also keeping unknown label glyphs.
  const token = categories.get(id)?.hashtag_token
    ?? raw.replace(/[^\p{L}\p{M}\p{N}_]+/gu, '_').replace(/^_+|_+$/g, '');
  return token ? `#${token}` : '';
}
