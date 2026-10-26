/* Web-version overrides: the desktop app built PDFs on the server; here we open a print-ready report
   (Save as PDF from the print dialog) and add a "restore catalog" action. Loaded after the dashboard script. */
(function () {
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var usd = function (n, d) { return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d }); };
  var table = function (head, rows) {
    return '<table><thead><tr>' + head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>';
  };
  var el = function (id) { return document.getElementById(id); };

  async function build(tab) {
    var api = Jarod.api, body = '', title = '';
    if (tab === 'arbitrage') {
      var model = el('arbModel').value, task = el('arbTask').value, tokens = parseInt(el('arbTokens').value, 10) || 500000;
      var res = await api('POST', '/api/arbitrage', { model: model, task_type: task, monthly_tokens: tokens });
      title = 'Arbitrage Report';
      body = '<p class="meta">Current model: <b>' + esc(model) + '</b> &middot; Task: <b>' + esc(task) + '</b> &middot; Volume: <b>' + tokens.toLocaleString() + ' tokens/month</b></p>' +
        (res.length ? table(['Switch to', 'Provider', 'Monthly savings', 'Annual impact', 'Savings', 'Confidence'], res.map(function (r) {
          return [esc(r.current_model) + ' &rarr; <b>' + esc(r.recommended_model) + '</b>', esc(r.provider), usd(r.current_cost_monthly - r.new_cost_monthly), usd(r.annual_savings, 0), r.savings_pct + '%', r.confidence + '%'];
        })) : '<p>No cheaper alternatives found; this model is already cost-optimal for the task.</p>');
    } else if (tab === 'recommend') {
      var role = el('recRole').value;
      if (!role) throw new Error('Pick a role first');
      var r = await api('POST', '/api/recommend', { role: role });
      title = 'Role Recommendation';
      body = '<h2>' + esc(r.role) + ' <small>' + esc(r.industry) + '</small></h2>' +
        '<p class="meta">Tier: <b>' + esc(r.tier) + '</b> &middot; Complexity ' + r.complexity + '/5 &middot; Stakes ' + r.stakes + '/5 &middot; Volume ' + esc(r.volume) + ' &middot; Budget ' + r.monthly_token_budget.toLocaleString() + ' tokens/mo</p>' +
        '<p>Tasks: ' + r.tasks.map(esc).join(', ') + '</p>' +
        table(['Model', 'Provider', 'Input / Output per 1M', 'Est. monthly cost'], r.recommended_models.map(function (m) {
          return ['<b>' + esc(m.model) + '</b>', esc(m.provider), usd(m.input_cost) + ' / ' + usd(m.output_cost), usd(m.monthly_cost)];
        })) + '<p>' + esc(r.reasoning) + '</p><p><b>Upgrade trigger:</b> ' + esc(r.upgrade_trigger) + '</p>';
    } else if (tab === 'onboard') {
      var role2 = (el('obRole') || el('roiRole') || {}).value;
      if (!role2) throw new Error('Pick a role first');
      var o = await api('POST', '/api/onboard', { role: role2 });
      title = 'Onboarding Plan';
      body = '<h2>' + esc(o.role) + ' <small>' + esc(o.industry) + '</small></h2>' +
        '<p class="meta"><b>' + o.total_days + '</b> business days (' + o.total_weeks + ' weeks) &middot; multiplier <b>' + o.kw_multiplier + 'x</b> &middot; tier ' + esc(o.tier) + ' &middot; ' + o.monthly_token_budget.toLocaleString() + ' tokens/mo</p>' +
        '<h3>Phases</h3>' + table(['Phase', 'Days', 'What happens'], o.phases.map(function (p) { return [esc(p.label), p.days, esc(p.description)]; })) +
        '<h3>Milestones</h3>' + table(['Day', 'Milestone', 'Detail'], o.milestones.map(function (m) { return [m.day, esc(m.label), esc(m.description)]; })) +
        (o.risks.length ? '<h3>Risks</h3>' + table(['Level', 'Factor', 'Detail'], o.risks.map(function (k) { return [esc(k.level), esc(k.factor), esc(k.detail)]; })) : '') +
        '<p>' + esc(o.reasoning) + '</p>';
    } else {
      var scan = await api('GET', '/api/insights/arbitrage-scan'), fit = await api('GET', '/api/insights/role-fit');
      title = 'Insights Report';
      var s = scan.summary;
      body = '<p class="meta">' + s.groups_scanned + ' groups scanned &middot; ' + s.opportunities_found + ' opportunities &middot; <b>' + usd(s.total_monthly_savings) + '/mo</b> (' + usd(s.total_annual_savings, 0) + '/yr)</p>' +
        '<h3>Arbitrage opportunities</h3>' + table(['Employee', 'Task', 'Switch', 'Monthly', 'Annual', 'Confidence'], scan.opportunities.map(function (x) {
          return [esc(x.employee) + '<br><small>' + esc(x.department) + '</small>', esc(x.task_type), esc(x.current_model) + ' &rarr; <b>' + esc(x.recommended_model) + '</b>', usd(x.monthly_savings), usd(x.annual_savings, 0), x.confidence + '%'];
        })) +
        '<h3>Role fit</h3><p class="meta">Matched ' + fit.summary.matched + ' &middot; Over-provisioned ' + fit.summary.over_provisioned + ' &middot; Under-provisioned ' + fit.summary.under_provisioned + ' &middot; Recoverable ' + usd(fit.summary.total_overprovision_savings) + '/mo</p>' +
        table(['Employee', 'Role', 'Primary model', 'Status', 'Recoverable / mo'], fit.results.map(function (x) {
          return [esc(x.employee), esc(x.role), esc(x.primary_model) + ' <small>(' + esc(x.model_tier) + ')</small>', esc(x.status), x.potential_savings > 0 ? usd(x.potential_savings) : '&mdash;'];
        }));
    }
    return '<!doctype html><html><head><meta charset="utf-8"><title>Jarod - ' + esc(title) + '</title><style>' +
      'body{font:13px/1.5 Inter,Arial,sans-serif;color:#111;margin:32px}h1{font-size:20px;margin:0 0 4px}h2{font-size:17px;margin:14px 0 4px}h2 small{font-weight:400;color:#555;font-size:12px}h3{font-size:13px;text-transform:uppercase;letter-spacing:.6px;margin:20px 0 6px}' +
      '.meta{color:#444}table{width:100%;border-collapse:collapse;margin:6px 0}th,td{border-bottom:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f3f4f6;font-size:11px;text-transform:uppercase;letter-spacing:.5px}' +
      '.foot{margin-top:24px;color:#777;font-size:11px}</style></head><body><h1>Jarod &mdash; ' + esc(title) + '</h1><div class="meta">Generated ' + new Date().toLocaleString() + '</div>' + body +
      '<p class="foot">Dollar figures assume a 60/40 input/output token split. Savings and quality figures are directional estimates, not guarantees.</p></body></html>';
  }

  window.exportPDF = async function (tab) {
    var btn = window.event && window.event.currentTarget, label = btn && btn.textContent;
    var w = window.open('', '_blank');
    if (!w) { alert('Allow pop-ups for this site to export the report.'); return; }
    w.document.write('<p style="font:14px sans-serif">Building report&hellip;</p>');
    if (btn) { btn.textContent = 'Building report…'; btn.disabled = true; }
    try {
      var html = await build(tab);
      w.document.open(); w.document.write(html); w.document.close();
      setTimeout(function () { try { w.focus(); w.print(); } catch (e) {} }, 400);
    } catch (e) {
      w.close(); alert('Report failed: ' + e.message);
    } finally {
      if (btn) { btn.textContent = label; btn.disabled = false; }
    }
  };

  /* Provider picker: first-run (blank slate) and reachable from Settings. */
  window.restorePricing = async function (firstRun) {
    var list = await (await fetch('/api/pricing/providers')).json();
    var old = el('providerPicker'); if (old) old.remove();
    var d = document.createElement('div');
    d.id = 'providerPicker';
    d.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:16px';
    d.innerHTML = '<div style="background:var(--bg-card,#14181f);color:var(--text-primary,#e8ecf1);border:1px solid var(--border,#2a3140);border-radius:12px;max-width:460px;width:100%;max-height:88vh;overflow:auto;padding:24px;font-family:inherit">' +
      '<h2 style="margin:0 0 6px;font-size:18px">' + (firstRun === true ? 'Welcome to Jarod' : 'Choose providers') + '</h2>' +
      '<p style="margin:0 0 14px;font-size:12px;line-height:1.5;color:var(--text-secondary,#9aa4b2)">Pick the AI providers you use or want to compare. Jarod starts empty and only tracks what you select. Prices are a built-in snapshot; add an API key in Settings to refresh them live.</p>' +
      '<div id="ppList">' + list.map(function (p) {
        return '<label style="display:flex;align-items:center;gap:10px;padding:7px 4px;font-size:13px;cursor:pointer"><input type="checkbox" value="' + esc(p.provider) + '"' + (p.selected ? ' checked' : '') + '> <span style="flex:1">' + esc(p.provider) + '</span><span style="color:var(--text-dim,#6b7686);font-size:11px">' + p.models + ' models</span></label>';
      }).join('') + '</div>' +
      '<div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end"><button class="btn btn-secondary" id="ppCancel">' + (firstRun === true ? 'Skip for now' : 'Cancel') + '</button><button class="btn btn-primary" id="ppSave">Start tracking</button></div></div>';
    document.body.appendChild(d);
    el('ppCancel').onclick = function () { d.remove(); };
    el('ppSave').onclick = async function () {
      var picked = Array.prototype.map.call(d.querySelectorAll('#ppList input:checked'), function (i) { return i.value; });
      await fetch('/api/pricing/select-providers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ providers: picked }) });
      location.reload();
    };
  };

  fetch('/api/pricing').then(function (r) { return r.json(); }).then(function (p) { if (!p.length) window.restorePricing(true); });
})();
