(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const STORAGE = {
    settings: "fsi.settings.v1",
    leagueCache: "fsi.leagueCache.v1",
    playersCache: "fsi.playersCache.v1",
  };

  const DEFAULT_SETTINGS = {
    provider: "TheSportsDB",
    apiKey: "3",
    sport: "Soccer",
    leagueId: "4328",
    selectedEventId: "",
    formN: 8,
    homeAdv: 0.12,
  };

  const LEAGUES = [
    { id: "4328", name: "英超 Premier League" },
    { id: "4335", name: "西甲 La Liga" },
    { id: "4332", name: "義甲 Serie A" },
    { id: "4331", name: "德甲 Bundesliga" },
    { id: "4334", name: "法甲 Ligue 1" },
    { id: "4346", name: "MLS 美國職足" },
    { id: "4337", name: "荷甲 Eredivisie" },
  ];

  const UI = {
    status: $("#status"),
    pillProvider: $("#pillProvider"),
    pillCache: $("#pillCache"),
    pillUpdated: $("#pillUpdated"),

    sportSelect: $("#sportSelect"),
    leagueSelect: $("#leagueSelect"),
    matchSelect: $("#matchSelect"),

    btnSync: $("#btnSync"),
    btnUseCache: $("#btnUseCache"),
    btnClearCache: $("#btnClearCache"),

    apiKeyInput: $("#apiKeyInput"),
    formNInput: $("#formNInput"),
    homeAdvInput: $("#homeAdvInput"),

    homeName: $("#homeName"),
    awayName: $("#awayName"),
    homeMeta: $("#homeMeta"),
    awayMeta: $("#awayMeta"),

    pHome: $("#pHome"),
    pDraw: $("#pDraw"),
    pAway: $("#pAway"),
    barHome: $("#barHome"),
    barDraw: $("#barDraw"),
    barAway: $("#barAway"),

    goalDist: $("#goalDist"),
    formSummary: $("#formSummary"),
    formGrid: $("#formGrid"),

    homeTableTitle: $("#homeTableTitle"),
    awayTableTitle: $("#awayTableTitle"),
    homePlayers: $("#homePlayers tbody"),
    awayPlayers: $("#awayPlayers tbody"),
  };

  function setStatus(state, text) {
    UI.status.dataset.state = state;
    const el = $(".status__text", UI.status);
    if (el) el.textContent = text;
  }

  function fmtPct(x) {
    if (!Number.isFinite(x)) return "—%";
    return `${Math.round(x)}%`;
  }

  function clamp(x, lo, hi) {
    return Math.max(lo, Math.min(hi, x));
  }

  function safeJsonParse(s, fallback) {
    try {
      return JSON.parse(s);
    } catch {
      return fallback;
    }
  }

  function loadSettings() {
    const raw = localStorage.getItem(STORAGE.settings);
    const s = raw ? safeJsonParse(raw, {}) : {};
    return { ...DEFAULT_SETTINGS, ...s };
  }

  function saveSettings(settings) {
    localStorage.setItem(STORAGE.settings, JSON.stringify(settings));
  }

  function loadLeagueCache() {
    const raw = localStorage.getItem(STORAGE.leagueCache);
    return raw ? safeJsonParse(raw, null) : null;
  }

  function saveLeagueCache(cache) {
    localStorage.setItem(STORAGE.leagueCache, JSON.stringify(cache));
  }

  function loadPlayersCache() {
    const raw = localStorage.getItem(STORAGE.playersCache);
    return raw ? safeJsonParse(raw, {}) : {};
  }

  function savePlayersCache(cache) {
    localStorage.setItem(STORAGE.playersCache, JSON.stringify(cache));
  }

  function formatDateTime(isoDate, isoTime) {
    const iso = isoTime ? `${isoDate}T${isoTime}` : isoDate;
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return "—";
    return new Intl.DateTimeFormat("zh-Hant", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  }

  async function fetchJson(url, { timeoutMs = 12000 } = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  }

  function apiBase(settings) {
    const key = String(settings.apiKey || "").trim() || DEFAULT_SETTINGS.apiKey;
    return `https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(key)}`;
  }

  async function syncLeague(settings) {
    const base = apiBase(settings);
    const leagueId = settings.leagueId;

    const leagueInfoUrl = `${base}/lookupleague.php?id=${encodeURIComponent(leagueId)}`;
    const leagueInfo = await fetchJson(leagueInfoUrl);
    const season = leagueInfo?.leagues?.[0]?.strCurrentSeason || leagueInfo?.leagues?.[0]?.strSeason || null;
    if (!season) throw new Error("找不到聯盟 season（strCurrentSeason）");

    const maxRoundCap = 60;
    const batchSize = 2;

    const eventTimeMs = (e) =>
      new Date(`${e?.dateEvent || "1970-01-01"}T${e?.strTime || "00:00:00"}`).getTime();

    const roundMemo = new Map();
    async function fetchRound(r) {
      if (roundMemo.has(r)) return await roundMemo.get(r);
      const url = `${base}/eventsround.php?id=${encodeURIComponent(leagueId)}&r=${encodeURIComponent(String(r))}&s=${encodeURIComponent(season)}`;
      const p = (async () => {
        const data = await fetchJson(url, { timeoutMs: 20000 });
        const evs = Array.isArray(data?.events) ? data.events : [];
        if (!evs.length) return { r, events: [], minT: null, maxT: null };
        const times = evs.map(eventTimeMs).filter((t) => Number.isFinite(t) && t > 0);
        const minT = times.length ? Math.min(...times) : null;
        const maxT = times.length ? Math.max(...times) : null;
        return { r, events: evs, minT, maxT };
      })();
      roundMemo.set(r, p);
      return await p;
    }

    async function findLastRound() {
      let lo = 1;
      let hi = maxRoundCap;
      let last = 0;
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const { events } = await fetchRound(mid).catch(() => ({ events: [] }));
        if (events.length) {
          last = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return last || 1;
    }

    async function findAnchorRound(lastRound, nowMs) {
      let lo = 1;
      let hi = lastRound;
      let ans = lastRound;
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const info = await fetchRound(mid).catch(() => null);
        const maxT = info?.maxT;
        if (maxT != null && maxT >= nowMs) {
          ans = mid;
          hi = mid - 1;
        } else {
          lo = mid + 1;
        }
      }
      return clamp(ans, 1, lastRound);
    }

    const now = Date.now();
    const lastRound = await findLastRound();
    const anchor = await findAnchorRound(lastRound, now);

    const wantedRounds = new Set();
    for (let r = anchor - 8; r <= anchor + 3; r++) {
      if (r >= 1 && r <= lastRound) wantedRounds.add(r);
    }
    for (let r = lastRound - 2; r <= lastRound; r++) {
      if (r >= 1 && r <= lastRound) wantedRounds.add(r);
    }

    const rounds = Array.from(wantedRounds).sort((a, b) => a - b);
    const allEvents = [];
    for (let i = 0; i < rounds.length; i += batchSize) {
      const batch = rounds.slice(i, i + batchSize);
      const results = await Promise.all(batch.map((r) => fetchRound(r).catch(() => ({ events: [] }))));
      for (const info of results) for (const e of info.events || []) allEvents.push(e);
    }

    const byId = new Map();
    for (const e of allEvents) {
      if (e?.idEvent && !byId.has(e.idEvent)) byId.set(e.idEvent, e);
    }
    const uniqueEvents = Array.from(byId.values());

    const upcomingEvents = [];
    const pastEvents = [];
    for (const e of uniqueEvents) {
      const hs = e?.intHomeScore;
      const as = e?.intAwayScore;
      const finished = Number.isFinite(Number(hs)) && Number.isFinite(Number(as));
      if (finished) {
        pastEvents.push(e);
        continue;
      }
      const t = eventTimeMs(e);
      if (Number.isFinite(t) && t >= now) upcomingEvents.push(e);
    }

    const cache = {
      provider: settings.provider,
      leagueId,
      sport: settings.sport,
      fetchedAt: new Date().toISOString(),
      season,
      upcomingEvents,
      pastEvents,
    };
    saveLeagueCache(cache);
    return cache;
  }

  function matchLabel(e) {
    const home = e?.strHomeTeam || "—";
    const away = e?.strAwayTeam || "—";
    const dt = e?.dateEvent ? formatDateTime(e.dateEvent, e.strTime) : "—";
    const status = e?.intHomeScore != null && e?.intAwayScore != null ? `（${e.intHomeScore}-${e.intAwayScore}）` : "";
    return `${dt}｜${home} vs ${away}${status}`;
  }

  function normalizeEvents(cache) {
    const all = []
      .concat(cache?.upcomingEvents || [])
      .concat(cache?.pastEvents || []);
    const byId = new Map();
    for (const e of all) {
      if (!e?.idEvent) continue;
      if (!byId.has(e.idEvent)) byId.set(e.idEvent, e);
    }
    const events = Array.from(byId.values());
    events.sort((a, b) => {
      const da = new Date(`${a.dateEvent || "1970-01-01"}T${a.strTime || "00:00:00"}`).getTime();
      const db = new Date(`${b.dateEvent || "1970-01-01"}T${b.strTime || "00:00:00"}`).getTime();
      return db - da;
    });
    return events;
  }

  function isFinished(e) {
    const hs = e?.intHomeScore;
    const as = e?.intAwayScore;
    return Number.isFinite(Number(hs)) && Number.isFinite(Number(as));
  }

  function teamKeyFromEvent(e, side) {
    return side === "home" ? e?.idHomeTeam : e?.idAwayTeam;
  }

  function eventsForTeam(pastEvents, teamId) {
    const out = [];
    for (const e of pastEvents || []) {
      if (!isFinished(e)) continue;
      if (e?.idHomeTeam === teamId || e?.idAwayTeam === teamId) out.push(e);
    }
    out.sort((a, b) => {
      const da = new Date(`${a.dateEvent || "1970-01-01"}T${a.strTime || "00:00:00"}`).getTime();
      const db = new Date(`${b.dateEvent || "1970-01-01"}T${b.strTime || "00:00:00"}`).getTime();
      return db - da;
    });
    return out;
  }

  function computeForm(pastEvents, teamId, n) {
    const evs = eventsForTeam(pastEvents, teamId).slice(0, n);
    let w = 0,
      d = 0,
      l = 0,
      gf = 0,
      ga = 0;

    for (const e of evs) {
      const hs = Number(e.intHomeScore);
      const as = Number(e.intAwayScore);
      const isHome = e.idHomeTeam === teamId;
      const scored = isHome ? hs : as;
      const conceded = isHome ? as : hs;
      gf += scored;
      ga += conceded;
      if (scored > conceded) w++;
      else if (scored === conceded) d++;
      else l++;
    }

    const played = evs.length || 0;
    const points = w * 3 + d;
    const avgGF = played ? gf / played : 0;
    const avgGA = played ? ga / played : 0;
    const winRate = played ? w / played : 0;
    return { played, w, d, l, points, gf, ga, avgGF, avgGA, winRate, evs };
  }

  function leagueAverages(pastEvents) {
    let matches = 0;
    let totalGoals = 0;
    let totalHomeGoals = 0;
    let totalAwayGoals = 0;
    for (const e of pastEvents || []) {
      if (!isFinished(e)) continue;
      const hs = Number(e.intHomeScore);
      const as = Number(e.intAwayScore);
      if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;
      matches++;
      totalGoals += hs + as;
      totalHomeGoals += hs;
      totalAwayGoals += as;
    }
    const perMatch = matches ? totalGoals / matches : 2.6;
    const perTeam = matches ? totalGoals / (matches * 2) : 1.3;
    const homePerMatch = matches ? totalHomeGoals / matches : perMatch / 2;
    const awayPerMatch = matches ? totalAwayGoals / matches : perMatch / 2;
    return { matches, perMatch, perTeam, homePerMatch, awayPerMatch };
  }

  function poissonPmf(k, lambda) {
    const kk = Number(k);
    if (kk < 0) return 0;
    let fact = 1;
    for (let i = 2; i <= kk; i++) fact *= i;
    return (Math.pow(lambda, kk) * Math.exp(-lambda)) / fact;
  }

  function scoreMatrixProbs(lambdaHome, lambdaAway, maxGoals = 6) {
    const ph = [];
    const pa = [];
    for (let i = 0; i <= maxGoals; i++) {
      ph[i] = poissonPmf(i, lambdaHome);
      pa[i] = poissonPmf(i, lambdaAway);
    }
    let pHome = 0,
      pDraw = 0,
      pAway = 0;
    for (let h = 0; h <= maxGoals; h++) {
      for (let a = 0; a <= maxGoals; a++) {
        const p = ph[h] * pa[a];
        if (h > a) pHome += p;
        else if (h === a) pDraw += p;
        else pAway += p;
      }
    }
    const pTail = 1 - (pHome + pDraw + pAway);
    const norm = pHome + pDraw + pAway + Math.max(0, pTail);
    return { pHome: (pHome / norm) * 100, pDraw: (pDraw / norm) * 100, pAway: (pAway / norm) * 100 };
  }

  function totalGoalsBuckets(lambdaHome, lambdaAway, maxGoals = 10) {
    let p01 = 0,
      p23 = 0,
      p4p = 0;
    for (let h = 0; h <= maxGoals; h++) {
      for (let a = 0; a <= maxGoals; a++) {
        const p = poissonPmf(h, lambdaHome) * poissonPmf(a, lambdaAway);
        const t = h + a;
        if (t <= 1) p01 += p;
        else if (t <= 3) p23 += p;
        else p4p += p;
      }
    }
    const sum = p01 + p23 + p4p;
    return { p01: (p01 / sum) * 100, p23: (p23 / sum) * 100, p4p: (p4p / sum) * 100 };
  }

  function cleanGoalDetails(s) {
    if (!s) return [];
    const raw = String(s)
      .replaceAll("<br>", ";")
      .replaceAll("\n", ";")
      .replaceAll("\r", ";");
    const parts = raw
      .split(";")
      .map((x) => x.trim())
      .filter(Boolean);
    const names = [];
    for (const p of parts) {
      const before = p.split(":")[0]?.trim() || p;
      const noMinute = before.replace(/\b\d+\s*'?/g, " ").replace(/\((.*?)\)/g, " ").trim();
      const n = noMinute.replace(/\s+/g, " ").trim();
      if (!n) continue;
      if (n.length > 40) continue;
      names.push(n);
    }
    return names;
  }

  function scorerCountsForTeam(pastEvents, teamId, n) {
    const evs = eventsForTeam(pastEvents, teamId).slice(0, n);
    const map = new Map();
    for (const e of evs) {
      const isHome = e.idHomeTeam === teamId;
      const s = isHome ? e.strHomeGoalDetails : e.strAwayGoalDetails;
      const scorers = cleanGoalDetails(s);
      for (const name of scorers) map.set(name, (map.get(name) || 0) + 1);
    }
    return map;
  }

  async function fetchPlayers(settings, teamId) {
    const base = apiBase(settings);
    const url = `${base}/lookup_all_players.php?id=${encodeURIComponent(teamId)}`;
    const data = await fetchJson(url);
    const players = Array.isArray(data?.player) ? data.player : [];
    return players.map((p) => ({
      id: p.idPlayer || null,
      name: p.strPlayer || "—",
      pos: p.strPosition || "—",
    }));
  }

  function renderGoalDist(buckets) {
    const rows = [
      { label: "0–1", pct: buckets?.p01 ?? NaN },
      { label: "2–3", pct: buckets?.p23 ?? NaN },
      { label: "4+", pct: buckets?.p4p ?? NaN },
    ];
    UI.goalDist.innerHTML = rows
      .map((r, i) => {
        const pct = Number.isFinite(r.pct) ? r.pct : 0;
        const w = clamp(pct, 0, 100);
        return `
          <div class="distrow" data-i="${i}">
            <div class="distrow__label">${r.label}</div>
            <div class="distrow__bar"><div class="distrow__fill" style="width:${w}%"></div></div>
            <div class="distrow__pct">${fmtPct(r.pct)}</div>
          </div>`;
      })
      .join("");
  }

  function renderFormBox(title, form) {
    const line1 = `戰績 W-D-L：${form.w}-${form.d}-${form.l}（${form.played} 場）`;
    const line2 = `得失球 GF/GA：${form.gf}/${form.ga}｜場均 GF ${form.avgGF.toFixed(2)} / GA ${form.avgGA.toFixed(2)}`;
    const line3 = `積分：${form.points}｜勝率：${Math.round(form.winRate * 100)}%`;
    return `
      <div class="formbox">
        <div class="formbox__title">${title}</div>
        <div class="formbox__line">${line1}</div>
        <div class="formbox__line">${line2}</div>
        <div class="formbox__line">${line3}</div>
      </div>
    `;
  }

  function renderPlayersTable(tbody, titleEl, teamName, players, goalCounts) {
    titleEl.textContent = teamName || "—";
    const rows = players
      .map((p) => ({
        name: p.name,
        pos: p.pos,
        goals: goalCounts.get(p.name) || 0,
      }))
      .sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name, "zh-Hant"));

    const top = rows.slice(0, 18);
    tbody.innerHTML = top
      .map(
        (r) => `
        <tr>
          <td>${escapeHtml(r.name)}</td>
          <td>${escapeHtml(r.pos)}</td>
          <td class="num">${r.goals}</td>
        </tr>
      `
      )
      .join("");
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function pickTeamName(e, side) {
    return side === "home" ? e?.strHomeTeam : e?.strAwayTeam;
  }

  function renderAnalysis(cache, settings, event, homePlayers, awayPlayers) {
    if (!event) return;

    const homeId = teamKeyFromEvent(event, "home");
    const awayId = teamKeyFromEvent(event, "away");
    const pastEvents = cache?.pastEvents || [];

    const n = clamp(Number(settings.formN) || DEFAULT_SETTINGS.formN, 3, 20);
    const homeAdv = clamp(Number(settings.homeAdv) || DEFAULT_SETTINGS.homeAdv, 0, 0.35);

    const homeForm = computeForm(pastEvents, homeId, n);
    const awayForm = computeForm(pastEvents, awayId, n);
    const avg = leagueAverages(pastEvents);

    const baseTeam = avg.perTeam || 1.3;

    const homeAttack = homeForm.played ? homeForm.avgGF / baseTeam : 1;
    const homeDefense = homeForm.played ? homeForm.avgGA / baseTeam : 1;
    const awayAttack = awayForm.played ? awayForm.avgGF / baseTeam : 1;
    const awayDefense = awayForm.played ? awayForm.avgGA / baseTeam : 1;

    let lambdaHome = baseTeam * homeAttack * awayDefense * (1 + homeAdv);
    let lambdaAway = baseTeam * awayAttack * homeDefense;

    lambdaHome = clamp(lambdaHome, 0.2, 3.4);
    lambdaAway = clamp(lambdaAway, 0.2, 3.2);

    const probs = scoreMatrixProbs(lambdaHome, lambdaAway, 6);
    const dist = totalGoalsBuckets(lambdaHome, lambdaAway, 10);

    UI.homeName.textContent = pickTeamName(event, "home") || "—";
    UI.awayName.textContent = pickTeamName(event, "away") || "—";

    const when = event?.dateEvent ? formatDateTime(event.dateEvent, event.strTime) : "—";
    const venue = event?.strVenue ? `｜${event.strVenue}` : "";
    const meta = `${when}${venue}`;
    UI.homeMeta.textContent = meta;
    UI.awayMeta.textContent = meta;

    UI.pHome.textContent = fmtPct(probs.pHome);
    UI.pDraw.textContent = fmtPct(probs.pDraw);
    UI.pAway.textContent = fmtPct(probs.pAway);
    UI.barHome.style.width = `${clamp(probs.pHome, 0, 100)}%`;
    UI.barDraw.style.width = `${clamp(probs.pDraw, 0, 100)}%`;
    UI.barAway.style.width = `${clamp(probs.pAway, 0, 100)}%`;

    renderGoalDist(dist);

    const info = [];
    if (avg.matches) info.push(`聯盟樣本：${avg.matches} 場已完賽`);
    info.push(`模型：近況攻防 × 聯盟均值 + 主場加權（${Math.round(homeAdv * 100)}%）`);
    info.push(`估計 λ：主隊 ${lambdaHome.toFixed(2)} / 客隊 ${lambdaAway.toFixed(2)}`);
    UI.formSummary.textContent = info.join("｜");

    UI.formGrid.innerHTML = [
      renderFormBox(`${UI.homeName.textContent}（近 ${homeForm.played} 場）`, homeForm),
      renderFormBox(`${UI.awayName.textContent}（近 ${awayForm.played} 場）`, awayForm),
    ].join("");

    const goalMapFromCache = (teamId) => {
      const raw = cache?.playerGoals?.[String(teamId)];
      if (!raw || typeof raw !== "object") return null;
      const m = new Map();
      for (const [name, goals] of Object.entries(raw)) m.set(name, Number(goals) || 0);
      return m;
    };

    const homeGoals = goalMapFromCache(homeId) || scorerCountsForTeam(pastEvents, homeId, n);
    const awayGoals = goalMapFromCache(awayId) || scorerCountsForTeam(pastEvents, awayId, n);

    const homeName = UI.homeName.textContent;
    const awayName = UI.awayName.textContent;

    renderPlayersTable(UI.homePlayers, UI.homeTableTitle, homeName, homePlayers, homeGoals);
    renderPlayersTable(UI.awayPlayers, UI.awayTableTitle, awayName, awayPlayers, awayGoals);
  }

  function renderLeagueControls(settings) {
    UI.leagueSelect.innerHTML = LEAGUES.map(
      (l) => `<option value="${escapeHtml(l.id)}" ${l.id === settings.leagueId ? "selected" : ""}>${escapeHtml(l.name)}</option>`
    ).join("");

    UI.apiKeyInput.value = settings.apiKey || "";
    UI.formNInput.value = String(settings.formN);
    UI.homeAdvInput.value = String(settings.homeAdv);

    UI.pillProvider.textContent = `資料源：${settings.provider}`;
  }

  function renderMatchSelect(events, selectedId) {
    if (!events.length) {
      UI.matchSelect.innerHTML = `<option value="">（無賽事資料）</option>`;
      return;
    }

    const options = events
      .slice(0, 60)
      .map((e) => {
        const id = e.idEvent;
        const label = matchLabel(e);
        const selected = id === selectedId ? "selected" : "";
        return `<option value="${escapeHtml(id)}" ${selected}>${escapeHtml(label)}</option>`;
      })
      .join("");
    UI.matchSelect.innerHTML = options;
  }

  async function ensurePlayers(settings, teamId) {
    const cache = loadPlayersCache();
    const key = String(teamId || "");
    const cached = cache[key];
    const now = Date.now();
    if (cached?.ts && now - cached.ts < 1000 * 60 * 60 * 24 * 7 && Array.isArray(cached.players)) {
      return cached.players;
    }
    const players = await fetchPlayers(settings, teamId);
    cache[key] = { ts: now, players };
    savePlayersCache(cache);
    return players;
  }

  function cacheMeta(cache) {
    if (!cache?.fetchedAt) return "—";
    const d = new Date(cache.fetchedAt);
    if (!Number.isFinite(d.getTime())) return "—";
    return new Intl.DateTimeFormat("zh-Hant", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  }

  function setCachePills(cache) {
    const provider = cache?.provider || "—";
    UI.pillProvider.textContent = `資料源：${provider}`;
    UI.pillCache.textContent = cache?.fetchedAt ? "快取：可用" : "快取：無";
    UI.pillUpdated.textContent = `更新：${cacheMeta(cache)}`;
  }

  function builtInFallbackCache(settings) {
    if (window.__FALLBACK_CACHE__ && typeof window.__FALLBACK_CACHE__ === "object") {
      return window.__FALLBACK_CACHE__;
    }
    return {
      provider: settings.provider,
      leagueId: settings.leagueId,
      sport: settings.sport,
      fetchedAt: null,
      upcomingEvents: [],
      pastEvents: [],
      _note: "未同步到外部資料源時的空快取。",
    };
  }

  const state = {
    settings: null,
    cache: null,
    events: [],
  };

  function resetResultsEmpty(message) {
    UI.homeName.textContent = "—";
    UI.awayName.textContent = "—";
    UI.homeMeta.textContent = "—";
    UI.awayMeta.textContent = "—";
    UI.formSummary.textContent = message || "—";
    UI.goalDist.innerHTML = "";
    UI.formGrid.innerHTML = "";
    UI.homePlayers.innerHTML = "";
    UI.awayPlayers.innerHTML = "";
    UI.pHome.textContent = "—%";
    UI.pDraw.textContent = "—%";
    UI.pAway.textContent = "—%";
    UI.barHome.style.width = "0%";
    UI.barDraw.style.width = "0%";
    UI.barAway.style.width = "0%";
  }

  function squadFromCache(cache, teamId) {
    const raw = cache?.teamSquads?.[String(teamId)];
    if (!Array.isArray(raw)) return null;
    return raw
      .map((p) => ({
        id: null,
        name: p?.name || p?.strPlayer || "—",
        pos: p?.pos || p?.position || p?.strPosition || "—",
      }))
      .filter((p) => p.name && p.name !== "—");
  }

  function getSelectedEventId() {
    const settings = state.settings || loadSettings();
    return UI.matchSelect.value || settings.selectedEventId || "";
  }

  async function analyzeSelectedEvent() {
    const cache = state.cache;
    const events = state.events;
    const settings = state.settings;
    if (!cache || !events.length) {
      resetResultsEmpty("尚無賽事資料。請按「重新同步資料」。");
      return;
    }

    const selectedId = getSelectedEventId() || events[0]?.idEvent || "";
    const event = events.find((e) => e.idEvent === selectedId) || events[0] || null;
    if (!event) {
      resetResultsEmpty("尚無賽事資料。");
      return;
    }

    UI.matchSelect.value = event.idEvent;
    settings.selectedEventId = event.idEvent;
    saveSettings(settings);

    try {
      setStatus("ok", "分析中…");
      const homeId = teamKeyFromEvent(event, "home");
      const awayId = teamKeyFromEvent(event, "away");

      const [homePlayers, awayPlayers] = await Promise.all([
        homeId ? Promise.resolve(squadFromCache(cache, homeId) || (await ensurePlayers(settings, homeId))) : Promise.resolve([]),
        awayId ? Promise.resolve(squadFromCache(cache, awayId) || (await ensurePlayers(settings, awayId))) : Promise.resolve([]),
      ]);

      renderAnalysis(cache, settings, event, homePlayers, awayPlayers);
      setStatus("ok", "完成");
    } catch (err) {
      setStatus("warn", `分析失敗（${String(err?.message || err)}）`);
    }
  }

  async function loadCacheAndEvents({ mode } = { mode: "auto" }) {
    const settings = loadSettings();
    state.settings = settings;
    renderLeagueControls(settings);

    let cache = null;
    if (mode === "cache") cache = loadLeagueCache();

    if (!cache && mode !== "cache") {
      setStatus("warn", "同步中…（若失敗會改用快取/離線）");
      try {
        cache = await syncLeague(settings);
        setStatus("ok", "已同步最新賽事資料");
      } catch (err) {
        cache = loadLeagueCache() || builtInFallbackCache(settings);
        setStatus("warn", `同步失敗，改用本機快取（${String(err?.message || err)}）`);
      }
    }

    if (!cache) cache = builtInFallbackCache(settings);
    state.cache = cache;
    setCachePills(cache);

    const events = normalizeEvents(cache);
    state.events = events;

    const selectedId = settings.selectedEventId || UI.matchSelect.value || events[0]?.idEvent || "";
    renderMatchSelect(events, selectedId);
    UI.matchSelect.value = selectedId && events.some((e) => e.idEvent === selectedId) ? selectedId : (events[0]?.idEvent || "");

    if (!events.length) {
      resetResultsEmpty("尚無賽事資料。請按「重新同步資料」。");
      return;
    }
  }

  function wireEvents() {
    UI.leagueSelect.addEventListener("change", async () => {
      const settings = loadSettings();
      settings.leagueId = UI.leagueSelect.value;
      settings.selectedEventId = "";
      saveSettings(settings);
      await loadCacheAndEvents({ mode: "auto" });
      await analyzeSelectedEvent();
    });

    UI.matchSelect.addEventListener("change", async () => {
      const settings = loadSettings();
      settings.selectedEventId = UI.matchSelect.value || "";
      saveSettings(settings);
      state.settings = settings;
      await analyzeSelectedEvent();
    });

    UI.btnSync.addEventListener("click", async () => {
      const settings = loadSettings();
      settings.apiKey = String(UI.apiKeyInput.value || "").trim() || DEFAULT_SETTINGS.apiKey;
      settings.formN = clamp(Number(UI.formNInput.value) || DEFAULT_SETTINGS.formN, 3, 20);
      settings.homeAdv = clamp(Number(UI.homeAdvInput.value) || DEFAULT_SETTINGS.homeAdv, 0, 0.35);
      saveSettings(settings);
      await loadCacheAndEvents({ mode: "auto" });
      await analyzeSelectedEvent();
    });

    UI.btnUseCache.addEventListener("click", async () => {
      await loadCacheAndEvents({ mode: "cache" });
      await analyzeSelectedEvent();
    });

    UI.btnClearCache.addEventListener("click", async () => {
      localStorage.removeItem(STORAGE.leagueCache);
      setCachePills(null);
      setStatus("warn", "已清除快取");
      await loadCacheAndEvents({ mode: "auto" });
      await analyzeSelectedEvent();
    });

    for (const el of [UI.apiKeyInput, UI.formNInput, UI.homeAdvInput]) {
      el.addEventListener("change", () => {
        const settings = loadSettings();
        settings.apiKey = String(UI.apiKeyInput.value || "").trim() || DEFAULT_SETTINGS.apiKey;
        settings.formN = clamp(Number(UI.formNInput.value) || DEFAULT_SETTINGS.formN, 3, 20);
        settings.homeAdv = clamp(Number(UI.homeAdvInput.value) || DEFAULT_SETTINGS.homeAdv, 0, 0.35);
        saveSettings(settings);
      });
    }
  }

  function init() {
    setStatus("warn", "準備中…");
    const settings = loadSettings();
    renderLeagueControls(settings);
    wireEvents();
    loadCacheAndEvents({ mode: "auto" }).then(analyzeSelectedEvent);
  }

  init();
})();
