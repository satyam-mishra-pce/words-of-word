import { cn } from '../../utils/cn';

export interface TimerRingProps {
  timeLeft: number;
  totalTime: number;
  size?: number;
  className?: string;
}

export function TimerRing({ timeLeft, totalTime, size = 88, className }: TimerRingProps) {
  const strokeWidth = 6;
  const center = size / 2;
  const radius = center - strokeWidth;
  const circumference = 2 * Math.PI * radius;
  const progress = totalTime > 0 ? Math.max(0, Math.min(1, timeLeft / totalTime)) : 0;
  const offset = circumference * (1 - progress);
  const isUrgent = timeLeft > 0 && timeLeft <= 10;
  const isWarn = timeLeft > 10 && timeLeft <= 20;

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const display = minutes > 0
    ? `${minutes}:${seconds.toString().padStart(2, '0')}`
    : String(timeLeft);

  const strokeColor = isUrgent ? 'var(--error)' : isWarn ? 'var(--gold)' : 'var(--main)';
  const labelColor  = isUrgent ? 'var(--error)' : isWarn ? 'var(--gold)' : 'var(--main)';
  const fontSize = size >= 88 ? '1.6rem' : size >= 64 ? '1.2rem' : '0.95rem';

  return (
    <div className={cn('ui-timer-ring', isUrgent && 'ui-timer-ring-urgent', className)} style={{ width: size, height: size }}>
      <svg
        className="ui-timer-ring-svg"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
      >
        <circle
          cx={center}
          cy={center}
          r={radius}
          strokeWidth={strokeWidth}
          stroke="rgba(255,255,255,0.07)"
          fill="none"
        />
        <circle
          className="ui-timer-ring-fill"
          cx={center}
          cy={center}
          r={radius}
          strokeWidth={strokeWidth}
          stroke={strokeColor}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div
        className="ui-timer-ring-label"
        style={{ fontSize, color: labelColor }}
      >
        {display}
      </div>
    </div>
  );
}
