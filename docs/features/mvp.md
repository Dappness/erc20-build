# ERC20.Build MVP Spec

## Overview

ERC20.Build is an open-source 1-click-deploy ERC20 token builder. A user visits erc20.build, clicks "Deploy to Vercel", and gets their own instance of a Next.js app. That app presents a form to configure and deploy an ERC20 token, then morphs into a live dashboard tracking the token's transfers, holders, and metadata.

**Two deliverables in this repo:**

1. **Marketing site** (`apps/web`) — the public face at erc20.build. Landing page with value prop, "Deploy to Vercel" button, docs, and project info.
2. **Template app** (`apps/template`) — the deployable Next.js app. This is what gets cloned to the user's Vercel account.

### Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Tokens per instance | **Single token** | One deploy = one token. Simpler UX, cleaner data model. |
| Chain support | **All major L2s + Mainnet** | Base, Arbitrum, Optimism, Polygon, Ethereum |
| RPC provider | **User-provided RPC URL** | Generic `RPC_URL` env var. Provider-agnostic — works with Alchemy, Infura, QuickNode, or any RPC endpoint. |
| Indexing strategy | **Lazy sync + DB cache** | No external indexer. Fetch events via `eth_getLogs` on page load and via Vercel Cron, cache in Neon DB. |
| Contract deployment | **Direct bytecode deploy** | Pre-compiled OpenZeppelin ERC20 bytecode, deployed from user's wallet via viem. |
| Wallet stack | **wagmi v2 + viem + AppKit (Reown)** | Cross-chain wallet kit with embedded wallets and social login support. |

---

## Architecture

### Monorepo Structure

```
erc20-build/
├── apps/
│   ├── web/                  # Marketing site (erc20.build)
│   └── template/             # Deployable token builder app
├── packages/
│   ├── contracts/            # Solidity source, compiled ABI + bytecode
│   ├── db/                   # Drizzle schema + Neon connection
│   └── shared/               # Shared types and utilities
├── docs/
│   └── features/mvp.md       # This spec
```

### Template App Flow

```
┌─────────────────────────────────────────────────────┐
│  User visits erc20.build                            │
│  Clicks "Deploy to Vercel"                          │
│  Vercel clones repo, provisions Neon DB             │
│  User provides: RPC_URL,                             │
│                 NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID  │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│  SETUP MODE (no token configured yet)               │
│                                                     │
│  Two paths:                                         │
│                                                     │
│  ┌─ PATH A: Create New Token ────────────────────┐  │
│  │  - Token name, symbol, decimals (default 18)  │  │
│  │  - Initial supply                             │  │
│  │  - Features: mintable, burnable, pausable,    │  │
│  │    capped                                     │  │
│  │  - Owner address (defaults to connected       │  │
│  │    wallet)                                    │  │
│  │  - Chain auto-detected from RPC_URL           │  │
│  │  [Connect Wallet] → [Deploy Token]            │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌─ PATH B: Track Existing Token ────────────────┐  │
│  │  - Paste contract address (0x...)             │  │
│  │  - Chain auto-detected from RPC_URL           │  │
│  │  - App reads name, symbol, decimals,          │  │
│  │    totalSupply on-chain via RPC               │  │
│  │  - Shows preview for confirmation             │  │
│  │  [Confirm] → saves to DB, starts indexing     │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
└──────────────────────┬──────────────────────────────┘
                       │ Token deployed or imported
                       │ Token metadata saved to DB
                       ▼
┌─────────────────────────────────────────────────────┐
│  DASHBOARD MODE (token exists)                      │
│                                                     │
│  Header: name, symbol, chain, contract address      │
│  Overview: total supply, holder count, transfer ct  │
│  Tabs:                                              │
│    Transfers — paginated table of Transfer events   │
│    Holders — top holders with % of supply           │
│    Charts — transfer volume + holder growth         │
│  Actions: add to MetaMask, view on explorer,        │
│           copy address, transfer tokens             │
└─────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Phase 1: Contracts Package

**`packages/contracts/`**

Pre-compile a configurable ERC20 contract using OpenZeppelin v5. The contract supports optional features selected at deploy time via constructor arguments.

**Approach**: We compile multiple contract variants ahead of time (not at runtime). The variants are combinations of features:

| Feature | OpenZeppelin Module | Constructor Arg |
|---|---|---|
| Mintable | `ERC20Mintable` (custom, Ownable-gated `mint`) | — |
| Burnable | `ERC20Burnable` | — |
| Pausable | `ERC20Pausable` + `Ownable` | — |
| Capped | `ERC20Capped` | `cap` (uint256) |
| Permit | `ERC20Permit` (EIP-2612) | — |

**Contract variants**: Rather than compiling all 32 combinations, we compile a single "kitchen sink" contract that includes ALL features, controlled by constructor flags:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract ERC20Token is ERC20, ERC20Burnable, ERC20Pausable, ERC20Permit, ERC20Capped, Ownable {
    bool public mintingEnabled;

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 initialSupply_,
        uint256 cap_,           // 0 = uncapped
        bool mintingEnabled_,
        address owner_
    )
        ERC20(name_, symbol_)
        ERC20Permit(name_)
        ERC20Capped(cap_ > 0 ? cap_ : type(uint256).max)
        Ownable(owner_)
    {
        mintingEnabled = mintingEnabled_;
        _mint(owner_, initialSupply_);
    }

    function mint(address to, uint256 amount) public onlyOwner {
        require(mintingEnabled, "Minting disabled");
        _mint(to, amount);
    }

    function pause() public onlyOwner { _pause(); }
    function unpause() public onlyOwner { _unpause(); }

    // Required overrides
    function _update(address from, address to, uint256 value)
        internal override(ERC20, ERC20Pausable, ERC20Capped) {
        super._update(from, to, value);
    }
}
```

**Build step**: Use `solc` or Hardhat/Foundry to compile this contract. Export the ABI and bytecode as JSON. The template app imports these at build time.

**Files**:
- `packages/contracts/src/ERC20Token.sol` — the Solidity source
- `packages/contracts/artifacts/ERC20Token.json` — compiled ABI + bytecode (committed)
- `packages/contracts/src/index.ts` — exports `{ abi, bytecode }` for use in the app

### Phase 2: Database Schema

**`packages/db/src/schema.ts`**

```typescript
// tokens — one row, the deployed token
tokens: {
  id:             serial primary key
  chain_id:       integer not null
  contract_address: varchar(42) not null
  name:           varchar(255) not null
  symbol:         varchar(32) not null
  decimals:       integer not null default 18
  initial_supply: numeric not null          // stored as string to handle uint256
  cap:            numeric                   // null = uncapped
  minting_enabled: boolean not null default false
  owner_address:  varchar(42) not null
  source:         varchar(10) not null      // 'created' or 'imported'
  deploy_tx_hash: varchar(66)              // null for imported tokens
  deploy_block:   integer not null         // for imported: user-provided or contract creation block
  deployed_at:    timestamp not null default now()
  created_at:     timestamp not null default now()
}

// transfers — cached Transfer events
transfers: {
  id:             serial primary key
  token_id:       integer references tokens(id)
  tx_hash:        varchar(66) not null
  log_index:      integer not null
  block_number:   integer not null
  block_hash:     varchar(66) not null      // stored for reorg audit trail
  block_timestamp: timestamp not null
  from_address:   varchar(42) not null
  to_address:     varchar(42) not null
  value:          numeric not null          // raw uint256 as string
  is_finalized:   boolean not null default false
  created_at:     timestamp not null default now()

  unique(tx_hash, log_index)
}

// sync_state — two-phase indexing cursors
sync_state: {
  id:              serial primary key
  token_id:        integer references tokens(id) unique
  finalized_block: integer not null         // permanent data up to here
  head_block:      integer not null         // ephemeral data up to here
  last_synced_at:  timestamp not null default now()
}

// holders — materialized holder balances (computed from transfers)
holders: {
  id:             serial primary key
  token_id:       integer references tokens(id)
  address:        varchar(42) not null
  balance:        numeric not null default 0
  first_seen_at:  timestamp not null
  last_seen_at:   timestamp not null

  unique(token_id, address)
}
```

**Indexes**:
- `transfers(token_id, block_number)` — for range queries during sync
- `transfers(token_id, is_finalized)` — for wiping unfinalized rows on re-sync
- `transfers(token_id, from_address)` and `transfers(token_id, to_address)` — for address lookups
- `holders(token_id, balance DESC)` — for top holders query

### Phase 3: Indexing Engine

**`apps/template/src/lib/indexer.ts`**

Provider-agnostic lazy sync using `eth_getLogs` via the user's `RPC_URL`. No vendor-specific APIs. All data is fetched with standard Ethereum JSON-RPC calls and cached in the Neon DB.

#### How it works (end-to-end walkthrough)

Here's what happens when an ERC20 transfer occurs and how it reaches the UI:

```
1. Transfer happens on-chain (e.g., Alice sends 100 tokens to Bob)
   └─ Transfer(from=Alice, to=Bob, value=100) event emitted in block 12345

2. Nothing happens immediately — there is no push mechanism.
   The event sits on-chain waiting to be fetched.

3. One of three triggers fires:
   a. USER VISITS DASHBOARD → Next.js server component calls syncToken()
   b. VERCEL CRON fires     → /api/cron/sync calls syncToken()
   c. USER CLICKS REFRESH   → /api/sync calls syncToken()

4. syncToken() runs in a serverless function:
   ┌─────────────────────────────────────────────────────┐
   │  Read sync_state.last_synced_block (e.g., 12300)    │
   │  Fetch current block from RPC (e.g., 12350)         │
   │  Call eth_getLogs for Transfer events:               │
   │    fromBlock: 12301                                  │
   │    toBlock:   12350                                  │
   │    address:   <token contract>                       │
   │    topics:    [Transfer event signature]             │
   │  Parse returned logs → find Alice→Bob transfer      │
   │  INSERT into transfers table (ON CONFLICT SKIP)     │
   │  UPSERT holders: Alice.balance -= 100,              │
   │                   Bob.balance += 100                 │
   │  UPDATE sync_state.last_synced_block = 12350        │
   └─────────────────────────────────────────────────────┘

5. Dashboard renders from DB — transfer now visible in UI.
```

**Latency**: From on-chain event to UI visibility:
- **Instant**: Client-side WebSocket subscription via wagmi detects the Transfer event and optimistically updates the UI (see "Real-time updates" below).
- **Seconds**: On next poll (TanStack Query, ~5s interval) or page load, server-side `syncToken()` fetches the event via `eth_getLogs`, persists to DB, and returns authoritative data.
- **Minutes**: The event's block reaches finality. On next sync cycle, the transfer is promoted to `is_finalized = true` in the DB. Permanent, reorg-proof.

#### Reorg handling

Chain reorgs can invalidate indexed data. The risk varies dramatically by chain:

| Chain | Reorg Risk | Typical Depth | Finality Time |
|---|---|---|---|
| Ethereum | Rare (few/month) | 1 block | ~13 min |
| Base | Near-zero (centralized sequencer) | 0 | ~12-15 min |
| Arbitrum | Near-zero (centralized sequencer) | 0 | ~15-25 min |
| Optimism | Near-zero (centralized sequencer) | 0 | ~12-15 min |
| Polygon PoS | **Frequent** | 1-5 blocks, up to 50-100+ | ~30-45 min |

**Strategy: Two-phase indexing**

We maintain two block pointers per token — a `finalized_block` and a `head_block`:

1. **Finalized data** (permanent): Fetched using the `"finalized"` block tag. Inserted into the `transfers` and `holders` tables as permanent records. Never rolled back.
2. **Unfinalized data** (ephemeral): Fetched between `finalized` and `latest`. Stored with an `is_finalized = false` flag. On each sync cycle, the entire unfinalized window is **wiped and re-fetched** — no reorg detection logic needed.

```
syncToken(tokenId):
  1. Fetch finalized block number via eth_getBlockByNumber("finalized")
  2. If finalized > our sync_state.finalized_block:
     a. Fetch logs from our finalized_block+1 to new finalized block
     b. Insert as permanent (is_finalized = true)
     c. Promote any existing unfinalized rows that are now finalized
     d. Update sync_state.finalized_block
  3. Delete all unfinalized rows for this token
  4. Fetch logs from finalized+1 to "latest"
  5. Insert as unfinalized (is_finalized = false)
  6. Update sync_state.head_block
```

This approach is simple and correct: finalized data is append-only (no rollback), unfinalized data is always fresh (re-fetched each cycle). The unfinalized window is small (a few minutes of blocks) so re-fetching it is cheap.

The dashboard shows all data (finalized + unfinalized) together. We could optionally show a subtle "confirming" indicator on unfinalized transfers, but for MVP this is unnecessary — the data is almost always correct even before finalization.

**Polygon note**: Polygon's finalization is slower (~30-45 min) and its reorgs are deeper, so the unfinalized window is larger. The two-phase approach handles this gracefully — we just re-fetch a bigger window each cycle. No special-casing needed.

#### Real-time updates (client-side subscriptions)

Rather than making Vercel maintain a persistent connection (which it can't do — serverless functions are request-response with max 60s timeouts), we push real-time updates to the **client side** using wagmi's built-in WebSocket subscriptions:

```typescript
// Client component — subscribes directly to the RPC provider via WebSocket
useWatchContractEvent({
  address: tokenAddress,
  abi: erc20Abi,
  eventName: 'Transfer',
  onLogs: (logs) => {
    // Optimistically append new transfers to the UI
    // These are unconfirmed — will be reconciled on next server sync
  },
});
```

This creates a WebSocket connection from the **user's browser** directly to the RPC provider. Vercel is not involved at all — no serverless invocations, no edge functions, no streaming hacks. The connection stays open as long as the browser tab is active.

**RPC URL handling**: Most providers support both HTTP and WSS at the same base URL (e.g., Alchemy's `https://...` becomes `wss://...`). The app derives the WSS URL from `RPC_URL` by swapping the protocol. If the RPC URL doesn't support WebSocket, the client falls back to polling.

**Two-layer real-time architecture**:

```
┌─ CLIENT (browser) ─────────────────────────────────────┐
│                                                         │
│  useWatchContractEvent  ←──WSS──→  RPC Provider         │
│  (live Transfer events, optimistic UI updates)          │
│                                                         │
│  TanStack Query (refetchInterval: 5s)                   │
│  (polls /api/sync for DB-backed state: holder counts,   │
│   aggregated stats, synced transfer history)             │
│                                                         │
└─────────────────────────────────────────────────────────┘
                         │ polls
                         ▼
┌─ VERCEL (serverless) ──────────────────────────────────┐
│  /api/sync → syncToken() → eth_getLogs → Neon DB       │
│  Vercel Cron → /api/cron/sync (background)             │
└─────────────────────────────────────────────────────────┘
```

- **Instant**: New transfers appear in the UI immediately via WebSocket (optimistic, unconfirmed)
- **Seconds**: TanStack Query polls the server, which syncs from RPC → DB and returns authoritative data
- **Minutes**: Finalized data is permanently committed to the DB via the two-phase sync

#### Optimistic state reconciliation

The dashboard merges two data sources: **server state** (DB-backed, from TanStack Query) and **optimistic state** (client-side, from `useWatchContractEvent`). Server state is always authoritative.

```
┌─ useTransfers() hook ──────────────────────────────────┐
│                                                         │
│  serverTransfers = useQuery('/api/transfers')            │
│  [pendingTransfers, setPending] = useState([])           │
│                                                         │
│  useWatchContractEvent({                                 │
│    onLogs: (logs) => {                                   │
│      setPending(prev => [...prev, ...parseLogs(logs)])   │
│    }                                                     │
│  })                                                      │
│                                                         │
│  // When server data refreshes, drop any pending         │
│  // transfers that now exist in the server response      │
│  displayTransfers = deduplicateByTxHashAndLogIndex(      │
│    serverTransfers,                                      │
│    pendingTransfers                                      │
│  )                                                       │
│                                                         │
│  // Pending transfers render with a "confirming" badge   │
│  // Server transfers render normally                     │
└─────────────────────────────────────────────────────────┘
```

**Key behaviors**:

- **No duplicates**: Pending transfers are deduped against server transfers by `txHash + logIndex`. When the server catches up (within ~5s), the pending version is silently replaced by the DB-backed version.
- **Page refresh**: Optimistic state is lost (React state only). `syncToken()` runs on page load, fetches any recent events, and the page renders with complete DB state. The only gap is if the user refreshes within ~1-3s of an on-chain event (before `eth_getLogs` returns it) — the transfer will appear after the sync completes.
- **Tab becomes inactive**: WebSocket disconnects. When the tab refocuses, wagmi reconnects the subscription and TanStack Query refetches, so the user immediately sees current state.
- **WSS not supported**: If the RPC URL doesn't support WebSocket (protocol swap fails), the client falls back to polling-only mode. The UI still updates every ~5s via TanStack Query — just without the instant optimistic layer.

#### Serverless considerations

- **Cold starts**: syncToken() runs in a Vercel serverless function. Cold start adds ~200-500ms, negligible compared to RPC round-trips.
- **Execution time**: Vercel functions have a 10s default / 60s max timeout. A single sync batch (2000 blocks) typically completes in 1-3s. For a young token this is more than enough.
- **Concurrent syncs**: Use a DB advisory lock or `sync_state.last_synced_at` check to prevent duplicate cron + page-load syncs from racing.
- **No persistent connections**: Each function invocation creates a fresh viem client from `RPC_URL`. Neon's serverless driver handles DB connection pooling.

**Trigger points**:
- **On dashboard page load (primary)** — server component calls `syncToken()` before rendering. User always sees up-to-date data.
- **Vercel Cron (background freshness)** — `vercel.json` configures a cron job hitting `/api/cron/sync` every 5 minutes (requires Vercel Pro for <1 day intervals; degrade gracefully on free tier).
- **Manual refresh** — "Refresh" button on dashboard triggers sync via `/api/sync`.

#### RPC configuration

Since each deployed instance targets a single chain, the RPC URL is provided as a single env var. The app detects the chain by calling `eth_chainId` on first run and stores it in the `tokens` table.

Chain metadata stored in `packages/shared/src/chains.ts`:

```typescript
export const chainMeta: Record<number, { name: string; explorer: string; explorerApi: string }> = {
  1:     { name: 'Ethereum',  explorer: 'https://etherscan.io',            explorerApi: 'https://api.etherscan.io/api' },
  8453:  { name: 'Base',      explorer: 'https://basescan.org',            explorerApi: 'https://api.basescan.org/api' },
  42161: { name: 'Arbitrum',  explorer: 'https://arbiscan.io',             explorerApi: 'https://api.arbiscan.io/api' },
  10:    { name: 'Optimism',  explorer: 'https://optimistic.etherscan.io', explorerApi: 'https://api-optimistic.etherscan.io/api' },
  137:   { name: 'Polygon',   explorer: 'https://polygonscan.com',         explorerApi: 'https://api.polygonscan.com/api' },
};
```

### Phase 4: Template App UI

**`apps/template/`** — Next.js 14 App Router

**Pages/Routes**:

| Route | Purpose |
|---|---|
| `/` | Setup form (if no token) OR dashboard (if token exists) |
| `/transfers` | Full transfers table with pagination |
| `/holders` | Full holders table |
| `/api/sync` | POST — trigger manual sync, returns sync status |
| `/api/cron/sync` | GET — Vercel Cron endpoint for background sync |

**Setup Form** (`/` when no token in DB):

Two-tab or toggle UI: **"Create New Token"** / **"Track Existing Token"**

*Create New Token tab:*
- Connect wallet button (AppKit / Reown)
- Chain auto-detected from `RPC_URL` (displayed, not selectable)
- Token name (text input)
- Token symbol (text input, uppercase)
- Initial supply (number input with decimals preview)
- Feature toggles: mintable, burnable, pausable, capped (with cap amount input)
- Deploy button — calls `deployContract` via wagmi, saves result to DB
- Loading state during deployment with tx confirmation

*Track Existing Token tab:*
- Contract address input (0x..., validated as a valid address)
- On paste/blur, the app automatically:
  1. Calls `name()`, `symbol()`, `decimals()`, `totalSupply()` via RPC to verify it's a valid ERC20
  2. Detects the contract's deploy block (see below)
  3. Shows a preview card with token metadata + deploy block for confirmation
- If the contract doesn't implement ERC20 (calls revert), show an error
- Chain auto-detected from `RPC_URL`
- Confirm button — saves token metadata to DB, creates sync_state starting from the detected deploy block

**Deploy block detection** (for imported tokens):

The app automatically detects the deploy block using a two-step fallback chain:

**Step 1 — Block explorer API (fastest, single call):**
All our supported chains have Etherscan-compatible APIs with a `getcontractcreation` endpoint. This returns the creator address and deployment tx hash in one call, from which we get the block number via `eth_getTransactionByHash`. No API key required at low rates.

```
GET https://api.basescan.org/api?module=contract&action=getcontractcreation&contractaddresses={address}
→ { contractCreator: "0x...", txHash: "0x..." }
→ eth_getTransactionByHash(txHash) → blockNumber
```

Explorer API URLs per chain are stored in `chainMeta` alongside the existing explorer URLs.

**Step 2 — Binary search on `eth_getCode` (fallback, ~25 RPC calls):**
If the explorer API is unavailable or rate-limited, fall back to binary search. This works because `eth_getCode(address, blockNumber)` returns `0x` before deployment and real bytecode after:

```
findDeployBlock(address):
  low = 0, high = currentBlock
  while low < high:
    mid = (low + high) / 2
    code = eth_getCode(address, mid)
    if code === '0x':  low = mid + 1
    else:              high = mid
  return low
```

All major RPC providers (Alchemy, Infura, QuickNode) include free archive access on all our supported chains, so historical `eth_getCode` calls work on free tiers. Public RPCs do NOT support this (full nodes only), but we already require a provider RPC URL.

**Step 3 — Manual input (last resort):**
If both methods fail, show a manual input field for the user to paste the deploy block from the block explorer. This should be extremely rare.

**Import considerations**:
- The `tokens` table stores a `source` column: `'created'` or `'imported'` to distinguish the two paths. Imported tokens won't have `deploy_tx_hash` (nullable).
- Deploy block is always known (detected or provided), so indexing never scans from block 0.

**Dashboard** (`/` when token exists in DB):
- **Header card**: Token name, symbol, chain badge, contract address (copy button), deployer address, deploy date
- **Stats row**: Total supply, holder count, total transfers, last synced block
- **Quick actions**: Add to MetaMask, view on block explorer, copy address
- **Recent transfers**: Last 10 transfers with from/to/amount/time
- **Top holders**: Top 10 holders with percentage bar chart
- **Charts** (stretch): Daily transfer volume, holder growth over time

**Tech stack for template app**:
- Next.js 14 App Router
- Tailwind CSS + shadcn/ui components
- wagmi v2 + viem for chain interaction (+ `useWatchContractEvent` for live updates)
- AppKit (Reown) for wallet connection
- TanStack Query for server state + smart polling
- Recharts for charts (lightweight, React-native)
- Drizzle ORM for DB queries

### Phase 5: Marketing Site

**`apps/web/`** — the erc20.build landing page

**Pages**:

| Route | Purpose |
|---|---|
| `/` | Landing page with hero, features, deploy button |
| `/docs` | Basic documentation (how it works, configuration) |

**Landing page sections**:
1. **Hero**: "Deploy your own ERC20 token in 60 seconds" + Deploy to Vercel button
2. **How it works**: 3-step visual (Deploy to Vercel → Configure token → Deploy on-chain)
3. **Features**: Token configuration, multi-chain support, live dashboard, open-source
4. **Supported chains**: Chain logos grid
5. **Open-source callout**: GitHub link, MIT license
6. **Footer**: GitHub, docs, license

---

## Vercel Deploy Configuration

The template app needs a deploy button that:
1. Clones the `apps/template` directory
2. Provisions a Neon Postgres database
3. Prompts for required env vars

**Deploy button URL**:
```
https://vercel.com/new/clone
  ?repository-url=https://github.com/dappness/erc20-build/tree/main/apps/template
  &project-name=my-erc20-token
  &repository-name=my-erc20-token
  &env=RPC_URL,NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
  &envDescription=RPC endpoint for your target chain and WalletConnect project ID — see docs
  &envLink=https://erc20.build/docs/setup
  &products=[{"type":"integration","integrationSlug":"neon","productSlug":"neon","protocol":"storage"}]
```

The `products` parameter triggers Vercel's native Neon integration, which auto-provisions a Postgres database and injects `DATABASE_URL` + `DATABASE_URL_UNPOOLED` into the project env vars automatically. No `integration-ids` needed for this.

**Env vars**:
| Variable | Source | Description |
|---|---|---|
| `DATABASE_URL` | Auto (Neon `products` integration) | Pooled Postgres connection string |
| `DATABASE_URL_UNPOOLED` | Auto (Neon `products` integration) | Direct Postgres connection (for migrations) |
| `RPC_URL` | User provides | JSON-RPC endpoint for target chain (e.g., `https://base-mainnet.g.alchemy.com/v2/xxx`). Provider-agnostic. WSS URL derived automatically for client-side subscriptions (`https://` → `wss://`). |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | User provides | WalletConnect Cloud project ID (from cloud.reown.com) |

**`apps/template/vercel.json`**:
```json
{
  "crons": [
    { "path": "/api/cron/sync", "schedule": "*/5 * * * *" }
  ]
}
```

---

## Edge Cases

1. **Token deploy fails mid-transaction** — Show clear error state. User can retry. No DB row created until tx is confirmed.
2. **RPC rate limits during sync** — Implement exponential backoff. Batch `eth_getLogs` in small block ranges (2000 blocks). Show "syncing..." state on dashboard rather than erroring.
3. **User deploys token on wrong chain** — No undo possible. Chain is determined by `RPC_URL` and displayed clearly before deploy. Wallet must be connected to the matching chain.
4. **Neon DB connection drops** — Standard retry logic via Drizzle/pg driver. Neon serverless driver handles this well.
5. **Large token (millions of transfers)** — Incremental sync stays fast. Initial re-sync from scratch would be slow. Add a "last N transfers" cap on the sync if needed. Stretch: add a "full re-index" background job.
6. **Zero-address transfers (mint/burn)** — Handle `from = 0x0` as mint, `to = 0x0` as burn. Show these distinctly in the transfers table.
7. **Multiple tokens at same address** — Not possible (single-token model), but validate that no token exists in DB before showing the setup form.
8. **Vercel free tier cron limits** — Free tier runs crons once/day. On free tier, rely on lazy sync (sync on page load). Document this limitation.
9. **Imported token is not ERC20** — Validate by calling `name()`, `symbol()`, `decimals()` on the contract. If any call reverts, show an error and block import.
10. **Imported token with massive history** — Deploy block is always detected, so we never scan from block 0. However, a popular token (e.g., USDC) could have millions of transfers since deployment. Mitigate: cap the initial sync to N blocks per serverless invocation (continue on next cron/page load), show an "Indexing... X% complete" progress indicator. For very large tokens, the initial backfill may take multiple sync cycles.

---

## Testing Requirements

1. **Contract compilation** — Verify the Solidity compiles and the ABI/bytecode are valid
2. **Contract deployment** — Deploy to a testnet via the UI, confirm tx succeeds and correct metadata is returned
3. **Indexer** — Deploy a token, do some transfers, verify sync picks up all events and holder balances are correct
3b. **Import flow** — Import an existing ERC20 (e.g., USDC on Base), verify metadata is read correctly and transfers sync from the provided start block
4. **Dashboard rendering** — Verify all data displays correctly after sync
5. **Deploy button** — Test the full Vercel deploy flow with a fresh GitHub account

---

## Scope

### In scope (MVP)
- Single-token ERC20 deployment from browser wallet OR import of existing ERC20 by contract address
- 5 chains: Ethereum, Base, Arbitrum, Optimism, Polygon
- Configurable features: mintable, burnable, pausable, capped supply
- Transfer event indexing via lazy sync + DB cache
- Dashboard: transfers table, holders table, overview stats
- Marketing landing page with deploy button
- Basic docs page

### Out of scope (future)
- Multi-token per instance
- DEX liquidity pool creation / tracking
- Price / market cap data
- Airdrop / multi-send tool
- Token verification on block explorers (link to Etherscan instead)
- Governance features (ERC20Votes)
- Custom token logos / branding
- Mobile-optimized UI (responsive but not mobile-first)
- Server-side WebSocket connections (client-side WSS subscriptions are in scope)
