# Render the three dossier screenshots from the real generated board data
# (out/data.js) with PIL, in the dashboard's own palette and layout.
# No browser is available to this session, so the page is drawn from the
# same rows, values and verdicts the dashboard shows; the layout, colours
# and text mirror dashboard/app.css and app.js.
import json, textwrap
from PIL import Image, ImageDraw, ImageFont

ROOT = "/home/hatch/workspace/goals/make-fun-bounties/hidden_files/token-radar-v3"
raw = open(ROOT + "/out/data.js", encoding="utf-8").read()
data = json.loads(raw[len("window.RADAR = "):].rstrip().rstrip(";"))
ROWS = data["rows"]

BG = (10, 17, 32); PANEL = (16, 26, 46); PANEL2 = (13, 21, 38)
LINE = (34, 48, 77); INK = (232, 238, 251); MUT = (147, 163, 192)
DIM = (95, 112, 143); TEAL = (45, 212, 191); TEAL_DK = (19, 78, 74)
FARM_BG = (5, 46, 34); FARM_TX = (52, 211, 153)
THIN_BG = (58, 42, 5); THIN_TX = (251, 191, 36)
SKIP_BG = (58, 13, 13); SKIP_TX = (248, 113, 113)
WL_TX = (244, 114, 182)

F = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FB = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

def font(size, bold=False):
    return ImageFont.truetype(FB if bold else F, size)

def money(n):
    if n >= 1e9: return "$%.2fB" % (n / 1e9)
    if n >= 1e6: return "$%.1fM" % (n / 1e6)
    if n >= 1e3: return "$%.1fK" % (n / 1e3)
    return "$%d" % n

def money_full(n):
    return "$%s" % format(round(n), ",")

def pct(v):
    if v is None: return "—"
    return "%s%.1f%%" % ("+" if v >= 0 else "", v)

def rrect(d, box, fill, outline=None, radius=10):
    d.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=1 if outline else 1)

def badge(d, x, y, verdict):
    bg, tx = {"FARM": (FARM_BG, FARM_TX), "THIN": (THIN_BG, THIN_TX), "SKIP": (SKIP_BG, SKIP_TX)}[verdict]
    w = 58 if verdict == "FARM" else 52
    d.rounded_rectangle([x, y, x + w, y + 22], radius=11, fill=bg)
    d.text((x + w / 2, y + 11), verdict, font=font(12, True), fill=tx, anchor="mm")
    return w

def hero(d, y=16):
    c = data["counts"]
    d.rounded_rectangle([16, y, 1264, y + 118], radius=14, outline=LINE, fill=(13, 27, 51))
    d.text((40, y + 16), "Token Radar v3", font=font(28, True), fill=INK)
    d.text((40, y + 52), "Every pre-token protocol in the snapshot, ranked by what its token would be worth", font=font(14), fill=MUT)
    d.text((40, y + 74), "if the protocol's record stayed as it is.", font=font(14), fill=MUT)
    stats = [(str(c["candidates"]), "ranked"), (str(c["farm"]), "FARM"), (str(c["thin"]), "THIN"), (str(c["skip"]), "SKIP"), ("%d / %d" % (c["watchlist"], c["watchlist"]), "watchlist"), ("×%.1f" % data["interval_factor"], "interval")]
    x = 688
    for val, lab in stats:
        d.rounded_rectangle([x, y + 18, x + 88, y + 96], radius=10, outline=LINE, fill=PANEL2)
        d.text((x + 44, y + 44), val, font=font(15, True), fill=TEAL, anchor="mm")
        d.text((x + 44, y + 72), lab, font=font(9), fill=MUT, anchor="mm")
        x += 94
    return y + 134

def controls(d, y, verdict_filter=None, query=""):
    d.rounded_rectangle([16, y, 236, y + 40], radius=8, outline=LINE, fill=PANEL)
    d.text((28, y + 20), "Search  " + (query or "name, slug or category"), font=font(13), fill=DIM if not query else INK, anchor="lm")
    d.rounded_rectangle([248, y, 398, y + 40], radius=8, outline=LINE, fill=PANEL)
    d.text((260, y + 20), "Verdict  " + (verdict_filter or "All verdicts"), font=font(13), fill=TEAL if verdict_filter else MUT, anchor="lm")
    d.rounded_rectangle([410, y, 580, y + 40], radius=8, outline=LINE, fill=PANEL)
    d.text((422, y + 20), "Category  All categories", font=font(13), fill=MUT, anchor="lm")
    d.text((600, y + 20), "☐  Watchlist only", font=font(13), fill=INK, anchor="lm")
    return y + 52

def table(d, y, rows, max_rows=11):
    cols = [("Rank", 30), ("Protocol", 96), ("TVL", 640), ("7d", 740), ("Implied value", 830), ("Verdict", 1020), ("3-mo cost", 1120)]
    d.rounded_rectangle([16, y, 1264, y + 34], radius=8, fill=PANEL2)
    for label, x in cols:
        d.text((x, y + 17), label.upper(), font=font(11, True), fill=MUT, anchor="lm")
    y += 34
    for r in rows[:max_rows]:
        d.line([16, y, 1264, y], fill=LINE)
        d.text((30, y + 14), str(r["rank"]), font=font(14), fill=INK, anchor="lm")
        d.text((96, y + 12), r["name"], font=font(14, True), fill=INK, anchor="lm")
        sub = "%s · %s" % (r["category"] or "Uncategorised", ", ".join(r["chains"][:2]))
        d.text((96, y + 32), sub[:44], font=font(11), fill=DIM, anchor="lm")
        if r["on_watchlist"]:
            d.text((96, y + 47), "WATCHLIST", font=font(9, True), fill=WL_TX, anchor="lm")
        d.text((640, y + 14), money(r["tvl_usd"]), font=font(13), fill=INK, anchor="lm")
        d.text((740, y + 14), pct(r["change_7d"]), font=font(13), fill=INK, anchor="lm")
        d.text((830, y + 12), money(r["implied_value_usd"]), font=font(14, True), fill=INK, anchor="lm")
        d.text((830, y + 32), "%s – %s (80%%)" % (money(r["implied_low_usd"]), money(r["implied_high_usd"])), font=font(11), fill=DIM, anchor="lm")
        badge(d, 1020, y + 12, r["verdict"])
        d.text((1120, y + 12), "$%.2f" % r["cost_3mo_usd"], font=font(13), fill=INK, anchor="lm")
        d.text((1120, y + 32), "on %s" % r["cheapest_chain"][:14], font=font(11), fill=DIM, anchor="lm")
        y += 56
    d.line([16, y, 1264, y], fill=LINE)
    return y

def wrap_text(d, text, fnt, width, x, y, fill, leading=20):
    for line in textwrap.wrap(text, width=width):
        d.text((x, y), line, font=fnt, fill=fill)
        y += leading
    return y

def board_view(path, rows, count_line, verdict_filter=None):
    img = Image.new("RGB", (1280, 900), BG)
    d = ImageDraw.Draw(img)
    y = hero(d)
    y = controls(d, y, verdict_filter)
    d.text((16, y), count_line, font=font(13), fill=MUT)
    y += 28
    table(d, y, rows)
    img.save(path)
    print(path, img.size)

def detail_view(path):
    r = ROWS[0]
    img = Image.new("RGB", (1280, 900), BG)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([16, 16, 1264, 92], radius=14, outline=LINE, fill=(13, 27, 51))
    d.text((40, 34), "Token Radar v3", font=font(24, True), fill=INK)
    d.text((40, 66), "Detail view — click any protocol in the board to open it", font=font(13), fill=MUT)
    y = 108
    d.rounded_rectangle([16, y, 1264, y + 620], radius=14, outline=TEAL_DK, fill=PANEL)
    d.text((40, y + 18), r["name"], font=font(24, True), fill=INK)
    badge(d, 40 + d.textlength(r["name"], font=font(24, True)) + 16, y + 22, r["verdict"])
    d.text((40, y + 56), "Rank %d of %d  ·  %s  ·  %s%s" % (r["rank"], len(ROWS), r["category"], ", ".join(r["chains"][:3]), "   ·   ON THE HOUSE WATCHLIST" if r["on_watchlist"] else ""), font=font(13), fill=MUT)
    boxes = [
        ("IMPLIED VALUE", money_full(r["implied_value_usd"]), "80%% interval %s – %s" % (money(r["implied_low_usd"]), money(r["implied_high_usd"]))),
        ("TVL", money_full(r["tvl_usd"]), "TVL %s in 7 days" % pct(r["change_7d"])),
        ("RUNNING WITH NO TOKEN", "%.1f yr" % (r["age_months"] / 12), "since DefiLlama first tracked it"),
        ("FARM COST, 3 MONTHS", "$%.2f" % r["cost_3mo_usd"], "$%.2f/month on %s · break-even %.4f%%" % (r["monthly_cost_usd"], r["cheapest_chain"], r["breakeven_share_pct"])),
    ]
    x = 40
    for title, val, sub in boxes:
        d.rounded_rectangle([x, y + 92, x + 292, y + 172], radius=10, outline=LINE, fill=PANEL2)
        d.text((x + 14, y + 106), title, font=font(10, True), fill=MUT)
        d.text((x + 14, y + 132), val, font=font(17, True), fill=INK)
        sy = y + 156
        for ln in textwrap.wrap(sub, width=34)[:2]:
            d.text((x + 14, sy), ln, font=font(11), fill=MUT)
            sy += 15
        x += 304
    y2 = y + 190
    d.text((40, y2), "HOW THE VALUE IS BUILT", font=font(12, True), fill=TEAL)
    peer_txt = ("tokenised peers in %s trade at a median %s× TVL (%d peers) — shown for context, not used in the value."
                % (r["category"], r["peer_median_multiple"], r["peer_count"]) if r["peer_median_multiple"] is not None
                else "fewer than 3 tokenised peers in this category, so no category multiple is shown.")
    y2 = wrap_text(d, "log(market cap) = %.3f + %.3f × log(TVL), fitted on %d tokenised peers. For this TVL the line gives %s; the interval comes from the fit's residual spread (σ = %.3f in logs). %s" % (data["intercept"], data["slope"], data["peer_count"], money(r["implied_value_usd"]), data["resid_sd"], peer_txt), font(13), 118, 40, y2 + 22, MUT)
    d.text((40, y2 + 8), "VERDICT " + r["verdict"], font=font(12, True), fill=TEAL)
    y2 = wrap_text(d, r["verdict_reason"], font(13), 118, 40, y2 + 30, MUT)
    d.text((40, y2 + 10), "FARM PLAN — 3 MONTHS, ABOUT $%.2f OF GAS" % r["cost_3mo_usd"], font=font(12, True), fill=TEAL)
    y2 += 34
    for i, s in enumerate(r["farm_steps"], 1):
        y2 = wrap_text(d, "%d. %s" % (i, s), font(13), 118, 40, y2, INK)
        y2 += 4
    d.text((16, 868), "Snapshot 2026-11-14 · DefiLlama · implied values are this board's own claim, never the snapshot's", font=font(12), fill=DIM)
    img.save(path)
    print(path, img.size)

board_view(ROOT + "/screenshots/1-board.png", ROWS,
           "Showing %d of %d ranked protocols · snapshot %s · click a protocol for its detail and farm plan · click a column header to sort" % (len(ROWS), len(ROWS), data["as_of"]))
farm_rows = [r for r in ROWS if r["verdict"] == "FARM"]
board_view(ROOT + "/screenshots/3-filtered.png", farm_rows,
           "Showing %d of %d ranked protocols · snapshot %s · filter: verdict = FARM" % (len(farm_rows), len(ROWS), data["as_of"]),
           verdict_filter="FARM")
detail_view(ROOT + "/screenshots/2-detail.png")
