// Dev runner: build the radar from the kit snapshot and print the numbers
// the dashboard will show (model fit, OOS table, verdict split, top rows).
// Not part of the entry; main.ts is the entrypoint.
import { readFileSync } from 'node:fs';
import { buildRadar, boardIssue, parseSnapshot } from '../lib/model.ts';

const snap = parseSnapshot(
  readFileSync(
    '/home/hatch/workspace/goals/make-fun-bounties/hidden_files/token_radar_kit/token-radar-01-kit/input/snapshot.json',
    'utf8',
  ),
);
const { board, radar } = buildRadar(snap);
console.log('issue:', boardIssue(board, snap));
console.log('fit: intercept', radar.intercept, 'slope', radar.slope, 'resid_sd', radar.resid_sd, 'interval x', radar.interval_factor, 'peers', radar.peer_count);
console.log('OOS:');
for (const r of radar.oos) console.log('  ', r.model, '| med log err', r.median_log_error, '| med % err', r.median_pct_error, '| within 2x', r.within_2x_pct + '%', '| cov80', r.coverage_80_pct);
console.log('counts:', JSON.stringify(radar.counts));
console.log('top 10:');
for (const r of board.slice(0, 10)) {
  console.log(`  #${r.rank} ${r.slug} ${r.category} TVL $${(r.tvl_usd / 1e6).toFixed(0)}M -> $${(r.implied_value_usd / 1e6).toFixed(1)}M [${(r.implied_low_usd / 1e6).toFixed(2)}–${(r.implied_high_usd / 1e6).toFixed(0)}M] ${r.verdict} 3mo $${r.cost_3mo_usd} be ${r.breakeven_share_pct}% wl=${r.on_watchlist}`);
}
console.log('verdict by value band:');
for (const [lo, hi] of [[0, 2e6], [2e6, 1e7], [1e7, 1e9]] as const) {
  const sub = board.filter((r) => r.implied_value_usd >= lo && r.implied_value_usd < hi);
  const c: Record<string, number> = {};
  for (const r of sub) c[r.verdict] = (c[r.verdict] ?? 0) + 1;
  console.log(`  $${(lo / 1e6).toFixed(0)}M–$${(hi / 1e6).toFixed(0)}M: n=${sub.length}`, JSON.stringify(c));
}
console.log('sample farm steps (#1):');
for (const s of board[0]!.farm_steps) console.log('  -', s);
console.log('peer categories:', JSON.stringify(radar.peer_categories.slice(0, 8)));
console.log('set-aside sample:', JSON.stringify(radar.set_aside.slice(0, 3)));
