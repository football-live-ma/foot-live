// Trouve les logos des équipes qu'ESPN n'a pas (CAF, Botola) et les écrit dans logos.json :
// { "Nom affiché dans l'app": "https://...png" }. Lancé par GitHub Actions, lentement (limite gratuite TheSportsDB).
import { readFile, writeFile } from 'node:fs/promises';

const OUT = new URL('../../logos.json', import.meta.url);
const BOTOLA = new URL('../../botola.json', import.meta.url);
const TSDB = 'https://www.thesportsdb.com/api/v1/json/123/';
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MAX_LOOKUPS = 90; // par exécution, pour rester sous la limite gratuite

// Noms différents entre ESPN / Wikipédia et TheSportsDB
const ALIAS = {
  'Maghreb As De Fès': 'Maghreb Fes', 'MAS Fez': 'Maghreb Fes',
  'RSB Berkane': 'RS Berkane',
  'Colombe Sportiv Du Dja Et Lobo': 'Colombe du Dja et Lobo',
  'Raja CA': 'Raja Casablanca', 'Wydad AC': 'Wydad Casablanca',
  'AS FAR': 'FAR Rabat', 'HUS Agadir': 'Hassania Agadir',
  'DH El Jadida': 'Difaa El Jadida', 'COD Meknes': 'CODM Meknes',
  'KAC Marrakech': 'Kawkab Marrakech', 'MA Tétouan': 'Moghreb Tetouan',
  'IR Tanger': 'Ittihad Tanger', 'Al Hilal Omdurman': 'Al-Hilal Omdurman',
};

async function json(url) {
  const r = await fetch(url);
  const t = await r.text();
  if (/^error code/i.test(t) || r.status === 429) throw new Error('limite TheSportsDB');
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return JSON.parse(t);
}

// 1. Liste des équipes à couvrir
const names = new Set();
const y = new Date().getUTCFullYear();
for (const yy of [y - 1, y, y + 1]) {
  try {
    const d = await json(`${ESPN}caf.champions/scoreboard?dates=${yy}&limit=1000`);
    for (const e of d.events || []) for (const c of (e.competitions?.[0]?.competitors || [])) names.add(c.team.displayName);
  } catch (e) { console.warn('ESPN', yy, e.message); }
}
try { (JSON.parse(await readFile(BOTOLA, 'utf8')).rows || []).forEach(r => names.add(r.n)); } catch {}
try {
  const d = await json(`${TSDB}eventsnextleague.php?id=4520`);
  for (const e of d.events || []) { names.add(e.strHomeTeam); names.add(e.strAwayTeam); }
} catch (e) { console.warn('TSDB events', e.message); }
await sleep(3000);

// 2. Recherche des logos manquants
let logos = {};
try { logos = JSON.parse(await readFile(OUT, 'utf8')); } catch {}
const variants = n => [...new Set([ALIAS[n], n,
  n.replace(/\b(FC|SC|AC|AS|CF|CS|RSB|Club|Sportiv|Sporting)\b\.?/gi, ' ').replace(/\s+/g, ' ').trim()])]
  .filter(v => v && v.length > 2);

let lookups = 0, found = 0, blocked = false;
for (const n of [...names].filter(Boolean).sort()) {
  if (logos[n]) continue;
  if (lookups >= MAX_LOOKUPS || blocked) break;
  for (const v of variants(n)) {
    lookups++;
    try {
      const t = ((await json(`${TSDB}searchteams.php?t=${encodeURIComponent(v)}`)).teams || [])
        .find(x => x.strSport === 'Soccer' && (x.strBadge || x.strTeamBadge));
      if (t) { logos[n] = t.strBadge || t.strTeamBadge; found++; await sleep(3000); break; }
    } catch (e) { console.warn(n, e.message); if (/limite/.test(e.message)) blocked = true; await sleep(3000); break; }
    await sleep(3000);
  }
}

const sorted = Object.fromEntries(Object.entries(logos).filter(([, v]) => v).sort());
await writeFile(OUT, JSON.stringify(sorted, null, 1) + '\n');
const missing = [...names].filter(n => n && !sorted[n]);
console.log(`logos.json : ${Object.keys(sorted).length} logos (+${found}), ${missing.length} manquants${missing.length ? ' : ' + missing.join(', ') : ''}`);
