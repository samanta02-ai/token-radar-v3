# v3 research: OOS comparison of candidate value models on the 128 usable
# tokenized peers (mcap > 0, tvl > 0), plus candidate counts and verdict
# calibration. Fresh analysis for token-radar-01 v3, 2026-11-17.
# Data: kit input/snapshot.json (DefiLlama fetch 2026-11-14).
import json, math, statistics
from datetime import date
from collections import Counter, defaultdict

SNAP = "/home/hatch/workspace/goals/make-fun-bounties/hidden_files/token_radar_kit/token-radar-01-kit/input/snapshot.json"
d = json.load(open(SNAP))
P = d["protocols"]
W = set(d["watchlist"])
ASOF = date.fromisoformat(d["as_of"])

EXCL_CATS = {"Bridge", "Canonical Bridge", "Liquid Staking", "Liquid Restaking", "Restaked BTC", "CEX"}
EXCH = ("Binance", "Coinbase", "Bybit", "Kraken", "Bitget", "OKX", "Bitfinex", "Gemini")
import re
VER_RE = re.compile(r"\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$")
WRAP_RE = re.compile(r"\b(wrapped|staked|staking)\b", re.I)

def is_candidate(p):
    if p["gecko_id"] is not None or p["symbol"] is not None or p["mcap_usd"] is not None:
        return False
    if p["category"] in EXCL_CATS:
        return False
    if VER_RE.search(p["name"] or ""):
        return False
    if WRAP_RE.search(p["name"] or ""):
        return False
    if any((p["name"] or "").startswith(e) for e in EXCH):
        return False
    return True

cands = [p for p in P if is_candidate(p)]
pre = [p for p in P if p["gecko_id"] is None and p["symbol"] is None and p["mcap_usd"] is None]
print("pre-token total", len(pre), "candidates", len(cands), "set-aside", len(pre) - len(cands))
print("candidates on watchlist", sum(1 for p in cands if p["slug"] in W), "of", len(W))
print("candidate TVL>=50m", sum(1 for p in cands if p["tvl_usd"] >= 50_000_000))
print("candidate TVL median $%.1fM" % (statistics.median([p["tvl_usd"] for p in cands]) / 1e6))
print("set-aside by category:", Counter(p["category"] for p in pre if not is_candidate(p)).most_common(8))
print("top candidates by TVL:")
for p in sorted(cands, key=lambda x: -x["tvl_usd"])[:12]:
    print("  %-26s %-24s $%12d wl=%s" % (p["slug"], str(p["category"]), p["tvl_usd"], p["slug"] in W))

# ---- peer set ----
peers = [p for p in P if p["mcap_usd"] and p["mcap_usd"] > 0 and p["tvl_usd"] > 0]
print("\npeers usable:", len(peers))

def ols(xs, ys):
    n = len(xs); mx = sum(xs) / n; my = sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs); sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    b = sxy / sxx; a = my - b * mx
    return a, b

def shrink_median(vals, k=6):
    if len(vals) < 3:
        return 0.0
    return statistics.median(vals) * len(vals) / (len(vals) + k)

# deterministic 5-fold split by slug hash order
order = sorted(peers, key=lambda p: p["slug"])
folds = [order[i::5] for i in range(5)]

def predict_v3(train, p):
    xs = [math.log(q["tvl_usd"]) for q in train]; ys = [math.log(q["mcap_usd"]) for q in train]
    a, b = ols(xs, ys)
    resid = [y - (a + b * x) for x, y in zip(xs, ys)]
    by_cat = defaultdict(list)
    for q, r in zip(train, resid):
        by_cat[q["category"]].append(r)
    off = {c: shrink_median(v) for c, v in by_cat.items()}
    base = a + b * math.log(p["tvl_usd"]) + off.get(p["category"], 0.0)
    sd = statistics.pstdev(resid) if len(resid) > 1 else 2.0
    return base, sd

def predict_loglog(train, p):
    xs = [math.log(q["tvl_usd"]) for q in train]; ys = [math.log(q["mcap_usd"]) for q in train]
    a, b = ols(xs, ys)
    resid = [y - (a + b * x) for x, y in zip(xs, ys)]
    return a + b * math.log(p["tvl_usd"]), statistics.pstdev(resid)

def predict_catmed(train, p):
    by_cat = defaultdict(list)
    for q in train:
        by_cat[q["category"]].append(math.log(q["mcap_usd"] / q["tvl_usd"]))
    glob = statistics.median([math.log(q["mcap_usd"] / q["tvl_usd"]) for q in train])
    m = statistics.median(by_cat[p["category"]]) if len(by_cat.get(p["category"], [])) >= 3 else glob
    return math.log(p["tvl_usd"]) + m, None

def predict_globmed(train, p):
    m = statistics.median([math.log(q["mcap_usd"] / q["tvl_usd"]) for q in train])
    return math.log(p["tvl_usd"]) + m, None

def predict_growth_age(train, p):
    xs = [math.log(q["tvl_usd"]) for q in train]
    ys = [math.log(q["mcap_usd"]) for q in train]
    gs = [((q["change_7d"] or 0.0) / 100.0) for q in train]
    ag = [math.log(max(((ASOF - date.fromisoformat(q["listed_at"])).days / 365.25 if q["listed_at"] else 2.0), 0.1)) for q in train]
    # OLS with 4 columns via normal equations (small, hand-rolled Gaussian elimination)
    cols = [[1.0] * len(xs), xs, gs, ag]
    k = 4
    ata = [[sum(cols[i][t] * cols[j][t] for t in range(len(xs))) for j in range(k)] for i in range(k)]
    aty = [sum(cols[i][t] * ys[t] for t in range(len(xs))) for i in range(k)]
    # solve
    m = [row[:] + [aty[i]] for i, row in enumerate(ata)]
    for c in range(k):
        piv = max(range(c, k), key=lambda r: abs(m[r][c]))
        m[c], m[piv] = m[piv], m[c]
        for r in range(k):
            if r != c:
                f = m[r][c] / m[c][c]
                for cc in range(c, k + 1):
                    m[r][cc] -= f * m[c][cc]
    coef = [m[i][k] / m[i][i] for i in range(k)]
    resid = [ys[t] - sum(coef[j] * cols[j][t] for j in range(k)) for t in range(len(xs))]
    age_p = math.log(max(((ASOF - date.fromisoformat(p["listed_at"])).days / 365.25 if p["listed_at"] else 2.0), 0.1))
    pred = coef[0] + coef[1] * math.log(p["tvl_usd"]) + coef[2] * ((p["change_7d"] or 0.0) / 100.0) + coef[3] * age_p
    return pred, statistics.pstdev(resid)

models = {"A global-median multiple": predict_globmed,
          "B per-category median": predict_catmed,
          "C log-log OLS only": predict_loglog,
          "D v3 log-log + shrunk cat": predict_v3,
          "E log-log + growth + age": predict_growth_age}

for name, fn in models.items():
    errs, pcts, within2, cover = [], [], 0, 0
    for i in range(5):
        test = folds[i]
        train = [q for j in range(5) if j != i for q in folds[j]]
        for p in test:
            pred, sd = fn(train, p)
            true = math.log(p["mcap_usd"])
            errs.append(abs(pred - true))
            pcts.append(abs(math.exp(pred) - p["mcap_usd"]) / p["mcap_usd"])
            if abs(pred - true) <= math.log(2):
                within2 += 1
            if sd is not None and abs(pred - true) <= 1.2816 * sd:
                cover += 1
    n = len(errs)
    print("%-28s med|log err| %.3f  med %% err %.0f%%  within 2x %d%%  80%%-int coverage %s"
          % (name, statistics.median(errs), 100 * statistics.median(pcts), 100 * within2 / n,
             ("%.0f%%" % (100 * cover / n)) if cover else "n/a"))

# full-fit v3 numbers for the report
pred_all, sd_all = [], []
for p in peers:
    pr, sd = predict_v3(peers, p)
    pred_all.append(pr); sd_all.append(sd)
a, b = ols([math.log(q["tvl_usd"]) for q in peers], [math.log(q["mcap_usd"]) for q in peers])
print("\nfull-fit: log mcap = %.3f + %.3f logTVL ; resid sd %.3f" % (a, b, statistics.pstdev(
    [math.log(q["mcap_usd"]) - (a + b * math.log(q["tvl_usd"])) for q in peers])))
print("v3 80pct interval half-width in log: %.2f -> factor %.1fx" % (1.2816 * sd_all[0], math.exp(1.2816 * sd_all[0])))
