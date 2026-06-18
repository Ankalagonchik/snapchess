# SnapChess Agent Notes

## Product Summary

SnapChess is a Hive-native chess web app built for the `snapie.io` ecosystem.

Core product features currently implemented:

- Hive Keychain login
- Lobby with rated and casual games
- Time controls
- Optional HIVE stake matches
- Rating and leaderboard system
- Player profile pages
- Vercel deployment with Supabase-backed persistent app state

## Tech Stack

- Next.js 14 App Router
- React 18
- TypeScript
- `react-chessboard`
- `chess.js`
- `@hiveio/dhive`
- `@supabase/supabase-js`

## Current Data Model

Persistent state is stored as a single JSON blob in Supabase table `snapchess_state`.

Top-level state includes:

- `games`
- `players`
- `challenges`

Important game fields:

- rated/casual mode
- stake amount and settlement status
- move history
- FEN/PGN
- clocks
- result

Important player fields:

- rating
- peak rating
- wins/losses/draws
- HIVE won/lost
- last game time

## Current UX Structure

### Lobby

- Left column: account and create game
- Center: hero and open games
- Right column: my games and leaderboards

### Game Page

- Left column: game summary, table controls, stake controls
- Center: board and result banner
- Right column: player clocks and move list

### Profiles

- `/player/[username]`
- Overview stats, record stats, recent games

## Hive / Stake Notes

- Escrow account is currently configured through `NEXT_PUBLIC_HIVE_ESCROW_ACCOUNT`
- Server-side settlement automation requires `ESCROW_ACTIVE_KEY`
- Stake verification checks Hive transfer history by account, destination, amount, and deterministic memo
- Current fee logic:
  - 4% of total pot
  - minimum 0.002 HIVE
  - fee retained by escrow account

## Deployment Notes

- Production deploy target is Vercel
- Persistent state depends on Supabase env vars:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
- Auth depends on stable `AUTH_SECRET`

## Known Architectural Limitation

The app still stores all state in one JSON blob row instead of normalized tables. This is functional, but not ideal for long-term scale or concurrent write robustness.

If future work touches persistence heavily, prefer migrating to normalized Supabase tables for:

- players
- games
- game events / moves
- auth challenges
- settlements
