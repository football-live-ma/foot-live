// Trouve les logos des équipes qu'ESPN n'a pas (CAF surtout) et les écrit dans logos.json :
// { "Nom affiché dans l'app": "https://...png" }. Source : FotMob, secours TheSportsDB.
// Lancé automatiquement par GitHub Actions.
import { readFile, writeFile } from 'node:fs/promises';

const UA = 'Mozilla/5.0 (FootLive; https://github.com/football-live-ma/foot-live)';
const OUT = new URL('../../logos.json', import.meta.url);
const BOTOLA = new URL('../../botola.json', import.meta.url);
const TSDB = 'https://www.thesportsdb.com/api/v1/json/123/';
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MAX_NEW = 120; // équipes recherchées par exécution
const fotmobLogo = id => `https://images.fotmob.com/image_resources/logo/teamlogo/${id}.png`;

// Noms différents entre ESPN / TheSportsDB et FotMob
const ALIAS = {
  'Maghreb As De Fès': 'Maghreb Fes', 'MAS Fez': 'Maghreb Fes',
  'RSB Berkane': 'RS Berkane', 'Renaissance Berkane': 'RS Berkane',
  'Colombe Sportiv Du Dja Et Lobo': 'Colombe du Dja et Lobo',
  'Esperance Sportive de Tunis': 'Esperance Tunis',
  'Petro de Luanda': 'Petro Atletico', 'Scottland Mabvuku': 'Scottland FC',
};

async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  const t = await r.text();
  if (!r.ok || /^error code/i.test(t)) throw new Error(`HTTP ${r.status}`);
  return JSON.parse(t);
}

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ');
const GENERIC = new Set('club sportif sportive sport sports fc sc cd ac as cs ud de du des la le les et of the football united city association associacao athletic atletico olympique olympic real union stade'.split(' '));
const keyWords = n => norm(n).split(/\s+/).filter(w => w.length >= 3 && !GENERIC.has(w));

// strict = le nom trouvé doit partager un mot important avec le nom cherché (évite les faux logos)
async function fotmob(q, original) {
  const d = await get(`https://www.fotmob.com/api/data/search/suggest?term=${encodeURIComponent(q)}&lang=en`);
  const teams = (d[0]?.suggestions || []).filter(s => s.type === 'team');
  const want = keyWords(original);
  const team = teams.find(t => !want.length || keyWords(t.name).some(w => want.some(x => x === w || (x.length >= 5 && (x.startsWith(w) || w.startsWith(x))))));
  return team ? fotmobLogo(team.id) : '';
}
async function tsdb(q) {
  const t = ((await get(`${TSDB}searchteams.php?t=${encodeURIComponent(q)}`)).teams || [])
    .find(x => x.strSport === 'Soccer' && (x.strBadge || x.strTeamBadge));
  return t ? (t.strBadge || t.strTeamBadge) : '';
}

// 1. Équipes à couvrir : CAF (ESPN, sans logos), Botola (TheSportsDB + botola.json)
const names = new Set();
const y = new Date().getUTCFullYear();
for (const slug of ['caf.champions', 'caf.confed'])
  for (const yy of [y - 1, y, y + 1]) {
    try {
      const d = await get(`${ESPN}${slug}/scoreboard?dates=${yy}&limit=1000`);
      for (const e of d.events || []) for (const c of (e.competitions?.[0]?.competitors || [])) names.add(c.team.displayName);
    } catch (e) { console.warn('ESPN', slug, yy, e.message); }
  }
let botolaLogos = {};
try { for (const r of JSON.parse(await readFile(BOTOLA, 'utf8')).rows || []) if (r.b) botolaLogos[r.n] = r.b; } catch {}
try {
  const d = await get(`${TSDB}eventsnextleague.php?id=4520`);
  for (const e of d.events || []) { names.add(e.strHomeTeam); names.add(e.strAwayTeam); }
} catch (e) { console.warn('TheSportsDB', e.message); }

// 2. Recherche
let logos = {};
try { logos = JSON.parse(await readFile(OUT, 'utf8')); } catch {}
Object.assign(logos, botolaLogos);
const variants = n => [...new Set([ALIAS[n], n,
  n.replace(/\b(FC|SC|AC|AS|CF|CS|RSB|Club|Sportiv|Sporting)\b\.?/gi, ' ').replace(/[.]/g, ' ').replace(/\s+/g, ' ').trim(),
  ...keyWords(n).sort((a, b) => b.length - a.length).slice(0, 2)])]
  .filter(v => v && v.length > 2 && !/^TBD/i.test(n));

let tried = 0, found = 0, tsdbOk = true;
for (const n of [...names].filter(Boolean).sort()) {
  if (logos[n] || tried >= MAX_NEW) continue;
  tried++;
  let url = '';
  for (const v of variants(n)) {
    try { url = await fotmob(v, n); } catch (e) { console.warn('FotMob', n, e.message); }
    await sleep(800);
    if (url) break;
  }
  if (!url && tsdbOk) {
    try { url = await tsdb(ALIAS[n] || n); } catch (e) { console.warn('TheSportsDB', n, e.message); tsdbOk = false; }
    await sleep(3000);
  }
  if (url) { logos[n] = url; found++; }
}

const sorted = Object.fromEntries(Object.entries(logos).filter(([, v]) => v).sort());
await writeFile(OUT, JSON.stringify(sorted, null, 1) + '\n');
const missing = [...names].filter(n => n && !sorted[n]);
console.log(`logos.json : ${Object.keys(sorted).length} logos (+${found}), ${missing.length} manquants${missing.length ? ' : ' + missing.join(', ') : ''}`);
