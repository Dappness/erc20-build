# Token Actions Dashboard

## Overview

Add an interactive token actions panel to the template dashboard that lets connected wallets perform on-chain token operations. The owner can execute all privileged functions (mint, pause/unpause, transfer ownership), while any connected wallet can transfer and burn their own tokens.

**Why**: The dashboard currently only displays read-only data (transfers, holders, stats). Users who deployed a token have no way to interact with it from the same UI — they'd need to go to Etherscan or use a separate tool. This closes the loop: deploy, manage, and monitor all in one place.

## Implementation Plan

### New component: `TokenActions` (`apps/template/src/components/token-actions.tsx`)

A single `'use client'` component with tabbed sub-forms. Uses wagmi hooks (`useReadContract`, `useWriteContract`, `useWaitForTransactionReceipt`) for all chain interaction.

**On-chain reads** (via `useReadContract`):
- `owner()` — determine if connected wallet is the contract owner
- `paused()` — current pause state
- `mintingEnabled()` — whether minting is allowed
- `balanceOf(address)` — connected wallet's token balance

**Tabs / actions:**

| Tab | Function called | Who | Inputs |
|---|---|---|---|
| Transfer | `transfer(address, uint256)` | Any holder | Recipient address, amount |
| Burn | `burn(uint256)` | Any holder | Amount |
| Mint | `mint(address, uint256)` | Owner only | Recipient address, amount |
| Pause / Unpause | `pause()` / `unpause()` | Owner only | None (toggle) |
| Transfer Ownership | `transferOwnership(address)` | Owner only | New owner address |

**UI behavior:**
- When no wallet is connected: show wallet connect prompt (`<w3m-button />`)
- Owner-only tabs are disabled (greyed out, `cursor-not-allowed`) for non-owner wallets
- "Owner" badge displayed when connected wallet matches `owner()`
- Each form shows relevant context (current balance, pause state, current owner address)
- Transaction lifecycle: button → "Confirm in wallet..." → "Confirming..." → success with tx hash → "Perform another action" reset link
- Dangerous actions (burn, pause, transfer ownership) use red button variant
- Transfer ownership shows irreversibility warning

### Dashboard integration (`apps/template/src/components/dashboard.tsx`)

- Import and render `<TokenActions>` between the stats row and the "Recent Transfers" table
- Pass props: `contractAddress`, `chainId`, `decimals`, `symbol`, `mintingEnabled`

### Files changed

| File | Change |
|---|---|
| `apps/template/src/components/token-actions.tsx` | **New** — full component |
| `apps/template/src/components/dashboard.tsx` | Import `TokenActions`, render in layout |

No schema changes. No new API routes. No new dependencies — everything uses wagmi/viem already in the project.

## Edge Cases

1. **Connected to wrong chain** — wagmi will reject the transaction with a chain mismatch error; the wallet UI typically prompts to switch networks
2. **Minting disabled** — Mint tab shows "Minting is disabled for this token" instead of the form
3. **Imported tokens** — `owner()` may revert if the contract isn't Ownable; owner-only tabs remain disabled (non-owner state)
4. **Transaction reverts** — wagmi surfaces the revert reason in the error; shown to user
5. **Transfer ownership** — irreversible; explicit warning text + red button
6. **Pause when already paused** — on-chain `paused()` state drives the UI; tab label toggles between "Pause" / "Unpause"
7. **Insufficient balance** — validated client-side before submission where possible; contract reverts are shown as errors

## Testing Requirements

- Component renders wallet connect prompt when disconnected
- Owner-only tabs disabled for non-owner wallets
- Mint tab shows disabled message when `mintingEnabled` is false
- Pause/unpause tab label reflects current on-chain state
- Transfer form validates recipient address format
- Burn/transfer forms validate amount > 0
- Success state renders tx hash and reset link

These can be tested with React Testing Library + mocked wagmi hooks, consistent with the existing test approach in the MVP spec.

## Scope

**In**: Transfer, burn, mint, pause/unpause, transfer ownership — all functions the deployed ERC20Token contract exposes.

**Out**: `approve` / `transferFrom` (allowance management), `renounceOwnership`, `burnFrom`, `permit` (gasless approvals). These are less commonly needed by the token owner and can be added later if requested.
