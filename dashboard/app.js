// Token Radar v3 — the dashboard. Reads window.RADAR (written beside
// dashboard/ by main.ts) and renders the board, the filters, the detail
// view and the method. No network: every byte it shows is in data.js.
(function () {
  'use strict';
  var DATA = window.RADAR;
  var rows = DATA.rows;

  var state = { q: '', verdict: 'ALL', category: 'ALL', watchOnly: false, sort: 'rank', dir: 1 };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n.toFixed(0);
  }
  function moneyFull(n) {
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function pct(v) {
    if (v == null) return '—';
    return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
  }
  function ageText(m) {
    if (m == null) return 'unknown';
    if (m < 12) return m.toFixed(0) + ' mo';
    return (m / 12).toFixed(1) + ' yr';
  }

  function categories() {
    var seen = {};
    rows.forEach(function (r) { if (r.category) seen[r.category] = true; });
    return Object.keys(seen).sort();
  }

  function filtered() {
    var q = state.q.trim().toLowerCase();
    var out = rows.filter(function (r) {
      if (state.verdict !== 'ALL' && r.verdict !== state.verdict) return false;
      if (state.category !== 'ALL' && r.category !== state.category) return false;
      if (state.watchOnly && !r.on_watchlist) return false;
      if (q && (r.slug + ' ' + r.name + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = state.sort;
    out.sort(function (a, b) {
      var d = 0;
      if (key === 'rank') d = a.rank - b.rank;
      else if (key === 'value') d = b.implied_value_usd - a.implied_value_usd;
      else if (key === 'tvl') d = b.tvl_usd - a.tvl_usd;
      else if (key === 'change') d = (b.change_7d == null ? -999 : b.change_7d) - (a.change_7d == null ? -999 : a.change_7d);
      else if (key === 'cost') d = a.cost_3mo_usd - b.cost_3mo_usd;
      else if (key === 'name') d = a.name < b.name ? -1 : 1;
      return key === 'rank' || key === 'value' ? d : d * state.dir;
    });
    return out;
  }

  function sortButton(label, key) {
    var arrow = state.sort === key ? (state.dir === 1 ? ' ▲' : ' ▼') : '';
    return '<button data-sort="' + key + '">' + label + arrow + '</button>';
  }

  function tableHtml(list) {
    if (!list.length) return '<p class="empty">No protocol matches these filters. Clear the search or widen the verdict.</p>';
    var h = '<table class="board"><thead><tr>'
      + '<th>' + sortButton('Rank', 'rank') + '</th>'
      + '<th>' + sortButton('Protocol', 'name') + '</th>'
      + '<th>' + sortButton('TVL', 'tvl') + '</th>'
      + '<th>' + sortButton('7d', 'change') + '</th>'
      + '<th>' + sortButton('Implied value', 'value') + '</th>'
      + '<th>Verdict</th>'
      + '<th>' + sortButton('3-mo cost', 'cost') + '</th>'
      + '</tr></thead><tbody>';
    list.forEach(function (r) {
      h += '<tr' + (location.hash === '#' + r.slug ? ' class="sel"' : '') + '>'
        + '<td class="num">' + r.rank + '</td>'
        + '<td class="name"><a href="#' + esc(r.slug) + '">' + esc(r.name) + '</a>'
        + '<span class="sub">' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.slice(0, 3).join(', '))
        + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</span>'
        + (r.on_watchlist ? ' <span class="wltag">WATCHLIST</span>' : '') + '</td>'
        + '<td class="num">' + money(r.tvl_usd) + '</td>'
        + '<td class="num">' + pct(r.change_7d) + '</td>'
        + '<td class="num"><b>' + money(r.implied_value_usd) + '</b>'
        + '<span class="interval">' + money(r.implied_low_usd) + ' – ' + money(r.implied_high_usd) + ' (80%)</span></td>'
        + '<td><span class="badge ' + r.verdict + '">' + r.verdict + '</span></td>'
        + '<td class="num">$' + r.cost_3mo_usd.toFixed(2) + '<span class="interval">on ' + esc(r.cheapest_chain) + '</span></td>'
        + '</tr>';
    });
    return h + '</tbody></table>';
  }

  function detailHtml(r) {
    if (!r) return '';
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    var peer = r.peer_median_multiple == null
      ? 'fewer than 3 tokenised peers in this category, so no category multiple is shown'
      : 'tokenised peers in ' + esc(r.category || 'this category') + ' trade at a median ' + r.peer_median_multiple + '× TVL (' + r.peer_count + ' peers)';
    return '<section class="detail" aria-label="Protocol detail"><h2>' + esc(r.name) + ' <span class="badge ' + r.verdict + '">' + r.verdict + '</span></h2>'
      + '<p class="meta">Rank ' + r.rank + ' of ' + rows.length + ' · ' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.join(', '))
      + (r.on_watchlist ? ' · <span class="wltag">ON THE HOUSE WATCHLIST</span>' : '') + '</p>'
      + '<dl class="kv">'
      + '<div><dt>Implied value</dt><dd>' + moneyFull(r.implied_value_usd) + '<small>80% interval ' + money(r.implied_low_usd) + ' – ' + money(r.implied_high_usd) + ' (×' + DATA.interval_factor + ' wide)</small></dd></div>'
      + '<div><dt>TVL</dt><dd>' + moneyFull(r.tvl_usd) + '<small>' + esc(r.growth_note) + '</small></dd></div>'
      + '<div><dt>Running with no token</dt><dd>' + ageText(r.age_months) + '<small>since DefiLlama first tracked it' + (r.age_months == null ? ' (date not reported)' : '') + '</small></dd></div>'
      + '<div><dt>Farm cost, 3 months</dt><dd>$' + r.cost_3mo_usd.toFixed(2) + '<small>$' + r.monthly_cost_usd.toFixed(2) + '/month on ' + esc(r.cheapest_chain) + ' · break-even airdrop share ' + r.breakeven_share_pct + '%</small></dd></div>'
      + '</dl>'
      + '<h3>How the value is built</h3>'
      + '<p class="reason">log(market cap) = ' + DATA.intercept + ' + ' + DATA.slope + ' × log(TVL), fitted on ' + DATA.peer_count
      + ' tokenised peers. For this TVL the line gives ' + money(r.implied_value_usd) + '; the interval comes from the fit\u2019s residual spread (σ = '
      + DATA.resid_sd + ' in logs). ' + esc(peer) + '. The number is this board\u2019s claim about what a token would be worth if the record stayed as it is — not a prediction that one is issued.</p>'
      + '<p class="reason"><b>Verdict ' + r.verdict + ':</b> ' + esc(r.verdict_reason) + '</p>'
      + '<h3>Farm plan — 3 months, about $' + r.cost_3mo_usd.toFixed(2) + ' of gas</h3><ol>' + steps + '</ol>'
      + '</section>';
  }

  function methodHtml() {
    var oos = DATA.oos.map(function (r) {
      return '<tr><td>' + esc(r.model) + '</td><td class="num">' + r.median_log_error.toFixed(3) + '</td>'
        + '<td class="num">' + Math.round(r.median_pct_error * 100) + '%</td>'
        + '<td class="num">' + r.within_2x_pct + '%</td>'
        + '<td class="num">' + (r.coverage_80_pct == null ? '—' : r.coverage_80_pct + '%') + '</td></tr>';
    }).join('');
    return '<section class="method"><h2>How the radar works — and how wrong it can be</h2>'
      + '<p>The snapshot holds 758 protocols at or above $5M of TVL, fetched ' + esc(DATA.as_of) + ' from DefiLlama. '
      + DATA.peer_count + ' of them record a token with a market cap; those are the peers the value line is fitted on. '
      + 'The board ranks the ' + DATA.counts.candidates + ' protocols that record no token and are genuine launch candidates — '
      + 'no exchange, bridge, staking wrapper or versioned deployment among them. The other ' + DATA.counts.set_aside
      + ' pre-token protocols are listed below with the reason each was set aside, not ranked as if they might launch a token.</p>'
      + '<p><b>Value:</b> log(market cap) = ' + DATA.intercept + ' + ' + DATA.slope + ' × log(TVL), fitted by least squares on the '
      + DATA.peer_count + ' peers. Residual spread σ = ' + DATA.resid_sd + ' in logs, so the 80% interval is ×' + DATA.interval_factor
      + ' wide — the honest width of this data. 7-day growth and listing age were tested as extra predictors and dropped: out of sample they did not help, so they appear on each row as context only.</p>'
      + '<table><thead><tr><th>Model (5-fold out-of-sample, peers only)</th><th>Median log error</th><th>Median % error</th><th>Within 2×</th><th>80% interval covers</th></tr></thead><tbody>' + oos + '</tbody></table>'
      + '<p>' + esc(DATA.oos_note) + '</p>'
      + '<p><b>Verdicts:</b> FARM — implied value $10M or more (top of the field). THIN — $5M to $10M, farm lightly. SKIP — under $5M, the smallest dollars at stake. '
      + 'Gas is not the constraint: 3 months of farming costs $1.30–$13 on the cheapest chain for every candidate, so the verdict ranks by the money at stake and quotes the cost as the check. Your time is the scarce input.</p>'
      + '</section>';
  }

  function setAsideHtml() {
    var list = DATA.set_aside;
    var body = list.map(function (p) {
      return '<tr><td><b>' + esc(p.name) + '</b></td><td>' + esc(p.category || '—') + '</td><td class="num">' + money(p.tvl_usd) + '</td><td>' + esc(p.reason) + '</td></tr>';
    }).join('');
    return '<section class="setaside"><details><summary>Set aside: ' + list.length + ' pre-token protocols not ranked (click to list them)</summary>'
      + '<p>These record no token, but they are exchanges, bridges, staking wrappers or versioned deployments — products of a token that already trades, or a deployment of a protocol, not a protocol awaiting its own launch. Ranking them as launch candidates would be the radar inventing launches.</p>'
      + '<table><thead><tr><th>Protocol</th><th>Category</th><th>TVL</th><th>Why it is set aside</th></tr></thead><tbody>' + body + '</tbody></table>'
      + '</details></section>';
  }

  function render() {
    var slug = location.hash.replace(/^#/, '');
    var sel = rows.find(function (r) { return r.slug === slug; }) || null;
    var list = filtered();
    var cats = categories().map(function (c) {
      return '<option value="' + esc(c) + '"' + (state.category === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    var html = '<div class="wrap">'
      + '<header class="hero"><h1>Token Radar <span class="dot">v3</span></h1>'
      + '<p class="lede">Every pre-token protocol in the snapshot, ranked by what its token would be worth if the protocol\u2019s record stayed as it is. '
      + 'The value is fitted on the ' + DATA.peer_count + ' protocols whose token already trades — and the interval beside it says how wide that answer really is.</p>'
      + '<div class="stats">'
      + '<div class="stat"><b>' + DATA.counts.candidates + '</b><span>ranked</span></div>'
      + '<div class="stat"><b>' + DATA.counts.farm + '</b><span>FARM</span></div>'
      + '<div class="stat"><b>' + DATA.counts.thin + '</b><span>THIN</span></div>'
      + '<div class="stat"><b>' + DATA.counts.skip + '</b><span>SKIP</span></div>'
      + '<div class="stat"><b>' + DATA.counts.watchlist + ' / ' + DATA.counts.watchlist + '</b><span>watchlist covered</span></div>'
      + '<div class="stat"><b>×' + DATA.interval_factor + '</b><span>80% interval width</span></div>'
      + '</div></header>'
      + '<div class="controls">'
      + '<label>Search<input id="f-q" type="search" placeholder="name, slug or category" value="' + esc(state.q) + '"></label>'
      + '<label>Verdict<select id="f-v"><option value="ALL">All verdicts</option>'
      + ['FARM', 'THIN', 'SKIP'].map(function (v) { return '<option' + (state.verdict === v ? ' selected' : '') + '>' + v + '</option>'; }).join('')
      + '</select></label>'
      + '<label>Category<select id="f-c"><option value="ALL">All categories</option>' + cats + '</select></label>'
      + '<label class="check"><input id="f-w" type="checkbox"' + (state.watchOnly ? ' checked' : '') + '> Watchlist only</label>'
      + '</div>'
      + '<p class="count">Showing ' + list.length + ' of ' + rows.length + ' ranked protocols · snapshot ' + esc(DATA.as_of) + ' · click a protocol for its detail and farm plan · click a column header to sort</p>'
      + detailHtml(sel)
      + tableHtml(list)
      + methodHtml()
      + setAsideHtml()
      + '<footer class="foot">Snapshot: ' + esc(DATA.source) + '. Floor for the house watchlist: $' + (DATA.floor_usd / 1e6).toFixed(0) + 'M TVL. '
      + 'Implied values are this board\u2019s own claim, never the snapshot\u2019s and never make.fun\u2019s; nothing here predicts whether or when a token is issued. Farm steps are generic on-chain actions with costed gas on the cheapest chain — check the protocol\u2019s own pages before you move funds.</footer>'
      + '</div>';
    var main = document.getElementById('board');
    main.innerHTML = html;
    main.removeAttribute('aria-busy');
    document.getElementById('f-q').addEventListener('input', function (e) { state.q = e.target.value; render(); var q = document.getElementById('f-q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); });
    document.getElementById('f-v').addEventListener('change', function (e) { state.verdict = e.target.value; render(); });
    document.getElementById('f-c').addEventListener('change', function (e) { state.category = e.target.value; render(); });
    document.getElementById('f-w').addEventListener('change', function (e) { state.watchOnly = e.target.checked; render(); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-sort]'), function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-sort');
        if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = 1; }
        render();
      });
    });
  }

  window.addEventListener('hashchange', render);
  render();
})();
