(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);

  const STORAGE = {
    settings: "fsi.settings.v3",
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
    { id: "4328", name: "Premier League" },
    { id: "4335", name: "La Liga" },
    { id: "4332", name: "Serie A" },
    { id: "4331", name: "Bundesliga" },
    { id: "4334", name: "Ligue 1" },
    { id: "4346", name: "MLS" },
    { id: "4337", name: "Eredivisie" },
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
    projectedScore: $("#projectedScore"),
    projectedScoreMeta: $("#projectedScoreMeta"),
    confidenceLabel: $("#confidenceLabel"),
    confidenceMeta: $("#confidenceMeta"),
    sampleLabel: $("#sampleLabel"),
    sampleMeta: $("#sampleMeta"),
    goalDist: $("#goalDist"),
    formSummary: $("#formSummary"),
    formGrid: $("#formGrid"),
    edgeChips: $("#edgeChips"),
    scorelines: $("#scorelines"),
    btnAiAnalyze: $("#btnAiAnalyze"),
    btnAiCopy: $("#btnAiCopy"),
    aiStatusPill: $("#aiStatusPill"),
    aiPlaceholder: $("#aiPlaceholder"),
    aiContent: $("#aiContent"),
    homeTableTitle: $("#homeTableTitle"),
    awayTableTitle: $("#awayTableTitle"),
    homePlayers: $("#homePlayers tbody"),
    awayPlayers: $("#awayPlayers tbody"),
  };

  const state = {
    settings: null,
    cache: null,
    events: [],
    latestAiText: "",
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function fmtPct(value) {
    return Number.isFinite(value) ? `${Math.round(value)}%` : "-";
  }

  function safeJsonParse(value, fallback) {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function loadSettings() {
    const raw = localStorage.getItem(STORAGE.settings);
    return { ...DEFAULT_SETTINGS, ...(raw ? safeJsonParse(raw, {}) : {}) };
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

  function setStatus(kind, text) {
    UI.status.dataset.state = kind;
    const statusText = $(".status__text", UI.status);
    if (statusText) statusText.textContent = text;
  }

  function setAiState(kind, text) {
    if (!UI.aiStatusPill) return;
    UI.aiStatusPill.dataset.state = kind;
    UI.aiStatusPill.textContent = text;
  }

  function resetAiPanel(message = "AI summary will appear here after you click Run AI Analysis.") {
    state.latestAiText = "";
    if (UI.aiPlaceholder) {
      UI.aiPlaceholder.hidden = false;
      UI.aiPlaceholder.textContent = message;
    }
    if (UI.aiContent) {
      UI.aiContent.hidden = true;
      UI.aiContent.textContent = "";
    }
    if (UI.btnAiAnalyze) UI.btnAiAnalyze.disabled = false;
    if (UI.btnAiCopy) UI.btnAiCopy.disabled = true;
    setAiState("idle", "GPT Ready");
  }

  function showAiResult(text) {
    const content = String(text || "").trim();
    state.latestAiText = content;
    if (UI.aiPlaceholder) UI.aiPlaceholder.hidden = true;
    if (UI.aiContent) {
      UI.aiContent.hidden = false;
      UI.aiContent.textContent = content || "No AI analysis returned.";
    }
    if (UI.btnAiCopy) UI.btnAiCopy.disabled = !content;
    setAiState("done", content ? "AI Complete" : "No Result");
  }

  function formatDateTime(dateText, timeText) {
    const iso = timeText ? `${dateText}T${timeText}` : dateText;
    const date = new Date(iso);
    if (!Number.isFinite(date.getTime())) return "-";
    return new Intl.DateTimeFormat("zh-Hant", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  async function fetchJson(url, { timeoutMs = 15000 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function apiBase(settings) {
    const key = String(settings.apiKey || "").trim() || DEFAULT_SETTINGS.apiKey;
    return `https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(key)}`;
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
    };
  }

  async function syncLeague(settings) {
    const base = apiBase(settings);
    const leagueInfo = await fetchJson(`${base}/lookupleague.php?id=${encodeURIComponent(settings.leagueId)}`);
    const season = leagueInfo?.leagues?.[0]?.strCurrentSeason || leagueInfo?.leagues?.[0]?.strSeason;
    if (!season) throw new Error("Missing season info");

    const eventTimeMs = (event) =>
      new Date(`${event?.dateEvent || "1970-01-01"}T${event?.strTime || "00:00:00"}`).getTime();

    const roundMemo = new Map();
    async function fetchRound(round) {
      if (roundMemo.has(round)) return roundMemo.get(round);
      const promise = (async () => {
        const url =
          `${base}/eventsround.php?id=${encodeURIComponent(settings.leagueId)}` +
          `&r=${encodeURIComponent(String(round))}&s=${encodeURIComponent(season)}`;
        const data = await fetchJson(url, { timeoutMs: 20000 });
        const events = Array.isArray(data?.events) ? data.events : [];
        const times = events.map(eventTimeMs).filter((value) => Number.isFinite(value) && value > 0);
        return { round, events, maxTime: times.length ? Math.max(...times) : null };
      })();
      roundMemo.set(round, promise);
      return promise;
    }

    async function findLastRound(maxRound = 60) {
      let low = 1;
      let high = maxRound;
      let last = 1;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const info = await fetchRound(mid).catch(() => ({ events: [] }));
        if (info.events.length) {
          last = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      return last;
    }

    async function findAnchorRound(lastRound, nowMs) {
      let low = 1;
      let high = lastRound;
      let answer = lastRound;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const info = await fetchRound(mid).catch(() => null);
        if (info?.maxTime != null && info.maxTime >= nowMs) {
          answer = mid;
          high = mid - 1;
        } else {
          low = mid + 1;
        }
      }
      return clamp(answer, 1, lastRound);
    }

    const nowMs = Date.now();
    const lastRound = await findLastRound();
    const anchorRound = await findAnchorRound(lastRound, nowMs);
    const targetRounds = new Set();

    for (let round = anchorRound - 8; round <= anchorRound + 3; round += 1) {
      if (round >= 1 && round <= lastRound) targetRounds.add(round);
    }
    for (let round = lastRound - 2; round <= lastRound; round += 1) {
      if (round >= 1 && round <= lastRound) targetRounds.add(round);
    }

    const allEvents = [];
    for (const round of Array.from(targetRounds).sort((a, b) => a - b)) {
      const info = await fetchRound(round).catch(() => ({ events: [] }));
      allEvents.push(...(info.events || []));
    }

    const seen = new Set();
    const upcomingEvents = [];
    const pastEvents = [];
    for (const event of allEvents) {
      if (!event?.idEvent || seen.has(event.idEvent)) continue;
      seen.add(event.idEvent);
      if (Number.isFinite(Number(event?.intHomeScore)) && Number.isFinite(Number(event?.intAwayScore))) {
        pastEvents.push(event);
      } else if (eventTimeMs(event) >= nowMs) {
        upcomingEvents.push(event);
      }
    }

    const cache = {
      provider: settings.provider,
      leagueId: settings.leagueId,
      sport: settings.sport,
      season,
      fetchedAt: new Date().toISOString(),
      upcomingEvents,
      pastEvents,
    };

    saveLeagueCache(cache);
    return cache;
  }

  function normalizeEvents(cache) {
    const merged = [...(cache?.upcomingEvents || []), ...(cache?.pastEvents || [])];
    const deduped = [];
    const seen = new Set();
    for (const event of merged) {
      if (!event?.idEvent || seen.has(event.idEvent)) continue;
      seen.add(event.idEvent);
      deduped.push(event);
    }

    const now = Date.now();
    deduped.sort((a, b) => {
      const aTime = new Date(`${a.dateEvent || "1970-01-01"}T${a.strTime || "00:00:00"}`).getTime();
      const bTime = new Date(`${b.dateEvent || "1970-01-01"}T${b.strTime || "00:00:00"}`).getTime();
      const aUpcoming = Number.isFinite(aTime) && aTime >= now;
      const bUpcoming = Number.isFinite(bTime) && bTime >= now;
      if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1;
      if (aUpcoming) return aTime - bTime;
      return bTime - aTime;
    });

    return deduped;
  }

  function isFinished(event) {
    return Number.isFinite(Number(event?.intHomeScore)) && Number.isFinite(Number(event?.intAwayScore));
  }

  function teamKeyFromEvent(event, side) {
    return side === "home" ? event?.idHomeTeam : event?.idAwayTeam;
  }

  function eventsForTeam(pastEvents, teamId) {
    return (pastEvents || [])
      .filter((event) => isFinished(event))
      .filter((event) => event?.idHomeTeam === teamId || event?.idAwayTeam === teamId)
      .sort((a, b) => {
        const aTime = new Date(`${a.dateEvent || "1970-01-01"}T${a.strTime || "00:00:00"}`).getTime();
        const bTime = new Date(`${b.dateEvent || "1970-01-01"}T${b.strTime || "00:00:00"}`).getTime();
        return bTime - aTime;
      });
  }

  function computeForm(events, teamId, limit) {
    const recent = eventsForTeam(events, teamId).slice(0, limit);
    let wins = 0;
    let draws = 0;
    let losses = 0;
    let goalsFor = 0;
    let goalsAgainst = 0;

    for (const event of recent) {
      const homeScore = Number(event.intHomeScore);
      const awayScore = Number(event.intAwayScore);
      const isHome = event.idHomeTeam === teamId;
      const scored = isHome ? homeScore : awayScore;
      const conceded = isHome ? awayScore : homeScore;
      goalsFor += scored;
      goalsAgainst += conceded;
      if (scored > conceded) wins += 1;
      else if (scored === conceded) draws += 1;
      else losses += 1;
    }

    const played = recent.length;
    return {
      played,
      wins,
      draws,
      losses,
      points: wins * 3 + draws,
      goalsFor,
      goalsAgainst,
      avgGoalsFor: played ? goalsFor / played : 0,
      avgGoalsAgainst: played ? goalsAgainst / played : 0,
    };
  }

  function computeVenueForm(events, teamId, venue, limit) {
    const filtered = eventsForTeam(events, teamId).filter((event) =>
      venue === "home" ? event.idHomeTeam === teamId : event.idAwayTeam === teamId
    );
    return computeForm(filtered, teamId, limit);
  }

  function computeHeadToHead(events, homeId, awayId, limit) {
    const matches = (events || [])
      .filter((event) => isFinished(event))
      .filter(
        (event) =>
          (event.idHomeTeam === homeId && event.idAwayTeam === awayId) ||
          (event.idHomeTeam === awayId && event.idAwayTeam === homeId)
      )
      .sort((a, b) => {
        const aTime = new Date(`${a.dateEvent || "1970-01-01"}T${a.strTime || "00:00:00"}`).getTime();
        const bTime = new Date(`${b.dateEvent || "1970-01-01"}T${b.strTime || "00:00:00"}`).getTime();
        return bTime - aTime;
      })
      .slice(0, limit);

    let homeWins = 0;
    let awayWins = 0;
    let draws = 0;
    let homeGoals = 0;
    let awayGoals = 0;

    for (const event of matches) {
      const homeScore = Number(event.intHomeScore);
      const awayScore = Number(event.intAwayScore);
      const normalizedHomeGoals = event.idHomeTeam === homeId ? homeScore : awayScore;
      const normalizedAwayGoals = event.idHomeTeam === homeId ? awayScore : homeScore;
      homeGoals += normalizedHomeGoals;
      awayGoals += normalizedAwayGoals;
      if (normalizedHomeGoals > normalizedAwayGoals) homeWins += 1;
      else if (normalizedHomeGoals < normalizedAwayGoals) awayWins += 1;
      else draws += 1;
    }

    const played = matches.length;
    return {
      played,
      homeWins,
      awayWins,
      draws,
      avgHomeGoals: played ? homeGoals / played : 0,
      avgAwayGoals: played ? awayGoals / played : 0,
    };
  }

  function leagueAverages(events) {
    let matches = 0;
    let homeGoals = 0;
    let awayGoals = 0;
    for (const event of events || []) {
      if (!isFinished(event)) continue;
      const hs = Number(event.intHomeScore);
      const as = Number(event.intAwayScore);
      if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;
      matches += 1;
      homeGoals += hs;
      awayGoals += as;
    }
    const totalGoals = homeGoals + awayGoals;
    return {
      matches,
      perTeam: matches ? totalGoals / (matches * 2) : 1.3,
      homePerMatch: matches ? homeGoals / matches : 1.4,
      awayPerMatch: matches ? awayGoals / matches : 1.2,
    };
  }

  function ratio(value, baseline, fallback = 1) {
    if (!Number.isFinite(value) || !Number.isFinite(baseline) || baseline <= 0) return fallback;
    return value / baseline;
  }

  function pointsRate(form) {
    return form.played ? form.points / (form.played * 3) : 0.5;
  }

  function goalDiffRate(form) {
    return form.played ? (form.goalsFor - form.goalsAgainst) / form.played : 0;
  }

  function poissonPmf(k, lambda) {
    if (k < 0) return 0;
    let factorial = 1;
    for (let i = 2; i <= k; i += 1) factorial *= i;
    return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial;
  }

  function scoreMatrixDetails(lambdaHome, lambdaAway, maxGoals = 6) {
    const homeProb = [];
    const awayProb = [];
    const cells = [];
    let pHome = 0;
    let pDraw = 0;
    let pAway = 0;
    let total = 0;

    for (let i = 0; i <= maxGoals; i += 1) {
      homeProb[i] = poissonPmf(i, lambdaHome);
      awayProb[i] = poissonPmf(i, lambdaAway);
    }

    for (let home = 0; home <= maxGoals; home += 1) {
      for (let away = 0; away <= maxGoals; away += 1) {
        const probability = homeProb[home] * awayProb[away];
        total += probability;
        cells.push({ home, away, prob: probability * 100 });
        if (home > away) pHome += probability;
        else if (home === away) pDraw += probability;
        else pAway += probability;
      }
    }

    const norm = total || 1;
    return {
      pHome: (pHome / norm) * 100,
      pDraw: (pDraw / norm) * 100,
      pAway: (pAway / norm) * 100,
      cells: cells
        .map((cell) => ({ ...cell, prob: cell.prob / norm }))
        .sort((a, b) => b.prob - a.prob),
    };
  }

  function totalGoalsBuckets(lambdaHome, lambdaAway, maxGoals = 10) {
    let p01 = 0;
    let p23 = 0;
    let p4p = 0;
    for (let home = 0; home <= maxGoals; home += 1) {
      for (let away = 0; away <= maxGoals; away += 1) {
        const probability = poissonPmf(home, lambdaHome) * poissonPmf(away, lambdaAway);
        const total = home + away;
        if (total <= 1) p01 += probability;
        else if (total <= 3) p23 += probability;
        else p4p += probability;
      }
    }
    const sum = p01 + p23 + p4p || 1;
    return {
      p01: (p01 / sum) * 100,
      p23: (p23 / sum) * 100,
      p4p: (p4p / sum) * 100,
    };
  }

  function cleanGoalDetails(rawValue) {
    if (!rawValue) return [];
    return String(rawValue)
      .replaceAll("<br>", ";")
      .replaceAll("\n", ";")
      .replaceAll("\r", ";")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => part.split(":")[0]?.trim() || part)
      .map((part) => part.replace(/\b\d+\s*'?/g, " ").replace(/\((.*?)\)/g, " ").trim())
      .map((part) => part.replace(/\s+/g, " ").trim())
      .filter((part) => part && part.length <= 40);
  }

  function scorerCountsForTeam(events, teamId, limit) {
    const map = new Map();
    const recent = eventsForTeam(events, teamId).slice(0, limit);
    for (const event of recent) {
      const raw = event.idHomeTeam === teamId ? event.strHomeGoalDetails : event.strAwayGoalDetails;
      for (const scorer of cleanGoalDetails(raw)) {
        map.set(scorer, (map.get(scorer) || 0) + 1);
      }
    }
    return map;
  }

  async function fetchPlayers(settings, teamId) {
    const base = apiBase(settings);
    const data = await fetchJson(`${base}/lookup_all_players.php?id=${encodeURIComponent(teamId)}`);
    const players = Array.isArray(data?.player) ? data.player : [];
    return players.map((player) => ({
      id: player.idPlayer || null,
      name: player.strPlayer || "-",
      pos: player.strPosition || "-",
    }));
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
    if (!cache?.fetchedAt) return "-";
    const date = new Date(cache.fetchedAt);
    if (!Number.isFinite(date.getTime())) return "-";
    return new Intl.DateTimeFormat("zh-Hant", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function setCachePills(cache) {
    UI.pillProvider.textContent = `Provider: ${cache?.provider || "-"}`;
    UI.pillCache.textContent = cache?.fetchedAt ? "Cache: ready" : "Cache: none";
    UI.pillUpdated.textContent = `Updated: ${cacheMeta(cache)}`;
  }

  function renderLeagueControls(settings) {
    UI.sportSelect.value = settings.sport;
    UI.leagueSelect.innerHTML = LEAGUES.map(
      (league) =>
        `<option value="${escapeHtml(league.id)}" ${
          league.id === settings.leagueId ? "selected" : ""
        }>${escapeHtml(league.name)}</option>`
    ).join("");
    UI.apiKeyInput.value = settings.apiKey || "";
    UI.formNInput.value = String(settings.formN);
    UI.homeAdvInput.value = String(settings.homeAdv);
    UI.pillProvider.textContent = `Provider: ${settings.provider}`;
  }

  function matchLabel(event) {
    const home = event?.strHomeTeam || "-";
    const away = event?.strAwayTeam || "-";
    const dateText = event?.dateEvent ? formatDateTime(event.dateEvent, event.strTime) : "-";
    const scoreText =
      event?.intHomeScore != null && event?.intAwayScore != null
        ? ` (${event.intHomeScore}-${event.intAwayScore})`
        : "";
    return `${dateText} | ${home} vs ${away}${scoreText}`;
  }

  function renderMatchSelect(events, selectedId) {
    if (!events.length) {
      UI.matchSelect.innerHTML = `<option value="">(No matches)</option>`;
      return;
    }
    UI.matchSelect.innerHTML = events
      .slice(0, 80)
      .map((event) => {
        const selected = event.idEvent === selectedId ? "selected" : "";
        return `<option value="${escapeHtml(event.idEvent)}" ${selected}>${escapeHtml(
          matchLabel(event)
        )}</option>`;
      })
      .join("");
  }

  function renderGoalDist(buckets) {
    const rows = [
      { label: "0-1", pct: buckets?.p01 },
      { label: "2-3", pct: buckets?.p23 },
      { label: "4+", pct: buckets?.p4p },
    ];
    UI.goalDist.innerHTML = rows
      .map(
        (row) => `
          <div class="distrow">
            <div class="distrow__label">${row.label}</div>
            <div class="distrow__bar"><div class="distrow__fill" style="width:${clamp(
              row.pct || 0,
              0,
              100
            )}%"></div></div>
            <div class="distrow__pct">${fmtPct(row.pct)}</div>
          </div>
        `
      )
      .join("");
  }

  function renderEdgeChips(chips) {
    UI.edgeChips.innerHTML = chips
      .map(
        (chip) => `
          <div class="chip chip--${chip.tone}">
            <span class="chip__tone" aria-hidden="true"></span>
            <span>${escapeHtml(chip.text)}</span>
          </div>
        `
      )
      .join("");
  }

  function renderScorelines(lines) {
    UI.scorelines.innerHTML = lines
      .map(
        (line, index) => `
          <div class="scoreline">
            <div class="scoreline__label">${escapeHtml(line.label)}</div>
            <div class="scoreline__prob">${fmtPct(line.prob)}</div>
            <div class="scoreline__rank">Top ${index + 1}</div>
          </div>
        `
      )
      .join("");
  }

  function renderFormBox(title, form) {
    return `
      <div class="formbox">
        <div class="formbox__title">${escapeHtml(title)}</div>
        <div class="formbox__line">W-D-L: ${form.wins}-${form.draws}-${form.losses} (${form.played})</div>
        <div class="formbox__line">GF/GA: ${form.goalsFor}/${form.goalsAgainst}</div>
        <div class="formbox__line">AVG GF ${form.avgGoalsFor.toFixed(2)} / GA ${form.avgGoalsAgainst.toFixed(2)}</div>
      </div>
    `;
  }

  function renderPlayersTable(tbody, titleEl, teamName, players, goalCounts) {
    titleEl.textContent = teamName || "-";
    const rows = (players || [])
      .map((player) => ({
        name: player.name || "-",
        pos: player.pos || "-",
        goals: goalCounts.get(player.name) || 0,
      }))
      .sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name, "en"))
      .slice(0, 18);

    tbody.innerHTML = rows
      .map(
        (row) => `
          <tr>
            <td>${escapeHtml(row.name)}</td>
            <td>${escapeHtml(row.pos)}</td>
            <td class="num">${row.goals}</td>
          </tr>
        `
      )
      .join("");
  }

  function buildConfidenceLabel(sampleSize, edgePct) {
    if (sampleSize >= 16 && edgePct >= 18) return "High";
    if (sampleSize >= 10 && edgePct >= 10) return "Mid";
    return "Low";
  }

  function buildEdgeChips(homeForm, awayForm, homeVenue, awayVenue, h2h) {
    const chips = [];
    const pointsGap = homeForm.points - awayForm.points;
    if (Math.abs(pointsGap) >= 4) {
      chips.push({
        tone: pointsGap > 0 ? "home" : "away",
        text: `${pointsGap > 0 ? "Home" : "Away"} form edge`,
      });
    }

    const venueGap =
      (homeVenue.avgGoalsFor - homeVenue.avgGoalsAgainst) -
      (awayVenue.avgGoalsFor - awayVenue.avgGoalsAgainst);
    if (Math.abs(venueGap) >= 0.35) {
      chips.push({
        tone: venueGap > 0 ? "home" : "away",
        text: `${venueGap > 0 ? "Home venue" : "Away venue"} strength`,
      });
    }

    if (h2h.played >= 2) {
      const balance = h2h.homeWins - h2h.awayWins;
      chips.push({
        tone: balance === 0 ? "neutral" : balance > 0 ? "home" : "away",
        text: balance === 0 ? `H2H even (${h2h.played})` : `${balance > 0 ? "Home" : "Away"} H2H edge`,
      });
    }

    if (!chips.length) {
      chips.push({ tone: "neutral", text: "Teams are close" });
    }
    return chips.slice(0, 4);
  }

  function resetResultsEmpty(message) {
    UI.homeName.textContent = "-";
    UI.awayName.textContent = "-";
    UI.homeMeta.textContent = "-";
    UI.awayMeta.textContent = "-";
    UI.pHome.textContent = "-";
    UI.pDraw.textContent = "-";
    UI.pAway.textContent = "-";
    UI.barHome.style.width = "0%";
    UI.barDraw.style.width = "0%";
    UI.barAway.style.width = "0%";
    UI.projectedScore.textContent = "-";
    UI.projectedScoreMeta.textContent = "-";
    UI.confidenceLabel.textContent = "-";
    UI.confidenceMeta.textContent = "-";
    UI.sampleLabel.textContent = "-";
    UI.sampleMeta.textContent = "-";
    UI.goalDist.innerHTML = "";
    UI.formSummary.textContent = message || "-";
    UI.formGrid.innerHTML = "";
    UI.edgeChips.innerHTML = "";
    UI.scorelines.innerHTML = "";
    UI.homePlayers.innerHTML = "";
    UI.awayPlayers.innerHTML = "";
    resetAiPanel(message ? `AI is waiting for match data. ${message}` : undefined);
  }

  function goalMapFromCache(cache, teamId) {
    const raw = cache?.playerGoals?.[String(teamId)];
    if (!raw || typeof raw !== "object") return null;
    const map = new Map();
    for (const [name, goals] of Object.entries(raw)) {
      map.set(name, Number(goals) || 0);
    }
    return map;
  }

  function squadFromCache(cache, teamId) {
    const raw = cache?.teamSquads?.[String(teamId)];
    if (!Array.isArray(raw)) return null;
    return raw
      .map((player) => ({
        id: null,
        name: player?.name || player?.strPlayer || "-",
        pos: player?.pos || player?.position || player?.strPosition || "-",
      }))
      .filter((player) => player.name && player.name !== "-");
  }

  function getSelectedEventId() {
    return UI.matchSelect.value || state.settings?.selectedEventId || "";
  }

  function analyzeMatch(cache, settings, event) {
    const pastEvents = cache?.pastEvents || [];
    const n = clamp(Number(settings.formN) || DEFAULT_SETTINGS.formN, 3, 20);
    const homeAdv = clamp(Number(settings.homeAdv) || DEFAULT_SETTINGS.homeAdv, 0, 0.35);
    const homeId = teamKeyFromEvent(event, "home");
    const awayId = teamKeyFromEvent(event, "away");

    const homeForm = computeForm(pastEvents, homeId, n);
    const awayForm = computeForm(pastEvents, awayId, n);
    const homeVenue = computeVenueForm(pastEvents, homeId, "home", Math.min(6, n));
    const awayVenue = computeVenueForm(pastEvents, awayId, "away", Math.min(6, n));
    const h2h = computeHeadToHead(pastEvents, homeId, awayId, 4);
    const averages = leagueAverages(pastEvents);
    const baseTeam = averages.perTeam || 1.3;

    const homeAttack =
      ratio(homeForm.avgGoalsFor, baseTeam) * 0.45 +
      ratio(homeVenue.avgGoalsFor, averages.homePerMatch || baseTeam) * 0.35 +
      (0.8 + pointsRate(homeForm) * 0.4) * 0.2;
    const awayAttack =
      ratio(awayForm.avgGoalsFor, baseTeam) * 0.45 +
      ratio(awayVenue.avgGoalsFor, averages.awayPerMatch || baseTeam) * 0.35 +
      (0.8 + pointsRate(awayForm) * 0.4) * 0.2;

    const homeDefense =
      ratio(homeForm.avgGoalsAgainst, baseTeam) * 0.5 +
      ratio(homeVenue.avgGoalsAgainst, averages.awayPerMatch || baseTeam) * 0.3 +
      clamp(1 - goalDiffRate(homeForm) * 0.08, 0.72, 1.28) * 0.2;
    const awayDefense =
      ratio(awayForm.avgGoalsAgainst, baseTeam) * 0.5 +
      ratio(awayVenue.avgGoalsAgainst, averages.homePerMatch || baseTeam) * 0.3 +
      clamp(1 - goalDiffRate(awayForm) * 0.08, 0.72, 1.28) * 0.2;

    const h2hBoost =
      h2h.played >= 2
        ? clamp((h2h.homeWins - h2h.awayWins) * 0.04 + (h2h.avgHomeGoals - h2h.avgAwayGoals) * 0.03, -0.12, 0.12)
        : 0;
    const formGapBoost = clamp((pointsRate(homeForm) - pointsRate(awayForm)) * 0.16, -0.12, 0.12);

    const lambdaHome = clamp(
      baseTeam * homeAttack * awayDefense * (1 + homeAdv + h2hBoost + Math.max(formGapBoost, -0.04)),
      0.25,
      3.8
    );
    const lambdaAway = clamp(
      baseTeam * awayAttack * homeDefense * (1 - h2hBoost - Math.min(formGapBoost, 0.04)),
      0.2,
      3.4
    );

    const matrix = scoreMatrixDetails(lambdaHome, lambdaAway, 6);
    const buckets = totalGoalsBuckets(lambdaHome, lambdaAway, 10);
    const sampleSize = Math.min(homeForm.played, awayForm.played);
    const edgePct = Math.abs(matrix.pHome - matrix.pAway);

    return {
      homeForm,
      awayForm,
      h2h,
      averages,
      lambdaHome,
      lambdaAway,
      matrix,
      buckets,
      sampleSize,
      edgePct,
      confidence: buildConfidenceLabel(sampleSize, edgePct),
      projected: matrix.cells[0] || { home: 1, away: 0, prob: 0 },
      topScorelines: matrix.cells.slice(0, 3).map((cell) => ({
        label: `${cell.home} - ${cell.away}`,
        prob: cell.prob,
      })),
      edgeChips: buildEdgeChips(homeForm, awayForm, homeVenue, awayVenue, h2h),
    };
  }
  async function analyzeSelectedEvent() {
    if (!state.cache || !state.events.length) {
      resetResultsEmpty("No match data");
      return;
    }

    const selectedId = getSelectedEventId() || state.events[0]?.idEvent || "";
    const event = state.events.find((item) => item.idEvent === selectedId) || state.events[0];
    if (!event) {
      resetResultsEmpty("No active match");
      return;
    }

    UI.matchSelect.value = event.idEvent;
    state.settings.selectedEventId = event.idEvent;
    saveSettings(state.settings);
    resetAiPanel(`AI summary is ready to run for ${event.strHomeTeam || "Home"} vs ${event.strAwayTeam || "Away"}.`);

    setStatus("ok", "Analyzing...");
    const model = analyzeMatch(state.cache, state.settings, event);

    UI.homeName.textContent = event.strHomeTeam || "-";
    UI.awayName.textContent = event.strAwayTeam || "-";
    const metaBase = formatDateTime(event.dateEvent, event.strTime);
    const venueText = event?.strVenue ? ` | ${event.strVenue}` : "";
    UI.homeMeta.textContent = `${metaBase}${venueText}`;
    UI.awayMeta.textContent = `${metaBase}${venueText}`;

    UI.pHome.textContent = fmtPct(model.matrix.pHome);
    UI.pDraw.textContent = fmtPct(model.matrix.pDraw);
    UI.pAway.textContent = fmtPct(model.matrix.pAway);
    UI.barHome.style.width = `${clamp(model.matrix.pHome, 0, 100)}%`;
    UI.barDraw.style.width = `${clamp(model.matrix.pDraw, 0, 100)}%`;
    UI.barAway.style.width = `${clamp(model.matrix.pAway, 0, 100)}%`;

    UI.projectedScore.textContent = `${model.projected.home} - ${model.projected.away}`;
    UI.projectedScoreMeta.textContent = `Top exact score ${fmtPct(model.projected.prob)}`;
    UI.confidenceLabel.textContent = model.confidence;
    UI.confidenceMeta.textContent = `Edge ${fmtPct(model.edgePct)} | Sample ${model.sampleSize}`;
    UI.sampleLabel.textContent = `${model.sampleSize}`;
    UI.sampleMeta.textContent = model.h2h.played ? `H2H ${model.h2h.played}` : "No H2H sample";

    renderGoalDist(model.buckets);
    renderEdgeChips(model.edgeChips);
    renderScorelines(model.topScorelines);

    UI.formSummary.textContent = [
      model.averages.matches ? `League sample ${model.averages.matches}` : null,
      `Model: form + venue + h2h + home bonus ${Math.round(state.settings.homeAdv * 100)}%`,
      `Expected goals ${model.lambdaHome.toFixed(2)} / ${model.lambdaAway.toFixed(2)}`,
    ]
      .filter(Boolean)
      .join(" | ");

    UI.formGrid.innerHTML = [
      renderFormBox(`${UI.homeName.textContent} recent ${model.homeForm.played}`, model.homeForm),
      renderFormBox(`${UI.awayName.textContent} recent ${model.awayForm.played}`, model.awayForm),
    ].join("");

    const homeId = teamKeyFromEvent(event, "home");
    const awayId = teamKeyFromEvent(event, "away");
    const [homePlayers, awayPlayers] = await Promise.all([
      squadFromCache(state.cache, homeId) || ensurePlayers(state.settings, homeId).catch(() => []),
      squadFromCache(state.cache, awayId) || ensurePlayers(state.settings, awayId).catch(() => []),
    ]);

    const homeGoals =
      goalMapFromCache(state.cache, homeId) || scorerCountsForTeam(state.cache.pastEvents || [], homeId, state.settings.formN);
    const awayGoals =
      goalMapFromCache(state.cache, awayId) || scorerCountsForTeam(state.cache.pastEvents || [], awayId, state.settings.formN);

    renderPlayersTable(UI.homePlayers, UI.homeTableTitle, UI.homeName.textContent, homePlayers, homeGoals);
    renderPlayersTable(UI.awayPlayers, UI.awayTableTitle, UI.awayName.textContent, awayPlayers, awayGoals);

    setStatus("ok", "Done");
  }

  async function loadCacheAndEvents({ mode = "auto" } = {}) {
    state.settings = loadSettings();
    renderLeagueControls(state.settings);

    let cache = mode === "cache" ? loadLeagueCache() : null;
    if (!cache && mode !== "cache") {
      setStatus("warn", "Syncing...");
      try {
        cache = await syncLeague(state.settings);
        setStatus("ok", "Latest data synced");
      } catch (error) {
        cache = loadLeagueCache() || builtInFallbackCache(state.settings);
        setStatus("warn", `Sync failed, using cache (${String(error?.message || error)})`);
      }
    }

    if (!cache) cache = builtInFallbackCache(state.settings);
    state.cache = cache;
    state.events = normalizeEvents(cache);
    setCachePills(cache);

    const selectedId = state.settings.selectedEventId || state.events[0]?.idEvent || "";
    renderMatchSelect(state.events, selectedId);
    if (!state.events.length) resetResultsEmpty("No data");
  }

  function bindSettingsInputs() {
    const settings = loadSettings();
    settings.apiKey = String(UI.apiKeyInput.value || "").trim() || DEFAULT_SETTINGS.apiKey;
    settings.formN = clamp(Number(UI.formNInput.value) || DEFAULT_SETTINGS.formN, 3, 20);
    settings.homeAdv = clamp(Number(UI.homeAdvInput.value) || DEFAULT_SETTINGS.homeAdv, 0, 0.35);
    saveSettings(settings);
    state.settings = settings;
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
      bindSettingsInputs();
      await loadCacheAndEvents({ mode: "auto" });
      await analyzeSelectedEvent();
    });

    UI.btnUseCache.addEventListener("click", async () => {
      bindSettingsInputs();
      await loadCacheAndEvents({ mode: "cache" });
      await analyzeSelectedEvent();
    });

    UI.btnClearCache.addEventListener("click", async () => {
      localStorage.removeItem(STORAGE.leagueCache);
      setStatus("warn", "Cache cleared");
      await loadCacheAndEvents({ mode: "auto" });
      await analyzeSelectedEvent();
    });

    for (const element of [UI.apiKeyInput, UI.formNInput, UI.homeAdvInput]) {
      element.addEventListener("change", bindSettingsInputs);
    }

    if (UI.btnAiAnalyze) {
      UI.btnAiAnalyze.addEventListener("click", async () => {
        try {
          UI.btnAiAnalyze.disabled = true;
          setAiState("loading", "AI Thinking...");
          if (UI.aiPlaceholder) {
            UI.aiPlaceholder.hidden = false;
            UI.aiPlaceholder.textContent = "GPT is analyzing the current match...";
          }
          if (UI.aiContent) {
            UI.aiContent.hidden = true;
            UI.aiContent.textContent = "";
          }

          const result = await requestAiAnalysis();
          showAiResult(result.analysis || "");
        } catch (error) {
          const message = String(error?.message || error || "AI analyze failed");
          if (UI.aiPlaceholder) {
            UI.aiPlaceholder.hidden = false;
            UI.aiPlaceholder.textContent = message;
          }
          if (UI.aiContent) {
            UI.aiContent.hidden = true;
            UI.aiContent.textContent = "";
          }
          if (UI.btnAiCopy) UI.btnAiCopy.disabled = true;
          setAiState("error", "AI Error");
        } finally {
          if (UI.btnAiAnalyze) UI.btnAiAnalyze.disabled = false;
        }
      });
    }

    if (UI.btnAiCopy) {
      UI.btnAiCopy.disabled = true;
      UI.btnAiCopy.addEventListener("click", async () => {
        if (!state.latestAiText) return;
        try {
          await navigator.clipboard.writeText(state.latestAiText);
          setAiState("copied", "Copied");
        } catch {
          setAiState("warn", "Copy Failed");
        }
      });
    }
  }

  function buildAiPayload() {
    if (!state.cache || !state.events.length) return null;
    const selectedId = getSelectedEventId() || state.events[0]?.idEvent || "";
    const event = state.events.find((item) => item.idEvent === selectedId) || state.events[0];
    if (!event) return null;

    const model = analyzeMatch(state.cache, state.settings, event);
    return {
      sport: String(state.settings?.sport || "soccer").toLowerCase(),
      match: {
        id: event.idEvent,
        homeTeam: event.strHomeTeam,
        awayTeam: event.strAwayTeam,
        kickoff: event.dateEvent && event.strTime ? `${event.dateEvent}T${event.strTime}` : event.dateEvent || "",
        venue: event.strVenue || "",
      },
      modelInputs: {
        homeWinPct: Math.round(model.matrix.pHome),
        drawPct: Math.round(model.matrix.pDraw),
        awayWinPct: Math.round(model.matrix.pAway),
        expectedGoalsHome: Number(model.lambdaHome.toFixed(2)),
        expectedGoalsAway: Number(model.lambdaAway.toFixed(2)),
        projectedScore: `${model.projected.home}-${model.projected.away}`,
      },
      playerNotes: [],
    };
  }

  async function requestAiAnalysis(payload = buildAiPayload()) {
    if (!payload) throw new Error("No active match payload");
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok || !data?.ok) {
      throw new Error(data?.details || data?.error || "AI analyze failed");
    }
    return {
      ...data,
      analysis: String(data.analysis || "").trim(),
    };
  }

  window.futureSportsIntel = {
    buildAiPayload,
    requestAiAnalysis,
  };

  async function init() {
    setStatus("warn", "Loading...");
    resetAiPanel();
    renderLeagueControls(loadSettings());
    wireEvents();
    await loadCacheAndEvents({ mode: "auto" });
    await analyzeSelectedEvent();
  }

  init();
})();
