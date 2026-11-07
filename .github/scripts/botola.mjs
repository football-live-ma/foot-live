// Récupère le classement complet de la Botola Pro depuis Wikipédia (modèle "Sports table")
// et l'écrit dans botola.json, lu par l'application. Lancé automatiquement par GitHub Actions.
import { readFile, writeFile } from 'node:fs/promises';

const UA = 'FootLive/1.0 (https://github.com/football-live-ma/foot-live)';
const OUT = new URL('../../botola.json', import.meta.url);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function seasons() {
  const d = new Date(), y = d.getUTCFullYear();
  const start = d.getUTCMonth() >= 6 ? y : y - 1;
  return [start, start - 1]; // saison en cours, puis la précédente en secours
}

async function wikitext(title) {
  const u = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json&redirects=1`;
  const r = await fetch(u, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`Wikipedia HTTP ${r.status}`);
  const d = await r.json();
  if (d.error) return null;
  return d.parse.wikitext['*'];
}

const clean = s => String(s || '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
  .replace(/\{\{[^}]*\}\}/g, '')
  .replace(/'''?/g, '')
  .trim();

function parseTable(w) {
  const i = w.search(/\{\{#invoke:\s*Sports table/i);
  if (i < 0) return null;
  const end = w.indexOf('</onlyinclude>', i);
  const t = (end > 0 ? w.slice(i, end) : w.slice(i, i + 20000)).replace(/<!--[\s\S]*?-->/g, '');
  // valeur d'un paramètre "|cle=valeur", en gardant les liens [[a|b]] intacts
  const param = k => {
    const m = t.match(new RegExp(`\\|\\s*${k}\\s*=((?:\\[\\[[^\\]]*\\]\\]|[^|\\n])*)`));
    return m ? m[1].trim() : '';
  };
  const order = param('team_order').split(',').map(s => s.trim()).filter(Boolean);
  if (!order.length) return null;
  const num = k => parseInt(param(k), 10) || 0;
  const rows = order.map(c => {
    const w = num('win_' + c), d = num('draw_' + c), l = num('loss_' + c);
    return {
      code: c,
      n: clean(param('name_' + c)) || c,
      p: w + d + l, w, d, l,
      gf: num('gf_' + c), ga: num('ga_' + c),
      pts: 3 * w + d + num('adjust_points_' + c),
    };
  });
  const up = Date.parse(param('update') + ' UTC');
  return { update: isNaN(up) ? null : new Date(up).toISOString().slice(0, 10), rows };
}

// Logos : on réutilise ceux déjà trouvés, sinon on cherche sur TheSportsDB (lentement, limite gratuite).
async function logo(name) {
  const tries = [...new Set([name, name.replace(/\b(AC|CA|FC|AS|US|SC)\b/g, '').replace(/\s+/g, ' ').trim()])];
  for (const q of tries) {
    try {
      const r = await fetch(`https://www.thesportsdb.com/api/v1/json/123/searchteams.php?t=${encodeURIComponent(q)}`);
      if (r.ok) {
        const t = ((await r.json()).teams || []).find(x => x.strSport === 'Soccer' && /Morocco/i.test(x.strCountry || ''));
        if (t && t.strBadge) return t.strBadge;
      }
    } catch {}
    await sleep(4000);
  }
  return '';
}

let old = {};
try { old = JSON.parse(await readFile(OUT, 'utf8')); } catch {}
const oldLogos = Object.fromEntries((old.rows || []).filter(r => r.b).map(r => [r.n, r.b]));

let res = null, season = '';
for (const y of seasons()) {
  const title = `${y}–${String(y + 1).slice(-2)} Botola Pro`;
  const w = await wikitext(title);
  const t = w && parseTable(w);
  if (t && t.rows.length >= 8) { res = t; season = `${y}-${y + 1}`; res.page = title; break; }
}
if (!res) { console.error('Classement introuvable sur Wikipédia : botola.json inchangé'); process.exit(0); }

for (const r of res.rows) {
  r.b = oldLogos[r.n] || await logo(r.n);
  delete r.code;
}

const data = {
  season,
  update: res.update,
  source: `https://en.wikipedia.org/wiki/${encodeURIComponent(res.page.replace(/ /g, '_'))}`,
  rows: res.rows,
};
if (JSON.stringify(old) === JSON.stringify(data)) { console.log('Aucun changement'); process.exit(0); }
await writeFile(OUT, JSON.stringify(data, null, 1) + '\n');
console.log(`botola.json : ${data.rows.length} équipes, mise à jour Wikipédia du ${data.update}`);
