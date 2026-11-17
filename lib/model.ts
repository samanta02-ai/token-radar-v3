// Token Radar v3 — the model, the farm economics and the board builder.
//
// Idea: a protocol's token, if it ever issues one, is priced like the tokens
// of protocols that already trade. We fit that price on the snapshot itself —
// a log-log line of market cap on TVL over the 128 tokenised peers — and we
// show how wide the answer is (an 80% prediction interval) instead of
// pretending a point estimate is precise. 7-day growth and listing age were
// tested as extra predictors and dropped: out-of-sample they did not help
// (see oosTable), so they appear only as context on each row, never in the
// value. The board ranks every genuine launch candidate in the snapshot
// (198 of them), not just the 40 on the house watchlist and not the wrapped,
// staked, bridged or exchange products, which are listed separately with
// their reason instead of being ranked as if they might launch a token.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  // everything below is extra context the gate allows; the dashboard reads it.
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_months: number | null;
  implied_low_usd: number;
  implied_high_usd: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  verdict_reason: string;
  monthly_cost_usd: number;
  cost_3mo_usd: number;
  breakeven_share_pct: number;
  cheapest_chain: string;
  peer_median_multiple: number | null;
  peer_count: number;
  on_watchlist: boolean;
  growth_note: string;
}

export interface OosRow {
  model: string;
  median_log_error: number;
  median_pct_error: number;
  within_2x_pct: number;
  coverage_80_pct: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_name: string;
  model_version: string;
  peer_count: number;
  slope: number;
  intercept: number;
  resid_sd: number;
  interval_factor: number;
  oos: OosRow[];
  oos_note: string;
  counts: { candidates: number; set_aside: number; watchlist: number; farm: number; thin: number; skip: number };
  rows: BoardRow[];
  set_aside: { slug: string; name: string; category: string | null; tvl_usd: number; reason: string }[];
  peer_categories: { category: string; n: number; median_multiple: number }[];
}

export const MODEL_VERSION = 'radar-v3';

// ------------------------------------------------------------------ parsing

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: protocols and watchlist must be arrays');
  }
  return raw;
}

// ------------------------------------------------------- launch candidacy

const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

function hasToken(p: SnapshotProtocol): boolean {
  return p.gecko_id !== null || p.symbol !== null || p.mcap_usd !== null;
}

/** The house watchlist's own exclusion rule, minus its $50M floor. */
export function isCandidate(p: SnapshotProtocol): boolean {
  if (hasToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_NAMES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

export function setAsideReason(p: SnapshotProtocol): string {
  if (hasToken(p)) return 'records a token already (gecko id, symbol or market cap on file)';
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) {
    return `a ${p.category} product — an exchange, bridge or staking wrapper, not a protocol awaiting its own launch`;
  }
  if (VERSION_SUFFIX.test(p.name)) return 'a versioned deployment (V2, 2.0, …) of a protocol, not a fresh launch';
  if (WRAPPED_WORD.test(p.name)) return 'a wrapped or staked product of a token that already trades';
  if (EXCHANGE_NAMES.some((e) => p.name.startsWith(e))) return 'named after an exchange whose token already trades';
  return 'left out by the candidacy rule';
}

// ------------------------------------------------------------- peer fitting

export interface LogLogFit {
  intercept: number;
  slope: number;
  residSd: number;
}

function ols(xs: number[], ys: number[]): { a: number; b: number } {
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i]! - mx) * (xs[i]! - mx);
    sxy += (xs[i]! - mx) * (ys[i]! - my);
  }
  const b = sxx === 0 ? 0 : sxy / sxx;
  return { a: my - b * mx, b };
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function peerSet(snap: Snapshot): SnapshotProtocol[] {
  return snap.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
}

export function fitLogLog(peers: SnapshotProtocol[]): LogLogFit {
  const xs = peers.map((p) => Math.log(p.tvl_usd));
  const ys = peers.map((p) => Math.log(p.mcap_usd!));
  const { a, b } = ols(xs, ys);
  const resid = ys.map((y, i) => y - (a + b * xs[i]!));
  const mean = resid.reduce((s, v) => s + v, 0) / resid.length;
  const sd = Math.sqrt(resid.reduce((s, v) => s + (v - mean) * (v - mean), 0) / resid.length);
  return { intercept: a, slope: b, residSd: sd };
}

// ------------------------------------------------- out-of-sample comparison

function predictGlobalMedian(train: SnapshotProtocol[], p: SnapshotProtocol): number {
  const m = median(train.map((q) => Math.log(q.mcap_usd! / q.tvl_usd)));
  return Math.log(p.tvl_usd) + m;
}

function predictCategoryMedian(train: SnapshotProtocol[], p: SnapshotProtocol): number {
  const same = train.filter((q) => q.category === p.category);
  if (same.length >= 3) {
    return Math.log(p.tvl_usd) + median(same.map((q) => Math.log(q.mcap_usd! / q.tvl_usd)));
  }
  return predictGlobalMedian(train, p);
}

function predictLogLog(train: SnapshotProtocol[], p: SnapshotProtocol): { pred: number; sd: number } {
  const fit = fitLogLog(train);
  return { pred: fit.intercept + fit.slope * Math.log(p.tvl_usd), sd: fit.residSd };
}

export function oosTable(peers: SnapshotProtocol[]): OosRow[] {
  const order = [...peers].sort((a, b) => (a.slug < b.slug ? -1 : 1));
  const folds: SnapshotProtocol[][] = [[], [], [], [], []];
  order.forEach((p, i) => folds[i % 5]!.push(p));
  const acc: Record<string, { logErr: number[]; pctErr: number[]; within2: number; cover: number; coverN: number }> = {
    'A. One multiple for all (global median mcap/TVL)': { logErr: [], pctErr: [], within2: 0, cover: 0, coverN: 0 },
    'B. One multiple per category (median, global fallback)': { logErr: [], pctErr: [], within2: 0, cover: 0, coverN: 0 },
    'C. v3: log-log line of mcap on TVL': { logErr: [], pctErr: [], within2: 0, cover: 0, coverN: 0 },
  };
  for (let f = 0; f < 5; f++) {
    const test = folds[f]!;
    const train = folds.flatMap((fold, i) => (i === f ? [] : fold));
    for (const p of test) {
      const truth = Math.log(p.mcap_usd!);
      const preds: [string, number, number | null][] = [
        ['A. One multiple for all (global median mcap/TVL)', predictGlobalMedian(train, p), null],
        ['B. One multiple per category (median, global fallback)', predictCategoryMedian(train, p), null],
        ['C. v3: log-log line of mcap on TVL', predictLogLog(train, p).pred, predictLogLog(train, p).sd],
      ];
      for (const [name, pred, sd] of preds) {
        const a = acc[name]!;
        a.logErr.push(Math.abs(pred - truth));
        a.pctErr.push(Math.abs(Math.exp(pred) - p.mcap_usd!) / p.mcap_usd!);
        if (Math.abs(pred - truth) <= Math.log(2)) a.within2 += 1;
        if (sd !== null) {
          a.coverN += 1;
          if (Math.abs(pred - truth) <= 1.2816 * sd) a.cover += 1;
        }
      }
    }
  }
  return Object.entries(acc).map(([model, a]) => ({
    model,
    median_log_error: Math.round(median(a.logErr) * 1000) / 1000,
    median_pct_error: Math.round(median(a.pctErr) * 1000) / 1000,
    within_2x_pct: Math.round((a.within2 / a.logErr.length) * 100),
    coverage_80_pct: a.coverN === 0 ? null : Math.round((a.cover / a.coverN) * 100),
  }));
}

// ------------------------------------------------------------ farm economics

const GAS_PER_TX: Record<string, number> = {
  Ethereum: 3.0,
  'BNB Chain': 0.15,
  Binance: 0.15,
  Solana: 0.05,
  Base: 0.2,
  Arbitrum: 0.25,
  Optimism: 0.2,
  Polygon: 0.1,
  Avalanche: 0.3,
  Gnosis: 0.1,
  xDai: 0.1,
  Linea: 0.2,
  Scroll: 0.3,
  'zkSync Era': 0.25,
  Blast: 0.15,
  Berachain: 0.2,
  Sonic: 0.1,
  'Hyperliquid L1': 0.05,
  Sui: 0.05,
  Aptos: 0.05,
  Near: 0.05,
  TON: 0.1,
  Mantle: 0.15,
  Unichain: 0.2,
  Sei: 0.05,
  Celo: 0.1,
  Fantom: 0.2,
  Tron: 0.2,
};
const DEFAULT_GAS = 0.5;

const TXS_PER_MONTH: Record<string, number> = {
  Dexs: 8,
  Lending: 4,
  Yield: 4,
  'Yield Aggregator': 4,
  CDP: 3,
  'Risk Curators': 2,
  'Onchain Capital Allocator': 2,
  RWA: 2,
  'Prediction Market': 6,
  Derivatives: 6,
  'Basis Trading': 4,
};

export function cheapestChain(p: SnapshotProtocol): { chain: string; gas: number } {
  let best: { chain: string; gas: number } = { chain: p.chains[0] ?? 'Ethereum', gas: DEFAULT_GAS };
  for (const c of p.chains) {
    const g = GAS_PER_TX[c] ?? DEFAULT_GAS;
    if (g < best.gas) best = { chain: c, gas: g };
  }
  return best;
}

function txsPerMonth(p: SnapshotProtocol): number {
  return TXS_PER_MONTH[p.category ?? ''] ?? 4;
}

export interface FarmEconomics {
  cheapestChain: string;
  gasPerTx: number;
  txsPerMonth: number;
  monthlyCost: number;
  threeMonthCost: number;
}

export function farmEconomics(p: SnapshotProtocol): FarmEconomics {
  const { chain, gas } = cheapestChain(p);
  const txs = txsPerMonth(p);
  const monthly = Math.round(txs * gas * 100) / 100;
  const threeMonth = Math.round((3 * monthly + 1) * 100) / 100; // +$1 one-off setup/bridge
  return { cheapestChain: chain, gasPerTx: gas, txsPerMonth: txs, monthlyCost: monthly, threeMonthCost: threeMonth };
}

// ------------------------------------------------------------------- verdicts

export function decideVerdict(value: number, econ: FarmEconomics): { verdict: 'FARM' | 'THIN' | 'SKIP'; reason: string } {
  // Gas is not the constraint here — the cheapest chain makes 3 months of
  // farming cost $1.30–$13 for every candidate — so the verdict ranks by the
  // money at stake (the implied value), and quotes the cost as the check
  // that farming it is cheap. Your time is the scarce input, not gas.
  const breakeven = econ.threeMonthCost / value; // airdrop share that must come back to pay for 3 months
  const be = (breakeven * 100).toFixed(4);
  const v = (value / 1e6).toFixed(1);
  if (value >= 10_000_000) {
    return {
      verdict: 'FARM',
      reason: `implied value $${v}M — the top of the field. 3 months of farming costs $${econ.threeMonthCost.toFixed(2)} on ${econ.cheapestChain}, so a ${be}% airdrop share already pays for it. Farm it properly.`,
    };
  }
  if (value >= 5_000_000) {
    return {
      verdict: 'THIN',
      reason: `mid-pack value $${v}M. 3 months costs $${econ.threeMonthCost.toFixed(2)} on ${econ.cheapestChain} (break-even share ${be}%) — farm it lightly, one chain, minimum size; do not let it eat time a FARM row deserves.`,
    };
  }
  return {
    verdict: 'SKIP',
    reason: `implied value $${v}M, the bottom of the field. It costs only $${econ.threeMonthCost.toFixed(2)} for 3 months, but the dollars at stake are the smallest here — skip it unless you already use the protocol.`,
  };
}

// ----------------------------------------------------------------- farm steps

const STEP_FAMILIES: Record<string, string[]> = {
  dexs: [
    'Open {name} on {chain} and connect the single wallet you will farm with, so every action accrues to one address. (10 minutes, $0)',
    'Swap $25–$50 through {name} once a week, about 4 swaps a month; each swap costs about {gas} in gas, so a month of swaps is about {monthly}. (5 minutes per swap)',
    'Add the same $25–$50 as liquidity to one {name} pool and leave it in for at least 3 months; airdrops usually snapshot long-lived positions, not one-day deposits. (10 minutes to deposit)',
    'Keep one small swap a week for 12 weeks and leave the liquidity untouched; 3 months of gas comes to about {three}. Check the position once a week. (5 minutes a week)',
    'Before any snapshot or token announcement, confirm the position still shows on {chain} and screenshot the position page for your records. (10 minutes)',
  ],
  lending: [
    'Open {name} on {chain} and connect the single wallet you will farm with, so deposits, borrows and repayments all sit on one address. (10 minutes, $0)',
    'Deposit $50–$100 of a stablecoin as collateral on {chain}; the deposit costs about {gas} in gas. Leave it supplied for at least 3 months. (10 minutes)',
    'Borrow $10–$20 against the deposit once, then repay it a week later; one borrow plus one repay costs about {gas2} in gas and shows real use of the protocol. (10 minutes)',
    'Top the deposit up by $10 once a month for 3 months so the position stays active; 3 months of gas comes to about {three}. (5 minutes a month)',
    'Before any snapshot, confirm the supply position is still open on {chain} and screenshot the dashboard for your records. (10 minutes)',
  ],
  yield: [
    'Open {name} on {chain} and connect the single wallet you will farm with, so every deposit accrues to one address. (10 minutes, $0)',
    'Deposit $50–$100 into one {name} vault on {chain}; the deposit costs about {gas} in gas. Plan to leave it in for at least 3 months. (10 minutes)',
    'Claim or compound the vault rewards once a month; each claim costs about {gas} in gas, so a month of activity is about {monthly}. (5 minutes a month)',
    'Add $10 to the vault once a month for 3 months to keep the position fresh; 3 months of gas comes to about {three}. Do not withdraw early. (5 minutes a month)',
    'Before any snapshot, confirm the vault position still shows on {chain} and screenshot it for your records. (10 minutes)',
  ],
  curator: [
    'Open {name} on {chain} and connect the single wallet you will farm with, so every allocation accrues to one address. (10 minutes, $0)',
    'Allocate $50–$100 to one vault or strategy on {chain}; the deposit costs about {gas} in gas. Leave it allocated for at least 3 months. (10 minutes)',
    'Read the vault\'s strategy page and re-allocate to a second vault once, a month later; the move costs about {gas} in gas and shows deliberate use. (15 minutes)',
    'Keep the allocation in place for 3 months and check it once a month; 3 months of gas comes to about {three}. Do not churn in and out. (5 minutes a month)',
    'Before any snapshot, confirm the allocation still shows on {chain} and screenshot the vault page for your records. (10 minutes)',
  ],
  rwa: [
    'Open {name} on {chain} and connect the single wallet you will farm with, so every holding accrues to one address. (10 minutes, $0)',
    'Buy or mint $50–$100 of the protocol\'s tokenised asset on {chain}; the transaction costs about {gas} in gas. Hold it for at least 3 months. (15 minutes)',
    'Check whether the asset pays a yield or needs a monthly claim, and claim once a month if it does; each claim costs about {gas} in gas. (5 minutes a month)',
    'Keep the holding untouched for 3 months; 3 months of gas comes to about {three}. A long, quiet hold is the signal here, not trading. (5 minutes a month)',
    'Before any snapshot, confirm the holding still shows in your wallet on {chain} and screenshot it for your records. (10 minutes)',
  ],
  cdp: [
    'Open {name} on {chain} and connect the single wallet you will farm with, so the vault accrues to one address. (10 minutes, $0)',
    'Lock $50–$100 of collateral in a {name} vault on {chain}; opening the vault costs about {gas} in gas. Keep the vault open for at least 3 months. (10 minutes)',
    'Mint $10–$20 of the protocol\'s stable asset against the collateral, then repay it a week later; mint plus repay costs about {gas2} in gas. (10 minutes)',
    'Top the collateral up by $10 once a month for 3 months so the vault stays healthy; 3 months of gas comes to about {three}. (5 minutes a month)',
    'Before any snapshot, confirm the vault is still open and healthy on {chain} and screenshot it for your records. (10 minutes)',
  ],
  prediction: [
    'Open {name} on {chain} and connect the single wallet you will farm with, so every trade accrues to one address. (10 minutes, $0)',
    'Place 2–3 small trades of $5–$10 each on {name} markets on {chain} in the first week; each trade costs about {gas} in gas. (15 minutes)',
    'Trade once a week for 12 weeks, $5–$10 a trade, across different markets; a month of trades costs about {monthly} in gas. (10 minutes a week)',
    'Settle or close at least one position each month so the activity reads as real trading, not wash volume; 3 months of gas comes to about {three}. (5 minutes a month)',
    'Before any snapshot, confirm your trade history shows on {chain} and screenshot the profile page for your records. (10 minutes)',
  ],
  generic: [
    'Open {name} on {chain} and connect the single wallet you will farm with, so every action accrues to one address. (10 minutes, $0)',
    'Use the protocol\'s core action with $25–$50 on {chain} — deposit, swap or stake, whichever it offers; the transaction costs about {gas} in gas. (10 minutes)',
    'Repeat the core action once a week for 12 weeks with $10–$25 each time; a month of activity costs about {monthly} in gas. (5 minutes a week)',
    'Keep the position open for the full 3 months and check it once a month; 3 months of gas comes to about {three}. Do not close it early. (5 minutes a month)',
    'Before any snapshot, confirm the position still shows on {chain} and screenshot it for your records. (10 minutes)',
  ],
};

function familyOf(p: SnapshotProtocol): string {
  switch (p.category) {
    case 'Dexs':
      return 'dexs';
    case 'Lending':
      return 'lending';
    case 'Yield':
    case 'Yield Aggregator':
      return 'yield';
    case 'Risk Curators':
    case 'Onchain Capital Allocator':
      return 'curator';
    case 'RWA':
      return 'rwa';
    case 'CDP':
      return 'cdp';
    case 'Prediction Market':
      return 'prediction';
    default:
      return 'generic';
  }
}

function money(n: number): string {
  return n < 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(2)}`;
}

export function farmSteps(p: SnapshotProtocol, econ: FarmEconomics): string[] {
  const fill = (s: string): string =>
    s
      .replaceAll('{name}', p.name)
      .replaceAll('{chain}', econ.cheapestChain)
      .replaceAll('{gas}', money(econ.gasPerTx))
      .replaceAll('{gas2}', money(2 * econ.gasPerTx))
      .replaceAll('{monthly}', money(econ.monthlyCost))
      .replaceAll('{three}', money(econ.threeMonthCost));
  return STEP_FAMILIES[familyOf(p)]!.map(fill);
}

// -------------------------------------------------------------- board build

function ageMonths(p: SnapshotProtocol, asOf: string): number | null {
  if (p.listed_at === null) return null;
  const start = new Date(`${p.listed_at}T00:00:00Z`).getTime();
  const end = new Date(`${asOf}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || end < start) return null;
  return Math.max(0, Math.round(((end - start) / (30.44 * 86400_000)) * 10) / 10);
}

function growthNote(p: SnapshotProtocol): string {
  if (p.change_7d === null) return 'TVL change over 7 days not reported.';
  if (p.change_7d >= 25) return `TVL up ${p.change_7d.toFixed(1)}% in 7 days — hot, but growth is not part of the value (it failed out-of-sample).`;
  if (p.change_7d <= -25) return `TVL down ${Math.abs(p.change_7d).toFixed(1)}% in 7 days — cooling; value uses TVL as it stands.`;
  return `TVL ${p.change_7d >= 0 ? 'up' : 'down'} ${Math.abs(p.change_7d).toFixed(1)}% in 7 days.`;
}

export function buildRadar(snap: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const peers = peerSet(snap);
  const fit = fitLogLog(peers);
  const watch = new Set(snap.watchlist);
  const oos = oosTable(peers);
  const z = 1.2816; // 80% two-sided normal quantile
  const intervalFactor = Math.exp(z * fit.residSd);

  // peer median multiple per category, for the detail view's context.
  const byCat = new Map<string, number[]>();
  for (const q of peers) {
    const arr = byCat.get(q.category ?? '—') ?? [];
    arr.push(q.mcap_usd! / q.tvl_usd);
    byCat.set(q.category ?? '—', arr);
  }
  const peerCats = [...byCat.entries()]
    .filter(([, v]) => v.length >= 3)
    .map(([category, v]) => ({ category, n: v.length, median_multiple: Math.round(median(v) * 1000) / 1000 }))
    .sort((a, b) => b.n - a.n);
  const peerMultiple = (cat: string | null): { m: number | null; n: number } => {
    const v = byCat.get(cat ?? '—');
    if (!v || v.length < 3) return { m: null, n: v?.length ?? 0 };
    return { m: Math.round(median(v) * 1000) / 1000, n: v.length };
  };

  const candidates = snap.protocols.filter(isCandidate);
  const rows: BoardRow[] = candidates.map((p) => {
    const pred = fit.intercept + fit.slope * Math.log(p.tvl_usd);
    const value = Math.max(1, Math.round(Math.exp(pred)));
    const econ = farmEconomics(p);
    const { verdict, reason } = decideVerdict(value, econ);
    const pm = peerMultiple(p.category);
    return {
      slug: p.slug,
      name: p.name,
      rank: 0, // filled after sorting
      implied_value_usd: value,
      farm_steps: farmSteps(p, econ),
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_months: ageMonths(p, snap.as_of),
      implied_low_usd: Math.max(1, Math.round(Math.exp(pred - z * fit.residSd))),
      implied_high_usd: Math.max(1, Math.round(Math.exp(pred + z * fit.residSd))),
      verdict,
      verdict_reason: reason,
      monthly_cost_usd: econ.monthlyCost,
      cost_3mo_usd: econ.threeMonthCost,
      breakeven_share_pct: Math.round((econ.threeMonthCost / value) * 100 * 1e6) / 1e6,
      cheapest_chain: econ.cheapestChain,
      peer_median_multiple: pm.m,
      peer_count: pm.n,
      on_watchlist: watch.has(p.slug),
      growth_note: growthNote(p),
    };
  });
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1));
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });

  const setAside = snap.protocols
    .filter((p) => !isCandidate(p) && !hasToken(p))
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, reason: setAsideReason(p) }))
    .sort((a, b) => b.tvl_usd - a.tvl_usd);

  const radar: RadarData = {
    as_of: snap.as_of,
    source: snap.source,
    floor_usd: snap.floor_usd,
    model_name: 'log-log peer line with 80% prediction interval',
    model_version: MODEL_VERSION,
    peer_count: peers.length,
    slope: Math.round(fit.slope * 1000) / 1000,
    intercept: Math.round(fit.intercept * 1000) / 1000,
    resid_sd: Math.round(fit.residSd * 1000) / 1000,
    interval_factor: Math.round(intervalFactor * 10) / 10,
    oos,
    oos_note:
      '5-fold out-of-sample on the 128 tokenised peers (each fold predicted from the other four). The log-log line beats a single multiple and a per-category multiple on median log error; growth and age were tested the same way and dropped — their coefficients were unstable and they did not improve the folds.',
    counts: {
      candidates: rows.length,
      set_aside: setAside.length,
      watchlist: snap.watchlist.length,
      farm: rows.filter((r) => r.verdict === 'FARM').length,
      thin: rows.filter((r) => r.verdict === 'THIN').length,
      skip: rows.filter((r) => r.verdict === 'SKIP').length,
    },
    rows,
    set_aside: setAside,
    peer_categories: peerCats,
  };
  return { board: rows, radar };
}

// ------------------------------------------------------------------ outputs

export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}

/** The gate's own shape checks, run before anything is written. */
export function boardIssue(board: BoardRow[], snap: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, the gate wants 100 to 4000`;
  const seen = new Set<string>();
  const slugs = new Set(snap.protocols.map((p) => p.slug));
  const byRank = new Set<number>();
  for (const r of board) {
    if (!slugs.has(r.slug)) return `row names ${r.slug}, not a protocol in the snapshot`;
    if (seen.has(r.slug)) return `slug ${r.slug} appears twice`;
    seen.add(r.slug);
    if (!Number.isInteger(r.rank) || r.rank < 1) return `row ${r.slug} has rank ${r.rank}`;
    if (byRank.has(r.rank)) return `rank ${r.rank} appears twice`;
    byRank.add(r.rank);
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd < 1) return `row ${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `row ${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `row ${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  for (let i = 1; i <= board.length; i++) if (!byRank.has(i)) return `rank ${i} is missing`;
  const sorted = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.implied_value_usd > sorted[i - 1]!.implied_value_usd) return `implied value rises from rank ${i} to ${i + 1}`;
  }
  if (new Set(sorted.map((r) => r.implied_value_usd)).size === 1 && sorted.length > 1) return 'all implied values are the same';
  for (const w of snap.watchlist) if (!seen.has(w)) return `watchlist protocol ${w} is missing from the board`;
  return null;
}
