import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { OnlineRoomSummary } from '@wow/shared';
import socket from '../services/socket';
import { loadPlayerAvatar, loadUsername, saveUsername } from '../services/session';
import { trackHotjarEvent, trackRoomJoined } from '../services/hotjar';
import { Alert, Button, Input, Label } from '../components/ui';

const MODE_LABELS: Record<OnlineRoomSummary['gameMode'], string> = {
  classic: 'Classic',
  arcade: 'Score Attack',
  precision: 'Precision',
  teams: 'Teams',
  betting: 'Betting',
  fastestNWords: 'Word Sprint',
  battleRoyale: 'Knockout',
  typist: 'Blind Type',
  category: 'Theme Challenge',
  oneWordForAll: 'Claim Mode',
  busted: 'Busted Mode',
  commonWord: 'Common Word',
  intuition: 'Intuition Mode',
  lightning: 'Lightning Mode',
  bingo: 'Bingo Board',
  mix: 'Mix Mode'
};

const PHASE_LABELS: Record<OnlineRoomSummary['phase'], string> = {
  lobby: 'Waiting',
  betting: 'Betting',
  round: 'In progress',
  betweenRounds: 'Between rounds',
  gameOver: 'Game over'
};

export default function OnlinePage(): JSX.Element {
  const navigate = useNavigate();
  const [username, setUsername] = useState(loadUsername());
  const [rooms, setRooms] = useState<OnlineRoomSummary[]>([]);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [joiningRoomId, setJoiningRoomId] = useState<string | undefined>();

  function loadRooms(): void {
    setIsLoading(true);
    socket.emit('listOnlineRooms', (response) => {
      setIsLoading(false);
      if (!response.ok) { setError(response.error); return; }
      setRooms(response.data.rooms);
      setError('');
    });
  }

  useEffect(() => {
    loadRooms();
    const id = window.setInterval(loadRooms, 3000);
    return () => window.clearInterval(id);
  }, []);

  function requireUsername(): string | undefined {
    const trimmed = username.trim();
    if (!trimmed) { setError('Please enter a username.'); return undefined; }
    saveUsername(trimmed);
    return trimmed;
  }

  function createOnlineRoom(): void {
    if (requireUsername()) navigate('/settings?online=1');
  }

  function joinOnlineRoom(roomId: string): void {
    const trimmed = requireUsername();
    if (!trimmed) return;

    setJoiningRoomId(roomId);
    setError('');
    socket.emit('joinRoom', { roomId, username: trimmed, avatar: loadPlayerAvatar() }, (response) => {
      setJoiningRoomId(undefined);
      if (!response.ok) {
        trackHotjarEvent('room_join_failed');
        setError(response.error);
        loadRooms();
        return;
      }
      trackRoomJoined(
        response.data.snapshot.settings,
        'online',
        response.data.snapshot.phase,
        response.data.snapshot.players.length
      );
      navigate(`/room/${response.data.snapshot.roomId}`);
    });
  }

  return (
    <main className="page-shell">
      <section className="panel-card">
        <p className="eyebrow">public matchmaking</p>
        <h1>Online Multiplayer</h1>
        <p className="muted">Create a public room with custom settings, or join one of the online rooms waiting for players.</p>

        <div className="entry-panel" style={{ marginTop: 18 }}>
          <div>
            <Label htmlFor="online-username">Player name</Label>
            <Input
              id="online-username"
              value={username}
              onChange={(e) => { setUsername(e.currentTarget.value); setError(''); }}
              placeholder="Your player name"
              maxLength={20}
            />
          </div>

          {error && <Alert variant="error">{error}</Alert>}

          <div className="button-row">
            <Button variant="secondary" onClick={() => navigate('/')}>← Back</Button>
            <Button variant="primary" onClick={createOnlineRoom}>Create Online Room</Button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 26, marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Join Online Room</h2>
          <Button variant="ghost" size="sm" onClick={loadRooms} isLoading={isLoading}>Refresh</Button>
        </div>

        {rooms.length === 0 ? (
          <div className="room-preview">
            <strong>No online rooms yet</strong>
            <span>Create one and wait for players to join.</span>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {rooms.map((room) => (
              <div key={room.roomId} className="room-preview" style={{ alignItems: 'stretch' }} data-hj-suppress>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                  <div className="online-room-details">
                    <strong className="online-room-mode">{MODE_LABELS[room.gameMode]}</strong>
                    <span>Host {room.hostName} · Room {room.roomId}</span>
                    <span>
                      {PHASE_LABELS[room.phase]} · {room.currentPlayers}/{room.maxPlayers} players · Round {Math.min(room.currentRound + (room.phase === 'lobby' ? 1 : 0), room.rounds)}/{room.rounds}
                    </span>
                    <span>
                      {room.timePerRound}s · {room.minWordLength}+ letters · late joiners start with 0 score
                    </span>
                  </div>
                  <Button variant="primary" size="sm" onClick={() => joinOnlineRoom(room.roomId)} isLoading={joiningRoomId === room.roomId}>
                    Join
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
