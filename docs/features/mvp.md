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
│  SETUP MODE (no token deployed yet)                 │
│                                                     │
│  Single-page form:                                  │
│  - Token name, symbol, decimals (default 18)        │
│  - Initial supply                                   │
│  - Features: mintable, burnable, pausable, capped   │
│  - Owner address (defaults to connected wallet)     │
│  - Chain auto-detected from RPC_URL                  │
│                                                     │
│  [Connect Wallet] → [Deploy Token]                  │
└──────────────────────┬──────────────────────────────┘
                       │ Contract deployed on-chain
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
  deploy_tx_hash: varchar(66) not null
  deploy_block:   integer not null
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
  block_timestamp: timestamp not null
  from_address:   varchar(42) not null
  to_address:     varchar(42) not null
  value:          numeric not null          // raw uint256 as string
  created_at:     timestamp not null default now()

  unique(tx_hash, log_index)
}

// sync_state — indexing cursor
sync_state: {
  id:              serial primary key
  token_id:        integer references tokens(id) unique
  last_synced_block: integer not null
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
- **On page load**: ~1-3 seconds (time to run syncToken + render). The user always sees fresh data because sync runs before render.
- **Between visits**: Data is stale until the next page load or cron trigger. Vercel Cron (every 5 min on Pro, once/day on free) keeps the DB reasonably fresh in the background.
- **Manual refresh**: User clicks refresh button → immediate sync → updated UI.

#### Sync logic

```
syncToken(tokenId):
  1. Read sync_state.last_synced_block for tokenId
  2. If no sync state, start from token.deploy_block
  3. Fetch current block number via eth_blockNumber
  4. If last_synced_block >= current_block, return (already synced)
  5. Fetch Transfer events via eth_getLogs from last_synced_block+1 to current_block
     - Batch in chunks of 2000 blocks to stay within RPC provider limits
     - Use exponential backoff on rate limit errors
  6. For each Transfer event:
     a. Fetch block timestamp via eth_getBlockByNumber (batch, cached)
     b. Insert into transfers table (ON CONFLICT DO NOTHING)
     c. Upsert holders: increment to_address balance, decrement from_address balance
  7. Update sync_state.last_synced_block = current_block
```

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
export const chainMeta: Record<number, { name: string; explorer: string }> = {
  1:     { name: 'Ethereum',  explorer: 'https://etherscan.io' },
  8453:  { name: 'Base',      explorer: 'https://basescan.org' },
  42161: { name: 'Arbitrum',  explorer: 'https://arbiscan.io' },
  10:    { name: 'Optimism',  explorer: 'https://optimistic.etherscan.io' },
  137:   { name: 'Polygon',   explorer: 'https://polygonscan.com' },
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
- Connect wallet button (AppKit / Reown)
- Chain auto-detected from `RPC_URL` (displayed, not selectable)
- Token name (text input)
- Token symbol (text input, uppercase)
- Initial supply (number input with decimals preview)
- Feature toggles: mintable, burnable, pausable, capped (with cap amount input)
- Deploy button — calls `deployContract` via wagmi, saves result to DB
- Loading state during deployment with tx confirmation

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
- wagmi v2 + viem for chain interaction
- AppKit (Reown) for wallet connection
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
| `RPC_URL` | User provides | JSON-RPC endpoint for target chain (e.g., `https://base-mainnet.g.alchemy.com/v2/xxx`). Provider-agnostic. |
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

---

## Testing Requirements

1. **Contract compilation** — Verify the Solidity compiles and the ABI/bytecode are valid
2. **Contract deployment** — Deploy to a testnet via the UI, confirm tx succeeds and correct metadata is returned
3. **Indexer** — Deploy a token, do some transfers, verify sync picks up all events and holder balances are correct
4. **Dashboard rendering** — Verify all data displays correctly after sync
5. **Deploy button** — Test the full Vercel deploy flow with a fresh GitHub account

---

## Scope

### In scope (MVP)
- Single-token ERC20 deployment from browser wallet
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
- WebSocket / real-time updates (polling only for MVP)
