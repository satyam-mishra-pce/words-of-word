# Render Free tournament capacity

This project now includes a **local-only** Render Free approximation. It runs the
production build in Docker with the documented allocation:

- **0.1 CPU** (`--cpus=0.1`)
- **512 MiB RAM** (`--memory=512m --memory-swap=512m`)
- Node **22.23.0**
- disposable container filesystem

It refuses non-loopback targets, so it cannot load production.

## Measured Knockout result

**Test profile**

- Knockout (`battleRoyale`), 50 players per room
- 5 rounds × 10 seconds, 1 elimination per round
- Each active player submits 5 valid words at a synchronized 1-second cadence
- Current-client compact score protocol with 50 ms batched score updates
- Old installed/mobile clients remain compatible but receive legacy full score snapshots; do not mix many of them into this capacity result without re-testing
- Passing criteria: 100% valid words accepted, no unexpected disconnects,
  score-update delivery >=99%, `wordAccepted` p95 <=1 second, health p95 <=3 seconds

| Concurrent rooms | Players | Outcome | Evidence |
| ---: | ---: | --- | --- |
| 6 × 50 | **300** | **Repeated pass** | 7,200 valid submissions/run, 100% accepted, `wordAccepted` p95: 316–744 ms, peak RSS: 176–181 MiB, zero disconnects. |
| 7 × 50 | 350 | **Variable** | Two sustained runs passed (p95 843/850 ms); one failed (p95 1,447 ms). |
| 8 × 50 | 400 | **Variable** | Two sustained runs missed the 1-second p95 (1,044/1,248 ms); a later run passed at 846 ms. |
| 10 × 50 | 500 | **One passing observation** | 12,000 valid submissions, 100% accepted, p95 851 ms, zero disconnects. It has not been repeated enough to certify. |

### Recommended event cap

Use **300 simultaneous players / 6 full rooms** as the local Render-Free
operational cap for this workload. It is the largest level repeatedly verified
with margin; keep a meaningful margin below it if the venue network, client
devices, or game settings add load.

The production schema permits a **single room of up to 60 players**, but this
capacity result is only verified for 50-player rooms; configure tournament
rooms at 50 until a 60-player cell passes repeatedly. There is no documented
Render Free numeric WebSocket connection cap, so 300 is an application/SLO
result, not a platform-guaranteed socket maximum. Shared/free CPU scheduling
also means there is no honest single “exact maximum” above the verified level:
350–400 was unstable across repetitions.

## Why the test found bottlenecks

The first constrained run exposed two synchronous fanout bottlenecks:

1. Every round rebuilt the valid-word set by allocating a `Map` for every
   dictionary word. On the 0.1-CPU container, even a two-player game blocked
   round start for 6–9 seconds.
2. Every accepted word broadcast a full `RoomSnapshot` to every player. A
   50-player score update was about 23 KB and was sent 50 times per accepted
   word.

The worktree changes address both without changing scoring rules:

- the dictionary is indexed once at boot and queried per round;
- score updates contain only changed scores and are batched for 50 ms;
- mode-specific score state is sent only when needed;
- current clients negotiate the compact score protocol, while older installed
  browser/Capacitor clients still receive the legacy full-snapshot event.

In the 50-player burst cell, the score-update payload dropped from about
23 KB to 1.4 KB (and 39 bytes for a one-player score delta). Round-start p95
dropped below 500 ms in the constrained container.

## Re-run a capacity cell

Start Colima/Docker first, then run from the repository root:

```bash
GAME_MODE=battleRoyale \
ROOMS=6 PLAYERS_PER_ROOM=50 \
ROUND_SECONDS=10 ROUNDS=5 ELIMINATIONS_PER_ROUND=1 \
ACTIONS_PER_PLAYER=5 ACTION_INTERVAL_MS=1000 \
WAIT_FOR_GAME_OVER=1 \
CONNECT_CONCURRENCY=50 SETUP_CONCURRENCY=50 \
pnpm test:render-free:cell
```

The report is written under `logs/` and includes action/event latency,
per-client score-update delivery, acknowledgements, health samples, Docker
CPU/RSS samples, disconnects, and the terminal container state (including
`OOMKilled`). The harness defaults to at most 500 virtual players; raising
`MAX_LOCAL_PLAYERS` is explicit because a 1,000-client connection ramp crashed
the local Colima/Docker daemon and was therefore inconclusive.

To inspect an exact boundary repeatedly:

```bash
SKIP_IMAGE_BUILD=1 \
SWEEP_VARIABLE=rooms SWEEP_LEVELS=6,7,8 REPEATS=3 \
GAME_MODE=battleRoyale PLAYERS_PER_ROOM=50 \
ROUND_SECONDS=10 ROUNDS=5 ELIMINATIONS_PER_ROUND=1 \
ACTIONS_PER_PLAYER=5 ACTION_INTERVAL_MS=1000 \
WAIT_FOR_GAME_OVER=1 CONNECT_CONCURRENCY=50 SETUP_CONCURRENCY=50 \
pnpm test:render-free:sweep
```

`SYNCHRONIZE_ROOM_ACTIONS=1` is useful for a one-round worst-case burst test.
It intentionally waits until all rooms are live and then submits concurrently.

## What this does not emulate exactly

The limits above are a controlled approximation, not a claim of identical
Render hardware. The harness enforces CPU, memory, production Node version,
and disposable runtime storage; it does **not** automatically emulate the
15-minute idle shutdown or a 100-second proxy timeout. Render documents the
CPU allocation and memory ceiling but not its CPU generation, scheduler
behavior, socket cap, or bandwidth cap. The local container runs Linux/ARM
under Colima, while Render's physical host may differ. Repeat the small,
bounded production test during an approved window before the event.

Also plan for these documented Free-plan realities:

- the service spins down after 15 minutes without inbound traffic;
- startup can take about a minute after spin-down;
- the filesystem is ephemeral and Free services do not support persistent
  disks;
- all rooms, reconnect sessions, and tournament state are process-local in
  this app, so a restart/deploy loses an active tournament.

There is no separate tournament/bracket persistence feature in the code today;
`battleRoyale` is the single-room Knockout mode.
