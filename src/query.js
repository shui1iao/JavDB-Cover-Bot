import { queryJav321 } from './jav321.js';
const q = process.argv.slice(2).join(' ');
try {
  const r = await queryJav321(q);
  console.log(JSON.stringify({ code: r.code, title: r.detail?.rawTitle, cover: r.cover, caption: r.caption }, null, 2));
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
}
