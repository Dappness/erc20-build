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
| Chain support | **All major L2s + Mainnet** | Base, Arbitrum, Optimism, Polygon, Ethereum + Sepolia testnet |
| RPC provider | **User-provided API key** | Alchemy key required at deploy time. Free tier is generous. |
| Indexing strategy | **Lazy sync + DB cache** | No external indexer. Fetch events via `eth_getLogs`, cache in Neon DB. |
| Contract deployment | **Direct bytecode deploy** | Pre-compiled OpenZeppelin ERC20 bytecode, deployed from user's wallet via viem. |
| Wallet stack | **wagmi v2 + viem + ConnectKit** | Current best practice for Next.js wallet integration. |

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
│  User provides: ALCHEMY_API_KEY,                    │
│                 NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID │
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
│  - Target chain selector                            │
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

A hybrid indexing approach using three layers, all powered by a single `ALCHEMY_API_KEY`:

#### Layer 1: Alchemy Webhook (real-time push)

After token deployment, the app auto-registers an [Alchemy Address Activity webhook](https://www.alchemy.com/docs/reference/address-activity-webhook) for the token contract address. Alchemy pushes new Transfer events to a Vercel API route (`/api/webhooks/alchemy`), which validates the webhook signature and upserts transfers into the DB. This gives near-real-time updates with zero polling.

```
[Alchemy] --webhook push--> /api/webhooks/alchemy --upsert--> [Neon DB]
```

#### Layer 2: Alchemy Token API (historical backfill + gaps)

On first dashboard load (or after webhook gaps), use `alchemy_getAssetTransfers` to backfill historical transfer data. This pre-indexed API returns paginated ERC20 transfers without needing to scan blocks ourselves. Cache results in Neon DB.

For holder balance snapshots, use `alchemy_getTokenBalances` as a cross-check against our computed balances.

#### Layer 3: Direct RPC fallback (eth_getLogs)

For targeted real-time queries (e.g., confirming a just-submitted transaction), fall back to viem's `getLogs` with a narrow block range. This supplements the webhook for cases where we need instant confirmation before the webhook delivers.

#### Sync logic

```
syncToken(tokenId):
  1. Read sync_state.last_synced_block for tokenId
  2. If no sync state, start from token.deploy_block
  3. Call alchemy_getAssetTransfers from last_synced_block to 'latest' (paginated)
  4. For each Transfer event:
     a. Insert into transfers table (ON CONFLICT DO NOTHING)
     b. Upsert holders: increment to_address balance, decrement from_address balance
  5. Update sync_state.last_synced_block = latest block
```

#### Webhook handler

```
POST /api/webhooks/alchemy:
  1. Verify Alchemy webhook signature (HMAC)
  2. Parse Transfer events from the activity payload
  3. Filter for our token contract address
  4. Upsert into transfers + update holders
  5. Update sync_state if block > last_synced_block
```

**Trigger points**:
- **Webhook (primary)** — Alchemy pushes new events in near-real-time. This is the main data ingestion path.
- **On dashboard page load** — call `syncToken()` to catch up on any missed webhook deliveries. Show cached data immediately.
- **Vercel Cron** — `vercel.json` configures a cron job hitting `/api/cron/sync` every 5 minutes (requires Vercel Pro for <1 day intervals; degrade gracefully on free tier).
- **Manual refresh** — "Refresh" button on dashboard triggers sync via API route.

**RPC configuration**:

Chain configs stored in `packages/shared/src/chains.ts`:

```typescript
export const supportedChains = {
  1:     { name: 'Ethereum',  rpcTemplate: 'https://eth-mainnet.g.alchemy.com/v2/{key}',  explorer: 'https://etherscan.io' },
  8453:  { name: 'Base',      rpcTemplate: 'https://base-mainnet.g.alchemy.com/v2/{key}', explorer: 'https://basescan.org' },
  42161: { name: 'Arbitrum',  rpcTemplate: 'https://arb-mainnet.g.alchemy.com/v2/{key}',  explorer: 'https://arbiscan.io' },
  10:    { name: 'Optimism',  rpcTemplate: 'https://opt-mainnet.g.alchemy.com/v2/{key}',  explorer: 'https://optimistic.etherscan.io' },
  137:   { name: 'Polygon',   rpcTemplate: 'https://polygon-mainnet.g.alchemy.com/v2/{key}', explorer: 'https://polygonscan.com' },
  11155111: { name: 'Sepolia', rpcTemplate: 'https://eth-sepolia.g.alchemy.com/v2/{key}', explorer: 'https://sepolia.etherscan.io' },
} as const;
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
| `/api/webhooks/alchemy` | POST — Alchemy webhook receiver for real-time Transfer events |

**Setup Form** (`/` when no token in DB):
- Connect wallet button (ConnectKit)
- Chain selector dropdown (all supported chains)
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
- ConnectKit for wallet connection
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
https://vercel.com/new/clone?repository-url=https://github.com/dappness/erc20-build/tree/main/apps/template&env=ALCHEMY_API_KEY,NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID&envDescription=API%20keys%20needed%20for%20the%20app&envLink=https://erc20.build/docs/setup&integration-ids=oac_VqOgBHqhEoFTPzGkPd7L0iH6
```

Note: `oac_VqOgBHqhEoFTPzGkPd7L0iH6` is Neon's Vercel integration ID (to be confirmed). This auto-provisions a Neon DB and sets `DATABASE_URL`.

**Required env vars**:
| Variable | Source | Description |
|---|---|---|
| `DATABASE_URL` | Auto (Neon integration) | Postgres connection string |
| `ALCHEMY_API_KEY` | User provides | Alchemy API key (RPC, Token API, and webhooks — all under one key) |
| `ALCHEMY_WEBHOOK_SIGNING_KEY` | Auto (set during post-deploy setup) | HMAC key for verifying webhook payloads |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | User provides | WalletConnect Cloud project ID |

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
3. **User deploys token on wrong chain** — No undo possible. Show clear chain confirmation before deploy. Consider a testnet-first flow.
4. **Neon DB connection drops** — Standard retry logic via Drizzle/pg driver. Neon serverless driver handles this well.
5. **Large token (millions of transfers)** — Incremental sync stays fast. Initial re-sync from scratch would be slow. Add a "last N transfers" cap on the sync if needed. Stretch: add a "full re-index" background job.
6. **Zero-address transfers (mint/burn)** — Handle `from = 0x0` as mint, `to = 0x0` as burn. Show these distinctly in the transfers table.
7. **Multiple tokens at same address** — Not possible (single-token model), but validate that no token exists in DB before showing the setup form.
8. **Vercel free tier cron limits** — Free tier runs crons once/day. On free tier, rely on lazy sync (sync on page load). Document this limitation.

---

## Testing Requirements

1. **Contract compilation** — Verify the Solidity compiles and the ABI/bytecode are valid
2. **Contract deployment** — Deploy to Sepolia via the UI, confirm tx succeeds and correct metadata is returned
3. **Indexer** — Deploy a token on Sepolia, do some transfers, verify sync picks up all events and holder balances are correct
4. **Dashboard rendering** — Verify all data displays correctly after sync
5. **Deploy button** — Test the full Vercel deploy flow with a fresh GitHub account

---

## Scope

### In scope (MVP)
- Single-token ERC20 deployment from browser wallet
- 6 chains: Ethereum, Base, Arbitrum, Optimism, Polygon, Sepolia
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
