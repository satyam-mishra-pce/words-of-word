type AnalyticsAdminPageOptions = {
  nonce: string;
  authenticated: boolean;
};

function loginPanel(): string {
  return `
    <section class="auth-card" aria-labelledby="access-title">
      <div class="eyebrow"><span></span> Private admin area</div>
      <h1 id="access-title">See what players actually do.</h1>
      <p class="lede">Enter the analytics password to open the W.o.W product observatory.</p>
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
          <button type="submit">Open dashboard <span aria-hidden="true">→</span></button>
        </div>
        <p id="access-error" class="form-error" role="alert" hidden></p>
      </form>
      <p class="fine-print">The password is never put in the URL. Successful access is remembered only in a secure browser session.</p>
    </section>`;
}

function dashboardPanel(): string {
  return `
    <main class="dashboard" aria-labelledby="report-title">
      <header class="report-header">
        <div>
          <div class="eyebrow"><span></span> First-party product observatory</div>
          <h1 id="report-title">Audience, play, and momentum.</h1>
          <p id="report-updated" class="report-updated">Loading the current signal…</p>
        </div>
        <div class="header-actions">
          <span class="live-pill"><i></i> Live</span>
          <button id="end-session" class="quiet-button" type="button">End session</button>
        </div>
      </header>

      <p id="report-error" class="form-error" role="alert" hidden></p>
      <div id="report-content" hidden>
        <section id="overview-metrics" class="overview-grid" aria-label="Audience overview"></section>

        <section class="panel panel-wide" aria-labelledby="traffic-title">
          <div class="panel-heading">
            <div>
              <p class="panel-kicker">Momentum</p>
              <h2 id="traffic-title">Audience & game traffic</h2>
            </div>
            <p class="panel-note">Daily, UTC · last 120 days</p>
          </div>
          <div id="traffic-chart" class="chart-stage"></div>
          <div id="traffic-legend" class="chart-legend" aria-label="Traffic chart legend"></div>
        </section>

        <div class="panel-pair">
          <section class="panel" aria-labelledby="retention-title">
            <div class="panel-heading compact-heading">
              <div>
                <p class="panel-kicker">Return rate</p>
                <h2 id="retention-title">Retention</h2>
              </div>
              <p class="panel-note">Exact anonymous cohorts</p>
            </div>
            <div id="retention-metrics" class="retention-grid"></div>
            <p class="definition">A returned player was active exactly 1, 7, or 30 days after their first recorded visit.</p>
          </section>
          <section class="panel" aria-labelledby="funnel-title">
            <div class="panel-heading compact-heading">
              <div>
                <p class="panel-kicker">Room health</p>
                <h2 id="funnel-title">From lobby to finish</h2>
              </div>
            </div>
            <div id="funnel-chart" class="funnel-list"></div>
          </section>
        </div>

        <div class="panel-pair">
          <section class="panel" aria-labelledby="rooms-title">
            <div class="panel-heading compact-heading">
              <div>
                <p class="panel-kicker">Game composition</p>
                <h2 id="rooms-title">Room size at start</h2>
              </div>
              <p id="room-size-summary" class="panel-note"></p>
            </div>
            <div id="room-size-chart" class="bar-list"></div>
          </section>
          <section class="panel" aria-labelledby="duration-title">
            <div class="panel-heading compact-heading">
              <div>
                <p class="panel-kicker">Time invested</p>
                <h2 id="duration-title">Completed game length</h2>
              </div>
              <p id="duration-summary" class="panel-note"></p>
            </div>
            <div id="duration-chart" class="bar-list"></div>
          </section>
        </div>

        <div class="panel-pair">
          <section class="panel" aria-labelledby="depth-title">
            <div class="panel-heading compact-heading">
              <div>
                <p class="panel-kicker">Play depth</p>
                <h2 id="depth-title">Rounds per player</h2>
              </div>
              <p id="depth-summary" class="panel-note"></p>
            </div>
            <div id="round-depth-chart" class="bar-list"></div>
          </section>
          <section class="panel" aria-labelledby="dropoff-title">
            <div class="panel-heading compact-heading">
              <div>
                <p class="panel-kicker">Drop-off</p>
                <h2 id="dropoff-title">When players leave</h2>
              </div>
              <p id="dropoff-summary" class="panel-note"></p>
            </div>
            <div id="dropoff-chart" class="bar-list warm-bars"></div>
          </section>
        </div>

        <section class="panel panel-wide" aria-labelledby="peaks-title">
          <div class="panel-heading">
            <div>
              <p class="panel-kicker">Timing</p>
              <h2 id="peaks-title">When the room is alive</h2>
            </div>
            <p class="panel-note">Sessions by UTC hour</p>
          </div>
          <div id="peak-heatmap" class="heatmap-wrap"></div>
        </section>

        <section class="panel panel-wide" aria-labelledby="modes-title">
          <div class="panel-heading">
            <div>
              <p class="panel-kicker">Adoption</p>
              <h2 id="modes-title">Modes players start and finish</h2>
            </div>
            <p class="panel-note">Completion reflects games, not scores</p>
          </div>
          <div id="mode-table" class="table-wrap"></div>
        </section>

        <div class="panel-pair">
          <section class="panel" aria-labelledby="features-title">
            <div class="panel-heading compact-heading">
              <div>
                <p class="panel-kicker">Product behavior</p>
                <h2 id="features-title">Feature adoption</h2>
              </div>
            </div>
            <div id="feature-chart" class="bar-list"></div>
          </section>
          <section class="panel" aria-labelledby="settings-title">
            <div class="panel-heading compact-heading">
              <div>
                <p class="panel-kicker">Game setup</p>
                <h2 id="settings-title">Most-used settings</h2>
              </div>
            </div>
            <div id="settings-chart" class="settings-grid"></div>
          </section>
        </div>

        <section class="method-note" aria-labelledby="method-title">
          <div class="method-mark">◎</div>
          <div>
            <h2 id="method-title">How this is measured</h2>
            <p>Gameplay is measured on the server after successful actions. Audience metrics use a random pseudonymous installation ID, stored only as a private server-side HMAC, plus a per-app session ID. Names, room codes, typed words, custom lists, scores, IP addresses, and user-agent strings are not shown in this report.</p>
          </div>
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
        submit.innerHTML = 'Open dashboard <span aria-hidden="true">→</span>';
      }
    });`;
}

function dashboardScript(): string {
  return `
    const reportContent = document.getElementById('report-content');
    const reportError = document.getElementById('report-error');
    const updated = document.getElementById('report-updated');
    const formatter = new Intl.NumberFormat();
    const percentFormatter = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 0 });
    const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    function humanize(value) {
      return String(value)
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/[_-]/g, ' ')
        .replace(/\\b\\w/g, function (letter) { return letter.toUpperCase(); });
    }

    function shortLabel(value) {
      return humanize(value)
        .replace('Under ', '< ')
        .replace(' Plus', '+');
    }

    function count(value) {
      return formatter.format(Number(value) || 0);
    }

    function ratio(numerator, denominator) {
      return denominator > 0 ? numerator / denominator : 0;
    }

    function duration(milliseconds) {
      const value = Number(milliseconds) || 0;
      if (value < 60 * 1000) return Math.round(value / 1000) + ' sec';
      if (value < 60 * 60 * 1000) return (value / 60_000).toFixed(value < 10 * 60_000 ? 1 : 0) + ' min';
      return (value / 3_600_000).toFixed(1) + ' hr';
    }

    function element(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    function overviewCard(label, value, note, accent) {
      const card = element('article', 'overview-card' + (accent ? ' ' + accent : ''));
      card.append(element('span', 'overview-label', label), element('strong', 'overview-value', value), element('span', 'overview-note', note));
      return card;
    }

    function metricBar(label, value, maximum, detail, tone) {
      const row = element('div', 'bar-row' + (tone ? ' ' + tone : ''));
      const top = element('div', 'bar-top');
      top.append(element('span', 'bar-label', label), element('strong', 'bar-value', count(value)));
      const track = element('div', 'bar-track');
      const fill = element('span', 'bar-fill');
      fill.style.width = String(maximum > 0 ? Math.max(3, value / maximum * 100) : 0) + '%';
      track.append(fill);
      row.append(top, track);
      if (detail) row.append(element('span', 'bar-detail', detail));
      return row;
    }

    function renderBars(id, entries, options) {
      const target = document.getElementById(id);
      target.replaceChildren();
      const filtered = entries.filter(function (entry) { return Number(entry.value) > 0; });
      if (!filtered.length) {
        target.append(element('p', 'empty-state', options && options.empty ? options.empty : 'No activity recorded yet.'));
        return;
      }
      const maximum = Math.max.apply(null, filtered.map(function (entry) { return Number(entry.value) || 0; }));
      filtered.forEach(function (entry) {
        target.append(metricBar(entry.label, Number(entry.value) || 0, maximum, entry.detail, entry.tone));
      });
    }

    function svgNode(name) {
      return document.createElementNS('http://www.w3.org/2000/svg', name);
    }

    function renderTrafficChart(daily) {
      const target = document.getElementById('traffic-chart');
      const legend = document.getElementById('traffic-legend');
      target.replaceChildren();
      legend.replaceChildren();
      const series = daily.slice(-60);
      if (!series.length || !series.some(function (point) { return point.uniqueVisitors || point.gamesStarted; })) {
        target.append(element('p', 'empty-state chart-empty', 'Traffic will appear once visitors and games are recorded.'));
        return;
      }

      const width = 900;
      const height = 280;
      const padding = { top: 20, right: 22, bottom: 34, left: 40 };
      const innerWidth = width - padding.left - padding.right;
      const innerHeight = height - padding.top - padding.bottom;
      const values = series.flatMap(function (point) { return [Number(point.uniqueVisitors) || 0, Number(point.gamesStarted) || 0]; });
      const maxValue = Math.max(1, Math.max.apply(null, values));
      const svg = svgNode('svg');
      svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', 'Daily unique visitors and games started over time');
      svg.classList.add('traffic-svg');

      for (let step = 0; step <= 4; step += 1) {
        const value = maxValue * step / 4;
        const y = padding.top + innerHeight - innerHeight * step / 4;
        const line = svgNode('line');
        line.setAttribute('x1', String(padding.left));
        line.setAttribute('x2', String(width - padding.right));
        line.setAttribute('y1', String(y));
        line.setAttribute('y2', String(y));
        line.setAttribute('class', 'chart-gridline');
        svg.append(line);
        const label = svgNode('text');
        label.setAttribute('x', String(padding.left - 9));
        label.setAttribute('y', String(y + 4));
        label.setAttribute('text-anchor', 'end');
        label.setAttribute('class', 'chart-axis-label');
        label.textContent = count(Math.round(value));
        svg.append(label);
      }

      function point(index, value) {
        const x = padding.left + (series.length === 1 ? innerWidth / 2 : index / (series.length - 1) * innerWidth);
        const y = padding.top + innerHeight - value / maxValue * innerHeight;
        return [x, y];
      }

      function addSeries(field, className) {
        const points = series.map(function (entry, index) { return point(index, Number(entry[field]) || 0); });
        const polyline = svgNode('polyline');
        polyline.setAttribute('points', points.map(function (entry) { return entry[0] + ',' + entry[1]; }).join(' '));
        polyline.setAttribute('fill', 'none');
        polyline.setAttribute('class', className);
        svg.append(polyline);
      }

      addSeries('uniqueVisitors', 'chart-line visitors-line');
      addSeries('gamesStarted', 'chart-line games-line');

      const first = series[0];
      const last = series[series.length - 1];
      [first, last].forEach(function (entry, index) {
        const label = svgNode('text');
        label.setAttribute('x', String(index === 0 ? padding.left : width - padding.right));
        label.setAttribute('y', String(height - 8));
        label.setAttribute('text-anchor', index === 0 ? 'start' : 'end');
        label.setAttribute('class', 'chart-axis-label');
        label.textContent = entry.date.slice(5);
        svg.append(label);
      });

      target.append(svg);
      [['Unique visitors', 'visitors-dot'], ['Games started', 'games-dot']].forEach(function (item) {
        const entry = element('span', 'legend-item');
        entry.append(element('i', item[1]), document.createTextNode(item[0]));
        legend.append(entry);
      });
    }

    function renderRetention(retention) {
      const target = document.getElementById('retention-metrics');
      target.replaceChildren();
      [['D1', retention.day1], ['D7', retention.day7], ['D30', retention.day30]].forEach(function (entry) {
        const block = element('div', 'retention-card');
        block.append(
          element('span', 'retention-label', entry[0]),
          element('strong', 'retention-rate', percentFormatter.format(entry[1].rate || 0)),
          element('span', 'retention-note', count(entry[1].returned) + ' / ' + count(entry[1].eligible) + ' eligible')
        );
        target.append(block);
      });
    }

    function renderFunnel(totals) {
      const target = document.getElementById('funnel-chart');
      target.replaceChildren();
      const entries = [
        ['Rooms created', totals.roomsCreated],
        ['Reached 2 players', totals.roomsPlayable],
        ['Games started', totals.gamesStarted],
        ['Games finished', totals.gamesFinished]
      ];
      const first = Math.max(1, Number(entries[0][1]) || 0);
      entries.forEach(function (entry, index) {
        const row = element('div', 'funnel-step');
        const label = element('span', 'funnel-label', entry[0]);
        const number = element('strong', 'funnel-number', count(entry[1]));
        const track = element('div', 'funnel-track');
        const fill = element('span', 'funnel-fill');
        fill.style.width = String(Math.max(4, Math.min(100, Number(entry[1]) / first * 100))) + '%';
        track.append(fill);
        row.append(element('span', 'funnel-index', String(index + 1).padStart(2, '0')), label, number, track);
        target.append(row);
      });
    }

    function renderHeatmap(hourOfWeek) {
      const target = document.getElementById('peak-heatmap');
      target.replaceChildren();
      const byKey = new Map(hourOfWeek.map(function (entry) { return [entry.weekday + '-' + entry.hour, entry]; }));
      const max = Math.max(1, Math.max.apply(null, hourOfWeek.map(function (entry) { return Number(entry.sessions) || 0; })));
      const grid = element('div', 'heatmap');
      const corner = element('span', 'heat-corner', 'UTC');
      grid.append(corner);
      for (let hour = 0; hour < 24; hour += 1) grid.append(element('span', 'heat-hour', String(hour).padStart(2, '0')));
      for (let day = 0; day < 7; day += 1) {
        grid.append(element('span', 'heat-day', DAY_NAMES[day]));
        for (let hour = 0; hour < 24; hour += 1) {
          const data = byKey.get(day + '-' + hour) || { sessions: 0, gamesStarted: 0, peakConnectedSockets: 0 };
          const cell = element('span', 'heat-cell');
          const intensity = Math.ceil((Number(data.sessions) || 0) / max * 5);
          cell.dataset.intensity = String(intensity);
          cell.setAttribute('role', 'img');
          cell.setAttribute('aria-label', DAY_NAMES[day] + ' ' + String(hour).padStart(2, '0') + ':00 UTC: ' + count(data.sessions) + ' sessions, ' + count(data.gamesStarted) + ' games started');
          cell.title = DAY_NAMES[day] + ' ' + String(hour).padStart(2, '0') + ':00 UTC · ' + count(data.sessions) + ' sessions · ' + count(data.gamesStarted) + ' games';
          grid.append(cell);
        }
      }
      target.append(grid);
      const caption = element('p', 'heatmap-caption', 'Brighter cells indicate more sessions. Hover or focus a cell for the exact count.');
      target.append(caption);
    }

    function renderModes(modes, adoption) {
      const target = document.getElementById('mode-table');
      target.replaceChildren();
      const table = element('table', 'mode-table');
      const head = document.createElement('thead');
      const headRow = document.createElement('tr');
      ['Mode', 'Started', 'Finished', 'Finish rate', 'Player slots', 'Unique players'].forEach(function (label) {
        headRow.append(element('th', '', label));
      });
      head.append(headRow);
      const body = document.createElement('tbody');
      Object.entries(modes)
        .filter(function (entry) { return Number(entry[1].gamesStarted) > 0 || Number(entry[1].roomsCreated) > 0; })
        .sort(function (left, right) { return Number(right[1].gamesStarted) - Number(left[1].gamesStarted); })
        .forEach(function (entry) {
          const mode = entry[0];
          const metrics = entry[1];
          const row = document.createElement('tr');
          const cells = [
            humanize(mode),
            count(metrics.gamesStarted),
            count(metrics.gamesFinished),
            percentFormatter.format(ratio(metrics.gamesFinished, metrics.gamesStarted)),
            count(metrics.participantSlots),
            count(adoption[mode])
          ];
          cells.forEach(function (value, index) {
            const cell = document.createElement(index === 0 ? 'th' : 'td');
            if (index === 0) cell.scope = 'row';
            cell.textContent = value;
            row.append(cell);
          });
          body.append(row);
        });
      if (!body.children.length) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 6;
        cell.className = 'empty-cell';
        cell.textContent = 'Modes will appear after the first game starts.';
        row.append(cell);
        body.append(row);
      }
      table.append(head, body);
      target.append(table);
    }

    function renderSettings(settings) {
      const target = document.getElementById('settings-chart');
      target.replaceChildren();
      const groups = [
        ['Visibility', settings.roomVisibility],
        ['Round time', settings.timePerRound],
        ['Rounds', settings.rounds],
        ['Max players', settings.maxPlayers],
        ['Category', settings.wordCategory],
        ['Mix modifiers', settings.mixModifiers]
      ];
      groups.forEach(function (group) {
        const card = element('section', 'settings-card');
        card.append(element('h3', '', group[0]));
        const entries = Object.entries(group[1]).filter(function (entry) { return Number(entry[1]) > 0; })
          .sort(function (left, right) { return Number(right[1]) - Number(left[1]); }).slice(0, 3);
        if (!entries.length) {
          card.append(element('p', 'empty-state', 'No games yet.'));
        } else {
          const list = element('div', 'micro-list');
          entries.forEach(function (entry) {
            const line = element('div', 'micro-line');
            line.append(element('span', '', shortLabel(entry[0])), element('strong', '', count(entry[1])));
            list.append(line);
          });
          card.append(list);
        }
        target.append(card);
      });
    }

    function renderDashboard(report) {
      const engagement = report.engagement;
      const totals = report.totals;
      const audience = report.audience;
      const completionRate = ratio(totals.gamesFinished, totals.gamesStarted);
      const averageRoomSize = ratio(engagement.participantsInStartedGames, totals.gamesStarted);
      const averageRounds = ratio(engagement.playerRounds, engagement.participantsInStartedGames);
      const averageGameLength = ratio(engagement.gameDurationMs.completed, totals.gamesFinished);
      const overview = document.getElementById('overview-metrics');
      overview.replaceChildren(
        overviewCard('Active today', count(audience.activeToday), count(audience.sessionsToday) + ' sessions today', 'lime'),
        overviewCard('Active · 30 days', count(audience.active30d), count(audience.active7d) + ' active 7d · ' + count(audience.knownVisitors) + ' known', 'aqua'),
        overviewCard('Live now', count(report.live.connectedSockets), count(report.live.activeGames) + ' games in progress', 'coral'),
        overviewCard('Game completion', percentFormatter.format(completionRate), count(totals.gamesFinished) + ' finished of ' + count(totals.gamesStarted) + ' started', 'violet')
      );

      renderTrafficChart(report.trends.daily);
      renderRetention(audience.retention);
      renderFunnel(totals);
      renderBars('room-size-chart', Object.entries(engagement.roomSizeAtGameStart).map(function (entry) {
        return { label: shortLabel(entry[0]) + ' players', value: entry[1] };
      }), { empty: 'Room size will appear after games start.' });
      document.getElementById('room-size-summary').textContent = totals.gamesStarted
        ? averageRoomSize.toFixed(1) + ' players / started game'
        : 'Waiting for games';

      renderBars('duration-chart', Object.entries(engagement.gameDuration).map(function (entry) {
        return { label: shortLabel(entry[0]), value: entry[1] };
      }), { empty: 'Duration data will appear after games finish.' });
      document.getElementById('duration-summary').textContent = totals.gamesFinished
        ? duration(averageGameLength) + ' average'
        : 'Waiting for finishes';

      renderBars('round-depth-chart', Object.entries(engagement.playerRoundDepth).map(function (entry) {
        return { label: shortLabel(entry[0]) + ' rounds', value: entry[1] };
      }), { empty: 'Player round depth will appear after a game ends.' });
      document.getElementById('depth-summary').textContent = engagement.participantsInStartedGames
        ? averageRounds.toFixed(1) + ' avg rounds / player · ' + count(totals.roundsCompleted) + ' rounds completed'
        : 'Waiting for rounds';

      renderBars('dropoff-chart', Object.entries(engagement.activeGameDropoffByRound).map(function (entry) {
        return { label: shortLabel(entry[0]), value: entry[1], tone: 'warm' };
      }), { empty: 'No active-game departures recorded.' });
      document.getElementById('dropoff-summary').textContent = count(engagement.activeGameDepartures) + ' active-game departures';

      renderHeatmap(report.trends.hourOfWeek);
      renderModes(report.byGameMode, report.modeAdoption);
      renderBars('feature-chart', Object.entries(report.featureAdoption)
        .map(function (entry) { return { label: humanize(entry[0]), value: entry[1], detail: count(report.featureUsage[entry[0]]) + ' total signals' }; })
        .sort(function (left, right) { return Number(right.value) - Number(left.value); }).slice(0, 8),
      { empty: 'Feature adoption will appear after client signals arrive.' });
      renderSettings(report.settings);
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
          : 'Updated ' + new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp) + ' · all timing charts use UTC';
        renderDashboard(report);
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
    <title>W.o.W — Product Observatory</title>
    <style>
      :root {
        color-scheme: dark;
        --canvas: #08100e;
        --canvas-deep: #040806;
        --ink: #eef8ed;
        --muted: #99aa9e;
        --faint: #64746a;
        --line: rgba(218, 245, 222, .14);
        --line-bright: rgba(190, 242, 100, .28);
        --panel: rgba(13, 25, 20, .86);
        --panel-strong: rgba(18, 35, 27, .96);
        --lime: #c4f36c;
        --aqua: #55dec8;
        --coral: #ff9f7d;
        --violet: #b9a8ff;
        --danger: #ffafba;
        --shadow: 0 28px 80px rgba(0, 0, 0, .38);
      }
      * { box-sizing: border-box; }
      body {
        min-height: 100vh;
        margin: 0;
        color: var(--ink);
        background:
          radial-gradient(1000px 540px at 5% -5%, rgba(85, 222, 200, .12), transparent 65%),
          radial-gradient(820px 560px at 100% 8%, rgba(196, 243, 108, .10), transparent 66%),
          radial-gradient(800px 500px at 58% 120%, rgba(185, 168, 255, .08), transparent 65%),
          var(--canvas);
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
        mask-image: linear-gradient(to bottom, black, transparent 74%);
      }
      .brand {
        position: absolute;
        top: 22px;
        left: 24px;
        z-index: 2;
        color: var(--lime);
        font-family: Georgia, "Times New Roman", serif;
        font-size: 1.13rem;
        font-weight: 700;
        letter-spacing: .07em;
      }
      .auth-card, .dashboard { width: min(1180px, calc(100% - 40px)); margin-inline: auto; }
      .auth-card {
        width: min(590px, calc(100% - 32px));
        margin-top: max(120px, 17vh);
        padding: clamp(28px, 6vw, 58px);
        border: 1px solid var(--line);
        border-radius: 25px;
        background: linear-gradient(150deg, rgba(21, 38, 29, .95), rgba(9, 18, 14, .96));
        box-shadow: var(--shadow);
      }
      .eyebrow {
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--aqua);
        font-size: .7rem;
        font-weight: 800;
        letter-spacing: .16em;
        text-transform: uppercase;
      }
      .eyebrow span { width: 7px; height: 7px; border-radius: 50%; background: var(--lime); box-shadow: 0 0 15px var(--lime); }
      h1, h2, h3, p { margin-top: 0; }
      h1 {
        max-width: 15ch;
        margin: .62rem 0 .9rem;
        font-family: Georgia, "Times New Roman", serif;
        font-size: clamp(2.2rem, 5vw, 4.2rem);
        line-height: .95;
        letter-spacing: -.06em;
      }
      h2 { margin-bottom: 0; font-size: clamp(1.1rem, 1.7vw, 1.35rem); letter-spacing: -.025em; }
      h3 { margin-bottom: .7rem; color: var(--aqua); font-size: .69rem; letter-spacing: .1em; text-transform: uppercase; }
      .lede { max-width: 44ch; color: var(--muted); font-size: 1.02rem; line-height: 1.6; }
      form { margin-top: 2rem; }
      label { display: block; margin-bottom: .62rem; font-size: .9rem; font-weight: 700; }
      .password-row { display: flex; gap: .65rem; }
      input {
        width: 100%; min-width: 0; padding: .86rem .95rem;
        border: 1px solid var(--line); border-radius: 10px; outline: none;
        color: var(--ink); background: rgba(2, 10, 6, .7); font: inherit;
      }
      input:focus { border-color: var(--aqua); box-shadow: 0 0 0 3px rgba(85, 222, 200, .14); }
      button {
        flex: none; padding: .82rem 1rem; border: 0; border-radius: 10px;
        color: #10200b; background: var(--lime); cursor: pointer; font: inherit; font-weight: 800; white-space: nowrap;
        transition: transform .16s ease, filter .16s ease;
      }
      button:hover { filter: brightness(1.08); transform: translateY(-1px); }
      button:focus-visible { outline: 3px solid var(--aqua); outline-offset: 3px; }
      button:disabled { cursor: wait; filter: saturate(.5); transform: none; }
      .fine-print, .report-updated, .panel-note, .definition { color: var(--muted); font-size: .79rem; line-height: 1.52; }
      .fine-print { margin: 1rem 0 0; }
      .form-error { margin: .85rem 0 0; color: var(--danger); font-size: .9rem; }
      .dashboard { padding: 62px 0 64px; }
      .report-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 28px; margin-bottom: 28px; }
      .report-header h1 { max-width: 16ch; margin-bottom: .48rem; }
      .report-updated { margin-bottom: 0; }
      .header-actions { display: flex; align-items: center; gap: 10px; padding-top: 4px; }
      .live-pill { display: inline-flex; align-items: center; gap: 7px; padding: .56rem .68rem; border: 1px solid var(--line); border-radius: 999px; color: var(--muted); font-size: .75rem; font-weight: 700; }
      .live-pill i { width: 7px; height: 7px; border-radius: 50%; background: var(--aqua); box-shadow: 0 0 12px var(--aqua); }
      .quiet-button { padding: .58rem .76rem; border: 1px solid var(--line); color: var(--muted); background: transparent; }
      .quiet-button:hover { color: var(--ink); background: rgba(255,255,255,.055); }
      .overview-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
      .overview-card { position: relative; min-height: 140px; overflow: hidden; padding: 19px; border: 1px solid var(--line); border-radius: 15px; background: var(--panel); }
      .overview-card::after { position: absolute; right: -25px; bottom: -39px; width: 112px; height: 112px; content: ""; border: 1px solid currentColor; border-radius: 50%; opacity: .24; }
      .overview-card.lime { color: var(--lime); }
      .overview-card.aqua { color: var(--aqua); }
      .overview-card.coral { color: var(--coral); }
      .overview-card.violet { color: var(--violet); }
      .overview-label, .overview-note { display: block; color: var(--muted); font-size: .75rem; }
      .overview-label { font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
      .overview-value { display: block; margin: .54rem 0 .38rem; color: currentColor; font-size: clamp(1.65rem, 3.4vw, 2.45rem); font-variant-numeric: tabular-nums; letter-spacing: -.055em; }
      .overview-note { position: relative; z-index: 1; line-height: 1.35; }
      .panel-pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
      .panel { min-width: 0; margin-top: 10px; padding: 21px; border: 1px solid var(--line); border-radius: 17px; background: linear-gradient(135deg, var(--panel), rgba(10, 21, 16, .88)); box-shadow: 0 12px 36px rgba(0,0,0,.13); }
      .panel-wide { margin-top: 10px; }
      .panel-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 18px; }
      .compact-heading { margin-bottom: 15px; }
      .panel-kicker { margin: 0 0 .34rem; color: var(--aqua); font-size: .67rem; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
      .panel-note { max-width: 19ch; margin: .1rem 0 0; text-align: right; }
      .chart-stage { position: relative; min-height: 285px; padding: 2px 0 0; }
      .traffic-svg { display: block; width: 100%; height: auto; overflow: visible; }
      .chart-gridline { stroke: rgba(221, 248, 224, .1); stroke-width: 1; }
      .chart-axis-label { fill: var(--faint); font-family: ui-rounded, sans-serif; font-size: 10px; }
      .chart-line { fill: none; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
      .visitors-line { stroke: var(--lime); filter: drop-shadow(0 0 6px rgba(196,243,108,.28)); }
      .games-line { stroke: var(--violet); stroke-dasharray: 7 5; }
      .chart-legend { display: flex; gap: 18px; padding-left: 40px; color: var(--muted); font-size: .76rem; }
      .legend-item { display: inline-flex; align-items: center; gap: 6px; }
      .legend-item i { width: 8px; height: 8px; border-radius: 50%; }
      .visitors-dot { background: var(--lime); box-shadow: 0 0 8px rgba(196,243,108,.7); }
      .games-dot { background: var(--violet); }
      .chart-empty { display: grid; min-height: 250px; place-items: center; }
      .retention-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
      .retention-card { padding: 14px 8px; border: 1px solid rgba(85, 222, 200, .14); border-radius: 11px; text-align: center; background: rgba(85, 222, 200, .035); }
      .retention-label, .retention-note { display: block; color: var(--muted); font-size: .68rem; }
      .retention-label { font-weight: 800; letter-spacing: .1em; }
      .retention-rate { display: block; margin: .43rem 0; color: var(--aqua); font-size: 1.45rem; font-variant-numeric: tabular-nums; letter-spacing: -.05em; }
      .definition { margin: 16px 0 0; }
      .funnel-list { display: grid; gap: 10px; }
      .funnel-step { display: grid; grid-template-columns: 25px minmax(0, 1fr) auto; align-items: center; gap: 9px; }
      .funnel-index { color: var(--faint); font-size: .69rem; font-variant-numeric: tabular-nums; }
      .funnel-label { min-width: 0; color: var(--muted); font-size: .82rem; }
      .funnel-number { font-size: .88rem; font-variant-numeric: tabular-nums; }
      .funnel-track { grid-column: 2 / -1; height: 6px; overflow: hidden; border-radius: 99px; background: rgba(255,255,255,.07); }
      .funnel-fill { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--lime), var(--aqua)); }
      .bar-list { display: grid; gap: 11px; }
      .bar-row { display: grid; gap: 6px; }
      .bar-top { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
      .bar-label, .bar-detail { min-width: 0; overflow: hidden; color: var(--muted); font-size: .79rem; text-overflow: ellipsis; white-space: nowrap; }
      .bar-value { font-size: .86rem; font-variant-numeric: tabular-nums; }
      .bar-track { height: 8px; overflow: hidden; border-radius: 99px; background: rgba(255,255,255,.065); }
      .bar-fill { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--aqua), var(--lime)); }
      .warm .bar-fill, .warm-bars .bar-fill { background: linear-gradient(90deg, var(--coral), #ffd48a); }
      .bar-detail { margin-top: -1px; color: var(--faint); font-size: .68rem; }
      .empty-state { margin: .6rem 0; color: var(--muted); font-size: .86rem; font-style: italic; }
      .heatmap-wrap { overflow-x: auto; padding-bottom: 2px; }
      .heatmap { display: grid; grid-template-columns: 31px repeat(24, minmax(13px, 1fr)); gap: 3px; min-width: 610px; }
      .heat-corner, .heat-hour, .heat-day { color: var(--faint); font-size: .61rem; line-height: 15px; text-align: center; }
      .heat-day { padding-right: 4px; text-align: right; }
      .heat-cell { min-height: 15px; border-radius: 3px; outline: 1px solid rgba(255,255,255,.025); background: rgba(255,255,255,.045); }
      .heat-cell[data-intensity="1"] { background: rgba(85, 222, 200, .18); }
      .heat-cell[data-intensity="2"] { background: rgba(85, 222, 200, .34); }
      .heat-cell[data-intensity="3"] { background: rgba(157, 231, 148, .54); }
      .heat-cell[data-intensity="4"] { background: rgba(196, 243, 108, .72); }
      .heat-cell[data-intensity="5"] { background: var(--lime); box-shadow: 0 0 7px rgba(196,243,108,.35); }
      .heat-cell:focus-visible { outline: 2px solid var(--ink); outline-offset: 1px; }
      .heatmap-caption { margin: 11px 0 0 31px; color: var(--muted); font-size: .72rem; }
      .table-wrap { overflow-x: auto; }
      .mode-table { width: 100%; border-collapse: collapse; font-size: .84rem; }
      .mode-table th, .mode-table td { padding: .73rem .6rem; border-bottom: 1px solid rgba(220,246,221,.09); text-align: right; font-variant-numeric: tabular-nums; }
      .mode-table th:first-child, .mode-table tbody th { text-align: left; }
      .mode-table thead th { color: var(--faint); font-size: .64rem; letter-spacing: .08em; text-transform: uppercase; }
      .mode-table tbody th { font-weight: 700; }
      .mode-table tbody tr:last-child th, .mode-table tbody tr:last-child td { border-bottom: 0; }
      .empty-cell { color: var(--muted); font-style: italic; text-align: center !important; }
      .settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
      .settings-card { min-width: 0; padding: 13px; border: 1px solid rgba(220,246,221,.1); border-radius: 11px; background: rgba(0,0,0,.13); }
      .micro-list { display: grid; gap: 6px; }
      .micro-line { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--muted); font-size: .75rem; }
      .micro-line span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .micro-line strong { color: var(--ink); font-variant-numeric: tabular-nums; }
      .method-note { display: grid; grid-template-columns: auto 1fr; gap: 14px; margin-top: 10px; padding: 19px 21px; border: 1px solid rgba(85,222,200,.2); border-radius: 16px; background: rgba(85,222,200,.045); }
      .method-mark { display: grid; width: 31px; height: 31px; place-items: center; border: 1px solid rgba(85,222,200,.36); border-radius: 50%; color: var(--aqua); }
      .method-note h2 { margin: 1px 0 .45rem; font-size: 1rem; }
      .method-note p { max-width: 92ch; margin-bottom: 0; color: var(--muted); font-size: .78rem; line-height: 1.55; }
      @media (max-width: 900px) {
        .overview-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
      @media (max-width: 720px) {
        .brand { top: 17px; left: 18px; }
        .dashboard { width: min(100% - 24px, 1180px); padding-top: 74px; }
        .report-header { flex-direction: column; gap: 15px; }
        .header-actions { width: 100%; justify-content: space-between; }
        .password-row { flex-direction: column; }
        .password-row button { width: 100%; }
        .panel-pair { grid-template-columns: 1fr; gap: 0; }
        .panel { padding: 17px; }
        .panel-heading { gap: 11px; }
        .panel-note { max-width: 17ch; font-size: .7rem; }
        .chart-stage { min-height: 205px; }
        .chart-legend { padding-left: 31px; }
        .settings-grid { grid-template-columns: 1fr; }
        .mode-table th, .mode-table td { padding: .63rem .43rem; font-size: .73rem; }
      }
      @media (max-width: 390px) {
        .overview-grid { grid-template-columns: 1fr; }
        .overview-card { min-height: 106px; }
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
