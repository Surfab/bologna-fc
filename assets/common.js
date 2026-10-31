// Funzioni comuni a tutte le pagine (dati ESPN, carte delle partite, menu, aggiornamento).
// Ogni pagina carica questo file prima del proprio script e usa l'oggetto BFC.
(function () {
  const API = 'https://site.api.espn.com/apis';

  // Voci del menu: per aggiungere una pagina basta una riga qui
  const PAGES = [
    { href: 'index.html',        label: 'Partite' },
    { href: 'serie-a.html',      label: 'Serie A' },
    { href: 'classifica.html',   label: 'Classifica' },
    { href: 'coppa-italia.html', label: 'Coppa Italia' },
  ];

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const ym = d => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const timeIt = (d, sec = true) => d.toLocaleTimeString('it-IT', sec ? undefined : { hour: '2-digit', minute: '2-digit' });

  const isBolognaTeam = t => [t?.name, t?.displayName, t?.shortDisplayName].some(n => (n || '').toLowerCase().includes('bologna'));
  const competitorsOf = ev => ev.competitions?.[0]?.competitors || [];
  const hasBologna = ev => competitorsOf(ev).some(c => isBolognaTeam(c.team));

  // 'LIVE' | 'PAST' | 'FUTURE'
  function eventState(ev) {
    const s = ev.status?.type?.state;
    return s === 'in' ? 'LIVE' : s === 'post' ? 'PAST' : 'FUTURE';
  }

  // "2026-27 Italian Serie A" -> "2026/27"
  function seasonLabel(data) {
    const s = data?.leagues?.[0]?.season || data?.season;
    const m = (s?.displayName || '').match(/(\d{4})-(\d{2})/);
    if (m) return `${m[1]}/${m[2]}`;
    if (s?.year) return `${s.year}/${String(s.year + 1).slice(2)}`;
    return '';
  }

  // Mesi della stagione, da agosto a maggio (a giugno e luglio resta quella appena finita)
  function seasonMonths() {
    const now = new Date();
    const startYear = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
    return Array.from({ length: 10 }, (_, i) => ym(new Date(startYear, 7 + i, 1)));
  }

  async function fetchJSON(url) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch (e) {}
    return null;
  }

  // Scoreboard ESPN di un mese, con cache. Il mese in corso si riscarica sempre,
  // gli altri ogni 30 minuti. Restituisce { data, ok, fromCache, missing }:
  // ok=false solo per errori di rete o del server, missing=true se ESPN non ha la competizione.
  const cache = new Map();
  const OLD_MONTH_TTL = 30 * 60 * 1000;
  async function fetchScoreboard(slug, month, force = false) {
    const key = `${slug}|${month}`;
    const hit = cache.get(key);
    const isCurrent = month === ym(new Date());
    if (hit && !force && !isCurrent && Date.now() - hit.at < OLD_MONTH_TTL) return { data: hit.data, ok: true, fromCache: true };
    try {
      const r = await fetch(`${API}/site/v2/sports/soccer/${slug}/scoreboard?dates=${month}&limit=200`);
      if (r.ok) {
        const data = await r.json();
        cache.set(key, { at: Date.now(), data });
        return { data, ok: true };
      }
      return { data: hit?.data || null, ok: r.status < 500, missing: r.status === 400 || r.status === 404 };
    } catch (e) {
      return { data: hit?.data || null, ok: false };
    }
  }

  // Vero solo se c'è stato almeno un tentativo di rete e sono falliti tutti
  const allFailed = results => {
    const network = results.filter(r => !r.fromCache);
    return network.length > 0 && network.every(r => !r.ok);
  };

  // Squadre non ancora definite (es. "TBD" o "Winner of ...")
  function teamName(c) {
    const n = c.team?.shortDisplayName || c.team?.displayName || c.team?.name || '';
    if (!n || /^tbd$/i.test(n)) return '<span class="tbd">Da definire</span>';
    if (/winner|vincente/i.test(n)) return `<span class="tbd">${esc(n.replace(/winner (of )?/i, 'Vincente '))}</span>`;
    return esc(n);
  }

  // Carta di una partita.
  // opts.highlight: 'all' evidenzia ogni partita del Bologna, 'home' solo quelle in casa
  // opts.chip: testo dell'etichetta sotto il risultato (competizione, turno...)
  function matchCard(ev, opts = {}) {
    const competitors = competitorsOf(ev);
    const home = competitors.find(c => c.homeAway === 'home') || competitors[0];
    const away = competitors.find(c => c.homeAway === 'away') || competitors[1];
    if (!home || !away) return '';

    const state = eventState(ev);
    const bolHome = isBolognaTeam(home.team), bolAway = isBolognaTeam(away.team);
    const img = c => c.team?.logo ? `<img src="${esc(c.team.logo)}" class="team-logo" alt="" loading="lazy" onerror="this.style.display='none'">` : '';

    const scoreHtml = state === 'FUTURE'
      ? `<div class="score time">${timeIt(new Date(ev.date), false)}</div>`
      : `<div class="score">${esc(home.score ?? '–')} – ${esc(away.score ?? '–')}</div>`;

    let statusHtml;
    if (state === 'LIVE') statusHtml = `<div class="match-status status-live"><span class="live-dot"></span>${esc(ev.status?.displayClock || 'Live')}</div>`;
    else if (state === 'PAST') statusHtml = '<div class="match-status status-finished">Finita</div>';
    else if (ev.status?.type?.name === 'STATUS_POSTPONED') statusHtml = '<div class="match-status status-scheduled">Rinviata</div>';
    else statusHtml = '<div class="match-status status-scheduled">Programmata</div>';

    const chip = opts.chip ? `<div class="label-chip">${esc(opts.chip)}</div>` : '';
    const mark = opts.highlight === 'all' ? (bolHome || bolAway ? 'has-bfc' : '') : (bolHome ? 'bologna-home' : '');

    return `
      <div class="match-card ${state === 'LIVE' ? 'live' : ''} ${mark}">
        <div class="team home">${img(home)}<span class="team-name ${bolHome ? 'bologna' : ''}">${teamName(home)}</span></div>
        <div class="score-block">${scoreHtml}${statusHtml}${chip}</div>
        <div class="team away"><span class="team-name ${bolAway ? 'bologna' : ''}">${teamName(away)}</span>${img(away)}</div>
      </div>`;
  }

  // Lista di partite raggruppate per giorno, con "Oggi" evidenziato.
  // opts.year: mostra l'anno nell'intestazione; gli altri opts passano a matchCard (chip può essere una funzione)
  function dayGroups(list, opts = {}) {
    const todayKey = new Date().toDateString();
    const groups = new Map();
    list.forEach(e => {
      const d = new Date(e.date), key = d.toDateString();
      if (!groups.has(key)) groups.set(key, { d, items: [] });
      groups.get(key).items.push(e);
    });
    let html = '';
    for (const [key, { d, items }] of groups) {
      const label = d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', ...(opts.year ? { year: 'numeric' } : {}) });
      const today = key === todayKey;
      html += `<div class="day-group" data-day="${d.getTime()}"><div class="day-header ${today ? 'today' : ''}">${today ? 'Oggi · ' : ''}${label}</div>`;
      items.forEach(ev => {
        const chip = typeof opts.chip === 'function' ? opts.chip(ev) : opts.chip;
        html += matchCard(ev, { ...opts, chip });
      });
      html += '</div>';
    }
    return html;
  }

  const emptyState = (icon, msg) => `<div class="empty-state"><div class="empty-icon">${icon}</div><p>${msg}</p></div>`;
  const offlineState = seconds => emptyState('📡', `Impossibile caricare i dati.<br><small>Controlla la connessione internet, riprovo tra ${seconds}s.</small>`);
  const staleMessage = (lastOk, seconds, what = 'Dati') => `⚠️ Connessione assente. ${what} delle ${timeIt(lastOk)}, riprovo tra ${seconds}s.`;

  function setStatus(msg, type = '') {
    const el = document.getElementById('status-bar');
    if (el) { el.textContent = msg; el.className = type; }
  }

  function showSkeleton(containerId, n = 3) {
    document.getElementById(containerId).innerHTML = '<div class="skeleton"></div>'.repeat(n);
  }

  function setActiveTab(btn) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
  }

  // Aggiornamento automatico con conto alla rovescia (se in pagina c'è #countdown).
  // Il conto si ferma durante il caricamento, così non partono ricaricamenti sovrapposti.
  // seconds può essere una funzione: l'intervallo viene ricalcolato dopo ogni caricamento.
  // Restituisce la funzione da chiamare per caricare subito (anche dal pulsante "Aggiorna").
  function autoRefresh(every, load) {
    const el = document.getElementById('countdown');
    const interval = () => typeof every === 'function' ? every() : every;
    let seconds = interval(), left = seconds, busy = false;
    const show = t => { if (el) el.textContent = t; };
    async function run(...args) {
      if (busy) return;
      busy = true; show('…');
      try { await load(...args); }
      catch (e) { console.error(e); }
      finally { busy = false; seconds = interval(); left = seconds; show(seconds + 's'); }
    }
    setInterval(() => {
      if (busy) return;
      left--; show(left + 's');
      if (left <= 0) run();
    }, 1000);
    return run;
  }

  // Menu: si riempie da solo nel <nav class="site-nav"> della pagina
  function renderNav() {
    const nav = document.querySelector('nav.site-nav');
    if (!nav) return;
    const here = location.pathname.split('/').pop() || 'index.html';
    nav.innerHTML = PAGES.map(p => `<a href="${p.href}"${p.href === here ? ' class="active"' : ''}>${p.label}</a>`).join('\n');
  }
  renderNav();

  window.BFC = {
    API, esc, ym, timeIt, isBolognaTeam, competitorsOf, hasBologna, eventState, seasonLabel, seasonMonths,
    fetchJSON, fetchScoreboard, allFailed, matchCard, dayGroups, emptyState, offlineState, staleMessage,
    setStatus, showSkeleton, setActiveTab, autoRefresh,
  };
})();
