import { readStoredValue, STORAGE_KEYS, writeStoredValue } from './storage';

/**
 * Words of Word game sound effects.
 *
 * A single "retro pixel" chiptune voice, generated live with the Web Audio API
 * so the app ships no audio assets. Each event category owns a signature
 * (register, rhythm, contour) so players can tell events apart by ear:
 *   room      → soft two-note, mid register
 *   round     → bright fanfares (rise = start, fall = end)
 *   word      → ultra-short; accept = high tick, reject = low, penalty = fall
 *   timer     → pure single-pitch clock ping, no melody
 *   busted    → the layered fuse/explosion/impact
 *   gameend   → the longest, most musical phrases
 *   knockout  → a downward fall + thud
 *   betting   → short metallic clicks
 *   claim/common → lock thunk, dissonant clash, sparkle
 *   bingo     → stamp + big fanfare
 *   sprint    → fastest staccato rise
 *   lightning → electric zap up / power-down
 *   intuition → single soft shimmer
 */

export type GameSound =
  | 'playerJoin'
  | 'playerLeave'
  | 'roundStart'
  | 'timerWarning'
  | 'timerTick'
  | 'roundEnd'
  | 'wordAccepted'
  | 'wordRejected'
  | 'scorePenalty'
  | 'bomb'
  | 'bombSelf'
  | 'elimination'
  | 'gameOver'
  | 'victory'
  | 'bettingStart'
  | 'betLocked'
  | 'bettingWin'
  | 'bettingLoss'
  | 'claimRejected'
  | 'commonCollision'
  | 'rareWord'
  | 'bingoTask'
  | 'bingoComplete'
  | 'sprintWin'
  | 'lightningGain'
  | 'lightningTimeout'
  | 'intuitionReveal';

export interface SoundPreferences {
  enabled: boolean;
  volume: number;
}

export const DEFAULT_SOUND_PREFERENCES: SoundPreferences = {
  enabled: true,
  volume: 0.65
};

export function loadSoundPreferences(): SoundPreferences {
  try {
    const stored = readStoredValue(STORAGE_KEYS.soundPreferences);
    if (!stored) return DEFAULT_SOUND_PREFERENCES;
    const parsed = JSON.parse(stored) as Partial<SoundPreferences>;
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_SOUND_PREFERENCES.enabled,
      volume: typeof parsed.volume === 'number' && Number.isFinite(parsed.volume)
        ? Math.max(0, Math.min(1, parsed.volume))
        : DEFAULT_SOUND_PREFERENCES.volume
    };
  } catch {
    return DEFAULT_SOUND_PREFERENCES;
  }
}

let preferences = loadSoundPreferences();
let context: AudioContext | undefined;
let masterGain: GainNode | undefined;
let hasUnlocked = false;
const activeSources = new Set<AudioScheduledSourceNode>();
const lastPlayedAt = new Map<GameSound, number>();
const pulseWaves = new Map<string, PeriodicWave>();

function persistPreferences(): void {
  writeStoredValue(STORAGE_KEYS.soundPreferences, JSON.stringify(preferences));
}

export function getSoundPreferences(): SoundPreferences {
  return { ...preferences };
}

export function setSoundPreferences(next: SoundPreferences): void {
  preferences = {
    enabled: next.enabled,
    volume: Math.max(0, Math.min(1, next.volume))
  };
  if (masterGain && context) {
    masterGain.gain.setTargetAtTime(preferences.enabled ? preferences.volume : 0, context.currentTime, 0.015);
  }
  persistPreferences();
}

function audioContextConstructor(): typeof AudioContext | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

function ensureContext(): AudioContext | undefined {
  if (context) return context;
  const AudioContextClass = audioContextConstructor();
  if (!AudioContextClass) return undefined;
  try {
    context = new AudioContextClass();
    masterGain = context.createGain();
    masterGain.gain.value = preferences.enabled ? preferences.volume : 0;
    masterGain.connect(context.destination);
    return context;
  } catch {
    context = undefined;
    masterGain = undefined;
    return undefined;
  }
}

/** Call only from a user gesture. Socket-driven sounds remain silent until this succeeds. */
export async function unlockGameAudio(): Promise<void> {
  if (!preferences.enabled) return;
  if (hasUnlocked && context?.state === 'running') return;
  const audioContext = ensureContext();
  if (!audioContext) return;
  try {
    if (audioContext.state === 'suspended') await audioContext.resume();
    hasUnlocked = audioContext.state === 'running';
  } catch {
    hasUnlocked = false;
  }
}

function trackSource(source: AudioScheduledSourceNode): void {
  activeSources.add(source);
  source.addEventListener('ended', () => activeSources.delete(source), { once: true });
}

/** A variable-duty pulse/square wave — the core of the chiptune voice. */
function pulseWave(duty: number): PeriodicWave | undefined {
  if (!context) return undefined;
  const key = duty.toFixed(3);
  const cached = pulseWaves.get(key);
  if (cached) return cached;
  const size = 1024;
  const real = new Float32Array(size);
  const imag = new Float32Array(size);
  for (let k = 1; k < size; k += 1) {
    real[k] = (2 / (k * Math.PI)) * Math.sin(Math.PI * k * duty);
  }
  const wave = context.createPeriodicWave(real, imag);
  pulseWaves.set(key, wave);
  return wave;
}

interface ToneOptions {
  f: number;
  dur: number;
  t?: number;
  gain?: number;
  /** Pulse duty cycle. Omit to use `type` instead. */
  duty?: number;
  type?: OscillatorType;
  /** End frequency for a pitch glide. */
  f2?: number | undefined;
  attack?: number;
}

function tone(options: ToneOptions): void {
  if (!context || !masterGain) return;
  const now = context.currentTime + (options.t ?? 0);
  const oscillator = context.createOscillator();
  if (options.duty != null) {
    const wave = pulseWave(options.duty);
    if (wave) oscillator.setPeriodicWave(wave);
  } else {
    oscillator.type = options.type ?? 'square';
  }
  const gainValue = options.gain ?? 0.12;
  const attack = options.attack ?? 0.002;
  oscillator.frequency.setValueAtTime(Math.max(20, options.f), now);
  if (options.f2 != null) {
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, options.f2), now + options.dur);
  }
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, gainValue), now + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + options.dur);
  oscillator.connect(gain).connect(masterGain);
  trackSource(oscillator);
  oscillator.start(now);
  oscillator.stop(now + options.dur + 0.03);
}

interface NoiseOptions {
  dur: number;
  t?: number;
  gain?: number;
  cutoff?: number;
  filter?: BiquadFilterType;
}

/** The NES-style "noise channel" for percussion and explosions. */
function noise(options: NoiseOptions): void {
  if (!context || !masterGain) return;
  const frameCount = Math.max(1, Math.floor(context.sampleRate * options.dur));
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = (Math.random() * 2 - 1) * (1 - index / samples.length);
  }
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  const now = context.currentTime + (options.t ?? 0);
  source.buffer = buffer;
  filter.type = options.filter ?? 'lowpass';
  filter.frequency.value = options.cutoff ?? 1400;
  gain.gain.setValueAtTime(options.gain ?? 0.2, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + options.dur);
  source.connect(filter).connect(gain).connect(masterGain);
  trackSource(source);
  source.start(now);
  source.stop(now + options.dur + 0.02);
}

interface NoteOptions {
  duty?: number;
  f2?: number | undefined;
  /** Adds a triangle sub-octave for weight. */
  bass?: boolean;
}

/** One chiptune note (pulse, optional glide, optional sub-octave). */
function note(f: number, dur: number, t: number, gain: number, options: NoteOptions = {}): void {
  tone({ f, f2: options.f2, dur, t, gain, duty: options.duty ?? 0.5 });
  if (options.bass) {
    tone({ f: f / 2, f2: options.f2 ? options.f2 / 2 : undefined, dur, t, gain: gain * 0.5, type: 'triangle' });
  }
}

/** A melodic sequence rendered note by note. */
function run(freqs: number[], step: number, dur: number, gain: number, options: NoteOptions = {}): void {
  freqs.forEach((f, index) => note(f, dur, index * step, gain, options));
}

/** A chord rendered as a fast chiptune arpeggio cycle. */
function arp(freqs: number[], dur: number, t: number, gain: number, duty = 0.5): void {
  const step = 0.03;
  const total = Math.max(1, Math.round(dur / (step * freqs.length)));
  let k = 0;
  for (let cycle = 0; cycle < total; cycle += 1) {
    for (const f of freqs) {
      tone({ f, dur: step * 0.9, t: t + k * step, gain, duty, attack: 0.001 });
      k += 1;
    }
  }
}

function playBomb(self: boolean): void {
  const strength = self ? 1 : 0.72;
  // Chiptune death: fuse chirp → noise-channel burst → descending square rumble.
  tone({ f: 1400, f2: 240, dur: 0.16, t: 0, gain: 0.08 * strength, duty: 0.25 });
  noise({ dur: 0.26, t: 0.14, gain: 0.34 * strength, cutoff: 2600, filter: 'highpass' });
  tone({ f: 210, f2: 46, dur: 0.34, t: 0.15, gain: 0.2 * strength, duty: 0.5 });
  tone({ f: 150, f2: 38, dur: 0.3, t: 0.15, gain: 0.13 * strength, type: 'triangle' });
  if (self) {
    // A little extra ear-ring tail for the player who actually got busted.
    tone({ f: 520, f2: 360, dur: 0.5, t: 0.34, gain: 0.03, type: 'triangle' });
  }
}

function render(sound: GameSound): void {
  switch (sound) {
    // ROOM — gentle two-note, mid register
    case 'playerJoin': run([392, 523], 0.1, 0.13, 0.12); break;
    case 'playerLeave': run([523, 392], 0.11, 0.14, 0.12); break;

    // ROUND — bright fanfares
    case 'roundStart': run([523, 659, 784, 1047], 0.075, 0.15, 0.14); break;
    case 'roundEnd': run([784, 659, 523], 0.1, 0.19, 0.12); break;

    // WORD — ultra-short, register extremes
    case 'wordAccepted': note(1319, 0.07, 0, 0.13, { duty: 0.25 }); break;
    case 'wordRejected':
      noise({ dur: 0.09, gain: 0.14, cutoff: 900 });
      tone({ f: 180, f2: 120, dur: 0.1, gain: 0.12, duty: 0.5 });
      break;
    case 'scorePenalty': run([523, 300], 0.055, 0.07, 0.12); break;

    // TIMER — pure fixed-pitch clock ping. Calm tick through the warning
    // window (10→4s), then a higher, brighter urgent tick for 3-2-1.
    case 'timerWarning': note(660, 0.05, 0, 0.1); break;
    case 'timerTick': note(1047, 0.055, 0, 0.12, { duty: 0.25 }); break;

    // BUSTED
    case 'bombSelf': playBomb(true); break;
    case 'bomb': playBomb(false); break;

    // GAMEEND — longest, most musical
    case 'victory':
      run([523, 659, 784, 1047], 0.11, 0.24, 0.14);
      arp([523, 659, 784, 1047], 0.5, 0.45, 0.08);
      break;
    case 'gameOver': run([440, 349, 294], 0.15, 0.26, 0.11); break;

    // KNOCKOUT — downward fall + thud
    case 'elimination':
      note(330, 0.3, 0, 0.13, { f2: 90 });
      noise({ dur: 0.14, t: 0.24, gain: 0.2, cutoff: 500 });
      break;

    // BETTING — short, metallic, clicky
    case 'bettingStart': run([660, 660, 880], 0.06, 0.045, 0.1, { duty: 0.25 }); break;
    case 'betLocked': run([880, 587], 0.05, 0.05, 0.11, { duty: 0.25 }); break;
    case 'bettingWin':
      run([784, 1047, 1319], 0.06, 0.11, 0.13, { duty: 0.25 });
      note(1319, 0.14, 0.2, 0.1, { duty: 0.25 });
      break;
    case 'bettingLoss': run([440, 294, 196], 0.08, 0.1, 0.11); break;

    // CLAIM / COMMON WORD
    case 'claimRejected':
      note(220, 0.09, 0, 0.12);
      note(220, 0.09, 0.08, 0.1);
      break;
    case 'commonCollision':
      note(466, 0.17, 0, 0.11);
      note(659, 0.17, 0, 0.09); // tritone clash
      break;
    case 'rareWord': run([880, 1175, 1568], 0.05, 0.1, 0.11, { duty: 0.25 }); break;

    // BINGO
    case 'bingoTask': run([659, 659, 880], 0.05, 0.06, 0.11); break;
    case 'bingoComplete':
      run([523, 659, 784, 1047, 1319], 0.07, 0.14, 0.14);
      arp([523, 784, 1047, 1319], 0.4, 0.42, 0.08);
      break;

    // SPRINT — fastest staccato rise
    case 'sprintWin': run([392, 523, 659, 880, 1047], 0.05, 0.06, 0.12); break;

    // LIGHTNING — electric
    case 'lightningGain':
      noise({ dur: 0.05, gain: 0.07, cutoff: 4000, filter: 'highpass' });
      note(400, 0.12, 0, 0.11, { f2: 1100 });
      break;
    case 'lightningTimeout':
      note(500, 0.3, 0, 0.12, { f2: 70 });
      noise({ dur: 0.3, gain: 0.06, cutoff: 1200 });
      break;

    // INTUITION — soft shimmer
    case 'intuitionReveal': note(1175, 0.14, 0, 0.09, { duty: 0.25 }); break;
  }
}

const SOUND_COOLDOWNS: Partial<Record<GameSound, number>> = {
  playerJoin: 150,
  playerLeave: 150,
  timerTick: 100,
  wordAccepted: 65,
  wordRejected: 100,
  scorePenalty: 100,
  bomb: 300,
  bombSelf: 300,
  intuitionReveal: 120
};

export function playGameSound(sound: GameSound): void {
  if (!preferences.enabled || preferences.volume <= 0 || !hasUnlocked || !context || context.state !== 'running') return;
  const now = performance.now();
  const cooldown = SOUND_COOLDOWNS[sound] ?? 180;
  if (now - (lastPlayedAt.get(sound) ?? -Infinity) < cooldown) return;
  lastPlayedAt.set(sound, now);
  try {
    render(sound);
  } catch {
    // Audio is progressive enhancement and must never interrupt the game.
  }
}

export async function previewGameSound(sound: GameSound): Promise<void> {
  await unlockGameAudio();
  stopGameAudio();
  playGameSound(sound);
}

export function stopGameAudio(): void {
  for (const source of activeSources) {
    try { source.stop(); } catch { /* It may already have ended. */ }
  }
  activeSources.clear();
  lastPlayedAt.clear();
}

/**
 * Release audio activity when leaving a room without destroying the shared
 * singleton. The next user gesture re-runs unlockGameAudio and resumes it.
 */
export function suspendGameAudio(): void {
  stopGameAudio();
  if (context && context.state === 'running') {
    hasUnlocked = false;
    void context.suspend().catch(() => { /* Suspension is best-effort. */ });
  }
}

export function classifyAcceptedSound(message: string, lightning: boolean): GameSound {
  if (message.includes('Bingo board complete')) return 'bingoComplete';
  if (message.includes('Bingo task complete')) return 'bingoTask';
  if (message.includes('Rare unique word')) return 'rareWord';
  if (message.includes('Common word')) return 'commonCollision';
  if (lightning) return 'lightningGain';
  return 'wordAccepted';
}

export function classifyRejectedSound(message: string, penalty?: number): GameSound {
  if (message.includes('already made by someone else')) return 'claimRejected';
  if (penalty && penalty < 0) return 'scorePenalty';
  return 'wordRejected';
}

export function classifyNoticeSound(message: string): GameSound | undefined {
  if (message.startsWith('Common word:')) return 'commonCollision';
  if (message.includes('eliminated from Knockout')) return 'elimination';
  if (message.includes('reached') && message.includes('first') && (message.includes('sprint bonus') || message.includes('point bonus'))) return 'sprintWin';
  return undefined;
}
