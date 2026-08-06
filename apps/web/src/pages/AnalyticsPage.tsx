import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button } from '../components/ui';
import {
  AnalyticsReport,
  AnalyticsReportWindow,
  AnalyticsUnauthorizedError,
  CounterMap,
  DailyMetric,
  endAnalyticsSession,
  HourOfWeekMetric,
  loadAnalyticsReport,
  RetentionMetric,
  startAnalyticsSession
} from '../services/adminAnalytics';

const numberFormatter = new Intl.NumberFormat();
const percentFormatter = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 0 });
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EMPTY_COUNTER: CounterMap = {};

function total(report: AnalyticsReport, key: string): number {
  return report.totals[key] ?? 0;
}

function count(value: number | undefined): string {
  return numberFormatter.format(Number(value) || 0);
}

function percent(value: number | undefined): string {
  return percentFormatter.format(Math.max(0, Number(value) || 0));
}

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function humanize(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function compactLabel(value: string): string {
  return humanize(value)
    .replace('Under ', '< ')
    .replace(' Plus', '+')
    .replace('Before R 1', 'Before R1');
}

function duration(milliseconds: number): string {
  if (!milliseconds) return '—';
  if (milliseconds < 60_000) return `${Math.round(milliseconds / 1_000)} sec`;
  if (milliseconds < 60 * 60_000) return `${(milliseconds / 60_000).toFixed(milliseconds < 10 * 60_000 ? 1 : 0)} min`;
  return `${(milliseconds / 3_600_000).toFixed(1)} hr`;
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

function reportWindowLabel(window: AnalyticsReport['window']): string {
  if (window.isAllTime) return 'all time';
  return `${formattedDate(window.from)} – ${formattedDate(window.to)}`;
}

function recentWindow(milliseconds: number): AnalyticsReportWindow {
  const to = new Date();
  return { from: new Date(to.valueOf() - milliseconds).toISOString(), to: to.toISOString() };
}

type TimeWindowPickerProps = {
  disabled: boolean;
  value: AnalyticsReportWindow | undefined;
  onChange: (value: AnalyticsReportWindow | undefined) => void;
};

function TimeWindowPicker({ disabled, onChange, value }: TimeWindowPickerProps): JSX.Element {
  const [from, setFrom] = useState(() => value ? toDateTimeInput(value.from) : '');
  const [to, setTo] = useState(() => value ? toDateTimeInput(value.to) : '');
  const [error, setError] = useState('');

  useEffect(() => {
    setFrom(value ? toDateTimeInput(value.from) : '');
    setTo(value ? toDateTimeInput(value.to) : '');
    setError('');
  }, [value?.from, value?.to]);

  const apply = (): void => {
    if (!from && !to) {
      setError('');
      onChange(undefined);
      return;
    }
    const fromIso = toUtcIso(from);
    const toIso = toUtcIso(to);
    if (!fromIso || !toIso) {
      setError('Choose both a start and end time.');
      return;
    }
    if (Date.parse(fromIso) >= Date.parse(toIso)) {
      setError('The end time must be after the start time.');
      return;
    }
    setError('');
    onChange({ from: fromIso, to: toIso });
  };

  const choosePreset = (next: AnalyticsReportWindow | undefined): void => {
    setError('');
    setFrom(next ? toDateTimeInput(next.from) : '');
    setTo(next ? toDateTimeInput(next.to) : '');
    onChange(next);
  };

  return (
    <section className="analytics-window" aria-label="Analytics time window">
      <div className="analytics-window__copy">
        <span>Time window</span>
        <small>Times are interpreted in your local time; reports are stored in UTC.</small>
      </div>
      <div className="analytics-window__presets" aria-label="Time window presets">
        <Button disabled={disabled} onClick={() => { choosePreset(undefined); }} size="sm" type="button" variant="ghost">All time</Button>
        <Button disabled={disabled} onClick={() => { choosePreset(recentWindow(24 * 60 * 60_000)); }} size="sm" type="button" variant="ghost">24 hours</Button>
        <Button disabled={disabled} onClick={() => { choosePreset(recentWindow(7 * 24 * 60 * 60_000)); }} size="sm" type="button" variant="ghost">7 days</Button>
        <Button disabled={disabled} onClick={() => { choosePreset(recentWindow(30 * 24 * 60 * 60_000)); }} size="sm" type="button" variant="ghost">30 days</Button>
      </div>
      <div className="analytics-window__fields">
        <label>
          <span>Start</span>
          <input className="ui-input" disabled={disabled} onChange={(event) => { setFrom(event.currentTarget.value); setError(''); }} type="datetime-local" value={from} />
        </label>
        <label>
          <span>End</span>
          <input className="ui-input" disabled={disabled} onChange={(event) => { setTo(event.currentTarget.value); setError(''); }} type="datetime-local" value={to} />
        </label>
        <Button disabled={disabled} onClick={apply} size="sm" type="button" variant="secondary">Apply</Button>
      </div>
      {error && <p className="analytics-window__error" role="alert">{error}</p>}
    </section>
  );
}

type MetricProps = {
  label: string;
  value: string;
  detail?: string;
  emphasis?: boolean;
};

function Metric({ label, value, detail, emphasis = false }: MetricProps): JSX.Element {
  return (
    <div className={`analytics-metric${emphasis ? ' analytics-metric--emphasis' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}

type SectionProps = {
  eyebrow: string;
  title: string;
  note?: string;
  children: ReactNode;
  className?: string;
};

function AnalyticsSection({ eyebrow, title, note, children, className = '' }: SectionProps): JSX.Element {
  return (
    <section className={`analytics-section ${className}`.trim()}>
      <header className="analytics-section__header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        {note && <p className="analytics-section__note">{note}</p>}
      </header>
      {children}
    </section>
  );
}

type BarEntry = {
  label: string;
  value: number;
  detail?: string;
};

function BarList({ entries, empty = 'No activity recorded yet.' }: { entries: BarEntry[]; empty?: string }): JSX.Element {
  const visible = entries.filter((entry) => entry.value > 0);
  const maximum = Math.max(1, ...visible.map((entry) => entry.value));

  if (!visible.length) return <p className="analytics-empty">{empty}</p>;

  return (
    <div className="analytics-bars">
      {visible.map((entry) => (
        <div className="analytics-bar" key={entry.label}>
          <div className="analytics-bar__label">
            <span>{entry.label}</span>
            <strong>{count(entry.value)}</strong>
          </div>
          <div className="analytics-bar__track" aria-hidden="true">
            <span style={{ width: `${Math.max(3, entry.value / maximum * 100)}%` }} />
          </div>
          {entry.detail && <small>{entry.detail}</small>}
        </div>
      ))}
    </div>
  );
}

function TrafficChart({ daily }: { daily: DailyMetric[] }): JSX.Element {
  const series = daily;
  const hasActivity = series.some((point) => point.uniqueVisitors > 0 || point.gamesStarted > 0);
  if (!hasActivity) return <p className="analytics-empty analytics-empty--chart">Traffic appears here after the first visit or game.</p>;

  const width = 760;
  const height = 212;
  const pad = { top: 16, right: 12, bottom: 27, left: 30 };
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const maximum = Math.max(1, ...series.flatMap((point) => [point.uniqueVisitors, point.gamesStarted]));
  const point = (index: number, value: number): [number, number] => {
    const x = pad.left + (series.length === 1 ? innerWidth / 2 : index / (series.length - 1) * innerWidth);
    const y = pad.top + innerHeight - value / maximum * innerHeight;
    return [x, y];
  };
  const line = (field: keyof Pick<DailyMetric, 'uniqueVisitors' | 'gamesStarted'>): string => series
    .map((entry, index) => {
      const [x, y] = point(index, entry[field]);
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
  const firstDate = series[0]?.date.slice(5) ?? '';
  const lastDate = series.at(-1)?.date.slice(5) ?? '';

  return (
    <>
      <div className="analytics-traffic" role="img" aria-label="Unique visitors and games started in the selected time window">
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
          {[0, 0.5, 1].map((step) => {
            const y = pad.top + innerHeight - innerHeight * step;
            return <line className="analytics-traffic__grid" key={step} x1={pad.left} x2={width - pad.right} y1={y} y2={y} />;
          })}
          <path className="analytics-traffic__line analytics-traffic__line--visitors" d={line('uniqueVisitors')} />
          <path className="analytics-traffic__line analytics-traffic__line--games" d={line('gamesStarted')} />
          <text className="analytics-traffic__axis" x={pad.left} y={height - 6}>{firstDate}</text>
          <text className="analytics-traffic__axis" x={width - pad.right} y={height - 6} textAnchor="end">{lastDate}</text>
        </svg>
      </div>
      <div className="analytics-legend" aria-label="Traffic chart legend">
        <span><i className="analytics-legend__dot analytics-legend__dot--visitors" />visitors</span>
        <span><i className="analytics-legend__dot analytics-legend__dot--games" />games started</span>
      </div>
    </>
  );
}

function Retention({ retention }: { retention: AnalyticsReport['audience']['retention'] }): JSX.Element {
  const values: Array<[string, RetentionMetric]> = [
    ['D1', retention.day1],
    ['D7', retention.day7],
    ['D30', retention.day30]
  ];

  return (
    <div className="analytics-retention">
      {values.map(([label, metric]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{percent(metric.rate)}</strong>
          <small>{count(metric.returned)} / {count(metric.eligible)}</small>
        </div>
      ))}
    </div>
  );
}

function Funnel({ report }: { report: AnalyticsReport }): JSX.Element {
  const values: BarEntry[] = [
    { label: 'Rooms created', value: total(report, 'roomsCreated') },
    { label: 'Rooms reached 2+ players', value: total(report, 'roomsPlayable') },
    { label: 'Games started', value: total(report, 'gamesStarted') },
    { label: 'Games finished', value: total(report, 'gamesFinished') }
  ];

  return <BarList entries={values} empty="The lobby-to-finish flow will appear after rooms are played." />;
}

function PeakHeatmap({ points }: { points: HourOfWeekMetric[] }): JSX.Element {
  const pointByHour = useMemo(() => new Map(points.map((point) => [`${point.weekday}-${point.hour}`, point])), [points]);
  const maximum = Math.max(1, ...points.map((point) => point.sessions));

  return (
    <div className="analytics-heatmap-wrap">
      <div className="analytics-heatmap-hours" aria-hidden="true">
        <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
      </div>
      <div className="analytics-heatmap" role="img" aria-label="Sessions by UTC hour and weekday">
        {DAY_NAMES.map((day, weekday) => (
          <div className="analytics-heatmap__row" key={day}>
            <span>{day}</span>
            <div>
              {Array.from({ length: 24 }, (_, hour) => {
                const value = pointByHour.get(`${weekday}-${hour}`)?.sessions ?? 0;
                const alpha = value > 0 ? Math.max(0.14, value / maximum) : 0;
                return (
                  <i
                    aria-label={`${day} ${String(hour).padStart(2, '0')}:00 UTC: ${count(value)} sessions`}
                    key={hour}
                    style={{ opacity: alpha }}
                    title={`${day} ${String(hour).padStart(2, '0')}:00 UTC — ${count(value)} sessions`}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="analytics-heatmap-note">UTC · stronger marks mean more sessions</p>
    </div>
  );
}

function ModeTable({ report }: { report: AnalyticsReport }): JSX.Element {
  const rows = Object.entries(report.byGameMode)
    .filter(([, metrics]) => metrics.gamesStarted > 0 || metrics.roomsCreated > 0)
    .sort(([, left], [, right]) => right.gamesStarted - left.gamesStarted);

  if (!rows.length) return <p className="analytics-empty">Modes will appear after a game starts.</p>;

  return (
    <div className="analytics-table-wrap">
      <table className="analytics-table">
        <thead>
          <tr><th>Mode</th><th>Starts</th><th>Finished</th><th>Completion</th><th>Players</th></tr>
        </thead>
        <tbody>
          {rows.map(([mode, metrics]) => (
            <tr key={mode}>
              <th scope="row">{humanize(mode)}</th>
              <td>{count(metrics.gamesStarted)}</td>
              <td>{count(metrics.gamesFinished)}</td>
              <td>{percent(rate(metrics.gamesFinished, metrics.gamesStarted))}</td>
              <td>{count(metrics.participantSlots)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SettingsDigest({ settings }: { settings: AnalyticsReport['settings'] }): JSX.Element {
  const groups = [
    ['Visibility', settings.roomVisibility ?? EMPTY_COUNTER],
    ['Players', settings.maxPlayers ?? EMPTY_COUNTER],
    ['Rounds', settings.rounds ?? EMPTY_COUNTER],
    ['Round time', settings.timePerRound ?? EMPTY_COUNTER],
    ['Word length', settings.minWordLength ?? EMPTY_COUNTER],
    ['Category', settings.wordCategory ?? EMPTY_COUNTER]
  ] as const;

  const entries = groups.map(([label, values]) => {
    const top = Object.entries(values).sort(([, left], [, right]) => right - left)[0];
    return { label, value: top ? compactLabel(top[0]) : '—', count: top?.[1] ?? 0 };
  });

  return (
    <dl className="analytics-settings">
      {entries.map((entry) => (
        <div key={entry.label}>
          <dt>{entry.label}</dt>
          <dd>{entry.value}</dd>
          <small>{entry.count ? `${count(entry.count)} starts` : 'No starts yet'}</small>
        </div>
      ))}
    </dl>
  );
}

function LoginPanel({ onAuthenticated }: { onAuthenticated: () => Promise<void> }): JSX.Element {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!password) return;
    setSubmitting(true);
    setError('');
    try {
      await startAnalyticsSession(password);
      setPassword('');
      await onAuthenticated();
    } catch (reason) {
      setError(reason instanceof AnalyticsUnauthorizedError
        ? 'That password did not work. Try again.'
        : 'Could not reach the analytics service. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="page-shell analytics-auth-shell">
      <section className="panel-card analytics-auth" aria-labelledby="analytics-access-title">
        <a className="analytics-brand" href="/">words <i>of</i> word</a>
        <p className="eyebrow">private analytics</p>
        <h1 id="analytics-access-title">Product signal.</h1>
        <p className="muted">Sign in to view the first-party aggregate report.</p>
        <form className="analytics-auth__form" onSubmit={submit}>
          <label htmlFor="analytics-password">Analytics password</label>
          <input
            autoComplete="current-password"
            autoFocus
            className="ui-input"
            id="analytics-password"
            onChange={(event) => { setPassword(event.currentTarget.value); setError(''); }}
            required
            spellCheck={false}
            type="password"
            value={password}
          />
          {error && <Alert variant="error">{error}</Alert>}
          <Button fullWidth isLoading={submitting} type="submit" variant="primary">
            {submitting ? 'Opening…' : 'Open analytics →'}
          </Button>
        </form>
        <p className="analytics-auth__note">Your password never goes in the URL. Access lasts only for this browser session.</p>
      </section>
    </main>
  );
}

function Dashboard({ onEndSession, onRefresh, onWindowChange, refreshing, report, window }: {
  onEndSession: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onWindowChange: (value: AnalyticsReportWindow | undefined) => void;
  refreshing: boolean;
  report: AnalyticsReport;
  window: AnalyticsReportWindow | undefined;
}): JSX.Element {
  const isScoped = !report.window.isAllTime;
  const completion = rate(total(report, 'gamesFinished'), total(report, 'gamesStarted'));
  const averageRounds = rate(report.engagement.playerRounds, report.engagement.participantsInStartedGames);
  const activeDropOff = rate(report.engagement.activeGameDepartures, report.engagement.playerDepartures);
  const roomSizeEntries = Object.entries(report.engagement.roomSizeAtGameStart).map(([label, value]) => ({ label: compactLabel(label), value }));
  const durationEntries = Object.entries(report.engagement.gameDuration).map(([label, value]) => ({ label: compactLabel(label), value }));
  const depthEntries = Object.entries(report.engagement.playerRoundDepth).map(([label, value]) => ({ label: compactLabel(label), value }));
  const dropoffEntries = Object.entries(report.engagement.activeGameDropoffByRound).map(([label, value]) => ({ label: compactLabel(label), value }));
  const featureEntries = Object.entries(report.featureAdoption)
    .map(([label, value]) => ({ label: humanize(label.replace(/^page_/, '')), value }))
    .sort((left, right) => right.value - left.value)
    .slice(0, 8);

  return (
    <main className="analytics-shell" aria-labelledby="analytics-title">
      <header className="analytics-topbar">
        <a className="analytics-brand" href="/">words <i>of</i> word</a>
        <div>
          <span className="analytics-private">private</span>
          <Button onClick={() => { void onEndSession(); }} size="sm" variant="ghost">End session</Button>
        </div>
      </header>

      <header className="analytics-heading">
        <div>
          <p className="eyebrow">first-party product analytics</p>
          <h1 id="analytics-title">The game, in numbers.</h1>
          <p className="muted">Updated {formattedDate(report.updatedAt)} · {reportWindowLabel(report.window)}.</p>
        </div>
        <Button isLoading={refreshing} onClick={() => { void onRefresh(); }} size="sm" variant="secondary">Refresh</Button>
      </header>

      <TimeWindowPicker disabled={refreshing} onChange={onWindowChange} value={window} />

      {!report.window.exactMetricsAvailable && isScoped && (
        <p className="analytics-window__notice" role="status">
          Detailed metrics are available from {formattedDate(report.window.metricsRecordedFrom)}. Earlier selected activity is retained in the traffic series, but cannot be reconstructed into an exact window.
        </p>
      )}

      <section className="analytics-overview" aria-label="Analytics overview">
        <Metric detail={isScoped ? 'pseudonymous installations' : `${count(report.audience.active7d)} active this week`} label={isScoped ? 'Players in window' : 'Known players'} value={count(report.audience.knownVisitors)} emphasis />
        <Metric detail={isScoped ? 'server-confirmed sessions' : `${count(report.audience.sessionsToday)} sessions today`} label={isScoped ? 'Sessions in window' : 'Active · 30d'} value={count(isScoped ? total(report, 'visitorSessions') : report.audience.active30d)} />
        <Metric detail={`${count(report.totals.roomsPlayable)} rooms reached 2+`} label="Games started" value={count(report.totals.gamesStarted)} />
        <Metric detail={`${count(report.totals.gamesFinished)} completed`} label="Completion" value={percent(completion)} />
      </section>

      <AnalyticsSection eyebrow="traffic" note={`${isScoped ? 'selected window' : 'all recorded history'} · UTC day view`} title="Audience and games">
        <TrafficChart daily={report.trends.daily} />
      </AnalyticsSection>

      <div className="analytics-grid analytics-grid--two">
        {isScoped ? (
          <AnalyticsSection eyebrow="return rate" note="all-time UTC-day cohort signal" title="Retention">
            <p className="analytics-definition">Retention uses full UTC-day cohorts, so it remains an all-time signal while a date/time window is selected.</p>
          </AnalyticsSection>
        ) : (
          <AnalyticsSection eyebrow="return rate" note="exact anonymous cohorts" title="Retention">
            <Retention retention={report.audience.retention} />
            <p className="analytics-definition">A return is an active visit exactly 1, 7, or 30 days after the first recorded visit.</p>
          </AnalyticsSection>
        )}
        <AnalyticsSection eyebrow="room health" title="Lobby to finish">
          <Funnel report={report} />
        </AnalyticsSection>
      </div>

      <div className="analytics-grid analytics-grid--two">
        <AnalyticsSection eyebrow="game composition" note={`${count(report.engagement.participantsInStartedGames)} player slots`} title="Room size at game start">
          <BarList entries={roomSizeEntries} empty="Room size appears once a game starts." />
        </AnalyticsSection>
        <AnalyticsSection eyebrow="time invested" note={`${duration(rate(report.engagement.gameDurationMs.completed, total(report, 'gamesFinished')))} avg finish`} title="Completed game length">
          <BarList entries={durationEntries} empty="Duration appears when a game ends." />
        </AnalyticsSection>
      </div>

      <div className="analytics-grid analytics-grid--two">
        <AnalyticsSection eyebrow="play depth" note={`${averageRounds.toFixed(1)} avg rounds / player`} title="Rounds per player">
          <BarList entries={depthEntries} empty="Play depth appears after rounds are completed." />
        </AnalyticsSection>
        <AnalyticsSection eyebrow="drop-off" note={`${percent(activeDropOff)} during active games`} title="Where players leave">
          <BarList entries={dropoffEntries} empty="Drop-off appears when a player leaves a live game." />
        </AnalyticsSection>
      </div>

      <AnalyticsSection eyebrow="timing" note={isScoped ? 'sessions in the selected window · UTC' : 'sessions by UTC hour'} title="When players show up">
        <PeakHeatmap points={report.trends.hourOfWeek} />
      </AnalyticsSection>

      <AnalyticsSection eyebrow="adoption" note="completion is based on games, never scores" title="Modes players start and finish">
        <ModeTable report={report} />
      </AnalyticsSection>

      <div className="analytics-grid analytics-grid--two">
        <AnalyticsSection eyebrow="product behavior" title={isScoped ? 'Feature adoption in window' : 'Feature adoption'}>
          <BarList entries={featureEntries} empty="Feature usage appears as players use the app." />
        </AnalyticsSection>
        <AnalyticsSection eyebrow="game setup" title="Most-used settings">
          <SettingsDigest settings={report.settings} />
        </AnalyticsSection>
      </div>

      <footer className="analytics-method">
        <p className="eyebrow">privacy boundary</p>
        <p>Server-confirmed gameplay is aggregated after successful actions. Retention uses a random pseudonymous installation ID that is HMACed before storage. Names, room codes, typed words, custom lists, scores, IP addresses, and user-agent strings are not included.</p>
      </footer>
    </main>
  );
}

export default function AnalyticsPage(): JSX.Element | null {
  const [report, setReport] = useState<AnalyticsReport>();
  const [state, setState] = useState<'loading' | 'unauthenticated' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [analyticsWindow, setAnalyticsWindow] = useState<AnalyticsReportWindow | undefined>();
  const latestRequest = useRef(0);

  const refresh = useCallback(async (): Promise<void> => {
    const request = ++latestRequest.current;
    setRefreshing(true);
    setError('');
    try {
      const nextReport = await loadAnalyticsReport(analyticsWindow);
      if (request !== latestRequest.current) return;
      setReport(nextReport);
      setState('ready');
    } catch (reason) {
      if (request !== latestRequest.current) return;
      setReport(undefined);
      if (reason instanceof AnalyticsUnauthorizedError) {
        setState('unauthenticated');
      } else {
        setState('error');
        setError(reason instanceof Error ? reason.message : 'Could not load analytics.');
      }
    } finally {
      if (request === latestRequest.current) setRefreshing(false);
    }
  }, [analyticsWindow]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const endSession = useCallback(async (): Promise<void> => {
    latestRequest.current += 1;
    try {
      await endAnalyticsSession();
    } finally {
      setReport(undefined);
      setState('unauthenticated');
    }
  }, []);

  if (state === 'loading' && !report) {
    return (
      <main className="page-shell analytics-auth-shell">
        <p className="analytics-loading">loading analytics…</p>
      </main>
    );
  }

  if (state === 'unauthenticated') return <LoginPanel onAuthenticated={refresh} />;

  if (state === 'error') {
    return (
      <main className="page-shell analytics-auth-shell">
        <section className="panel-card analytics-auth">
          <a className="analytics-brand" href="/">words <i>of</i> word</a>
          <p className="eyebrow">private analytics</p>
          <h1>Unavailable.</h1>
          <Alert variant="error">{error}</Alert>
          <div className="analytics-auth__actions">
            <Button onClick={() => { void refresh(); }} variant="primary">Try again</Button>
            <Button onClick={() => { window.location.assign('/'); }} variant="secondary">Go home</Button>
          </div>
        </section>
      </main>
    );
  }

  return report ? (
    <Dashboard
      onEndSession={endSession}
      onRefresh={refresh}
      onWindowChange={(value) => { latestRequest.current += 1; setAnalyticsWindow(value); }}
      refreshing={refreshing}
      report={report}
      window={analyticsWindow}
    />
  ) : null;
}
