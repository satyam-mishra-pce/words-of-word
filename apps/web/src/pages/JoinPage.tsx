import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { RoomSnapshot } from '@wow/shared';
import socket from '../services/socket';
import { loadUsername, saveUsername } from '../services/session';
import { Alert, Button, Input, Label } from '../components/ui';

export default function JoinPage(): JSX.Element {
  const params = useParams();
  const navigate = useNavigate();
  const [roomCode, setRoomCode] = useState(params.roomId ?? '');
  const [username, setUsername] = useState(loadUsername());
  const [roomSnapshot, setRoomSnapshot] = useState<RoomSnapshot | undefined>();
  const [error, setError] = useState('');
  const [isJoining, setIsJoining] = useState(false);

  useEffect(() => {
    if (!params.roomId) return;

    socket.emit('checkRoom', { roomId: params.roomId }, (response) => {
      if (!response.ok) { setError(response.error); return; }
      if (!response.data.exists || !response.data.snapshot) {
        setRoomSnapshot(undefined);
        setError('Room not found.');
        return;
      }
      setRoomSnapshot(response.data.snapshot);
      setError('');
    });
  }, [params.roomId]);

  function joinRoom(): void {
    const trimmedUsername = username.trim();
    const trimmedRoomCode = roomCode.trim().toUpperCase();

    if (!trimmedUsername) { setError('Please enter a username.'); return; }
    if (!trimmedRoomCode) { setError('Please enter a room code.'); return; }

    setIsJoining(true);
    setError('');
    saveUsername(trimmedUsername);

    socket.emit('joinRoom', { roomId: trimmedRoomCode, username: trimmedUsername }, (response) => {
      setIsJoining(false);
      if (!response.ok) { setError(response.error); return; }
      navigate(`/room/${response.data.snapshot.roomId}`);
    });
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    joinRoom();
  }

  return (
    <main className="page-shell">
      <section className="panel-card">
        <p className="eyebrow">drop into the session</p>
        <h1>{params.roomId ? 'Join Room' : 'Join Existing Game'}</h1>

        {roomSnapshot && (
          <div className="room-preview">
            <strong>Room {roomSnapshot.roomId}</strong>
            <span>{roomSnapshot.status.message}</span>
            <span>{roomSnapshot.phase === 'lobby' ? 'Waiting in lobby' : 'Game in progress'}</span>
          </div>
        )}

        <form className="entry-panel" style={{ marginTop: 18 }} onSubmit={submit}>
          <div>
            <Label htmlFor="join-username">Username</Label>
            <Input
              id="join-username"
              value={username}
              onChange={(e) => setUsername(e.currentTarget.value)}
              placeholder="Your player name"
              maxLength={20}
            />
          </div>

          <div>
            <Label htmlFor="room-code">Room code</Label>
            <Input
              id="room-code"
              value={roomCode}
              onChange={(e) => setRoomCode(e.currentTarget.value.toUpperCase())}
              placeholder="ABC123"
              maxLength={16}
              disabled={Boolean(params.roomId)}
            />
          </div>

          {error && <Alert variant="error">{error}</Alert>}

          <div className="button-row" style={{ marginTop: 4 }}>
            <Button variant="secondary" type="button" onClick={() => navigate('/')}>
              ← Back
            </Button>
            <Button variant="primary" type="submit" isLoading={isJoining}>
              {isJoining ? 'Joining…' : 'Join Room'}
            </Button>
          </div>
        </form>
      </section>
    </main>
  );
}
