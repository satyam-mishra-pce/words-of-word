type AnalyticsAdminPageOptions = {
  nonce: string;
  authenticated: boolean;
};

function loginPanel(): string {
  return `
    <section class="auth-card" aria-labelledby="access-title">
      <div class="eyebrow">Private admin area</div>
      <h1 id="access-title">Open the aggregate report.</h1>
      <p class="lede">Enter the analytics password to view first-party, aggregate-only product metrics.</p>
      <form id="access-form" novalidate>
        <label for="analytics-password">Analytics password</label>
        <div class="password-row">
          <input
            id="analytics-password"
            name="password"
            type="password"
            autocomplete="current-password"
            spellcheck="false"
            required
            autofocus
          >
          <button type="submit">Open report <span aria-hidden="true">→</span></button>
        </div>
        <p id="access-error" class="form-error" role="alert" hidden></p>
      </form>
      <p class="fine-print">Your password is never put in the URL. Successful access is remembered only in a secure browser session.</p>
    </section>`;
}

function dashboardPanel(): string {
  return `
    <main class="dashboard" aria-labelledby="report-title">
      <header class="report-header">
        <div>
          <div class="eyebrow">Private admin area</div>
          <h1 id="report-title">Aggregate report</h1>
          <p id="report-updated" class="report-updated">Loading the latest counters…</p>
        </div>
        <button id="end-session" class="quiet-button" type="button">End session</button>
      </header>

      <p id="report-error" class="form-error" role="alert" hidden></p>
      <div id="report-content" hidden>
        <section id="live-metrics" class="hero-metrics" aria-label="Live metrics"></section>
        <div class="report-grid">
          <section class="report-card" aria-labelledby="totals-title">
            <h2 id="totals-title">All-time totals</h2>
            <div id="total-metrics" class="metric-list"></div>
          </section>
          <section class="report-card" aria-labelledby="features-title">
            <h2 id="features-title">Feature signals</h2>
            <div id="feature-metrics" class="metric-list"></div>
          </section>
        </div>
        <section class="report-card wide-card" aria-labelledby="modes-title">
          <h2 id="modes-title">Game-mode adoption</h2>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Mode</th>
                  <th scope="col">Rooms</th>
                  <th scope="col">Started</th>
                  <th scope="col">Finished</th>
                  <th scope="col">Abandoned</th>
                </tr>
              </thead>
              <tbody id="mode-rows"></tbody>
            </table>
          </div>
        </section>
        <section class="report-card wide-card" aria-labelledby="settings-title">
          <h2 id="settings-title">Settings used in started games</h2>
          <div id="settings-metrics" class="settings-grid"></div>
        </section>
      </div>
    </main>`;
}

function loginScript(): string {
  return `
    const form = document.getElementById('access-form');
    const password = document.getElementById('analytics-password');
    const error = document.getElementById('access-error');
    const submit = form.querySelector('button[type="submit"]');

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      error.hidden = true;
      submit.disabled = true;
      submit.textContent = 'Checking…';

      try {
        const response = await fetch('/admin/analytics/session', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ password: password.value })
        });

        if (!response.ok) {
          error.textContent = 'That password did not work. Try again.';
          error.hidden = false;
          password.select();
          return;
        }

        window.location.replace('/admin/analytics');
      } catch {
        error.textContent = 'Could not reach the analytics service. Try again.';
        error.hidden = false;
      } finally {
        submit.disabled = false;
        submit.innerHTML = 'Open report <span aria-hidden="true">→</span>';
      }
    });`;
}

function dashboardScript(): string {
  return `
    const reportContent = document.getElementById('report-content');
    const reportError = document.getElementById('report-error');
    const updated = document.getElementById('report-updated');
    const formatter = new Intl.NumberFormat();

    function humanize(value) {
      return String(value)
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/[_-]/g, ' ')
        .replace(/\\b\\w/g, (letter) => letter.toUpperCase());
    }

    function metricRow(label, value) {
      const row = document.createElement('div');
      row.className = 'metric-row';
      const name = document.createElement('span');
      name.textContent = humanize(label);
      const count = document.createElement('strong');
      count.textContent = formatter.format(Number(value) || 0);
      row.append(name, count);
      return row;
    }

    function renderMetricList(id, metrics, { hideZeroes = false, emptyMessage = 'Nothing recorded yet.' } = {}) {
      const container = document.getElementById(id);
      container.replaceChildren();
      const entries = Object.entries(metrics).filter(([, value]) => !hideZeroes || Number(value) > 0);
      if (!entries.length) {
        const empty = document.createElement('p');
        empty.className = 'empty-state';
        empty.textContent = emptyMessage;
        container.append(empty);
        return;
      }
      entries.forEach(([label, value]) => container.append(metricRow(label, value)));
    }

    function renderModes(modes) {
      const rows = document.getElementById('mode-rows');
      rows.replaceChildren();
      Object.entries(modes).forEach(([mode, metrics]) => {
        const row = document.createElement('tr');
        const cells = [humanize(mode), metrics.roomsCreated, metrics.gamesStarted, metrics.gamesFinished, metrics.gamesAbandoned];
        cells.forEach((value, index) => {
          const cell = document.createElement(index === 0 ? 'th' : 'td');
          if (index === 0) cell.scope = 'row';
          cell.textContent = index === 0 ? String(value) : formatter.format(Number(value) || 0);
          row.append(cell);
        });
        rows.append(row);
      });
    }

    function renderSettings(settings) {
      const container = document.getElementById('settings-metrics');
      container.replaceChildren();
      Object.entries(settings).forEach(([setting, values]) => {
        const card = document.createElement('section');
        card.className = 'settings-card';
        const heading = document.createElement('h3');
        heading.textContent = humanize(setting);
        const list = document.createElement('div');
        list.className = 'metric-list compact-list';
        const entries = Object.entries(values).filter(([, value]) => Number(value) > 0);
        if (!entries.length) {
          const empty = document.createElement('p');
          empty.className = 'empty-state';
          empty.textContent = 'Not used yet.';
          list.append(empty);
        } else {
          entries.forEach(([label, value]) => list.append(metricRow(label, value)));
        }
        card.append(heading, list);
        container.append(card);
      });
    }

    async function loadReport() {
      try {
        const response = await fetch('/admin/analytics', {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'Accept': 'application/json' }
        });
        if (response.status === 401) {
          window.location.replace('/admin/analytics');
          return;
        }
        if (!response.ok) throw new Error('Could not load report.');
        const payload = await response.json();
        const report = payload.data;

        const timestamp = new Date(report.updatedAt);
        updated.textContent = Number.isNaN(timestamp.valueOf())
          ? 'Updated time unavailable'
          : 'Updated ' + new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp);

        const live = document.getElementById('live-metrics');
        live.replaceChildren(
          metricRow('Connected now', report.live.connectedSockets),
          metricRow('Games live', report.live.activeGames)
        );
        renderMetricList('total-metrics', report.totals);
        renderMetricList('feature-metrics', report.featureUsage, {
          hideZeroes: true,
          emptyMessage: 'No client feature signals yet.'
        });
        renderModes(report.byGameMode);
        renderSettings(report.settings);
        reportContent.hidden = false;
      } catch {
        reportError.textContent = 'Could not load the report. Refresh to try again.';
        reportError.hidden = false;
      }
    }

    document.getElementById('end-session').addEventListener('click', async () => {
      await fetch('/admin/analytics/session/logout', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Accept': 'application/json' }
      });
      window.location.replace('/admin/analytics');
    });

    void loadReport();`;
}

export function renderAnalyticsAdminPage({ nonce, authenticated }: AnalyticsAdminPageOptions): string {
  const content = authenticated ? dashboardPanel() : loginPanel();
  const script = authenticated ? dashboardScript() : loginScript();

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow, noarchive">
    <meta name="referrer" content="no-referrer">
    <title>W.o.W — Analytics</title>
    <style>
      :root {
        color-scheme: dark;
        --ink: #eff7ef;
        --muted: #a9b8aa;
        --panel: rgba(16, 28, 23, .9);
        --line: rgba(220, 246, 221, .16);
        --lime: #bef264;
        --aqua: #5eead4;
        --danger: #fda4af;
        --shadow: 0 24px 70px rgba(0, 0, 0, .38);
      }
      * { box-sizing: border-box; }
      body {
        min-height: 100vh;
        margin: 0;
        color: var(--ink);
        background:
          radial-gradient(circle at 12% 0%, rgba(94, 234, 212, .14), transparent 32rem),
          radial-gradient(circle at 92% 100%, rgba(190, 242, 100, .13), transparent 29rem),
          #08100d;
        font-family: ui-rounded, "Avenir Next", "Trebuchet MS", sans-serif;
      }
      body::before {
        position: fixed;
        inset: 0;
        z-index: -1;
        content: "";
        opacity: .34;
        background-image: linear-gradient(rgba(255,255,255,.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.025) 1px, transparent 1px);
        background-size: 28px 28px;
        mask-image: linear-gradient(to bottom, black, transparent 82%);
      }
      .brand {
        position: absolute;
        top: 22px;
        left: 24px;
        color: var(--lime);
        font-family: Georgia, "Times New Roman", serif;
        font-size: 1.15rem;
        font-weight: 700;
        letter-spacing: .06em;
      }
      .auth-card, .dashboard {
        width: min(1120px, calc(100% - 32px));
        margin-inline: auto;
      }
      .auth-card {
        width: min(580px, calc(100% - 32px));
        margin-top: max(120px, 17vh);
        padding: clamp(28px, 6vw, 56px);
        border: 1px solid var(--line);
        border-radius: 24px;
        background: var(--panel);
        box-shadow: var(--shadow);
      }
      .eyebrow {
        color: var(--aqua);
        font-size: .73rem;
        font-weight: 800;
        letter-spacing: .15em;
        text-transform: uppercase;
      }
      h1, h2, h3, p { margin-top: 0; }
      h1 {
        max-width: 12ch;
        margin: .55rem 0 .8rem;
        font-family: Georgia, "Times New Roman", serif;
        font-size: clamp(2.2rem, 5vw, 3.7rem);
        line-height: .98;
        letter-spacing: -.055em;
      }
      h2 {
        margin-bottom: 1rem;
        font-size: 1rem;
        letter-spacing: .01em;
      }
      h3 {
        margin-bottom: .75rem;
        color: var(--aqua);
        font-size: .78rem;
        letter-spacing: .08em;
        text-transform: uppercase;
      }
      .lede { max-width: 43ch; color: var(--muted); font-size: 1.02rem; line-height: 1.6; }
      form { margin-top: 2rem; }
      label { display: block; margin-bottom: .62rem; font-size: .9rem; font-weight: 700; }
      .password-row { display: flex; gap: .65rem; }
      input {
        width: 100%;
        min-width: 0;
        padding: .82rem .95rem;
        border: 1px solid var(--line);
        border-radius: 10px;
        outline: none;
        color: var(--ink);
        background: rgba(2, 10, 6, .7);
        font: inherit;
      }
      input:focus { border-color: var(--aqua); box-shadow: 0 0 0 3px rgba(94, 234, 212, .14); }
      button {
        flex: none;
        padding: .82rem 1rem;
        border: 0;
        border-radius: 10px;
        color: #11210c;
        background: var(--lime);
        cursor: pointer;
        font: inherit;
        font-weight: 800;
        white-space: nowrap;
        transition: transform .16s ease, filter .16s ease;
      }
      button:hover { filter: brightness(1.07); transform: translateY(-1px); }
      button:focus-visible { outline: 3px solid var(--aqua); outline-offset: 3px; }
      button:disabled { cursor: wait; filter: saturate(.5); transform: none; }
      .fine-print, .report-updated { color: var(--muted); font-size: .82rem; line-height: 1.5; }
      .fine-print { margin: 1rem 0 0; }
      .form-error { margin: .85rem 0 0; color: var(--danger); font-size: .9rem; }
      .dashboard { padding: 62px 0 52px; }
      .report-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; margin-bottom: 28px; }
      .report-header h1 { max-width: none; margin-bottom: .45rem; font-size: clamp(2.25rem, 5vw, 4rem); }
      .report-updated { margin-bottom: 0; }
      .quiet-button {
        padding: .63rem .82rem;
        border: 1px solid var(--line);
        color: var(--muted);
        background: transparent;
      }
      .quiet-button:hover { color: var(--ink); background: rgba(255,255,255,.06); }
      .hero-metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-bottom: 12px; }
      .hero-metrics .metric-row { min-height: 112px; padding: 22px; border-color: rgba(190, 242, 100, .3); background: linear-gradient(135deg, rgba(190,242,100,.13), rgba(94,234,212,.08)); }
      .hero-metrics .metric-row span { align-self: flex-start; color: var(--muted); }
      .hero-metrics .metric-row strong { align-self: flex-end; color: var(--lime); font-size: clamp(2rem, 5vw, 3rem); line-height: 1; }
      .report-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
      .report-card {
        margin-top: 12px;
        padding: 22px;
        border: 1px solid var(--line);
        border-radius: 16px;
        background: var(--panel);
        box-shadow: 0 10px 34px rgba(0,0,0,.14);
      }
      .metric-list { display: grid; gap: 2px; }
      .metric-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: .62rem 0; border-bottom: 1px solid rgba(220, 246, 221, .08); }
      .metric-row:last-child { border-bottom: 0; }
      .metric-row span { color: var(--muted); font-size: .9rem; }
      .metric-row strong { font-variant-numeric: tabular-nums; }
      .empty-state { margin: .25rem 0; color: var(--muted); font-size: .9rem; font-style: italic; }
      .wide-card { margin-top: 12px; }
      .table-wrap { overflow-x: auto; }
      table { width: 100%; border-collapse: collapse; font-size: .9rem; }
      th, td { padding: .72rem .6rem; border-bottom: 1px solid rgba(220, 246, 221, .1); text-align: right; font-variant-numeric: tabular-nums; }
      th:first-child, tbody th { text-align: left; }
      thead th { color: var(--muted); font-size: .72rem; letter-spacing: .07em; text-transform: uppercase; }
      tbody th { font-weight: 700; }
      tbody tr:last-child th, tbody tr:last-child td { border-bottom: 0; }
      .settings-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
      .settings-card { min-width: 0; padding: 16px; border: 1px solid rgba(220,246,221,.1); border-radius: 12px; background: rgba(0, 0, 0, .14); }
      .compact-list .metric-row { padding: .43rem 0; }
      .compact-list .metric-row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      @media (max-width: 760px) {
        .brand { top: 17px; left: 18px; }
        .dashboard { padding-top: 74px; }
        .report-header { flex-direction: column; gap: 14px; }
        .password-row { flex-direction: column; }
        .password-row button { width: 100%; }
        .report-grid, .settings-grid { grid-template-columns: 1fr; }
        .hero-metrics { gap: 8px; }
        .hero-metrics .metric-row { min-height: 96px; padding: 16px; }
        .report-card { padding: 17px; }
      }
      @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; } }
    </style>
  </head>
  <body>
    <div class="brand" aria-label="Words of Word">W.o.W</div>
    ${content}
    <script nonce="${nonce}">${script}</script>
  </body>
</html>`;
}
