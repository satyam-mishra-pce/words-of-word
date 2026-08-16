import { useNavigate } from 'react-router-dom';

interface StreakDailyPillProps {
  /** Current streak for a signed-in player, or null for a guest. */
  streak: number | null;
  /** Whether today's daily run is already finished. */
  done: boolean;
}

/**
 * The Daily Word entry point, folded together with the streak. Always routes to
 * /daily (guests can play too). A persistent, non-interactive tooltip nudges the
 * player while today's run is undone — messaging adapts to guest vs member.
 */
export function StreakDailyPill({ streak, done }: StreakDailyPillProps): JSX.Element {
  const navigate = useNavigate();
  const isGuest = streak === null;

  const tip = done
    ? ''
    : isGuest
      ? 'Sign in to save streaks'
      : streak && streak > 0
        ? 'Keep your streak →'
        : "Play today's word →";

  return (
    <div className="streak-daily">
      <button
        type="button"
        className={`streak-daily__btn${done ? ' is-done' : ''}${isGuest ? ' is-guest' : ''}`}
        onClick={() => navigate('/daily')}
        aria-label={isGuest ? 'Daily Word' : `Daily Word — ${streak}-day streak`}
        title="Daily Word"
      >
        <span className="streak-daily__flame" aria-hidden="true">🔥</span>
        {streak !== null && streak > 0 && <span className="streak-daily__count">{streak}</span>}
      </button>
      {tip && <span className="streak-daily__tip" role="status">{tip}</span>}
    </div>
  );
}
