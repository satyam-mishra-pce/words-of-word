import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
  customWordList: '',
  mixScoringMode: 'classic',
  mixModifiers: {
    teams: false,
    wordSprint: false,
    blind: false,
    claim: false,
    busted: false,
    intuition: false,
    lightning: false
  }
};

const GAME_MODE_INFO: Array<{ value: GameSettings['gameMode']; label: string; description: string }> = [
  { value: 'classic', label: 'Classic', description: 'Standard rules: every accepted word gives 3 points.' },
  { value: 'arcade', label: 'Score Attack', description: 'Reward bigger finds: every word gives 3 points plus bonus points equal to word length.' },
  { value: 'precision', label: 'Precision', description: 'Accepted words score 3 plus word length, wrong words lose 3 plus word length, and duplicates lose 3 points.' },
  { value: 'teams', label: 'Teams', description: 'Players pick Red or Blue before the game. Team totals and individual scores are both shown.' },
  { value: 'betting', label: 'Betting', description: 'Before each round, bet how many words you will make. Hit it for big points, miss it and lose the stake.' },
  { value: 'fastestNWords', label: 'Word Sprint', description: 'First player to reach the target word count ends the round and earns a 10 point bonus.' },
  { value: 'battleRoyale', label: 'Knockout', description: 'Lowest scoring players are eliminated after each round until a winner emerges.' },
  { value: 'typist', label: 'Blind Type', description: 'Your typed word stays hidden until you submit it.' },
  { value: 'category', label: 'Theme Challenge', description: 'Source words come from the selected theme or your custom list.' },
  { value: 'oneWordForAll', label: 'Claim Mode', description: 'Once any player claims a word, no one else can use it.' },
  { value: 'busted', label: 'Busted Mode', description: 'Each player’s first word becomes their bust word. Type another player’s bust word and your round score explodes to 0. Matching first words are safe.' },
  { value: 'commonWord', label: 'Common Word', description: 'Unique words score +3, rare unique words with 5+ letters score +5. If two or more players make the same word, everyone who used it gets -3 for that word.' },
  { value: 'intuition', label: 'Intuition Mode', description: 'The source word starts hidden and unlocks one random letter at a time over the round. You can guess words from the hidden letters before they appear.' },
  { value: 'lightning', label: 'Lightning Mode', description: 'You start with 10 seconds. Every valid word adds 1 second. If it hits zero, the round is dead.' },
  { value: 'bingo', label: 'Bingo Board', description: 'Everyone gets the same 7 hard tasks from a bigger pool: Pictureka-style word hunts plus rare letters, lengths, exact positions, edge letters, vowel traps, and pattern challenges. Every task is validated to be possible without using the source word itself. Each task gives 10 points; one word can complete multiple matching tasks. Complete all 7 for a 100 point bonus, then every extra valid word scores 3 points.' },
  { value: 'mix', label: 'Mix Mode', description: 'Choose Classic or Score Attack scoring, then stack compatible modifiers: Teams, Word Sprint, Blind Type, Claim, Busted, Intuition, and Lightning.' }
];

export default function SettingsPage(): JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isOnlineRoom = searchParams.get('online') === '1';
  const username = loadUsername();
  const [settings, setSettings] = useState<GameSettings>(DEFAULT_SETTINGS);
  const [error, setError] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [infoMode, setInfoMode] = useState<(typeof GAME_MODE_INFO)[number] | undefined>();
  const battleRoyaleWarning = settings.gameMode === 'battleRoyale' && settings.eliminationsPerRound * settings.rounds >= settings.maxPlayers
    ? 'Knockout would finish before all rounds are played. Lower eliminations, lower rounds, or increase max players.'
    : '';
  const usesWordSprint = settings.gameMode === 'fastestNWords' || (settings.gameMode === 'mix' && settings.mixModifiers.wordSprint);
  const usesLightning = settings.gameMode === 'lightning' || (settings.gameMode === 'mix' && settings.mixModifiers.lightning);

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

    let settled = false;
    const timeout = window.setTimeout(() => {
      settled = true;
      setIsCreating(false);
      setError('Could not reach the game server. Make sure the local server is running on port 4000, then try again.');
    }, 8000);

    socket.emit('createRoom', { username, settings, isPublic: isOnlineRoom }, (response) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      setIsCreating(false);
      if (!response.ok) { setError(response.error); return; }
      navigate(`/room/${response.data.roomId}`);
    });
  }

  function set<K extends keyof GameSettings>(key: K, value: GameSettings[K]): void {
    setSettings((prev) => ({
      ...prev,
      [key]: value,
      ...(key === 'gameMode' && value === 'lightning' ? { timePerRound: 10 } : {})
    }));
  }

  function setMixModifier(key: keyof GameSettings['mixModifiers'], value: boolean): void {
    setSettings((prev) => ({
      ...prev,
      timePerRound: key === 'lightning' && value ? 10 : prev.timePerRound,
      mixModifiers: {
        ...prev.mixModifiers,
        [key]: value
      }
    }));
  }

  return (
    <main className="page-shell">
      <section className="panel-card">
        <p className="eyebrow">configure the drop</p>
        <h1>{isOnlineRoom ? 'Create Online Room' : 'Game Settings'}</h1>
        <p className="muted">{isOnlineRoom ? 'Create a public room with your own settings. Other online players can find and join it.' : 'Set the rules before the battle starts.'}</p>

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
              <option value="betting">Betting</option>
              <option value="fastestNWords">Word Sprint</option>
              <option value="battleRoyale">Knockout</option>
              <option value="typist">Blind Type</option>
              <option value="category">Theme Challenge</option>
              <option value="oneWordForAll">Claim Mode</option>
              <option value="busted">Busted Mode</option>
              <option value="commonWord">Common Word</option>
              <option value="intuition">Intuition Mode</option>
              <option value="lightning">Lightning Mode</option>
              <option value="bingo">Bingo Board</option>
              <option value="mix">Mix Mode</option>
            </Select>
          </div>

          {settings.gameMode === 'mix' && (
            <>
              <div className="setting-group">
                <Label htmlFor="mix-scoring">Mix scoring</Label>
                <Select
                  id="mix-scoring"
                  value={settings.mixScoringMode}
                  onChange={(e) => set('mixScoringMode', e.currentTarget.value as GameSettings['mixScoringMode'])}
                >
                  <option value="classic">Classic</option>
                  <option value="arcade">Score Attack</option>
                </Select>
              </div>

              <div className="setting-group" style={{ gridColumn: '1 / -1' }}>
                <Label>Mix modifiers</Label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
                  {([
                    ['teams', 'Teams'],
                    ['wordSprint', 'Word Sprint'],
                    ['blind', 'Blind'],
                    ['claim', 'Claim'],
                    ['busted', 'Busted'],
                    ['intuition', 'Intuition'],
                    ['lightning', 'Lightning']
                  ] as const).map(([key, label]) => (
                    <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text)' }}>
                      <input
                        type="checkbox"
                        checked={settings.mixModifiers[key]}
                        onChange={(e) => setMixModifier(key, e.currentTarget.checked)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}

          {usesWordSprint && (
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
              value={usesLightning ? 10 : settings.timePerRound}
              onChange={(e) => set('timePerRound', Number(e.currentTarget.value))}
              disabled={usesLightning}
            >
              {[5, 10, 20, 30, 40, 50, 60, 90, 120].map((s) => (
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
            {isCreating ? 'Creating…' : isOnlineRoom ? 'Create Online Room →' : 'Create Room →'}
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
