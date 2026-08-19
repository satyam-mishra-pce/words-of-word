import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Spinner } from '../components/ui';
import {
  AnalyticsReport,
  AnalyticsUnauthorizedError,
  endAnalyticsSession,
  loadAnalyticsReport,
  MetricBucket,
  startAnalyticsSession
} from '../services/adminAnalytics';

const numberFormatter = new Intl.NumberFormat();
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EMPTY: MetricBucket[] = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function count(value: number | undefined): string {
  return numberFormatter.format(Number(value) || 0);
}

function humanize(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formattedDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return 'just now';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
}

function toDateTimeInput(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '';
  const local = new Date(date.valueOf() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function toUtcIso(value: string): string | undefined {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString();
}

function reportWindowLabel(report: AnalyticsReport): string {
  if (report.window.isAllTime) return 'all time';
  return `${formattedDate(report.window.from)} – ${formattedDate(report.window.to)}`;
}

function recentWindow(milliseconds: number): { from: string; to: string } {
  const to = new Date();
  return { from: new Date(to.valueOf() - milliseconds).toISOString(), to: to.toISOString() };
}

// ---------------------------------------------------------------------------
// TimeWindowPicker
// ---------------------------------------------------------------------------
type WindowValue = { from: string; to: string } | undefined;

function TimeWindowPicker({
  disabled,
  value,
  onChange
}: { disabled: boolean; value: WindowValue; onChange: (value: WindowValue) => void }): JSX.Element {
  const [from, setFrom] = useState(value ? toDateTimeInput(value.from) : '');
  const [to, setTo] = useState(value ? toDateTimeInput(value.to) : '');
  const [error, setError] = useState('');

  useEffect(() => {
    setFrom(value ? toDateTimeInput(value.from) : '');
    setTo(value ? toDateTimeInput(value.to) : '');
  }, [value]);

  const presets: Array<{ label: string; ms: number }> = [
    { label: 'Last 24h', ms: 24 * 3600_000 },
    { label: '7 days', ms: 7 * 24 * 3600_000 },
    { label: '30 days', ms: 30 * 24 * 3600_000 },
    { label: '90 days', ms: 90 * 24 * 3600_000 }
  ];

  function applyWindow(next: WindowValue): void {
    setError('');
    onChange(next);
  }

  function applyCustom(): void {
    const fromIso = toUtcIso(from);
    const toIso = toUtcIso(to);
    if (!fromIso || !toIso || fromIso >= toIso) {
      setError('Choose a valid end after start.');
      return;
    }
    applyWindow({ from: fromIso, to: toIso });
  }

  return (
    <div className="analytics-window">
      <div className="analytics-window__presets">
        {presets.map((preset) => (
          <button key={preset.label} type="button" className="footer-settings" disabled={disabled} onClick={() => applyWindow(recentWindow(preset.ms))}>
            {preset.label}
          </button>
        ))}
        <button type="button" className="footer-settings" disabled={disabled} onClick={() => applyWindow(undefined)}>
          All time
        </button>
      </div>
      <div className="analytics-window__custom">
        <label>From
          <input type="datetime-local" value={from} disabled={disabled} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>To
          <input type="datetime-local" value={to} disabled={disabled} onChange={(e) => setTo(e.target.value)} />
        </label>
        <Button size="sm" type="button" variant="secondary" disabled={disabled} onClick={applyCustom}>Apply</Button>
      </div>
      {error && <Alert variant="error">{error}</Alert>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tiny chart primitives (no external chart dependency)
// ---------------------------------------------------------------------------
function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }): JSX.Element {
  return (
    <div className="analytics-card analytics-stat">
      <span className="analytics-stat__label">{label}</span>
      <span className="analytics-stat__value">{value}</span>
      {sub ? <span className="analytics-stat__sub">{sub}</span> : null}
    </div>
  );
}

function BarChart({ data, height = 140 }: { data: MetricBucket[]; height?: number }): JSX.Element {
  const total = data.reduce((sum, row) => sum + row.count, 0);
  if (total === 0) return <p className="muted">No data in this window.</p>;
  const width = 720;
  const pad = 30;
  const barWidth = Math.max(2, Math.min(40, (width - pad) / Math.max(data.length, 1) - 4));
  const max = Math.max(...data.map((row) => row.count));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="analytics-chart" role="img" aria-label="Bar chart">
      {data.map((row, index) => {
        const barHeight = (row.count / max) * (height - pad);
        const x = pad + index * (barWidth + 4) + barWidth / 2;
        return (
          <g key={row.value}>
            <rect x={x - barWidth / 2} y={height - barHeight} width={barWidth} height={barHeight} rx={2} fill="currentColor" opacity={0.85} />
            <title>{`${row.value}: ${count(row.count)}`}</title>
          </g>
        );
      })}
    </svg>
  );
}

function LineChart({ data, height = 180 }: { data: Array<{ day: string; counts: Record<string, number> }>; height?: number }): JSX.Element {
  if (data.length === 0) return <p className="muted">No data in this window.</p>;
  const width = 720;
  const padL = 40;
  const padR = 12;
  const padT = 12;
  const padB = 24;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const totals = data.map((row) => Object.values(row.counts).reduce((a, b) => a + b, 0));
  const max = Math.max(...totals, 1);
  const step = data.length > 1 ? innerW / (data.length - 1) : 0;
  const points = totals.map((value, index) => {
    const x = padL + (data.length > 1 ? index * step : innerW / 2);
    const y = padT + innerH - (value / max) * innerH;
    return `${x},${y}`;
  });

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="analytics-chart" role="img" aria-label="Daily line chart">
      {[0.25, 0.5, 0.75, 1].map((fraction) => (
        <line key={fraction} x1={padL} x2={width - padR} y1={padT + innerH - fraction * innerH} y2={padT + innerH - fraction * innerH} stroke="currentColor" strokeOpacity={0.12} strokeWidth={1} />
      ))}
      <polyline points={points.join(' ')} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />
      {data.map((row, index) => {
        const value = totals[index] ?? 0;
        const x = padL + (data.length > 1 ? index * step : innerW / 2);
        const y = padT + innerH - (value / max) * innerH;
        if (data.length <= 14) {
          return <circle key={row.day} cx={x} cy={y} r={2.5} fill="currentColor"><title>{`${row.day}: ${count(value)}`}</title></circle>;
        }
        return <title key={row.day}>{`${row.day}: ${count(value)}`}</title>;
      })}
      {data.length <= 14 ? data.map((row, index) => (
        <text key={`t${row.day}`} x={padL + (data.length > 1 ? index * step : innerW / 2)} y={height - 6} textAnchor="middle" fontSize={10} fill="currentColor" opacity={0.6}>
          {row.day.slice(5)}
        </text>
      )) : null}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------
function BreakdownSection({ title, buckets }: { title: string; buckets: MetricBucket[] }): JSX.Element {
  return (
    <section className="analytics-card">
      <h3>{title}</h3>
      {buckets.length === 0 ? <p className="muted">No data.</p> : (
        <BarChart data={buckets} />
      )}
      {buckets.length > 0 && (
        <ul className="analytics-list">
          {buckets.slice(0, 12).map((bucket) => (
            <li key={String(bucket.value)}><span>{String(bucket.value)}</span><b>{count(bucket.count)}</b></li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EventTable({ byEvent }: { byEvent: Array<{ event: string; count: number }> }): JSX.Element {
  if (byEvent.length === 0) return <p className="muted">No events in this window.</p>;
  return (
    <section className="analytics-card">
      <h3>All events ({byEvent.length})</h3>
      <ul className="analytics-list">
        {byEvent.map((row) => (
          <li key={row.event}><span>{humanize(row.event)}</span><b>{count(row.count)}</b></li>
        ))}
      </ul>
    </section>
  );
}

function HourOfWeekChart({ data }: { data: Array<{ weekday: number; hour: number; count: number }> }): JSX.Element {
  const cells: Array<{ weekday: number; hour: number; count: number }> = [];
  const max = Math.max(1, ...data.map((row) => row.count));
  for (let weekday = 0; weekday < 7; weekday += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      cells.push(data.find((row) => row.weekday === weekday && row.hour === hour) ?? { weekday, hour, count: 0 });
    }
  }
  return (
    <section className="analytics-card">
      <h3>Hour of week</h3>
      <svg viewBox="0 0 480 120" className="analytics-heatmap" role="img" aria-label="Hour of week heatmap">
        {cells.map((cell) => {
          const x = (cell.hour / 24) * 480;
          const y = (cell.weekday / 7) * 120;
          const cw = 480 / 24;
          const ch = 120 / 7;
          const alpha = cell.count === 0 ? 0.04 : 0.15 + (cell.count / max) * 0.85;
          return <rect key={`${cell.weekday}-${cell.hour}`} x={x} y={y} width={cw} height={ch} fill="currentColor" opacity={alpha}>
            <title>{`${DAY_NAMES[cell.weekday]} ${cell.hour}:00 — ${count(cell.count)}`}</title>
          </rect>;
        })}
      </svg>
      <div className="analytics-heatmap__axis">
        <span>Mon</span><span style={{ marginLeft: 'auto' }}>Sun</span>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function AnalyticsPage(): JSX.Element {
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [window, setWindow] = useState<WindowValue>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState('');

  const load = useCallback(async (nextWindow: WindowValue) => {
    setLoading(true);
    setError('');
    try {
      const data = await loadAnalyticsReport(nextWindow);
      setReport(data);
      setAuthed(true);
      setWindow(nextWindow);
    } catch (err) {
      if (err instanceof AnalyticsUnauthorizedError) {
        setAuthed(false);
      } else {
        setError(err instanceof Error ? err.message : 'Could not load analytics.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Try the session cookie first; if 401, the login form is shown.
  useEffect(() => {
    void load(undefined);
  }, [load]);

  async function submitPassword(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError('');
    try {
      await startAnalyticsSession(password);
      await load(window);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the analytics session.');
      if (err instanceof AnalyticsUnauthorizedError) setError('Incorrect password.');
    }
  }

  async function logout(): Promise<void> {
    await endAnalyticsSession().catch(() => undefined);
    setAuthed(false);
    setReport(null);
  }

  const ready = authed && report;

  return (
    <main className="page-shell analytics-admin">
      <section className="analytics-head">
        <div>
          <p className="eyebrow">admin · supabase</p>
          <h1>Words of Word analytics</h1>
        </div>
        {ready && (
          <div className="analytics-head__actions">
            {report && <span className="muted">{reportWindowLabel(report)}</span>}
            <Button size="sm" variant="secondary" type="button" onClick={() => void logout()}>Logout</Button>
          </div>
        )}
      </section>

      {!authed && !loading && (
        <section className="panel-card" style={{ maxWidth: 420 }}>
          <p className="eyebrow">restricted</p>
          <h2>Admin sign in</h2>
          <form onSubmit={(event) => void submitPassword(event)}>
            <label className="field">
              <span>Analytics password</span>
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus />
            </label>
            {error && <Alert variant="error">{error}</Alert>}
            <Button variant="primary" fullWidth type="submit" style={{ marginTop: '0.75rem' }}>Sign in</Button>
          </form>
        </section>
      )}

      {loading && <div className="analytics-loading"><Spinner /> Loading…</div>}

      {ready && report && (
        <>
          <section className="analytics-toolbar">
            <TimeWindowPicker disabled={loading} value={window} onChange={(next) => void load(next)} />
          </section>

          <div className="analytics-grid analytics-grid--stats">
            <StatCard label="Events" value={count(report.headline.events)} />
            <StatCard label="Unique visitors" value={count(report.headline.uniqueVisitors)} />
            <StatCard label="Sessions" value={count(report.headline.uniqueSessions)} />
            <StatCard label="Signed-in users" value={count(report.headline.uniqueUsers)} sub={`${count(report.headline.signedInEvents)} signed-in events`} />
            <StatCard label="Live players" value={count(report.live.connectedSockets)} sub="right now" />
            <StatCard label="Live rooms" value={count(report.live.activeGames)} sub="right now" />
          </div>

          <section className="analytics-card">
            <h3>Events per day</h3>
            <LineChart data={report.trends.daily} />
          </section>

          <HourOfWeekChart data={report.trends.hourOfWeek} />

          <div className="analytics-grid">
            <BreakdownSection title="Top events" buckets={report.byEvent.map((row) => ({ value: humanize(row.event), count: row.count }))} />
            <BreakdownSection title="Game modes" buckets={report.breakdowns.gameModes ?? EMPTY} />
            <BreakdownSection title="Pages" buckets={report.breakdowns.pages ?? EMPTY} />
            <BreakdownSection title="Room size at start" buckets={report.breakdowns.roomSize ?? EMPTY} />
            <BreakdownSection title="Room fill rate" buckets={report.breakdowns.fillRate ?? EMPTY} />
            <BreakdownSection title="Game duration" buckets={report.breakdowns.gameDuration ?? EMPTY} />
            <BreakdownSection title="Min word length" buckets={report.breakdowns.minWordLength ?? EMPTY} />
            <BreakdownSection title="Time per round (s)" buckets={report.breakdowns.timePerRound ?? EMPTY} />
            <BreakdownSection title="Rounds" buckets={report.breakdowns.rounds ?? EMPTY} />
            <BreakdownSection title="Max players" buckets={report.breakdowns.maxPlayers ?? EMPTY} />
            <BreakdownSection title="Word category" buckets={report.breakdowns.wordCategory ?? EMPTY} />
            <BreakdownSection title="Departure phase" buckets={report.breakdowns.departurePhase ?? EMPTY} />
            <BreakdownSection title="Departure reason" buckets={report.breakdowns.departureReason ?? EMPTY} />
          </div>

          <div className="analytics-grid">
            <section className="analytics-card">
              <h3>Top emoters (visitor)</h3>
              {report.topEmoters.length === 0 ? <p className="muted">No emotes in this window.</p> : (
                <ul className="analytics-list">
                  {report.topEmoters.slice(0, 25).map((row) => (
                    <li key={row.visitorId}><span>{row.visitorId.slice(0, 8)}</span><b>{count(row.count)}</b></li>
                  ))}
                </ul>
              )}
            </section>
            <section className="analytics-card">
              <h3>Signed-in players</h3>
              {report.activeUsers.length === 0 ? <p className="muted">No signed-in players in this window.</p> : (
                <ul className="analytics-list">
                  {report.activeUsers.slice(0, 25).map((row) => (
                    <li key={row.userId}><span>{row.username ?? row.userId.slice(0, 8)}</span><b>{count(row.eventCount)}</b></li>
                  ))}
                </ul>
              )}
            </section>
            <EventTable byEvent={report.byEvent} />
          </div>
        </>
      )}
    </main>
  );
}
