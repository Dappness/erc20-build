# ERC20.Build MVP Spec

## Overview

Open-source 1-click-deploy ERC20 token builder. User visits erc20.build, clicks "Deploy to Vercel", gets their own Next.js app. The app has two modes: **Setup** (configure + deploy a new token OR import an existing one) and **Dashboard** (live transfer/holder tracking).

**Two apps in this repo:**
1. `apps/web` — Marketing site at erc20.build (landing page + docs)
2. `apps/template` — Deployable template app (setup form → dashboard)

### Key Decisions

| Decision | Choice |
|---|---|
| Tokens per instance | Single token per deploy |
| Chains | Ethereum, Base, Arbitrum, Optimism, Polygon |
| RPC | Generic `RPC_URL` env var (provider-agnostic, single chain) |
| Indexing | Two-phase lazy sync via `eth_getLogs`, cached in Neon DB |
| Contract deploy | Pre-compiled OpenZeppelin v5 bytecode, deployed from user's wallet via viem |
| Wallet | wagmi v2 + viem + AppKit (Reown) |
| Real-time | Client-side `useWatchContractEvent` via WSS + TanStack Query polling |

---

## Monorepo Structure

```
apps/web/          — Marketing site
apps/template/     — Deployable token builder
packages/contracts/ — Solidity source, compiled ABI + bytecode
packages/db/       — Drizzle schema + Neon connection
packages/shared/   — Shared types, chain metadata, utilities
```

---

## Phase 1: Contracts (`packages/contracts/`)

Single "kitchen sink" OpenZeppelin v5 ERC20 with all features, toggled by constructor flags. See `packages/contracts/src/ERC20Token.sol` for full source.

**Constructor**: `(name_, symbol_, initialSupply_, cap_, mintingEnabled_, owner_)`
- Inherits: `ERC20, ERC20Burnable, ERC20Pausable, ERC20Permit, ERC20Capped, Ownable`
- `cap_ = 0` means uncapped (uses `type(uint256).max`)
- `mintingEnabled_` gates the `mint()` function
- `pause()`/`unpause()` are always available to owner

**Build**: Compile with solc/Foundry. Export ABI + bytecode as JSON. The template app imports `{ abi, bytecode }` at build time.

---

## Phase 2: Database (`packages/db/`)

### Schema

**tokens** — one row per deployed instance:
`id, chain_id, contract_address, name, symbol, decimals(=18), initial_supply(numeric), cap(nullable), minting_enabled, owner_address, source('created'|'imported'), deploy_tx_hash(nullable), deploy_block, deployed_at, created_at`

**transfers** — cached Transfer events:
`id, token_id(FK), tx_hash, log_index, block_number, block_hash, block_timestamp, from_address, to_address, value(numeric), is_finalized(=false), created_at`
Unique: `(tx_hash, log_index)`

**sync_state** — two-phase indexing cursors:
`id, token_id(FK unique), finalized_block, head_block, last_synced_at`

**holders** — materialized balances (computed from transfers):
`id, token_id(FK), address, balance(numeric=0), first_seen_at, last_seen_at`
Unique: `(token_id, address)`

**Indexes**: `transfers(token_id, block_number)`, `transfers(token_id, is_finalized)`, `transfers(token_id, from_address)`, `transfers(token_id, to_address)`, `holders(token_id, balance DESC)`

### Migrations

- **Dev**: Local Postgres via Docker Compose. `db:generate` → review SQL → `db:migrate` → commit migration files.
- **Production**: Runs during Vercel build step (`"build": "pnpm db:migrate && next build"`). `DATABASE_URL` injected by Neon integration. Drizzle journal tracks applied migrations.
- **CI/Tests**: `pglite` (in-process Postgres, no Docker). Each test suite creates a fresh instance and runs all migrations.

---

## Phase 3: Indexing Engine (`apps/template/src/lib/indexer.ts`)

Provider-agnostic lazy sync using `eth_getLogs` via `RPC_URL`. No vendor-specific APIs.

### Two-phase sync (handles reorgs)

Reorg risk: near-zero on L2s (centralized sequencers), rare on Ethereum (1-block), **frequent on Polygon** (1-5 blocks, up to 100+). Strategy: separate finalized (permanent) from unfinalized (ephemeral) data.

```
syncToken(tokenId):
  1. Fetch finalized block via eth_getBlockByNumber("finalized")
  2. If finalized > sync_state.finalized_block:
     - Fetch logs from finalized_block+1 to new finalized
     - Insert as permanent (is_finalized = true)
     - Promote existing unfinalized rows now covered
     - Update sync_state.finalized_block
  3. Delete all unfinalized rows for this token
  4. Fetch logs from finalized+1 to "latest"
  5. Insert as unfinalized (is_finalized = false)
  6. Update sync_state.head_block
```

Finalized data is append-only (no rollback). Unfinalized data is wiped and re-fetched each cycle (small window, cheap). No reorg detection logic needed.

### Real-time updates (client-side)

Two-layer architecture — no Vercel infrastructure needed for real-time:

1. **Instant**: `useWatchContractEvent` (wagmi) opens WSS connection from browser to RPC provider. New transfers appear immediately as optimistic/pending.
2. **Seconds**: TanStack Query polls `/api/sync` (~5s). Server runs `syncToken()`, returns authoritative DB state.
3. **Minutes**: Block reaches finality, transfer promoted to `is_finalized = true`.

**WSS URL**: Derived from `RPC_URL` by swapping `https://` → `wss://`. Falls back to polling-only if WSS unavailable.

### Optimistic state reconciliation

Dashboard merges server state (TanStack Query) with optimistic state (`useWatchContractEvent`). Server is always authoritative. Dedup by `txHash + logIndex` — when server catches up, pending version silently replaced. Pending transfers render with a "confirming" badge. On page refresh, optimistic state is lost but `syncToken()` runs on load so DB state is always current.

### Trigger points

- **Page load** (primary) — server component calls `syncToken()` before render
- **Vercel Cron** — `/api/cron/sync` every 5 min (Pro) or daily (free tier)
- **Manual refresh** — button triggers `/api/sync`

### Serverless notes

- Cold starts ~200-500ms (negligible vs RPC round-trips)
- 10s default / 60s max timeout — sync batch completes in 1-3s
- DB advisory lock prevents concurrent sync races
- Fresh viem client per invocation from `RPC_URL`

---

## Phase 4: Template App UI (`apps/template/`)

**Tech**: Next.js 14 App Router, Tailwind + shadcn/ui, wagmi v2 + viem, AppKit (Reown), TanStack Query, Recharts, Drizzle ORM

### Routes

| Route | Purpose |
|---|---|
| `/` | Setup form (no token) OR dashboard (token exists) |
| `/transfers` | Full transfers table with pagination |
| `/holders` | Full holders table |
| `/api/sync` | POST — trigger manual sync |
| `/api/cron/sync` | GET — Vercel Cron endpoint |

### Setup Form (two tabs)

**Create New Token**: Connect wallet → name, symbol, initial supply, feature toggles (mintable, burnable, pausable, capped) → Deploy. Chain auto-detected from `RPC_URL`.

**Track Existing Token**: Paste contract address → app calls `name()`, `symbol()`, `decimals()`, `totalSupply()` via RPC + auto-detects deploy block → preview card → Confirm.

**Deploy block detection** (for imports):
1. Etherscan-compatible API `getcontractcreation` (single call, fastest)
2. Binary search on `eth_getCode` (~25 RPC calls, requires archive — free on Alchemy/Infura/QuickNode)
3. Manual input (last resort)

### Dashboard

- **Header**: name, symbol, chain badge, contract address (copy), deployer, deploy date
- **Stats**: total supply, holder count, total transfers, last synced block
- **Actions**: add to MetaMask, view on explorer, copy address
- **Recent transfers**: last 10 with from/to/amount/time
- **Top holders**: top 10 with percentage bar chart
- **Charts** (stretch): daily transfer volume, holder growth

---

## Phase 5: Marketing Site (`apps/web/`)

Landing page sections: Hero ("Deploy your own ERC20 token in 60 seconds" + Vercel deploy button), How it works (3-step), Features, Supported chains, Open-source callout, Footer. Plus a `/docs` page.

---

## Vercel Deploy Configuration

```
https://vercel.com/new/clone
  ?repository-url=https://github.com/dappness/erc20-build/tree/main/apps/template
  &project-name=my-erc20-token
  &repository-name=my-erc20-token
  &env=RPC_URL,NEXT_PUBLIC_REOWN_PROJECT_ID
  &envDescription=RPC endpoint for your target chain and Reown project ID — see docs
  &envLink=https://erc20.build/docs/setup
  &products=[{"type":"integration","integrationSlug":"neon","productSlug":"neon","protocol":"storage"}]
```

`products` auto-provisions Neon DB and injects `DATABASE_URL` + `DATABASE_URL_UNPOOLED`.

| Variable | Source |
|---|---|
| `DATABASE_URL` | Auto (Neon) |
| `DATABASE_URL_UNPOOLED` | Auto (Neon) |
| `RPC_URL` | User provides (WSS derived automatically for client-side subscriptions) |
| `NEXT_PUBLIC_REOWN_PROJECT_ID` | User provides (from cloud.reown.com) |

### Chain metadata (`packages/shared/src/chains.ts`)

```typescript
export const chainMeta: Record<number, { name: string; explorer: string; explorerApi: string }> = {
  1:     { name: 'Ethereum',  explorer: 'https://etherscan.io',            explorerApi: 'https://api.etherscan.io/api' },
  8453:  { name: 'Base',      explorer: 'https://basescan.org',            explorerApi: 'https://api.basescan.org/api' },
  42161: { name: 'Arbitrum',  explorer: 'https://arbiscan.io',             explorerApi: 'https://api.arbiscan.io/api' },
  10:    { name: 'Optimism',  explorer: 'https://optimistic.etherscan.io', explorerApi: 'https://api-optimistic.etherscan.io/api' },
  137:   { name: 'Polygon',   explorer: 'https://polygonscan.com',         explorerApi: 'https://api.polygonscan.com/api' },
};
```

---

## Edge Cases

1. **Token deploy fails** — Clear error, retry allowed. No DB row until tx confirmed.
2. **RPC rate limits** — Exponential backoff, 2000-block batches, "syncing..." UI state.
3. **Wrong chain** — Chain from `RPC_URL` displayed clearly. Wallet must match.
4. **Neon connection drops** — Neon serverless driver handles retries.
5. **Large token (millions of transfers)** — Cap initial sync to N blocks per invocation, continue on next cycle. Show "Indexing X%" progress.
6. **Mint/burn (zero-address)** — `from=0x0` is mint, `to=0x0` is burn. Display distinctly.
7. **Free tier cron** — Once/day. Rely on lazy sync (page load). Document limitation.
8. **Imported non-ERC20** — Validate via `name()`, `symbol()`, `decimals()` calls. Error if reverts.

---

## Testing Requirements

**Every feature must be verified with automated tests. Do not consider a phase complete until tests pass.**

### Infrastructure

- **Vitest** across all packages
- **DB**: `pglite` (in-process Postgres, no Docker). Fresh instance per test suite.
- **EVM**: viem test mode with anvil (in-process local chain). Real EVM, no mocking.
- **UI**: React Testing Library

### Coverage by phase

**Phase 1 (Contracts)**: Deploy on anvil with all constructor variants. Test mint/burn/pause/transfer/access control/cap enforcement.

**Phase 2 (DB)**: Run migrations on pglite. Test inserts, queries, unique constraints, upsert logic.

**Phase 3 (Indexer)**: Deploy ERC20 on anvil + pglite. Execute transfers → run `syncToken()` → verify: all events captured, holder balances correct, sync cursors updated, incremental sync works, two-phase finalization works, idempotent. Unit test `findDeployBlock` and `deduplicateByTxHashAndLogIndex`.

**Phase 4 (UI)**: Component tests for setup form validation (both tabs), dashboard rendering, empty states, API route responses.

**Phase 5 (Marketing)**: Smoke test page renders. Unit test deploy button URL format.

```bash
pnpm turbo test              # All tests
pnpm turbo test:unit         # Fast unit tests only
pnpm turbo test:integration  # DB + anvil tests
```

---

## Scope

**In**: Single-token deploy/import, 5 chains, mintable/burnable/pausable/capped, two-phase indexed transfers + holders, real-time WSS updates, dashboard, marketing site + docs.

**Out**: Multi-token, DEX/liquidity, price data, airdrops, block explorer verification, governance (ERC20Votes), custom branding, mobile-first, server-side WebSocket.
