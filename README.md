# SnapChess

Hive-native chess MVP for the Snapie ecosystem.

## What this project includes

- Hive Keychain login via signed challenge transaction
- Lichess-style core loop: lobby, invites, live board, clocks, move validation
- Optional HIVE stake mode using on-chain transfer verification to an escrow account
- File-based persistence for local development and small demos

## Research summary used for the build

### Snapie / Mantequilla Soft

- `about.snapie.io` positions Snapie as a Hive-native, open-source, community-first social app.
- `Mantequilla-Soft/snapie-io` shows Snapie web uses `Next.js`, `TypeScript`, `@hiveio/dhive`, and Aioha-based wallet/auth flows.
- `Mantequilla-Soft/hivesnaps` shows the mobile app is React Native + Expo with Hive blockchain integrations.

### Hive / Keychain

- Hive provides fast blocks, no gas fees, and human-readable account names.
- Hive Keychain injects `window.hive_keychain` into the browser.
- For this app, login uses a signed `custom_json` challenge transaction and server-side `verifyAuthority` through `@hiveio/dhive`.
- Stake mode uses `requestTransfer` and server-side verification through Hive account history.

### Open-source chess references

- `lichess-org/lila`: full-scale reference for lobby, real-time games, and feature surface.
- `jhlywa/chess.js`: move legality, checkmate/stalemate/draw detection.
- `react-chessboard`: responsive React board with drag-and-drop.
- `lichess-org/chessground`: rich board UI reference, but GPL; this MVP uses MIT/BSD-friendly pieces instead.

## Stack

- Next.js 14
- React 18
- TypeScript
- `react-chessboard`
- `chess.js`
- `@hiveio/dhive`

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Environment variables

Optional:

```bash
AUTH_SECRET=replace-me
HIVE_NODES=https://api.hive.blog,https://api.openhive.network
NEXT_PUBLIC_HIVE_ESCROW_ACCOUNT=snapchess.escrow
```

## Important prototype notes

- State is persisted in `data/snapchess-state.json`.
- Stake confirmation is on-chain, but payout automation is intentionally not included in this MVP.
- For production use, replace file storage with MongoDB/Postgres, add websocket transport, add rate limits, and connect escrow payout logic to a secured backend wallet flow.
