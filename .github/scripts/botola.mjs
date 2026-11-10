// Classement complet de la Botola Pro -> botola.json (lu par l'application).
// Source principale : FotMob (à jour, avec logos). Secours : Wikipédia (modèle "Sports table").
// Lancé automatiquement par GitHub Actions.
import { readFile, writeFile } from 'node:fs/promises';

const UA = 'Mozilla/5.0 (FootLive; https://github.com/football-live-ma/foot-live)';
const OUT = new URL('../../botola.json', import.meta.url);
const FOTMOB_LEAGUE = 530; // Botola Pro
const logoUrl = id => `https://images.fotmob.com/image_resources/logo/teamlogo/${id}.png`;

async function fromFotmob() {
  const r = await fetch(`https://www.fotmob.com/api/data/leagues?id=${FOTMOB_LEAGUE}`, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`FotMob HTTP ${r.status}`);
  const d = await r.json();
  const find = o => {
    if (!o || typeof o !== 'object') return null;
    if (Array.isArray(o.all) && o.all[0] && o.all[0].pts !== undefined) return o.all;
    for (const k in o) { const x = find(o[k]); if (x) return x; }
    return null;
  };
  const t = find(d);
  if (!t || t.length < 8) throw new Error('FotMob : tableau introuvable');
  const rows = t.sort((a, b) => a.idx - b.idx).map(x => {
    const [gf, ga] = String(x.scoresStr || '0-0').split('-').map(n => parseInt(n, 10) || 0);
    return { n: x.name, p: x.played, w: x.wins, d: x.draws, l: x.losses, gf, ga, pts: x.pts, b: logoUrl(x.id) };
  });
  return {
    season: String(d.details?.selectedSeason || '').replace('/', '-'),
    update: new Date().toISOString().slice(0, 10),
    source: `https://www.fotmob.com/leagues/${FOTMOB_LEAGUE}/table`,
    rows,
  };
}

// ---------- Secours : Wikipédia ----------
const clean = s => String(s || '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
  .replace(/\{\{[^}]*\}\}/g, '')
  .replace(/'''?/g, '')
  .trim();

async function fromWikipedia() {
  const d = new Date(), y = d.getUTCFullYear(), start = d.getUTCMonth() >= 6 ? y : y - 1;
  for (const s of [start, start - 1]) {
    const title = `${s}–${String(s + 1).slice(-2)} Botola Pro`;
    const r = await fetch(`https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json&redirects=1`, { headers: { 'User-Agent': UA } });
    if (!r.ok) continue;
    const j = await r.json();
    if (j.error) continue;
    const w = j.parse.wikitext['*'];
    const i = w.search(/\{\{#invoke:\s*Sports table/i);
    if (i < 0) continue;
    const end = w.indexOf('</onlyinclude>', i);
    const t = (end > 0 ? w.slice(i, end) : w.slice(i, i + 20000)).replace(/<!--[\s\S]*?-->/g, '');
    const param = k => { const m = t.match(new RegExp(`\\|\\s*${k}\\s*=((?:\\[\\[[^\\]]*\\]\\]|[^|\\n])*)`)); return m ? m[1].trim() : ''; };
    const order = param('team_order').split(',').map(x => x.trim()).filter(Boolean);
    if (order.length < 8) continue;
    const num = k => parseInt(param(k), 10) || 0;
    const rows = order.map(c => {
      const W = num('win_' + c), D = num('draw_' + c), L = num('loss_' + c);
      return { n: clean(param('name_' + c)) || c, p: W + D + L, w: W, d: D, l: L, gf: num('gf_' + c), ga: num('ga_' + c), pts: 3 * W + D + num('adjust_points_' + c), b: '' };
    });
    const up = Date.parse(param('update') + ' UTC');
    return { season: `${s}-${s + 1}`, update: isNaN(up) ? null : new Date(up).toISOString().slice(0, 10), source: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`, rows };
  }
  throw new Error('Wikipédia : classement introuvable');
}

let old = {};
try { old = JSON.parse(await readFile(OUT, 'utf8')); } catch {}

let data = null;
for (const src of [fromFotmob, fromWikipedia]) {
  try { data = await src(); break; } catch (e) { console.warn(e.message); }
}
if (!data) { console.error('Aucune source disponible : botola.json inchangé'); process.exit(0); }

// ne pas réécrire le fichier si seul le jour de mise à jour change
const same = JSON.stringify(old.rows) === JSON.stringify(data.rows);
if (same) { console.log('Classement inchangé'); process.exit(0); }
await writeFile(OUT, JSON.stringify(data, null, 1) + '\n');
console.log(`botola.json : ${data.rows.length} équipes (${data.source})`);
