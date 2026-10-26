/* Jarod web engine - replaces the Flask/SQLite backend of the desktop app.
   Intercepts fetch('/api/...') and answers from data held in this browser (IndexedDB). */
(function () {
  'use strict';
  var VERSION = '3.0.0-web';
  var SEED = window.JAROD_SEED;
  var origFetch = window.fetch.bind(window);
  var S = { pricing: [], history: [], proposals: [], usage: [], insights: [], nextProp: 1, nextUsage: 1 };

  /* ---------- storage (IndexedDB key/value, in-memory fallback) ---------- */
  var db = null;
  function openDB() {
    return new Promise(function (res) {
      try {
        var rq = indexedDB.open('jarod-tokenomics', 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore('kv'); };
        rq.onsuccess = function () { res(rq.result); };
        rq.onerror = function () { res(null); };
      } catch (e) { res(null); }
    });
  }
  function kvAll() {
    return new Promise(function (res) {
      if (!db) return res({});
      var out = {}, tx = db.transaction('kv', 'readonly'), cur = tx.objectStore('kv').openCursor();
      cur.onsuccess = function () {
        var c = cur.result;
        if (c) { out[c.key] = c.value; c.continue(); } else res(out);
      };
      cur.onerror = function () { res({}); };
    });
  }
  var saveTimer = null, dirty = {};
  function persist(key) {
    dirty[key] = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      if (!db) return;
      try {
        var tx = db.transaction('kv', 'readwrite'), st = tx.objectStore('kv');
        Object.keys(dirty).forEach(function (k) { st.put(S[k], k); });
        dirty = {};
      } catch (e) { /* storage unavailable: keep working in memory */ }
    }, 200);
  }
  var lsGet = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };
  var lsSet = function (k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} };

  function seedPricing() {
    S.pricing = SEED.pricing.map(function (m) { return Object.assign({}, m); });
    S.history = SEED.history.map(function (h) { return Object.assign({}, h); });
    S.proposals = [];
    persist('pricing'); persist('history'); persist('proposals');
  }
  var ready = (async function () {
    db = await openDB();
    var all = await kvAll();
    ['pricing', 'history', 'proposals', 'usage', 'insights'].forEach(function (k) { if (Array.isArray(all[k])) S[k] = all[k]; });
    S.nextProp = all.nextProp || (S.proposals.reduce(function (a, p) { return Math.max(a, p.id); }, 0) + 1);
    S.nextUsage = all.nextUsage || 1;
    /* blank slate: nothing is preloaded; the user picks providers on first run (see overrides.js) */
  })();
  function providerList() {
    var have = {}, seed = {};
    S.pricing.forEach(function (m) { have[m.provider] = true; });
    SEED.pricing.forEach(function (m) { seed[m.provider] = (seed[m.provider] || 0) + 1; });
    return Object.keys(seed).sort().map(function (p) { return { provider: p, models: seed[p], selected: !!have[p] }; });
  }
  /* Additive: keeps live-refreshed prices for providers already tracked, adds seed rows for new ones, drops unchecked ones. */
  function selectProviders(list) {
    var keep = {};
    (list || []).forEach(function (p) { keep[p] = true; });
    var have = {};
    S.pricing = S.pricing.filter(function (m) { return keep[m.provider]; });
    S.history = S.history.filter(function (h) { return keep[h.provider]; });
    S.proposals = S.proposals.filter(function (p) { return keep[p.provider]; });
    S.pricing.forEach(function (m) { have[m.provider] = true; });
    SEED.pricing.forEach(function (m) { if (keep[m.provider] && !have[m.provider]) S.pricing.push(Object.assign({}, m)); });
    SEED.history.forEach(function (h) { if (keep[h.provider] && !have[h.provider]) S.history.push(Object.assign({}, h)); });
    S.pricing.sort(function (a, b) { return a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model); });
    persist('pricing'); persist('history'); persist('proposals');
    return { models: S.pricing.length, providers: Object.keys(keep).length };
  }

  /* ---------- reference data ---------- */
  var TASKS = ['code generation', 'analysis', 'writing', 'summarization', 'research', 'customer support', 'contract review', 'data extraction', 'classification'];
  var TASK_MIN = { 'code generation': 86, 'analysis': 86, 'writing': 82, 'summarization': 78, 'research': 84, 'customer support': 78, 'contract review': 92, 'data extraction': 76, 'classification': 70 };
  var TIER_BASE = { frontier: 90, reasoning: 90, standard: 82, efficiency: 70 };
  var TIER_RANK = { efficiency: 1, standard: 2, frontier: 3, reasoning: 3 };
  var Q_OVERRIDE = {
    'Claude Fable 5': 99, 'Claude Opus 5': 98, 'Claude Opus 4.8': 97, 'Claude Opus 4.7': 96, 'Claude Opus 4.6': 96, 'Claude Opus 4.5': 95,
    'Claude Opus 4.1': 93, 'Claude Opus 4': 92, 'Claude Sonnet 5': 95, 'Claude Sonnet 4.6': 92, 'Claude Sonnet 4.5': 91, 'Claude Sonnet 4': 89,
    'Claude Haiku 4.5': 85, 'Claude Haiku 3.5': 78, 'Claude 3 Haiku': 68,
    'GPT-4.1': 90, 'GPT-4o': 88, 'GPT-4.1 Mini': 82, 'GPT-4o Mini': 77, 'GPT-4.1 Nano': 68, 'o3': 96, 'o3 Mini': 86, 'o4 Mini': 88,
    'Gemini 2.5 Pro': 93, 'Gemini 2.5 Flash': 84, 'Gemini 2.0 Flash': 76,
    'Mistral Large 2': 85, 'Mistral Small 3': 72, 'DeepSeek R1': 90, 'DeepSeek V3': 84, 'Grok 3': 87, 'Grok 3 Mini': 78,
    'Llama 4 Maverick': 80, 'Llama 4 Scout': 74, 'Command R+': 80, 'Command R': 70, 'Qwen3 235B': 86, 'Kimi K3': 91
  };

  function isVariant(name) { return /\((batch|fast)\)/i.test(name); }
  function baseName(name) { return name.replace(/\s*\((batch|fast)\)\s*/i, '').trim(); }
  function findModel(name) {
    var n = String(name || '').trim().toLowerCase();
    return S.pricing.find(function (m) { return m.model.toLowerCase() === n; }) || null;
  }
  function blended(m, inFrac) { inFrac = inFrac == null ? 0.6 : inFrac; return m.input * inFrac + m.output * (1 - inFrac); }
  /* Returns {q, est}: est=true when the score comes from the price-tier baseline instead of a hand-set value. */
  function quality(m, task) {
    var base = Q_OVERRIDE[baseName(m.model)], est = base == null;
    var q = est ? (TIER_BASE[m.tier] || 80) : base;
    var n = m.model;
    if (/code|coder/i.test(n)) q += task === 'code generation' ? 5 : -4;
    if (m.tier === 'reasoning') q += /analysis|research|contract review/.test(task) ? 3 : -3;
    if (/sonar/i.test(n)) q += task === 'research' ? 4 : -6;
    if (/guard/i.test(n)) q = task === 'classification' ? 85 : 40;
    return { q: Math.max(30, Math.min(99, q)), est: est };
  }

  /* roles: name -> [industry, tier, complexity, stakes, volume, tasks] */
  var ROLE_ROWS = [
    ['Senior Software Engineer', 'Technology', 'frontier', 5, 3, 'high', ['code generation', 'analysis', 'research']],
    ['Junior Software Engineer', 'Technology', 'standard', 3, 2, 'high', ['code generation', 'summarization']],
    ['QA Engineer', 'Technology', 'standard', 3, 3, 'medium', ['code generation', 'analysis', 'data extraction']],
    ['DevOps Engineer', 'Technology', 'standard', 4, 4, 'medium', ['code generation', 'analysis']],
    ['Data Engineer', 'Technology', 'standard', 4, 3, 'high', ['code generation', 'data extraction', 'analysis']],
    ['Data Scientist', 'Technology', 'reasoning', 5, 3, 'high', ['analysis', 'code generation', 'research']],
    ['Data Analyst', 'Technology', 'standard', 3, 3, 'high', ['analysis', 'data extraction', 'summarization']],
    ['Technical Writer', 'Technology', 'standard', 2, 2, 'medium', ['writing', 'summarization']],
    ['UX Designer', 'Technology', 'standard', 3, 2, 'medium', ['research', 'writing', 'summarization']],
    ['Product Manager', 'Technology', 'frontier', 4, 3, 'medium', ['research', 'analysis', 'writing', 'summarization']],
    ['Project Manager', 'Operations & People', 'standard', 3, 3, 'medium', ['summarization', 'writing', 'analysis']],
    ['HR Specialist', 'Operations & People', 'standard', 2, 3, 'medium', ['writing', 'summarization', 'classification']],
    ['Recruiter', 'Operations & People', 'efficiency', 2, 2, 'high', ['writing', 'classification', 'summarization']],
    ['Business Analyst', 'Operations & People', 'standard', 3, 3, 'medium', ['analysis', 'research', 'summarization']],
    ['Financial Analyst', 'Financial Services', 'frontier', 4, 4, 'high', ['analysis', 'data extraction', 'research']],
    ['Accountant', 'Financial Services', 'standard', 3, 4, 'medium', ['data extraction', 'classification', 'analysis']],
    ['Loan Officer', 'Financial Services', 'standard', 3, 4, 'medium', ['customer support', 'data extraction', 'analysis']],
    ['Compliance Officer', 'Financial Services', 'frontier', 4, 5, 'medium', ['contract review', 'analysis', 'research']],
    ['Actuary', 'Insurance', 'reasoning', 5, 5, 'medium', ['analysis', 'research', 'code generation']],
    ['Underwriter', 'Insurance', 'frontier', 4, 5, 'medium', ['analysis', 'data extraction', 'contract review']],
    ['Claims Adjuster', 'Insurance', 'standard', 3, 4, 'high', ['data extraction', 'summarization', 'classification']],
    ['Senior Attorney', 'Legal', 'frontier', 5, 5, 'medium', ['contract review', 'research', 'writing']],
    ['Junior Attorney', 'Legal', 'frontier', 4, 5, 'medium', ['contract review', 'research', 'writing']],
    ['Paralegal', 'Legal', 'standard', 3, 4, 'high', ['summarization', 'data extraction', 'contract review']],
    ['Legal Secretary', 'Legal', 'efficiency', 2, 3, 'medium', ['writing', 'summarization', 'classification']],
    ['Nurse Practitioner', 'Healthcare', 'frontier', 4, 5, 'medium', ['summarization', 'research', 'writing']],
    ['Pharmacist', 'Healthcare', 'standard', 4, 5, 'medium', ['research', 'data extraction', 'customer support']],
    ['Clinical Researcher', 'Healthcare', 'reasoning', 5, 5, 'medium', ['research', 'analysis', 'summarization']],
    ['Medical Coder', 'Healthcare', 'efficiency', 2, 4, 'high', ['classification', 'data extraction']],
    ['Healthcare Admin', 'Healthcare', 'efficiency', 2, 3, 'medium', ['summarization', 'writing', 'classification']],
    ['Sales Representative', 'Sales & Marketing', 'standard', 2, 2, 'high', ['writing', 'research', 'summarization']],
    ['Marketing Manager', 'Sales & Marketing', 'standard', 3, 2, 'high', ['writing', 'analysis', 'research']],
    ['Content Writer', 'Sales & Marketing', 'standard', 2, 2, 'high', ['writing', 'research', 'summarization']],
    ['Customer Success Manager', 'Customer Experience', 'standard', 3, 3, 'high', ['customer support', 'summarization', 'writing']],
    ['Customer Support Rep', 'Customer Experience', 'efficiency', 2, 2, 'high', ['customer support', 'classification']],
    ['Senior Customer Support', 'Customer Experience', 'standard', 3, 3, 'high', ['customer support', 'summarization', 'analysis']]
  ];
  var VOL_BASE = { low: 150000, medium: 400000, high: 1200000 };
  var ROLES = {};
  ROLE_ROWS.forEach(function (r) { /* row layout: name, industry, tier, complexity, stakes, volume, tasks */
    var budget = Math.round(VOL_BASE[r[5]] * (1 + (r[3] - 3) * 0.15) / 10000) * 10000;
    ROLES[r[0]] = { industry: r[1], tier: r[2], complexity: r[3], stakes: r[4], volume: r[5], tasks: r[6], monthly_token_budget: budget };
  });
  var INDUSTRY_SENS = { 'Healthcare': 1.35, 'Legal': 1.3, 'Financial Services': 1.3, 'Insurance': 1.25, 'Technology': 1.0, 'Operations & People': 1.05, 'Sales & Marketing': 1.0, 'Customer Experience': 1.05 };
  var TIER_FACTOR = { efficiency: 0.95, standard: 1.0, frontier: 1.1, reasoning: 1.15 };

  /* ---------- recommend ---------- */
  function candidatePool(tier) {
    var tiers = tier === 'reasoning' ? ['reasoning', 'frontier'] : [tier];
    return S.pricing.filter(function (m) { return !isVariant(m.model) && tiers.indexOf(m.tier) >= 0; });
  }
  function recommendFor(role) {
    var R = ROLES[role];
    if (!R) return null;
    var task = R.tasks[0], need = TASK_MIN[task];
    var pool = candidatePool(R.tier).filter(function (m) { return !/guard/i.test(m.model) && quality(m, task).q >= need - (R.stakes >= 4 ? 0 : 4); });
    if (pool.length < 3) {
      var extra = S.pricing.filter(function (m) { return !isVariant(m.model) && !/guard/i.test(m.model) && pool.indexOf(m) < 0 && quality(m, task).q >= need - 4; });
      pool = pool.concat(extra);
    }
    pool.sort(function (a, b) { return blended(a) - blended(b); });
    var picks = [];
    if (pool.length) {
      picks.push(pool[0]);
      var byQ = pool.slice().sort(function (a, b) { return quality(b, task).q - quality(a, task).q || blended(a) - blended(b); });
      var mid = pool[Math.floor(pool.length / 2)];
      [mid, byQ[0]].forEach(function (m) { if (picks.indexOf(m) < 0) picks.push(m); });
    }
    var budget = R.monthly_token_budget;
    var models = picks.slice(0, 3).map(function (m) {
      return { model: m.model, provider: m.provider, input_cost: m.input, output_cost: m.output, monthly_cost: budget * blended(m) / 1e6 };
    });
    var reasoning = role + ' work is ' + (R.stakes >= 4 ? 'high-stakes' : R.stakes === 3 ? 'moderately sensitive' : 'low-stakes') +
      ' (stakes ' + R.stakes + '/5) with ' + (R.complexity >= 4 ? 'demanding' : R.complexity === 3 ? 'moderate' : 'light') +
      ' complexity (' + R.complexity + '/5) and ' + R.volume + ' volume, centered on ' + R.tasks.join(', ') + '. A ' + R.tier +
      '-tier model clears the quality bar for the lead task (' + task + ' needs about ' + TASK_MIN[task] + '+); the first pick is the cheapest model that does, the last is the highest-quality option.';
    var trigger = R.tier === 'efficiency'
      ? 'Move up a tier if reviewers start correcting more than ~1 in 10 outputs or tasks need multi-step reasoning.'
      : R.stakes >= 4
        ? 'Keep a human review step; move to the top-quality pick for any output that leaves the company or drives a decision.'
        : 'Move up a tier if error-correction rates climb or tasks grow beyond ' + R.tasks[0] + '.';
    return {
      role: role, industry: R.industry, tier: R.tier, complexity: R.complexity, stakes: R.stakes, volume: R.volume,
      monthly_token_budget: budget, tasks: R.tasks.slice(), recommended_models: models, reasoning: reasoning, upgrade_trigger: trigger
    };
  }

  /* ---------- onboarding ---------- */
  function onboardFor(role) {
    var R = ROLES[role];
    if (!R) return null;
    var f = {
      complexity: { value: R.complexity, factor: +(1 + (R.complexity - 1) * 0.12).toFixed(2) },
      stakes: { value: R.stakes, factor: +(1 + (R.stakes - 1) * 0.1).toFixed(2) },
      task_diversity: { count: R.tasks.length, factor: +(1 + (R.tasks.length - 1) * 0.08).toFixed(2) },
      industry_sensitivity: { industry: R.industry, factor: INDUSTRY_SENS[R.industry] || 1 },
      tier_complexity: { tier: R.tier, factor: TIER_FACTOR[R.tier] || 1 }
    };
    var mult = 1;
    Object.keys(f).forEach(function (k) { mult *= f[k].factor; });
    mult = +mult.toFixed(2);
    var total = Math.max(5, Math.round(12 * mult));
    var split = [['Access & policy foundations', 0.2, 'Accounts, data-handling rules, approved tools, prompt basics.'],
      ['Guided practice', 0.3, 'Supervised use on real ' + R.tasks[0] + ' work with a buddy reviewing outputs.'],
      ['Workflow integration', 0.3, 'Templates and shortcuts for ' + R.tasks.join(', ') + ' built into daily routines.'],
      ['Independent operation', 0.2, 'Works unassisted; spot-check reviews and cost monitoring only.']];
    var phases = [], used = 0;
    split.forEach(function (p, i) {
      var d = i === split.length - 1 ? total - used : Math.max(1, Math.round(total * p[1]));
      d = Math.max(1, d); used += d;
      phases.push({ label: p[0], days: d, description: p[2] });
    });
    var cum = 0, ms = [];
    var msNames = ['First compliant session', 'First reviewed deliverable', 'Workflow templates in daily use', 'Fully productive with AI'];
    phases.forEach(function (p, i) { cum += p.days; ms.push({ day: cum, label: msNames[i], description: 'End of "' + p.label + '" phase.' }); });
    var risks = [];
    if (R.stakes >= 4) risks.push({ level: 'high', factor: 'Output accuracy', detail: 'Errors carry real consequences (stakes ' + R.stakes + '/5); keep human review until the error rate is proven low.' });
    if (['Healthcare', 'Legal', 'Financial Services', 'Insurance'].indexOf(R.industry) >= 0) risks.push({ level: 'high', factor: 'Data privacy & compliance', detail: R.industry + ' data is regulated; confirm what may be sent to a model before day 1.' });
    if (R.complexity >= 4) risks.push({ level: 'medium', factor: 'Prompting skill ramp', detail: 'Complex tasks need strong prompting and verification habits, which take longer to build.' });
    if (R.volume === 'high') risks.push({ level: 'medium', factor: 'Cost drift', detail: 'High volume makes spend grow quickly; set a monthly token budget and review it weekly.' });
    if (R.tasks.length >= 4) risks.push({ level: 'low', factor: 'Task sprawl', detail: 'Many task types dilute practice time; sequence them across phases.' });
    return {
      role: role, industry: R.industry, tier: R.tier, kw_multiplier: mult, total_days: total, total_weeks: +(total / 5).toFixed(1),
      monthly_token_budget: R.monthly_token_budget, tasks: R.tasks.slice(), factors: f, phases: phases, milestones: ms, risks: risks,
      reasoning: 'Baseline of 12 business days scaled by a ' + mult + 'x multiplier from role complexity, stakes, task variety, industry sensitivity and model tier. Estimates are directional, not guarantees.'
    };
  }

  /* ---------- arbitrage ---------- */
  function alternatives(cur, task, inTok, outTok) {
    var cq = quality(cur, task), req = Math.min(TASK_MIN[task] || 80, cq.q);
    var curCost = (inTok * cur.input + outTok * cur.output) / 1e6;
    var out = [];
    S.pricing.forEach(function (m) {
      if (m === cur || (isVariant(m.model) && !isVariant(cur.model))) return;
      if (m.context < Math.min(cur.context, 128000)) return;
      var nq = quality(m, task);
      if (nq.q < req) return;
      var cost = (inTok * m.input + outTok * m.output) / 1e6;
      if (cost >= curCost * 0.97) return;
      var conf = 55 + (nq.q - req) * 1.5 + (nq.q >= cq.q ? 10 : 0) + (!nq.est && !cq.est ? 8 : 0) + Math.min(10, (curCost - cost) / curCost * 12);
      conf = Math.round(Math.max(50, Math.min(97, conf)));
      out.push({ cur: cur, rec: m, curCost: curCost, newCost: cost, confidence: conf, est: nq.est || cq.est });
    });
    out.sort(function (a, b) { return (b.curCost - b.newCost) - (a.curCost - a.newCost); });
    return out;
  }
  function arbitrage(model, task, tokens) {
    var cur = findModel(model);
    if (!cur) return [];
    return alternatives(cur, task, tokens * 0.6, tokens * 0.4).slice(0, 5).map(function (a) {
      return {
        current_model: a.cur.model, recommended_model: a.rec.model, provider: a.rec.provider,
        current_cost_monthly: a.curCost, new_cost_monthly: a.newCost, annual_savings: (a.curCost - a.newCost) * 12,
        savings_pct: +((a.curCost - a.newCost) / a.curCost * 100).toFixed(1), confidence: a.confidence, quality_estimated: a.est
      };
    });
  }

  /* ---------- usage analytics + insights ---------- */
  function usageCost(u) {
    var m = findModel(u.model);
    return m ? (u.tokens_input * m.input + u.tokens_output * m.output) / 1e6 : (u.cost || 0);
  }
  function monthsSpan() {
    var lo = Infinity, hi = -Infinity;
    S.usage.forEach(function (u) { var t = Date.parse(u.timestamp); if (!isNaN(t)) { lo = Math.min(lo, t); hi = Math.max(hi, t); } });
    if (!isFinite(lo)) return 1;
    return Math.max(1, (hi - lo) / (30.44 * 86400000));
  }
  function groupSum(rows, keyFn, init, add) {
    var m = {};
    rows.forEach(function (r) { var k = keyFn(r); if (!m[k]) m[k] = init(r); add(m[k], r); });
    return Object.keys(m).map(function (k) { return m[k]; });
  }
  function analytics() {
    var U = S.usage;
    var users = {}, depts = {};
    var spend = 0, toks = 0;
    U.forEach(function (u) { users[u.employee] = 1; depts[u.department] = 1; spend += u.cost; toks += u.tokens_input + u.tokens_output; });
    var desc = function (a, b) { return b.spend - a.spend; };
    return {
      summary: { total_records: U.length, total_spend: spend, total_tokens: toks, total_users: Object.keys(users).length, total_departments: Object.keys(depts).length },
      by_department: groupSum(U, function (u) { return u.department; }, function (u) { return { department: u.department, spend: 0 }; }, function (g, u) { g.spend += u.cost; }).sort(desc),
      by_model: groupSum(U, function (u) { return u.model; }, function (u) { return { model: u.model, spend: 0 }; }, function (g, u) { g.spend += u.cost; }).sort(desc),
      by_task_type: groupSum(U, function (u) { return u.task_type; }, function (u) { return { task_type: u.task_type, spend: 0 }; }, function (g, u) { g.spend += u.cost; }).sort(desc),
      by_employee: groupSum(U, function (u) { return u.employee; }, function (u) { return { employee: u.employee, department: u.department, role: u.role, tokens: 0, spend: 0 }; },
        function (g, u) { g.tokens += u.tokens_input + u.tokens_output; g.spend += u.cost; }).sort(desc)
    };
  }
  function arbScan() {
    var months = monthsSpan();
    var groups = groupSum(S.usage, function (u) { return u.employee + '|' + u.model + '|' + u.task_type; },
      function (u) { return { employee: u.employee, department: u.department, model: u.model, task: u.task_type, inTok: 0, outTok: 0 }; },
      function (g, u) { g.inTok += u.tokens_input; g.outTok += u.tokens_output; });
    var opps = [];
    groups.forEach(function (g) {
      var cur = findModel(g.model);
      if (!cur || TASKS.indexOf(g.task) < 0) return;
      var alts = alternatives(cur, g.task, g.inTok / months, g.outTok / months).filter(function (a) { return a.confidence >= 65; });
      if (!alts.length) return;
      var a = alts[0], monthly = a.curCost - a.newCost;
      if (monthly < 0.01) return;
      opps.push({
        employee: g.employee, department: g.department, task_type: g.task, current_model: cur.model, recommended_model: a.rec.model,
        monthly_savings: monthly, annual_savings: monthly * 12, confidence: a.confidence, quality_estimated: a.est
      });
    });
    opps.sort(function (a, b) { return b.monthly_savings - a.monthly_savings; });
    var tm = opps.reduce(function (s, o) { return s + o.monthly_savings; }, 0);
    return { summary: { groups_scanned: groups.length, opportunities_found: opps.length, total_monthly_savings: tm, total_annual_savings: tm * 12 }, opportunities: opps.slice(0, 60) };
  }
  function roleFit() {
    var months = monthsSpan();
    var emps = {};
    S.usage.forEach(function (u) {
      var e = emps[u.employee] || (emps[u.employee] = { employee: u.employee, role: u.role, models: {} });
      var mm = e.models[u.model] || (e.models[u.model] = { spend: 0, inTok: 0, outTok: 0 });
      mm.spend += u.cost; mm.inTok += u.tokens_input; mm.outTok += u.tokens_output;
    });
    var results = [], s = { matched: 0, over_provisioned: 0, under_provisioned: 0, total_overprovision_savings: 0 };
    Object.keys(emps).forEach(function (k) {
      var e = emps[k], primary = Object.keys(e.models).sort(function (a, b) { return e.models[b].spend - e.models[a].spend; })[0];
      var pm = findModel(primary), tier = pm ? pm.tier : 'standard';
      var R = ROLES[e.role], status = 'matched', saving = 0;
      if (R) {
        if (TIER_RANK[tier] > TIER_RANK[R.tier]) {
          status = 'over';
          var rec = recommendFor(e.role), rm = rec && rec.recommended_models[0] && findModel(rec.recommended_models[0].model);
          if (rm) {
            var mm = e.models[primary];
            saving = Math.max(0, (mm.spend - (mm.inTok * rm.input + mm.outTok * rm.output) / 1e6) / months);
          }
        } else if (TIER_RANK[tier] < TIER_RANK[R.tier] && R.stakes >= 4) status = 'under';
      }
      if (status === 'over') s.over_provisioned++; else if (status === 'under') s.under_provisioned++; else s.matched++;
      s.total_overprovision_savings += saving;
      results.push({ employee: e.employee, role: e.role, primary_model: primary, model_tier: tier, status: status, potential_savings: saving });
    });
    var order = { under: 0, over: 1, matched: 2 };
    results.sort(function (a, b) { return order[a.status] - order[b.status] || b.potential_savings - a.potential_savings; });
    return { summary: s, results: results };
  }

  /* ---------- demo data ---------- */
  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function seedDemo() {
    var r = rng(2026);
    var pick = function (a) { return a[Math.floor(r() * a.length)]; };
    var first = ['Maya', 'Liam', 'Priya', 'Noah', 'Sofia', 'Ethan', 'Aisha', 'Lucas', 'Chloe', 'Omar', 'Hana', 'Diego', 'Ingrid', 'Kofi', 'Mei', 'Rafael', 'Tessa', 'Yusuf', 'Elena', 'Marcus', 'Nadia', 'Jonah', 'Camila', 'Dev', 'Freya', 'Tomas', 'Zara', 'Ivan'];
    var last = ['Alvarez', 'Brooks', 'Chen', 'Dubois', 'Eriksen', 'Fofana', 'Garcia', 'Hughes', 'Iyer', 'Jansen', 'Kim', 'Lopez', 'Mbeki', 'Nguyen', 'Okafor', 'Petrov', 'Quinn', 'Rossi', 'Sato', 'Turner'];
    var team = [
      ['Engineering', 'Senior Software Engineer', 'Claude Opus 5'], ['Engineering', 'Senior Software Engineer', 'Claude Sonnet 5'],
      ['Engineering', 'Junior Software Engineer', 'Claude Opus 5'], ['Engineering', 'Junior Software Engineer', 'GPT-4.1'],
      ['Engineering', 'DevOps Engineer', 'Claude Sonnet 4.6'], ['Engineering', 'QA Engineer', 'o3'],
      ['Sales', 'Sales Representative', 'Claude Opus 4.7'], ['Sales', 'Sales Representative', 'GPT-4o'], ['Sales', 'Customer Success Manager', 'Claude Sonnet 5'],
      ['Marketing', 'Marketing Manager', 'Claude Opus 5'], ['Marketing', 'Content Writer', 'GPT-4.1'], ['Marketing', 'Content Writer', 'Claude Haiku 4.5'],
      ['Finance', 'Financial Analyst', 'Claude Haiku 4.5'], ['Finance', 'Accountant', 'Claude Opus 4.7'], ['Finance', 'Accountant', 'GPT-4o'], ['Finance', 'Business Analyst', 'Gemini 2.5 Pro'],
      ['Legal', 'Senior Attorney', 'Claude Haiku 4.5'], ['Legal', 'Paralegal', 'Claude Opus 5'], ['Legal', 'Paralegal', 'Claude Sonnet 5'], ['Legal', 'Legal Secretary', 'Claude Opus 4.7'],
      ['Customer Experience', 'Customer Support Rep', 'Claude Sonnet 4.6'], ['Customer Experience', 'Customer Support Rep', 'GPT-4.1 Mini'],
      ['Customer Experience', 'Customer Support Rep', 'Claude Opus 4.5'], ['Customer Experience', 'Senior Customer Support', 'Claude Sonnet 5'],
      ['Customer Experience', 'Senior Customer Support', 'Gemini 2.5 Flash'], ['Engineering', 'Data Engineer', 'Claude Sonnet 5'],
      ['Finance', 'Financial Analyst', 'o3'], ['Marketing', 'Marketing Manager', 'Claude Sonnet 5']
    ];
    var start = Date.now() - 180 * 86400000, rows = [];
    team.forEach(function (t, i) {
      var name = first[i % first.length] + ' ' + last[(i * 7 + 3) % last.length];
      var R = ROLES[t[1]], model = findModel(t[2]);
      if (!R || !model) return;
      var n = (R.volume === 'high' ? 120 : R.volume === 'medium' ? 80 : 45) + Math.floor(r() * 30);
      for (var j = 0; j < n; j++) {
        var task = pick(R.tasks), scale = (0.6 + R.complexity * 0.35) * 15;
        var tin = Math.round((300 + r() * 4500) * scale), tout = Math.round((200 + r() * 2200) * scale);
        var ts = new Date(start + r() * 180 * 86400000);
        rows.push({
          id: S.nextUsage++, employee: name, department: t[0], role: t[1], model: model.model, provider: model.provider,
          tokens_input: tin, tokens_output: tout, task_type: task,
          cost: +((tin * model.input + tout * model.output) / 1e6).toFixed(4), timestamp: ts.toISOString().slice(0, 19)
        });
      }
    });
    S.usage = S.usage.concat(rows);
    persist('usage'); persist('nextUsage');
    return { seeded: rows.length };
  }

  /* ---------- CSV / XLSX import ---------- */
  function parseCSV(text) {
    var rows = [], row = [], cur = '', q = false;
    text = text.replace(/^﻿/, '');
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.length > 1 || row[0] !== '') rows.push(row); row = []; }
      else cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }
  function loadScript(src) {
    return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error('Could not load Excel reader (offline?). Export as CSV instead.')); }; document.head.appendChild(s); });
  }
  async function fileToRows(file) {
    if (/\.(xlsx|xlsm)$/i.test(file.name)) {
      if (!window.XLSX) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
      var wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
    }
    return parseCSV(await file.text());
  }
  async function importUsage(file) {
    var rows = await fileToRows(file);
    if (rows.length < 2) return { error: 'File has no data rows.' };
    var head = rows[0].map(function (h) { return String(h).trim().toLowerCase().replace(/\s+/g, '_'); });
    var need = ['employee', 'model', 'tokens_input', 'tokens_output'];
    var missing = need.filter(function (c) { return head.indexOf(c) < 0; });
    if (missing.length) return { error: 'Missing required column(s): ' + missing.join(', ') + '. Expected: employee, department, role, model, provider, tokens_input, tokens_output, task_type, timestamp.' };
    var ix = function (c) { return head.indexOf(c); };
    var imported = 0, skipped = 0, errors = [], fresh = [];
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i], get = function (c) { var k = ix(c); return k < 0 ? '' : String(r[k] == null ? '' : r[k]).trim(); };
      if (r.every(function (c) { return String(c).trim() === ''; })) continue;
      var tin = parseInt(get('tokens_input').replace(/,/g, ''), 10), tout = parseInt(get('tokens_output').replace(/,/g, ''), 10);
      var m = findModel(get('model'));
      if (!get('employee') || isNaN(tin) || isNaN(tout) || tin < 0 || tout < 0) { skipped++; errors.push('Row ' + (i + 1) + ': needs an employee and numeric token counts'); continue; }
      if (!m) { skipped++; errors.push('Row ' + (i + 1) + ': model "' + get('model') + '" is not in the pricing catalog'); continue; }
      var ts = get('timestamp'), d = ts ? new Date(ts) : new Date();
      var task = (get('task_type') || 'analysis').toLowerCase();
      fresh.push({
        id: S.nextUsage++, employee: get('employee'), department: get('department') || 'Unassigned', role: get('role') || 'Unknown',
        model: m.model, provider: m.provider, tokens_input: tin, tokens_output: tout, task_type: task,
        cost: +((tin * m.input + tout * m.output) / 1e6).toFixed(4), timestamp: (isNaN(d.getTime()) ? new Date() : d).toISOString().slice(0, 19)
      });
      imported++;
    }
    S.usage = S.usage.concat(fresh);
    persist('usage'); persist('nextUsage');
    return { imported: imported, skipped: skipped, errors: errors, summary: 'Imported ' + imported + ' records' + (skipped ? ', skipped ' + skipped : '') + '.' };
  }

  /* ---------- Claude (optional, user key, called straight from the browser) ---------- */
  function getKey() { return lsGet('jarod_anthropic_key'); }
  function isOpenAI(key) { return !!key && key.indexOf('sk-ant-') !== 0; }
  /* OpenAI keys (sk-..., sk-proj-...) go to the Responses API; same Anthropic-shaped body in, plain text out. */
  async function openai(key, body) {
    var big = body.model !== 'claude-haiku-5-5';
    var req = { model: big ? 'gpt-5' : 'gpt-5-mini', input: body.messages[0].content, max_output_tokens: Math.max(body.max_tokens * 3, 1500) };
    if (body.tools) req.tools = [{ type: 'web_search' }];
    var r = await origFetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + key },
      body: JSON.stringify(req)
    });
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error((j.error && j.error.message) || ('OpenAI API error ' + r.status));
    var out = [];
    (j.output || []).forEach(function (o) { if (o.type === 'message') (o.content || []).forEach(function (c) { if (c.type === 'output_text') out.push(c.text); }); });
    return out.join('\n');
  }
  async function claude(body) {
    var key = getKey();
    if (!key) throw new Error('No API key saved. Add one in Settings.');
    if (isOpenAI(key)) return openai(key, body);
    var r = await origFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify(body)
    });
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error((j.error && j.error.message) || ('Anthropic API error ' + r.status));
    return (j.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('\n');
  }
  function extractJSON(text) {
    var t = text.replace(/```json|```/g, '');
    var a = t.search(/[\[{]/), b = Math.max(t.lastIndexOf(']'), t.lastIndexOf('}'));
    if (a < 0 || b < a) throw new Error('Claude did not return JSON.');
    return JSON.parse(t.slice(a, b + 1));
  }

  async function refreshPricing() {
    if (!getKey()) return { error: 'Live refresh needs your Anthropic or OpenAI API key (Settings). Without one, Jarod uses the built-in catalog (' + SEED.seedDate + ').' };
    var groups = [['Anthropic'], ['OpenAI'], ['Google'], ['Mistral', 'Cohere', 'xAI', 'DeepSeek', 'Moonshot', 'Meta', 'Qwen', 'Z.AI', 'MiniMax', 'Amazon', 'Perplexity']];
    var tracked = {};
    S.pricing.forEach(function (m) { tracked[m.provider] = true; });
    groups = groups.map(function (g) { return g.filter(function (p) { return tracked[p]; }); }).filter(function (g) { return g.length; });
    if (!groups.length) return { error: 'Choose the providers you want to track first (Settings > Choose Providers).' };
    var found = [], errors = [];
    for (var g = 0; g < groups.length; g++) {
      var have = S.pricing.filter(function (m) { return groups[g].indexOf(m.provider) >= 0; }).map(function (m) { return m.provider + ': ' + m.model; }).join('\n');
      var prompt = 'Use web search on the official API pricing pages for: ' + groups[g].join(', ') + '.\n' +
        'Return the CURRENT USD list price per 1M tokens for their text models. Use exactly these names where the model already exists, and add any newly released flagship models:\n' + have +
        '\n\nRespond ONLY with a JSON array, no prose: [{"provider":"","model":"","input":0,"output":0,"cached":null,"context":0,"tier":"frontier|standard|efficiency|reasoning"}]. Omit anything you cannot verify.';
      try {
        var txt = await claude({ model: 'claude-sonnet-5-5', max_tokens: 8000, tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }], messages: [{ role: 'user', content: prompt }] });
        extractJSON(txt).forEach(function (x) { found.push(x); });
      } catch (e) { errors.push(groups[g][0] + ': ' + e.message); }
    }
    var created = 0, nNew = 0, nUpd = 0, today = new Date().toISOString().slice(0, 10);
    S.proposals = S.proposals.filter(function (p) { return p.status !== 'pending'; });
    found.forEach(function (x) {
      if (!x || !x.model || !x.provider || !(x.input >= 0) || !(x.output >= 0) || x.input > 1000 || x.output > 1000) return;
      var cur = S.pricing.find(function (m) { return m.provider === x.provider && m.model.toLowerCase() === String(x.model).toLowerCase(); });
      var tier = TIER_BASE[x.tier] ? x.tier : (x.output > 20 ? 'frontier' : x.output > 3 ? 'standard' : 'efficiency');
      if (!cur) {
        S.proposals.push({ id: S.nextProp++, proposed_date: today, provider: x.provider, model: x.model, input_cost: +x.input, output_cost: +x.output, cached_cost: x.cached == null ? null : +x.cached, context_window: x.context || 128000, tier: tier, prev_input_cost: null, prev_output_cost: null, pct_change_input: null, pct_change_output: null, needs_review: true, status: 'pending', change_type: 'new' });
        created++; nNew++;
      } else if (Math.abs(cur.input - x.input) > 1e-9 || Math.abs(cur.output - x.output) > 1e-9) {
        var pi = cur.input ? +((x.input - cur.input) / cur.input * 100).toFixed(1) : 0, po = cur.output ? +((x.output - cur.output) / cur.output * 100).toFixed(1) : 0;
        S.proposals.push({ id: S.nextProp++, proposed_date: today, provider: cur.provider, model: cur.model, input_cost: +x.input, output_cost: +x.output, cached_cost: x.cached == null ? cur.cached : +x.cached, context_window: x.context || cur.context, tier: cur.tier, prev_input_cost: cur.input, prev_output_cost: cur.output, pct_change_input: pi, pct_change_output: po, needs_review: Math.abs(pi) > 25 || Math.abs(po) > 25, status: 'pending', change_type: 'update' });
        created++; nUpd++;
      }
    });
    persist('proposals'); persist('nextProp');
    return { providers_checked: groups.reduce(function (n, g) { return n + g.length; }, 0), models_found: found.length, proposals_created: created, new_count: nNew, updated_count: nUpd, retired_count: 0, errors: errors };
  }
  function ensureSnapshot(date) {
    S.pricing.forEach(function (m) {
      var row = S.history.find(function (h) { return h.snapshot_date === date && h.model === m.model; });
      var vals = { provider: m.provider, input_cost: m.input, output_cost: m.output, cached_cost: m.cached, context_window: m.context, tier: m.tier };
      if (row) Object.assign(row, vals); else S.history.push(Object.assign({ snapshot_date: date, model: m.model }, vals));
    });
  }
  function approve(p) {
    var today = new Date().toISOString().slice(0, 10);
    var cur = S.pricing.find(function (m) { return m.provider === p.provider && m.model === p.model; });
    var vals = { provider: p.provider, model: p.model, input: p.input_cost, output: p.output_cost, cached: p.cached_cost, context: p.context_window, tier: p.tier };
    if (cur) Object.assign(cur, vals); else S.pricing.push(vals);
    S.pricing.sort(function (a, b) { return a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model); });
    ensureSnapshot(today);
    S.proposals = S.proposals.filter(function (x) { return x.id !== p.id; });
    persist('pricing'); persist('history'); persist('proposals');
  }

  /* ---------- router ---------- */
  var json = function (o, status) { return new Response(JSON.stringify(o), { status: status || 200, headers: { 'Content-Type': 'application/json' } }); };
  async function route(method, path, body) {
    var m;
    if (path === '/api/config/has-key') return { has_key: !!getKey() };
    if (path === '/api/pricing' && method === 'GET') return S.pricing;
    if (path === '/api/pricing/history') return S.history;
    if (path === '/api/pricing/summary') return { model_count: S.pricing.length, provider_count: new Set(S.pricing.map(function (x) { return x.provider; })).size };
    if (path === '/api/pricing/refresh') return refreshPricing();
    if (path === '/api/pricing/providers') return providerList();
    if (path === '/api/pricing/select-providers') return selectProviders(body.providers);
    if (path === '/api/pricing/restore') { seedPricing(); return { restored: S.pricing.length }; }
    if (path === '/api/pricing/clear') {
      var out = { history_rows_deleted: S.history.length, proposals_deleted: S.proposals.length };
      S.pricing = []; S.history = []; S.proposals = [];
      persist('pricing'); persist('history'); persist('proposals');
      return out;
    }
    if (path === '/api/pricing/proposals' && method === 'GET') return S.proposals.filter(function (p) { return p.status === 'pending'; });
    if (path === '/api/pricing/proposals/approve-safe') {
      var safe = S.proposals.filter(function (p) { return !p.needs_review && p.change_type === 'update'; });
      safe.forEach(approve);
      return { approved_count: safe.length };
    }
    if (path === '/api/pricing/proposals/reject-all') { var n = S.proposals.length; S.proposals = []; persist('proposals'); return { rejected_count: n }; }
    if ((m = path.match(/^\/api\/pricing\/proposals\/(\d+)\/(approve|reject)$/))) {
      var p = S.proposals.find(function (x) { return x.id === +m[1]; });
      if (!p) return { error: 'not found' };
      if (m[2] === 'approve') approve(p); else { S.proposals = S.proposals.filter(function (x) { return x !== p; }); persist('proposals'); }
      return { ok: true };
    }
    if (path === '/api/roles') return ROLES;
    if (path === '/api/recommend') return recommendFor(body.role) || { error: 'Unknown role' };
    if (path === '/api/onboard') return onboardFor(body.role) || { error: 'Unknown role' };
    if (path === '/api/arbitrage') return arbitrage(body.model, body.task_type, +body.monthly_tokens || 500000);
    if (path === '/api/usage/analytics') return analytics();
    if (path === '/api/usage/seed-demo' || path === '/api/usage/seed') return seedDemo();
    if (path === '/api/usage/clear') { S.usage = []; persist('usage'); return { ok: true }; }
    if (path === '/api/insights/arbitrage-scan') return arbScan();
    if (path === '/api/insights/role-fit') return roleFit();
    if (path === '/api/settings' && method === 'GET') {
      var k = getKey();
      return { anthropic_api_key_set: !!k, anthropic_api_key_masked: k ? (isOpenAI(k) ? 'sk-…' : 'sk-ant-…') + k.slice(-4) : null, db_path: 'This browser (IndexedDB) - nothing is uploaded', data_dir: 'Browser storage for ' + location.host, version: VERSION };
    }
    if (path === '/api/settings' && method === 'POST') {
      if (body.anthropic_api_key === null) lsSet('jarod_anthropic_key', null);
      else if (typeof body.anthropic_api_key === 'string') lsSet('jarod_anthropic_key', body.anthropic_api_key.trim());
      return { saved: true };
    }
    if (path === '/api/settings/test-key') {
      try { await claude({ model: 'claude-haiku-5-5', max_tokens: 16, messages: [{ role: 'user', content: 'Reply with the single word: ready' }] }); return { success: true, response: 'Key works.' }; }
      catch (e) { return { success: false, error: e.message }; }
    }
    if (path === '/api/onboard/validate') {
      try {
        var v = extractJSON(await claude({ model: 'claude-sonnet-5-5', max_tokens: 900, messages: [{ role: 'user', content: body.prompt }] }));
        var sys = body.system_days, disc = v.adjusted_days && sys ? Math.round(Math.abs(v.adjusted_days - sys) / sys * 100) : 0;
        if (disc >= 25) {
          S.insights.push({ timestamp: new Date().toISOString(), role: body.role, system_days: sys, ai_adjusted_days: v.adjusted_days, discrepancy_pct: disc, verdict: v.verdict });
          persist('insights'); v.insight_stored = true; v.discrepancy_pct = disc;
        }
        return v;
      } catch (e) { return { error: e.message }; }
    }
    return { error: 'Not found: ' + path, __status: 404 };
  }

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/api/') !== 0) return origFetch(input, init);
    init = init || {};
    var method = (init.method || 'GET').toUpperCase();
    return ready.then(async function () {
      var body = {};
      if (typeof init.body === 'string') { try { body = JSON.parse(init.body); } catch (e) {} }
      else if (init.body instanceof FormData) body = init.body;
      try {
        if (url === '/api/usage/import') {
          var f = init.body.get('file');
          return json(f ? await importUsage(f) : { error: 'No file.' });
        }
        var out = await route(method, url.split('?')[0], body);
        return json(out, out && out.__status);
      } catch (e) { return json({ error: e.message }, 500); }
    });
  };

  window.Jarod = { api: function (method, path, body) { return ready.then(function () { return route(method, path, body || {}); }); }, restorePricing: function () { return window.fetch('/api/pricing/restore', { method: 'POST' }); }, version: VERSION };
})();
