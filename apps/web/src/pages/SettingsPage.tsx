import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GameSettings } from '@wow/shared';
import socket from '../services/socket';
import { loadUsername } from '../services/session';
import { Alert, Button, Dialog, Label, Select, Textarea } from '../components/ui';

const DEFAULT_SETTINGS: GameSettings = {
  minWordLength: 7,
  timePerRound: 30,
  rounds: 5,
  maxPlayers: 4,
  gameMode: 'classic',
  fastestWordTarget: 5,
  eliminationsPerRound: 1,
  wordCategory: 'general',
  customWordList: ''
};

const GAME_MODE_INFO: Array<{ value: GameSettings['gameMode']; label: string; description: string }> = [
  { value: 'classic', label: 'Classic', description: 'Standard rules: every accepted word gives 3 points.' },
  { value: 'arcade', label: 'Score Attack', description: 'Reward bigger finds: every word gives 3 points plus bonus points equal to word length.' },
  { value: 'precision', label: 'Precision', description: 'Accepted words score 3 plus word length, wrong words lose 3 plus word length, and duplicates lose 3 points.' },
  { value: 'teams', label: 'Teams', description: 'Players pick Red or Blue before the game. Team totals and individual scores are both shown.' },
  { value: 'fastestNWords', label: 'Word Sprint', description: 'First player to reach the target word count ends the round and earns a 10 point bonus.' },
  { value: 'battleRoyale', label: 'Knockout', description: 'Lowest scoring players are eliminated after each round until a winner emerges.' },
  { value: 'typist', label: 'Blind Type', description: 'Your typed word stays hidden until you submit it.' },
  { value: 'category', label: 'Theme Challenge', description: 'Source words come from the selected theme or your custom list.' },
  { value: 'oneWordForAll', label: 'Claim Mode', description: 'Once any player claims a word, no one else can use it.' }
];

export default function SettingsPage(): JSX.Element {
  const navigate = useNavigate();
  const username = loadUsername();
  const [settings, setSettings] = useState<GameSettings>(DEFAULT_SETTINGS);
  const [error, setError] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [infoMode, setInfoMode] = useState<(typeof GAME_MODE_INFO)[number] | undefined>();
  const battleRoyaleWarning = settings.gameMode === 'battleRoyale' && settings.eliminationsPerRound * settings.rounds >= settings.maxPlayers
    ? 'Knockout would finish before all rounds are played. Lower eliminations, lower rounds, or increase max players.'
    : '';

  if (!username) {
    return (
      <main className="page-shell">
        <section className="panel-card">
          <p className="eyebrow">Hold on</p>
          <h1>Name required</h1>
          <p className="muted">Choose a player name before creating a room.</p>
          <Button variant="primary" onClick={() => navigate('/')}>Go Home</Button>
        </section>
      </main>
    );
  }

  function createRoom(): void {
    if (battleRoyaleWarning) {
      setError(battleRoyaleWarning);
      return;
    }

    setIsCreating(true);
    setError('');
    socket.emit('createRoom', { username, settings }, (response) => {
      setIsCreating(false);
      if (!response.ok) { setError(response.error); return; }
      navigate(`/room/${response.data.roomId}`);
    });
  }

  function set<K extends keyof GameSettings>(key: K, value: GameSettings[K]): void {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <main className="page-shell">
      <section className="panel-card">
        <p className="eyebrow">configure the drop</p>
        <h1>Game Settings</h1>
        <p className="muted">Set the rules before the battle starts.</p>

        <div className="settings-grid">
          <div className="setting-group">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <Label htmlFor="game-mode">Game mode</Label>
              <button
                type="button"
                onClick={() => setInfoMode(GAME_MODE_INFO.find((mode) => mode.value === settings.gameMode))}
                title="About selected game mode"
                aria-label="About selected game mode"
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: '999px',
                  border: '1px solid var(--sub-2)',
                  background: 'var(--main-10)',
                  color: 'var(--main)',
                  font: 'inherit',
                  fontWeight: 800,
                  cursor: 'pointer',
                  lineHeight: 1
                }}
              >
                i
              </button>
            </div>
            <Select
              id="game-mode"
              value={settings.gameMode}
              onChange={(e) => set('gameMode', e.currentTarget.value as GameSettings['gameMode'])}
            >
              <option value="classic">Classic</option>
              <option value="arcade">Score Attack</option>
              <option value="precision">Precision</option>
              <option value="teams">Teams</option>
              <option value="fastestNWords">Word Sprint</option>
              <option value="battleRoyale">Knockout</option>
              <option value="typist">Blind Type</option>
              <option value="category">Theme Challenge</option>
              <option value="oneWordForAll">Claim Mode</option>
            </Select>
          </div>

          {settings.gameMode === 'fastestNWords' && (
            <div className="setting-group">
              <Label htmlFor="fastest-target">Words to win</Label>
              <Select
                id="fastest-target"
                value={settings.fastestWordTarget}
                onChange={(e) => set('fastestWordTarget', Number(e.currentTarget.value))}
              >
                {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <option key={n} value={n}>First {n} words</option>
                ))}
              </Select>
            </div>
          )}

          {settings.gameMode === 'battleRoyale' && (
            <div className="setting-group">
              <Label htmlFor="eliminations">Eliminations per round</Label>
              <Select
                id="eliminations"
                value={settings.eliminationsPerRound}
                onChange={(e) => set('eliminationsPerRound', Number(e.currentTarget.value))}
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>{n} player{n !== 1 ? 's' : ''}</option>
                ))}
              </Select>
            </div>
          )}

          {settings.gameMode === 'category' && (
            <>
              <div className="setting-group">
                <Label htmlFor="word-category">Source word category</Label>
                <Select
                  id="word-category"
                  value={settings.wordCategory}
                  onChange={(e) => set('wordCategory', e.currentTarget.value as GameSettings['wordCategory'])}
                >
                  <option value="general">General dictionary</option>
                  <option value="genz">Gen Z</option>
                  <option value="sports">Sports</option>
                  <option value="food">Food</option>
                  <option value="slangs">Slangs</option>
                  <option value="custom">Custom word list</option>
                  <option value="vehicles">Vehicle names</option>
                  <option value="technology">Technology</option>
                  <option value="finance">Finances</option>
                  <option value="medical">Medical</option>
                </Select>
              </div>

              {settings.wordCategory === 'custom' && (
                <div className="setting-group">
                  <Label htmlFor="custom-words">Custom source words</Label>
                  <Textarea
                    id="custom-words"
                    value={settings.customWordList}
                    onChange={(e) => set('customWordList', e.currentTarget.value)}
                    placeholder="Comma or line separated source words"
                    rows={4}
                  />
                </div>
              )}
            </>
          )}

          <div className="setting-group">
            <Label htmlFor="max-players">Max players</Label>
            <Select
              id="max-players"
              value={settings.maxPlayers}
              onChange={(e) => set('maxPlayers', Number(e.currentTarget.value))}
            >
              {[2, 3, 4, 5, 6, 8, 10, 15, 20, 30, 40, 50].map((n) => (
                <option key={n} value={n}>{n} players</option>
              ))}
            </Select>
          </div>

          <div className="setting-group">
            <Label htmlFor="time-per-round">Time per round</Label>
            <Select
              id="time-per-round"
              value={settings.timePerRound}
              onChange={(e) => set('timePerRound', Number(e.currentTarget.value))}
            >
              {[5, 20, 30, 40, 50, 60, 90, 120].map((s) => (
                <option key={s} value={s}>{s} seconds</option>
              ))}
            </Select>
          </div>

          <div className="setting-group">
            <Label htmlFor="word-length">Source word length</Label>
            <Select
              id="word-length"
              value={settings.minWordLength}
              onChange={(e) => set('minWordLength', Number(e.currentTarget.value))}
            >
              {[7, 8, 9, 10, 11, 12, 13].map((n) => (
                <option key={n} value={n}>{n}+ letters</option>
              ))}
            </Select>
          </div>

          <div className="setting-group">
            <Label htmlFor="rounds">Number of rounds</Label>
            <Select
              id="rounds"
              value={settings.rounds}
              onChange={(e) => set('rounds', Number(e.currentTarget.value))}
            >
              {[2, 3, 4, 5, 6, 8, 10].map((n) => (
                <option key={n} value={n}>{n} rounds</option>
              ))}
            </Select>
          </div>
        </div>

        {battleRoyaleWarning && <Alert variant="warning" style={{ marginBottom: 16 }}>{battleRoyaleWarning}</Alert>}
        {error && <Alert variant="error" style={{ marginBottom: 16 }}>{error}</Alert>}

        <div className="button-row">
          <Button variant="secondary" onClick={() => navigate('/')}>← Back</Button>
          <Button variant="primary" onClick={createRoom} isLoading={isCreating}>
            {isCreating ? 'Creating…' : 'Create Room →'}
          </Button>
        </div>
      </section>

      <Dialog open={Boolean(infoMode)} onClose={() => setInfoMode(undefined)} size="sm">
        <p className="eyebrow">game mode info</p>
        <h1 style={{ fontSize: 'clamp(1.8rem,5vw,2.6rem)', lineHeight: 0.94, marginBottom: 16 }}>
          {infoMode?.label}
        </h1>
        <p className="muted" style={{ lineHeight: 1.8, marginBottom: 20 }}>
          {infoMode?.description}
        </p>
        <Button variant="secondary" fullWidth onClick={() => setInfoMode(undefined)}>Got it</Button>
      </Dialog>
    </main>
  );
}
