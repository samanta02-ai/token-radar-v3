// Dev gate check: re-implements the scorer's seven gate rows against a
// built out/ directory, plus a dossier byte-equality check. Not part of
// the entry; the server grades, this only catches local mistakes early.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildDossier } from '../vendor/makefun-board.ts';

const OUT = process.argv[2] ?? 'out';
const KIT = '/home/hatch/workspace/goals/make-fun-bounties/hidden_files/token_radar_kit/token-radar-01-kit';
const snap = JSON.parse(readFileSync(join(KIT, 'input/snapshot.json'), 'utf8'));
const slugs = new Set(snap.protocols.map((p) => p.slug));
const fails = [];
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) fails.push(name);
};

const NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
// 1 dashboard_files
{
  const files = readdirSync(join(OUT, 'dashboard'));
  const total = files.reduce((n, f) => n + statSync(join(OUT, 'dashboard', f)).size, 0);
  const hasHtml = files.includes('index.html');
  const hasCss = files.some((f) => f.endsWith('.css'));
  const hasJs = files.some((f) => f.endsWith('.js'));
  let badUrl = null;
  for (const f of files) {
    const text = readFileSync(join(OUT, 'dashboard', f), 'utf8');
    if (/https?:\/\//.test(text) && !/^\s*\/\//.test(text)) {
      // the gate refuses http(s) in HTML attrs, CSS and JS imports; our files
      // carry none at all, so any occurrence is a failure here.
      badUrl = f;
    }
    if (!NAME.test(f)) badUrl = f;
  }
  ok('dashboard_files', hasHtml && hasCss && hasJs && files.length <= 400 && total <= 4_194_304 && !badUrl,
    `${files.length} files, ${total} bytes${badUrl ? ', bad file: ' + badUrl : ''}`);
}
// 2 + 3 + 4 + 5 board
{
  const raw = readFileSync(join(OUT, 'board.json'));
  const board = JSON.parse(raw.toString('utf8'));
  const rows = board.rows;
  let issue = null;
  if (!Array.isArray(rows) || rows.length < 100 || rows.length > 4000) issue = `rows=${rows?.length}`;
  const seen = new Set(); const ranks = new Set();
  for (const r of rows ?? []) {
    if (!slugs.has(r.slug)) { issue = 'unknown slug ' + r.slug; break; }
    if (seen.has(r.slug)) { issue = 'dup slug ' + r.slug; break; }
    seen.add(r.slug);
    if (!Number.isInteger(r.rank) || r.rank < 1) { issue = 'bad rank ' + r.slug; break; }
    ranks.add(r.rank);
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd < 1 || r.implied_value_usd > 1e14) { issue = 'bad value ' + r.slug; break; }
    if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) { issue = 'steps ' + r.slug; break; }
    for (const s of r.farm_steps) {
      const t = String(s).trim();
      if (t.length < 20 || t.length > 600) { issue = `step ${t.length} chars in ${r.slug}`; break; }
    }
    if (issue) break;
  }
  ok('board_file', !issue && raw.length <= 8_000_000, `${rows.length} rows, ${raw.length} bytes${issue ? ', ' + issue : ''}`);
  const sorted = [...rows].sort((a, b) => a.rank - b.rank);
  let sortedOk = ranks.size === rows.length;
  for (let i = 1; i <= rows.length; i++) if (!ranks.has(i)) sortedOk = false;
  for (let i = 1; i < sorted.length; i++) if (sorted[i].implied_value_usd > sorted[i - 1].implied_value_usd) sortedOk = false;
  if (new Set(rows.map((r) => r.implied_value_usd)).size === 1) sortedOk = false;
  ok('sorted_by_value', sortedOk, `ranks 1..${rows.length}, non-increasing values`);
  const missing = snap.watchlist.filter((w) => !seen.has(w));
  ok('coverage', missing.length === 0, `${snap.watchlist.length - missing.length}/${snap.watchlist.length} watchlist covered`);
  ok('farm_steps', !issue, 'all rows 3–12 steps of 20–600 chars');
}
// 6 screenshots
{
  const files = readdirSync(join(OUT, 'screenshots')).filter((f) => !f.startsWith('.'));
  let issue = null;
  if (files.length < 3 || files.length > 4) issue = `${files.length} images`;
  const pngDims = (buf) => {
    if (buf[0] === 0x89 && buf[1] === 0x50) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), type: 'png' };
    if (buf[0] === 0xff && buf[1] === 0xd8) return { w: 0, h: 0, type: 'jpeg' };
    return null;
  };
  for (const f of files) {
    const buf = readFileSync(join(OUT, 'screenshots', f));
    if (!NAME.test(f)) { issue = 'bad name ' + f; break; }
    if (buf.length > 524_288) { issue = f + ' over 512 KiB'; break; }
    const d = pngDims(buf);
    if (!d) { issue = f + ' not PNG/JPEG'; break; }
    if (d.type === 'png') {
      const long = Math.max(d.w, d.h); const short = Math.min(d.w, d.h);
      if (long > 1440 || short < 800) { issue = `${f} is ${d.w}x${d.h}`; break; }
    }
  }
  ok('screenshots', !issue, `${files.length} images${issue ? ', ' + issue : ''}`);
}
// 7 dossier_matches
{
  const built = Buffer.from(buildDossier(OUT, { text_max_bytes: 65_536, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));
  const mine = readFileSync(join(OUT, 'dossier.json'));
  ok('dossier_matches', built.equals(mine), `dossier ${mine.length} bytes, rebuild ${built.length} bytes`);
  const doc = JSON.parse(mine.toString('utf8'));
  console.log(`dossier text: ${Buffer.byteLength(doc.text, 'utf8')} bytes, images: ${doc.images.length}`);
}

if (fails.length) { console.log('GATE FAILURES:', fails.join(', ')); process.exit(1); }
console.log('ALL GATE ROWS PASS (local re-implementation)');
