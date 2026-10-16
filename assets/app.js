/* Score Préci — le jeu des buteurs au but près. */
(function () {
  'use strict';

  const DATA = window.SCOREPRECI_DATA;
  if (!DATA || !DATA.leagues) {
    document.getElementById('app').insertAdjacentHTML('afterbegin',
      '<p class="noscript">Les données des buteurs n\'ont pas pu être chargées (assets/players.js).</p>');
    return;
  }

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = (ms) => new Promise((r) => setTimeout(r, reduceMotion ? Math.min(ms, 30) : ms));
  const fmt = (n) => n.toLocaleString('fr-FR');
  const plural = (n, word) => `${fmt(n)} ${word}${Math.abs(n) > 1 ? 's' : ''}`;
  const COUNTS = [3, 5, 7, 11];

  /* ---------------------------------------------------------------- storage */
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem('scorepreci:' + key);
        return v == null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('scorepreci:' + key, JSON.stringify(value)); } catch (e) { /* private mode */ }
    },
    del(key) {
      try { localStorage.removeItem('scorepreci:' + key); } catch (e) { /* private mode */ }
    },
  };

  /* ---------------------------------------------------------------- data */
  // Same normalisation as scripts/build_data.py so typed names match the index.
  function norm(s) {
    return String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/[øØ]/g, 'o').replace(/ß/g, 'ss').replace(/[đĐ]/g, 'd').replace(/[łŁ]/g, 'l')
      .replace(/[æÆ]/g, 'ae').replace(/ı/g, 'i')
      .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  const LEAGUES = DATA.leagues.map((L) => ({
    id: L.id, name: L.name, short: L.short, scope: L.scope, source: L.source,
    count: L.count, min: L.min, max: L.max,
    players: L.players.map((a, i) => ({
      i, name: a[0], goals: a[1], nat: a[2], pos: a[3], born: a[4], era: a[5],
      tokens: a[6].split(' '), clubs: a[7], key: norm(a[0]),
    })),
  }));
  const LEAGUE = Object.fromEntries(LEAGUES.map((L) => [L.id, L]));

  function leagueSub(L) {
    if (L.id === 'pl') return `${fmt(L.count)} buteurs depuis 1992`;
    return `${fmt(L.count)} buteurs · ${L.min} buts et +`;
  }

  function bounds(L, n) {
    let max = 0, min = 0;
    const p = L.players; // sorted by goals, descending
    for (let k = 0; k < n; k++) { max += p[k].goals; min += p[p.length - 1 - k].goals; }
    return { min, max };
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(str) {
    let h = 2166136261;
    for (let k = 0; k < str.length; k++) { h ^= str.charCodeAt(k); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  // A drawn target is the sum of real players, so a perfect answer always exists.
  function draw(L, n, rand = Math.random) {
    const pool = Math.min(L.players.length, 300);
    const picked = new Set();
    while (picked.size < n) picked.add(Math.floor(rand() * pool));
    const combo = Array.from(picked);
    return { target: combo.reduce((s, i) => s + L.players[i].goals, 0), combo };
  }

  function dayKey(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function dailyChallenge(key = dayKey()) {
    const rand = mulberry32(hash('scorepreci:' + key));
    const majors = LEAGUES.filter((L) => L.id !== 'ucl');
    const L = majors[Math.floor(rand() * majors.length)];
    const n = rand() < 0.55 ? 3 : 5;
    const { target, combo } = draw(L, n, rand);
    return { key, leagueId: L.id, n, target, combo };
  }

  // Closest reachable total with exactly n distinct players (0/1 knapsack on counts).
  function bestCombo(L, n, target) {
    const pool = L.players.slice(0, Math.min(L.players.length, 400));
    const cap = target + pool[0].goals;
    const reach = [];
    for (let k = 0; k <= n; k++) reach.push(new Int16Array(cap + 1).fill(-1));
    reach[0][0] = 32767;
    pool.forEach((p, j) => {
      for (let k = n; k >= 1; k--) {
        const prev = reach[k - 1], cur = reach[k];
        for (let s = cap; s >= p.goals; s--) {
          if (cur[s] === -1 && prev[s - p.goals] !== -1) cur[s] = j;
        }
      }
    });
    let best = -1;
    for (let d = 0; d <= cap; d++) {
      if (target - d >= 0 && reach[n][target - d] !== -1) { best = target - d; break; }
      if (target + d <= cap && reach[n][target + d] !== -1) { best = target + d; break; }
    }
    if (best < 0) return null;
    const combo = [];
    for (let k = n, s = best; k > 0; k--) {
      const j = reach[k][s];
      combo.push(pool[j].i);
      s -= pool[j].goals;
    }
    return combo;
  }

  function meta(p) {
    const bits = [p.nat];
    if (p.pos) bits.push(p.pos);
    if (p.born) bits.push(`né en ${p.born}`);
    else if (p.era) bits.push(p.era);
    return bits.filter(Boolean).join(' · ');
  }

  function search(L, query, used) {
    const q = norm(query);
    if (!q) return [];
    const qt = q.split(' ');
    const out = [];
    for (const p of L.players) {
      if (!qt.every((t) => p.tokens.some((pt) => pt.startsWith(t)))) continue;
      let rank = 2;
      if (p.key.startsWith(q)) rank = 0;
      else if (qt.every((t) => p.key.split(' ').some((pt) => pt.startsWith(t)))) rank = 1;
      out.push({ p, rank, used: used.has(p.i) });
    }
    out.sort((a, b) => a.rank - b.rank || b.p.goals - a.p.goals || a.p.name.localeCompare(b.p.name));
    return out.slice(0, 7);
  }

  function verdict(ecart) {
    if (ecart === 0) return { title: 'Lucarne', line: 'Pile le compte. Impossible de faire mieux.', good: true };
    if (ecart <= 2) return { title: 'Poteau rentrant', line: 'À un cheveu. Ça rentre quand même.', good: true };
    if (ecart <= 5) return { title: 'Cadré', line: 'Le gardien a dû sortir le grand jeu.', good: true };
    if (ecart <= 12) return { title: 'À côté', line: 'Le ballon frôle le poteau.', good: false };
    if (ecart <= 30) return { title: 'Dans le mur', line: 'Tir contré, il faudra mieux viser.', good: false };
    return { title: 'En tribune', line: 'Le ballon a fini dans le virage.', good: false };
  }

  /* ---------------------------------------------------------------- sound */
  const sfx = {
    ctx: null,
    noise: null,
    on: store.get('sound', true),
    last: 0,
    unlocked: false, // browsers only allow audio after a tap or key press
    ensure() {
      if (!this.on || !this.unlocked) return null;
      try {
        if (!this.ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return null;
          this.ctx = new AC();
          const len = Math.floor(this.ctx.sampleRate * 0.6);
          this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
          const d = this.noise.getChannelData(0);
          for (let k = 0; k < len; k++) d[k] = Math.random() * 2 - 1;
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return this.ctx;
      } catch (e) { return null; }
    },
    burst(freq, q, gain, dur) {
      const c = this.ensure();
      if (!c) return;
      const t = c.currentTime;
      const src = c.createBufferSource();
      src.buffer = this.noise;
      const f = c.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
      const g = c.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(c.destination);
      src.start(t, Math.random() * 0.5);
      src.stop(t + dur + 0.02);
    },
    flap() {
      const now = performance.now();
      if (now - this.last < 26) return;
      this.last = now;
      this.burst(2200 + Math.random() * 1400, 1.6, 0.2, 0.028);
    },
    key() { this.burst(4200, 2.5, 0.05, 0.012); },
    thud() {
      const c = this.ensure();
      if (!c) return;
      const t = c.currentTime;
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.14);
      g.gain.setValueAtTime(0.55, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      o.connect(g); g.connect(c.destination);
      o.start(t); o.stop(t + 0.22);
      this.burst(800, 0.7, 0.3, 0.07);
    },
    whistle(pattern) {
      const c = this.ensure();
      if (!c) return;
      let t = c.currentTime + 0.03;
      for (const d of pattern) {
        const o = c.createOscillator(), lfo = c.createOscillator();
        const depth = c.createGain(), g = c.createGain();
        o.type = 'sine'; o.frequency.value = 2900;
        lfo.frequency.value = 32; depth.gain.value = 170;
        lfo.connect(depth); depth.connect(o.frequency);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.09, t + 0.02);
        g.gain.setValueAtTime(0.09, t + d - 0.04);
        g.gain.linearRampToValueAtTime(0, t + d);
        o.connect(g); g.connect(c.destination);
        o.start(t); lfo.start(t); o.stop(t + d + 0.02); lfo.stop(t + d + 0.02);
        t += d + 0.11;
      }
    },
  };
  function buzz(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* unsupported */ } }

  /* ---------------------------------------------------------------- split-flap */
  const DIGITS = ' 0123456789';
  const LETTERS = ' ABCDEFGHIJKLMNOPQRSTUVWXYZÉ';

  class Flaps {
    constructor(el, length, charset = DIGITS) {
      this.el = el;
      this.charset = charset;
      this.el.textContent = '';
      this.cells = [];
      for (let k = 0; k < length; k++) {
        const cell = document.createElement('span');
        cell.className = 'flap is-blank';
        cell.innerHTML =
          '<span class="flap-half flap-top"><span> </span></span>' +
          '<span class="flap-half flap-bottom"><span> </span></span>' +
          '<span class="flap-leaf flap-leaf-top"><span> </span></span>' +
          '<span class="flap-leaf flap-leaf-bottom"><span> </span></span>';
        const parts = cell.querySelectorAll('.flap-half > span, .flap-leaf > span');
        this.cells.push({
          el: cell, cur: ' ', run: 0,
          top: parts[0], bottom: parts[1], leafTop: parts[2], leafBottom: parts[3],
          leafTopEl: cell.querySelector('.flap-leaf-top'), leafBottomEl: cell.querySelector('.flap-leaf-bottom'),
        });
        el.appendChild(cell);
      }
    }
    text(value) {
      const s = String(value).toUpperCase();
      return s.length >= this.cells.length ? s.slice(-this.cells.length) : s.padStart(this.cells.length, ' ');
    }
    paint(cell, ch) {
      cell.cur = ch;
      cell.el.classList.toggle('is-blank', ch === ' ');
      cell.top.textContent = cell.bottom.textContent = cell.leafTop.textContent = cell.leafBottom.textContent = ch;
    }
    flip(cell, next, dur) {
      const prev = cell.cur;
      cell.top.textContent = next;
      cell.bottom.textContent = prev;
      cell.leafTop.textContent = prev;
      cell.leafBottom.textContent = next;
      cell.el.classList.add('is-flipping');
      cell.el.classList.remove('is-blank');
      const half = dur / 2;
      if (cell.leafTopEl.animate) {
        cell.leafTopEl.animate([{ transform: 'rotateX(0deg)' }, { transform: 'rotateX(-90deg)' }],
          { duration: half, easing: 'ease-in', fill: 'forwards' });
        cell.leafBottomEl.animate([{ transform: 'rotateX(90deg)' }, { transform: 'rotateX(0deg)' }],
          { duration: half, delay: half, easing: 'ease-out', fill: 'both' });
      }
      cell.cur = next;
      return new Promise((resolve) => setTimeout(() => {
        if (cell.cur === next) {
          cell.bottom.textContent = next;
          cell.el.classList.toggle('is-blank', next === ' ');
        }
        cell.el.classList.remove('is-flipping');
        cell.leafTopEl.getAnimations?.().forEach((a) => a.cancel());
        cell.leafBottomEl.getAnimations?.().forEach((a) => a.cancel());
        sfx.flap();
        resolve();
      }, dur));
    }
    // Real split-flap units only turn forward through their drum.
    path(from, to) {
      const cs = this.charset;
      let k = cs.indexOf(from);
      const end = cs.indexOf(to);
      if (end < 0) return [to];
      if (k < 0) k = 0;
      const steps = [];
      while (k !== end) { k = (k + 1) % cs.length; steps.push(cs[k]); }
      return steps;
    }
    set(value, { animate = true, step = 62, stagger = 70, shuffle = 0 } = {}) {
      const target = this.text(value);
      const jobs = this.cells.map((cell, idx) => {
        const ch = target[idx];
        const run = ++cell.run;
        if (!animate || reduceMotion) { this.paint(cell, ch); return Promise.resolve(); }
        let steps;
        if (shuffle) {
          steps = [];
          for (let s = 0; s < shuffle + (idx % 3); s++) steps.push(this.charset[1 + Math.floor(Math.random() * (this.charset.length - 1))]);
          steps.push(ch);
        } else {
          steps = this.path(cell.cur, ch);
        }
        if (!steps.length) return Promise.resolve();
        return (async () => {
          await new Promise((r) => setTimeout(r, idx * stagger));
          for (let s = 0; s < steps.length; s++) {
            if (cell.run !== run) return;
            await this.flip(cell, steps[s], s === steps.length - 1 ? step * 1.6 : step);
          }
        })();
      });
      return Promise.all(jobs);
    }
  }

  /* ---------------------------------------------------------------- ui helpers */
  let toastTimer = 0;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
  }

  function setSound(on) {
    sfx.on = on;
    store.set('sound', on);
    $$('[data-action="sound"]').forEach((b) => {
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', on ? 'Couper le son' : 'Activer le son');
    });
    if (on) sfx.ensure();
  }

  function show(screen) {
    $$('.screen').forEach((el) => { el.hidden = el.id !== 'screen-' + screen; });
    document.body.dataset.screen = screen;
    if (screen !== 'game') { $('#result').hidden = true; }
    window.scrollTo(0, 0);
  }

  const FR_MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  function frDate(key) {
    const [y, m, d] = key.split('-').map(Number);
    return `${d} ${FR_MONTHS[m - 1]} ${y}`;
  }

  /* ---------------------------------------------------------------- home */
  const prefs = Object.assign({ league: 'pl', n: 3 }, store.get('prefs', {}));
  if (!LEAGUE[prefs.league]) prefs.league = 'pl';
  if (!COUNTS.includes(prefs.n)) prefs.n = 3;

  const home = { leagueId: prefs.league, n: prefs.n, target: 0, combo: null };
  let heroFlaps1, heroFlaps2, targetFlaps;

  function renderLeagues() {
    const wrap = $('#leagues');
    wrap.textContent = '';
    for (const L of LEAGUES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'league';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(L.id === home.leagueId));
      b.dataset.league = L.id;
      b.innerHTML = `<span class="league-name"></span><span class="league-sub"></span>`;
      b.querySelector('.league-name').textContent = L.name;
      b.querySelector('.league-sub').textContent = leagueSub(L);
      wrap.appendChild(b);
    }
  }

  function renderCounts() {
    const wrap = $('#counts');
    wrap.textContent = '';
    for (const n of COUNTS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'count';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(n === home.n));
      b.setAttribute('aria-label', `${n} joueurs`);
      b.dataset.n = n;
      b.innerHTML = `<span class="count-num">${n}</span><span class="count-sub">joueurs</span>`;
      wrap.appendChild(b);
    }
  }

  function syncChoice(selector, attr, value) {
    $$(selector).forEach((b) => b.setAttribute('aria-checked', String(b.dataset[attr] === String(value))));
  }

  function setTarget(value, combo, animate = true) {
    const L = LEAGUE[home.leagueId];
    const b = bounds(L, home.n);
    const v = Math.max(b.min, Math.min(b.max, Math.round(value) || b.min));
    home.target = v;
    home.combo = combo || null;
    targetFlaps.set(v, { animate });
    const input = $('#t-input');
    if (document.activeElement !== input) input.value = v;
    input.min = b.min;
    input.max = b.max;
    $('#t-hint').textContent = `De ${fmt(b.min)} à ${fmt(b.max)} buts possibles avec ${home.n} joueurs. ` +
      (home.combo ? 'Ce tirage a une solution parfaite.' : 'Cible libre.');
  }

  function redraw(animate = true) {
    const { target, combo } = draw(LEAGUE[home.leagueId], home.n);
    setTarget(target, combo, animate);
  }

  function renderDaily() {
    const d = dailyChallenge();
    const L = LEAGUE[d.leagueId];
    const [, m, day] = d.key.split('-').map(Number);
    $('#daily-day').textContent = day;
    $('#daily-month').textContent = FR_MONTHS[m - 1];
    $('#daily-line').textContent = `${L.name} · ${d.n} joueurs · cible ${fmt(d.target)} buts`;
    const done = store.get('daily:' + d.key, null);
    $('#daily-status').textContent = done ? `Joué : écart ${done.ecart} · ${done.title}` : 'Même défi pour tout le monde aujourd\'hui.';
    $('#daily-btn').textContent = done ? 'Rejouer le défi' : 'Jouer le défi';
  }

  function renderStats() {
    const s = store.get('stats', null);
    if (!s || !s.played) { $('#stats').textContent = ''; return; }
    const bits = [plural(s.played, 'match'), plural(s.exact, 'lucarne'), `meilleur écart ${s.best}`];
    $('#stats').textContent = bits.join(' · ');
  }

  function renderResume() {
    const g = store.get('game', null);
    const live = g && !g.done && LEAGUE[g.leagueId] && g.picks.length < g.n;
    $('#resume').hidden = !live;
    if (live) {
      $('#resume-text').textContent = `${LEAGUE[g.leagueId].name} · cible ${fmt(g.target)} · ${g.picks.length}/${g.n} joueurs`;
    }
  }

  function showHome() {
    show('home');
    renderDaily();
    renderStats();
    renderResume();
    heroFlaps1.set('SCORE', { shuffle: 3, step: 55, stagger: 45 });
    heroFlaps2.set('PRÉCI', { shuffle: 4, step: 55, stagger: 45 });
  }

  /* ---------------------------------------------------------------- game */
  let G = null;           // current game
  let busy = false;
  const board = {};
  let activeOpt = -1;
  let results = [];

  function saveGame() { if (G) store.set('game', G); }
  function total() { return G.picks.reduce((s, p) => s + p.goals, 0); }
  function used() { return new Set(G.picks.map((p) => p.i)); }

  function newGame(opts) {
    G = {
      v: 1,
      leagueId: opts.leagueId, n: opts.n, target: opts.target,
      combo: opts.combo || null, picks: [], mode: opts.mode || 'free',
      day: opts.day || null, done: false, recorded: false,
      date: dayKey(),
    };
    saveGame();
    showGame(true);
    sfx.whistle([0.42]);
  }

  function showGame(fresh) {
    const L = LEAGUE[G.leagueId];
    show('game');
    document.body.classList.remove('is-typing');
    $('#g-mode').textContent = G.mode === 'daily' ? `Défi du ${frDate(G.day)}` : `${G.n} joueurs`;
    $('#g-league').textContent = L.short;

    const digits = Math.max(3, String(bounds(L, G.n).max).length, String(G.target).length);
    $('.counters').classList.toggle('d4', digits >= 4);
    board.target = new Flaps($('#f-target'), digits);
    board.total = new Flaps($('#f-total'), digits);
    board.rest = new Flaps($('#f-rest'), digits);

    $('#sh-league').textContent = L.name;
    $('#sh-target').textContent = `${fmt(G.target)} buts`;
    $('#sh-date').textContent = (G.date || dayKey()).slice(2).split('-').reverse().join('/');
    $('#scope').textContent = `Base : ${L.scope.charAt(0).toLowerCase()}${L.scope.slice(1)} (${fmt(L.count)} joueurs). Source : ${L.source}.`;

    const tbody = $('#sh-lines');
    tbody.textContent = '';
    for (let k = 0; k < G.n; k++) {
      const tr = document.createElement('tr');
      tr.className = 'line is-empty';
      tr.innerHTML =
        `<td><span class="line-no">${k + 1}</span></td>` +
        '<td class="who"><div class="who-name"></div><div class="who-meta"></div><div class="who-clubs"></div></td>' +
        '<td class="goals"></td>';
      tbody.appendChild(tr);
    }
    G.picks.forEach((pick, k) => fillLine(k, L.players[pick.i], false));

    const verdictEl = $('#sh-verdict');
    verdictEl.hidden = true;
    verdictEl.className = 'verdict-stamp';
    $('#result').hidden = true;
    $('#result-spacer').hidden = true;
    $('#pick').hidden = false;
    $('#c-rest').classList.remove('is-final', 'is-over');

    if (fresh) {
      board.target.set(G.target, { step: 48, stagger: 90 });
      board.total.set(0, { animate: false });
      board.rest.set(G.target, { animate: false });
    } else {
      board.target.set(G.target, { animate: false });
      board.total.set(total(), { animate: false });
      board.rest.set(Math.abs(G.target - total()), { animate: false });
    }
    updateBoardMeta();
    updatePickUI();

    if (G.done) finish(false);
  }

  function updateBoardMeta() {
    const t = total();
    const rest = G.target - t;
    const max = Math.max(G.target * 1.25, t * 1.04, 1);
    const track = $('.gauge-track');
    track.style.setProperty('--fill', `${(Math.min(t, G.target) / max) * 100}%`);
    track.style.setProperty('--over-from', `${(G.target / max) * 100}%`);
    track.style.setProperty('--over-to', `${(Math.max(t, G.target) / max) * 100}%`);
    track.style.setProperty('--mark', `${(G.target / max) * 100}%`);
    const restBox = $('#c-rest');
    if (!G.done) {
      restBox.classList.toggle('is-over', rest < 0);
      $('#rest-label').textContent = rest < 0 ? 'Dépassé' : 'Reste';
    }
    $('#g-progress').textContent = `${Math.min(G.picks.length + (G.done ? 0 : 1), G.n)} / ${G.n}`;
    $('#sh-total').textContent = fmt(t);
    $('#board-live').textContent = G.done
      ? `Écart final ${Math.abs(rest)} buts.`
      : `Total ${t} buts, ${rest < 0 ? 'cible dépassée de ' + -rest : 'reste ' + rest} buts.`;
  }

  function updatePickUI() {
    const k = G.picks.length;
    $('#pick-label').textContent = `Joueur nº ${Math.min(k + 1, G.n)}`;
    $('#pick-count').textContent = `${k} / ${G.n} sur la feuille`;
    $$('#sh-lines .line').forEach((tr, idx) => tr.classList.toggle('is-next', idx === k && !G.done));
    const input = $('#q');
    input.disabled = G.done || busy;
  }

  function fillLine(k, p, animate) {
    const tr = $$('#sh-lines .line')[k];
    if (!tr) return Promise.resolve();
    tr.classList.remove('is-empty');
    const nameEl = tr.querySelector('.who-name');
    tr.querySelector('.who-meta').textContent = meta(p);
    tr.querySelector('.who-clubs').textContent = p.clubs ? p.clubs : '';
    const cell = tr.querySelector('.goals');
    const stamp = document.createElement('span');
    stamp.className = 'goal-stamp';
    stamp.style.setProperty('--rot', `${(hash(p.name) % 11) - 6}deg`);
    stamp.textContent = p.goals;
    if (!animate) {
      nameEl.textContent = p.name;
      cell.textContent = '';
      cell.appendChild(stamp);
      return Promise.resolve();
    }
    return (async () => {
      nameEl.textContent = '';
      for (let c = 1; c <= p.name.length; c++) {
        nameEl.textContent = p.name.slice(0, c);
        if (c % 2) sfx.key();
        await wait(16);
      }
      await wait(180);
      cell.textContent = '';
      stamp.classList.add('is-in');
      cell.appendChild(stamp);
      sfx.thud();
      buzz(12);
      await wait(120);
    })();
  }

  async function pick(p) {
    if (!G || busy || G.done || G.picks.some((x) => x.i === p.i)) return;
    busy = true;
    sfx.ensure();
    closeSuggest();
    const input = $('#q');
    input.value = '';
    $('#q-clear').hidden = true;
    input.blur();
    document.body.classList.remove('is-typing');
    updatePickUI();

    G.picks.push({ i: p.i, goals: p.goals });
    saveGame();
    const k = G.picks.length - 1;
    const row = $$('#sh-lines .line')[k];
    if (row) row.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
    await fillLine(k, p, true);

    const t = total();
    updateBoardMeta();
    await Promise.all([
      board.total.set(t, { step: 46, stagger: 60 }),
      board.rest.set(Math.abs(G.target - t), { step: 46, stagger: 60 }),
    ]);

    busy = false;
    if (G.picks.length >= G.n) {
      await finish(true);
    } else {
      updatePickUI();
      if (window.matchMedia('(hover: hover)').matches) input.focus();
    }
  }

  function record(ecart, v) {
    if (G.recorded) return;
    G.recorded = true;
    const s = Object.assign({ played: 0, exact: 0, best: null, sum: 0 }, store.get('stats', {}));
    s.played += 1;
    if (ecart === 0) s.exact += 1;
    s.best = s.best == null ? ecart : Math.min(s.best, ecart);
    s.sum += ecart;
    store.set('stats', s);
    if (G.mode === 'daily' && G.day && !store.get('daily:' + G.day, null)) {
      store.set('daily:' + G.day, { ecart, total: total(), title: v.title });
    }
  }

  async function finish(animate) {
    const L = LEAGUE[G.leagueId];
    const t = total();
    const ecart = Math.abs(G.target - t);
    const v = verdict(ecart);
    G.done = true;
    record(ecart, v);
    saveGame();

    $('#pick').hidden = true;
    const restBox = $('#c-rest');
    restBox.classList.remove('is-over');
    restBox.classList.add('is-final');
    $('#rest-label').textContent = 'Écart';
    updateBoardMeta();
    updatePickUI();

    if (animate) {
      sfx.whistle([0.16, 0.16, 0.7]);
      await wait(1150);
    }
    board.rest.set(ecart, { animate: false });

    const stampEl = $('#sh-verdict');
    stampEl.innerHTML = '';
    stampEl.append(v.title);
    const small = document.createElement('small');
    small.textContent = ecart === 0 ? 'Écart 0' : `Écart ${ecart}`;
    stampEl.appendChild(small);
    stampEl.className = 'verdict-stamp' + (v.good ? '' : ' is-bad');
    stampEl.hidden = false;
    if (animate) {
      const sheet = $('#sheet');
      window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
      await wait(380);
      stampEl.classList.add('is-in');
      await wait(200);
      sfx.thud();
      buzz([20, 40, 20]);
      sheet.classList.remove('is-shaking');
      void sheet.offsetWidth;
      sheet.classList.add('is-shaking');
      if (ecart === 0) confetti(180);
      else if (ecart <= 2) confetti(60);
      await wait(1100);
    }

    // result panel
    $('#r-title').textContent = v.title;
    $('#r-sub').textContent = `${v.line} Écart ${ecart} · ${fmt(G.target)} visés, ${fmt(t)} marqués.`;
    $('#r-hint').innerHTML = '';
    $('#r-hint').append(...hintNodes(L));
    const combo = G.combo && G.combo.length === G.n ? G.combo : bestCombo(L, G.n, G.target);
    const sol = $('#r-solution');
    if (combo && combo.length) {
      const players = combo.map((i) => L.players[i]);
      const sum = players.reduce((s, p) => s + p.goals, 0);
      $('#r-combo-label').textContent = sum === G.target ? 'Une combinaison parfaite :' : 'La meilleure combinaison possible :';
      $('#r-combo').textContent = players.map((p) => `${p.name} (${p.goals})`).join(' + ') + ` = ${fmt(sum)}`;
    } else {
      $('#r-combo-label').textContent = '';
      $('#r-combo').textContent = '';
    }
    sol.open = false;
    const panel = $('#result');
    panel.hidden = false;
    $('#result-spacer').hidden = false;
    panel.classList.remove('is-in');
    if (animate) { void panel.offsetWidth; panel.classList.add('is-in'); }
  }

  // Coaching line: what the last shot needed and who would have nailed it.
  function hintNodes(L) {
    if (G.picks.length < 1) return [];
    const before = G.picks.slice(0, -1).reduce((s, p) => s + p.goals, 0);
    const last = G.picks[G.picks.length - 1];
    const need = G.target - before;
    const taken = new Set(G.picks.slice(0, -1).map((p) => p.i));
    let best = null;
    for (const p of L.players) {
      if (taken.has(p.i)) continue;
      if (!best || Math.abs(p.goals - need) < Math.abs(best.goals - need)) best = p;
    }
    if (!best) return [];
    const lastGap = Math.abs(last.goals - need);
    const bestGap = Math.abs(best.goals - need);
    if (lastGap <= bestGap) return [document.createTextNode('Ton dernier choix était le meilleur possible.')];
    const strong = document.createElement('strong');
    strong.textContent = `${best.name} (${best.goals})`;
    const lead = need > 0
      ? `Il te fallait ${plural(need, 'but')} au dernier tir. `
      : 'La cible était déjà dépassée avant le dernier tir. ';
    return [
      document.createTextNode(lead),
      strong,
      document.createTextNode(bestGap === 0 ? ' finissait pile.' : ` t'aurait laissé à ${plural(bestGap, 'but')}.`),
    ];
  }

  /* ---------------------------------------------------------------- suggestions */
  function closeSuggest() {
    const list = $('#suggest');
    list.hidden = true;
    list.textContent = '';
    $('#q').setAttribute('aria-expanded', 'false');
    $('#q').removeAttribute('aria-activedescendant');
    activeOpt = -1;
    results = [];
  }

  function highlight(name, query) {
    const frag = document.createDocumentFragment();
    const q = norm(query).split(' ')[0];
    const words = name.split(/(\s+)/);
    let done = false;
    for (const w of words) {
      if (!done && q && norm(w).startsWith(q)) {
        // accents make offsets differ; mark the visible prefix of the same length
        const mark = document.createElement('mark');
        mark.textContent = w.slice(0, Math.min(w.length, q.length));
        frag.append(mark, w.slice(mark.textContent.length));
        done = true;
      } else {
        frag.append(w);
      }
    }
    return frag;
  }

  function renderSuggest() {
    const input = $('#q');
    const list = $('#suggest');
    const L = LEAGUE[G.leagueId];
    const q = input.value;
    $('#q-clear').hidden = !q;
    if (!norm(q)) { closeSuggest(); return; }
    results = search(L, q, used());
    list.textContent = '';
    if (!results.length) {
      const li = document.createElement('li');
      li.className = 'suggest-empty';
      li.textContent = `Aucun buteur « ${q.trim()} » dans la base ${L.name}. Essaie une autre orthographe ou le nom de famille seul.`;
      list.appendChild(li);
    }
    results.forEach((r, idx) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'presentation');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'opt';
      b.id = `opt-${idx}`;
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', 'false');
      b.dataset.idx = idx;
      if (r.used) b.disabled = true;
      const name = document.createElement('span');
      name.className = 'opt-name';
      name.appendChild(highlight(r.p.name, q));
      const m = document.createElement('span');
      m.className = 'opt-meta';
      m.textContent = meta(r.p);
      b.append(name, m);
      li.appendChild(b);
      list.appendChild(li);
    });
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    setActive(results.findIndex((r) => !r.used));
  }

  function setActive(idx) {
    activeOpt = idx;
    $$('#suggest .opt').forEach((b, k) => b.setAttribute('aria-selected', String(k === idx)));
    const input = $('#q');
    if (idx >= 0) {
      input.setAttribute('aria-activedescendant', `opt-${idx}`);
      const el = $(`#opt-${idx}`);
      if (el) el.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  /* ---------------------------------------------------------------- share */
  function shareText() {
    const L = LEAGUE[G.leagueId];
    const t = total();
    const ecart = Math.abs(G.target - t);
    const lines = [
      `SCORE PRÉCI · ${L.name}${G.mode === 'daily' ? ` · défi du ${frDate(G.day)}` : ''}`,
      `🎯 Cible ${fmt(G.target)} buts avec ${G.n} joueurs`,
      `⚽ ${fmt(t)} marqués · écart ${ecart} · ${verdict(ecart).title.toUpperCase()}`,
    ];
    if (/^https?:$/.test(location.protocol) && window.self === window.top) lines.push(location.origin + location.pathname);
    return lines.join('\n');
  }

  function share() {
    const text = shareText();
    const inFrame = window.self !== window.top;
    if (!inFrame && navigator.share) {
      navigator.share({ text }).catch(() => { /* dismissed */ });
      return;
    }
    const fallback = () => {
      const box = $('#share-box');
      $('#share-text').value = text;
      box.hidden = false;
      $('#share-text').focus();
      $('#share-text').select();
    };
    try {
      navigator.clipboard.writeText(text).then(() => toast('Résultat copié'), fallback);
    } catch (e) { fallback(); }
  }

  /* ---------------------------------------------------------------- confetti */
  function confetti(count) {
    if (reduceMotion) return;
    const canvas = $('#confetti');
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth, h = window.innerHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    const css = getComputedStyle(document.documentElement);
    const colors = ['--lamp', '--chalk', '--paper', '--stamp'].map((v) => css.getPropertyValue(v).trim() || '#fff');
    const bits = Array.from({ length: count }, () => ({
      x: Math.random() * w, y: -20 - Math.random() * h * 0.5,
      vx: (Math.random() - 0.5) * 1.6, vy: 2 + Math.random() * 3,
      w: 6 + Math.random() * 8, h: 3 + Math.random() * 4,
      r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
      c: colors[Math.floor(Math.random() * colors.length)], sway: Math.random() * 6.28,
    }));
    const start = performance.now();
    function frame(now) {
      const el = now - start;
      ctx.clearRect(0, 0, w, h);
      for (const b of bits) {
        b.sway += 0.05;
        b.x += b.vx + Math.sin(b.sway) * 0.8;
        b.y += b.vy;
        b.r += b.vr;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.r);
        ctx.scale(1, Math.cos(b.sway * 1.7));
        ctx.fillStyle = b.c;
        ctx.globalAlpha = el > 2600 ? Math.max(0, 1 - (el - 2600) / 600) : 1;
        ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
        ctx.restore();
      }
      if (el < 3200) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, w, h);
    }
    requestAnimationFrame(frame);
  }

  /* ---------------------------------------------------------------- events */
  function bindHome() {
    $('#leagues').addEventListener('click', (e) => {
      const b = e.target.closest('.league');
      if (!b) return;
      home.leagueId = b.dataset.league;
      syncChoice('.league', 'league', home.leagueId);
      prefs.league = home.leagueId;
      store.set('prefs', prefs);
      sfx.ensure();
      redraw();
    });
    $('#counts').addEventListener('click', (e) => {
      const b = e.target.closest('.count');
      if (!b) return;
      home.n = Number(b.dataset.n);
      syncChoice('.count', 'n', home.n);
      prefs.n = home.n;
      store.set('prefs', prefs);
      sfx.ensure();
      redraw();
    });
    // arrow keys inside the two radio groups
    for (const id of ['#leagues', '#counts']) {
      $(id).addEventListener('keydown', (e) => {
        if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
        const items = $$('[role="radio"]', $(id));
        const cur = items.indexOf(document.activeElement);
        const next = items[(cur + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length];
        next.focus();
        next.click();
        e.preventDefault();
      });
    }

    const input = $('#t-input');
    input.addEventListener('focus', () => { try { input.select(); } catch (e) { /* number inputs */ } });
    input.addEventListener('input', () => {
      const v = parseInt(input.value, 10);
      if (Number.isFinite(v)) { home.combo = null; targetFlaps.set(Math.max(0, v), { step: 30, stagger: 0 }); }
    });
    input.addEventListener('change', () => setTarget(parseInt(input.value, 10), null));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });

    // −/+ with press-and-hold acceleration
    for (const [id, dir] of [['#t-minus', -1], ['#t-plus', 1]]) {
      const btn = $(id);
      let timer = 0, reps = 0;
      const bump = () => {
        const stepSize = reps > 14 ? 10 : 1;
        setTarget(home.target + dir * stepSize, null, reps < 3);
        reps++;
      };
      const stop = () => { clearTimeout(timer); timer = 0; };
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        sfx.ensure();
        reps = 0;
        bump();
        const loop = () => { bump(); timer = setTimeout(loop, reps > 14 ? 60 : 110); };
        timer = setTimeout(loop, 420);
      });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, stop));
      btn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); reps = 0; bump(); }
      });
    }

    $('#t-draw').addEventListener('click', () => { sfx.ensure(); redraw(); });

    $('#setup').addEventListener('submit', (e) => {
      e.preventDefault();
      sfx.ensure();
      const input = $('#t-input');
      if (document.activeElement === input) setTarget(parseInt(input.value, 10), null, false);
      newGame({ leagueId: home.leagueId, n: home.n, target: home.target, combo: home.combo });
    });
  }

  function bindGame() {
    const input = $('#q');
    input.addEventListener('input', renderSuggest);
    input.addEventListener('focus', () => {
      if (window.matchMedia('(max-width: 40rem)').matches) {
        document.body.classList.add('is-typing');
        setTimeout(() => $('#board').scrollIntoView({ block: 'start', behavior: 'smooth' }), 250);
      }
      if (input.value) renderSuggest();
    });
    input.addEventListener('blur', () => {
      setTimeout(() => {
        if (document.activeElement !== input) {
          document.body.classList.remove('is-typing');
          closeSuggest();
        }
      }, 150);
    });
    input.addEventListener('keydown', (e) => {
      const n = results.length;
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && n) {
        e.preventDefault();
        const dir = e.key === 'ArrowDown' ? 1 : n - 1;
        let k = activeOpt < 0 ? (dir === 1 ? n - 1 : 0) : activeOpt;
        for (let tries = 0; tries < n; tries++) {
          k = (k + dir) % n;
          if (!results[k].used) { setActive(k); break; }
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const r = results[activeOpt];
        if (r && !r.used) pick(r.p);
      } else if (e.key === 'Escape') {
        closeSuggest();
      }
    });
    const list = $('#suggest');
    // keep focus in the field while tapping an option
    list.addEventListener('pointerdown', (e) => { if (e.target.closest('.opt')) e.preventDefault(); });
    list.addEventListener('click', (e) => {
      const b = e.target.closest('.opt');
      if (!b || b.disabled) return;
      const r = results[Number(b.dataset.idx)];
      if (r) pick(r.p);
    });
    $('#q-clear').addEventListener('click', () => {
      input.value = '';
      closeSuggest();
      $('#q-clear').hidden = true;
      input.focus();
    });
  }

  function bindGlobal() {
    const unlock = () => { sfx.unlocked = true; };
    window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
    window.addEventListener('keydown', unlock, { capture: true });
    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const action = el.dataset.action;
      if (action === 'sound') setSound(!sfx.on);
      else if (action === 'rules') { $('#rules').hidden = false; $('#rules .cta').focus(); }
      else if (action === 'close-rules') { $('#rules').hidden = true; store.set('seenRules', true); }
      else if (action === 'menu') { closeSuggest(); document.body.classList.remove('is-typing'); showHome(); }
      else if (action === 'resume') {
        const g = store.get('game', null);
        if (g && LEAGUE[g.leagueId]) { G = g; sfx.ensure(); showGame(false); }
      } else if (action === 'daily') {
        const d = dailyChallenge();
        sfx.ensure();
        newGame({ leagueId: d.leagueId, n: d.n, target: d.target, combo: d.combo, mode: 'daily', day: d.key });
      } else if (action === 'again') {
        if (!G) return;
        const L = LEAGUE[G.leagueId];
        const next = draw(L, G.n);
        newGame({ leagueId: G.leagueId, n: G.n, target: next.target, combo: next.combo });
      } else if (action === 'share') share();
      else if (action === 'close-share') $('#share-box').hidden = true;
    });
    $('#rules').addEventListener('click', (e) => { if (e.target.id === 'rules') $('#rules').hidden = true; });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { $('#rules').hidden = true; $('#share-box').hidden = true; }
    });
  }

  /* ---------------------------------------------------------------- boot */
  function start(hotData) {
    heroFlaps1 = new Flaps($('#hero-1'), 5, LETTERS);
    heroFlaps2 = new Flaps($('#hero-2'), 5, LETTERS);
    heroFlaps1.set('SCORE', { animate: false });
    heroFlaps2.set('PRÉCI', { animate: false });
    targetFlaps = new Flaps($('#t-flaps'), 4);

    renderLeagues();
    renderCounts();
    redraw(false);
    setSound(sfx.on);
    bindHome();
    bindGame();
    bindGlobal();

    const updated = DATA.updated ? frDate(DATA.updated) : '';
    $('#foot-sources').textContent = `Buts en championnat uniquement, toutes saisons confondues. Sources : premierleague.com, BDFutbol, Wikipédia. Données du ${updated}.`;

    const saved = (hotData && hotData.G) || null;
    if (saved && LEAGUE[saved.leagueId]) {
      G = saved;
      showGame(false);
    } else {
      showHome();
    }

    window.claude?.hot?.snapshot?.(() => ({ G: document.body.dataset.screen === 'game' ? G : null }));
  }

  const hot = window.claude?.hot;
  if (hot?.ready) hot.ready(start);
  else start(hot?.data ?? {});
})();
