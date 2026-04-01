import {
  createPublicClient,
  http,
  parseAbiItem,
  type Address,
  type PublicClient,
  type Log,
} from 'viem';
import { eq, and, sql } from 'drizzle-orm';
import { transfers, syncState, holders, tokens } from '@erc20-build/db';
import { chainMeta, type TokenMetadata } from '@erc20-build/shared';
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import type * as schema from '@erc20-build/db';

type Db = NeonHttpDatabase<typeof schema>;

const TRANSFER_EVENT = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)'
);

const BATCH_SIZE = 2000;

/**
 * Derive a WSS URL from an HTTP RPC URL.
 * Returns null if the URL doesn't use http(s).
 */
export function deriveWssUrl(httpUrl: string): string | null {
  if (httpUrl.startsWith('https://')) {
    return 'wss://' + httpUrl.slice('https://'.length);
  }
  if (httpUrl.startsWith('http://')) {
    return 'ws://' + httpUrl.slice('http://'.length);
  }
  return null;
}

/**
 * Read on-chain ERC20 metadata via multicall.
 */
export async function readTokenMetadata(
  rpcUrl: string,
  contractAddress: Address
): Promise<TokenMetadata> {
  const client = createPublicClient({ transport: http(rpcUrl) });

  const erc20Abi = [
    { type: 'function', name: 'name', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' },
    { type: 'function', name: 'symbol', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' },
    { type: 'function', name: 'decimals', inputs: [], outputs: [{ type: 'uint8' }], stateMutability: 'view' },
    { type: 'function', name: 'totalSupply', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  ] as const;

  const results = await client.multicall({
    contracts: [
      { address: contractAddress, abi: erc20Abi, functionName: 'name' },
      { address: contractAddress, abi: erc20Abi, functionName: 'symbol' },
      { address: contractAddress, abi: erc20Abi, functionName: 'decimals' },
      { address: contractAddress, abi: erc20Abi, functionName: 'totalSupply' },
    ],
  });

  const [nameResult, symbolResult, decimalsResult, totalSupplyResult] = results;

  if (nameResult.status !== 'success') throw new Error('Failed to read name()');
  if (symbolResult.status !== 'success') throw new Error('Failed to read symbol()');
  if (decimalsResult.status !== 'success') throw new Error('Failed to read decimals()');
  if (totalSupplyResult.status !== 'success') throw new Error('Failed to read totalSupply()');

  const chainId = await client.getChainId();

  return {
    name: nameResult.result as string,
    symbol: symbolResult.result as string,
    decimals: Number(decimalsResult.result),
    totalSupply: (totalSupplyResult.result as bigint).toString(),
    contractAddress,
    chainId,
  };
}

/**
 * Find the block in which a contract was deployed.
 *
 * 1. Try Etherscan-compatible API
 * 2. Fallback: binary search on eth_getCode
 */
export async function findDeployBlock(
  rpcUrl: string,
  contractAddress: Address,
  chainId: number
): Promise<number> {
  // Step 1: Try Etherscan API
  const meta = chainMeta[chainId];
  if (meta?.explorerApi) {
    try {
      const url = `${meta.explorerApi}?module=contract&action=getcontractcreation&contractaddresses=${contractAddress}`;
      const resp = await fetch(url);
      const data = (await resp.json()) as {
        status: string;
        result?: Array<{ txHash: string }>;
      };

      if (data.status === '1' && data.result && data.result.length > 0) {
        const txHash = data.result[0]!.txHash as `0x${string}`;
        const client = createPublicClient({ transport: http(rpcUrl) });
        const tx = await client.getTransaction({ hash: txHash });
        if (tx.blockNumber !== null && tx.blockNumber !== undefined) {
          return Number(tx.blockNumber);
        }
      }
    } catch {
      // Fall through to binary search
    }
  }

  // Step 2: Binary search on eth_getCode
  return binarySearchDeployBlock(rpcUrl, contractAddress);
}

async function binarySearchDeployBlock(
  rpcUrl: string,
  contractAddress: Address
): Promise<number> {
  const client = createPublicClient({ transport: http(rpcUrl) });

  const latestBlock = await client.getBlockNumber();
  let low = 0;
  let high = Number(latestBlock);

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const code = await client.getCode({
      address: contractAddress,
      blockNumber: BigInt(mid),
    });

    if (code && code !== '0x') {
      high = mid;
    } else {
      low = mid + 1;
    }
  }

  return low;
}

/**
 * Two-phase sync: finalized + unfinalized.
 */
export async function syncToken(
  db: Db,
  rpcUrl: string,
  tokenId: number
): Promise<{ finalizedBlock: number; headBlock: number }> {
  const client = createPublicClient({ transport: http(rpcUrl) });

  // Read token record to get contract address and chain id
  const [tokenRecord] = await db
    .select()
    .from(tokens)
    .where(eq(tokens.id, tokenId))
    .limit(1);

  if (!tokenRecord) {
    throw new Error(`Token ${tokenId} not found`);
  }

  const contractAddress = tokenRecord.contractAddress as Address;

  // Read or initialize sync_state
  let [state] = await db
    .select()
    .from(syncState)
    .where(eq(syncState.tokenId, tokenId))
    .limit(1);

  if (!state) {
    const deployBlock = tokenRecord.deployBlock;
    const [inserted] = await db
      .insert(syncState)
      .values({
        tokenId,
        finalizedBlock: deployBlock,
        headBlock: deployBlock,
        lastSyncedAt: new Date(),
      })
      .returning();
    state = inserted!;
  }

  // Get finalized block from chain
  const finalizedBlock = await client.getBlock({ blockTag: 'finalized' });
  const finalizedBlockNumber = Number(finalizedBlock.number);

  // Get latest block from chain
  const latestBlockNumber = Number(await client.getBlockNumber());

  // ---- FINALIZED PHASE ----
  if (finalizedBlockNumber > state.finalizedBlock) {
    const fromBlock = state.finalizedBlock + 1;
    const toBlock = finalizedBlockNumber;

    // Fetch and insert finalized transfer logs in batches
    for (let batchStart = fromBlock; batchStart <= toBlock; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, toBlock);
      await fetchAndInsertTransfers(
        client,
        db,
        contractAddress,
        tokenId,
        batchStart,
        batchEnd,
        true
      );
    }

    // Promote any existing unfinalized rows that now fall within finalized range
    await db
      .update(transfers)
      .set({ isFinalized: true })
      .where(
        and(
          eq(transfers.tokenId, tokenId),
          eq(transfers.isFinalized, false),
          sql`${transfers.blockNumber} <= ${finalizedBlockNumber}`
        )
      );

    // Update finalized block in sync_state
    await db
      .update(syncState)
      .set({ finalizedBlock: finalizedBlockNumber, lastSyncedAt: new Date() })
      .where(eq(syncState.tokenId, tokenId));
  }

  // ---- UNFINALIZED PHASE ----
  // Delete all unfinalized transfers for this token
  await db
    .delete(transfers)
    .where(
      and(eq(transfers.tokenId, tokenId), eq(transfers.isFinalized, false))
    );

  // Fetch unfinalized logs from finalized+1 to latest
  if (latestBlockNumber > finalizedBlockNumber) {
    for (
      let batchStart = finalizedBlockNumber + 1;
      batchStart <= latestBlockNumber;
      batchStart += BATCH_SIZE
    ) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, latestBlockNumber);
      await fetchAndInsertTransfers(
        client,
        db,
        contractAddress,
        tokenId,
        batchStart,
        batchEnd,
        false
      );
    }
  }

  // Update head_block
  await db
    .update(syncState)
    .set({ headBlock: latestBlockNumber, lastSyncedAt: new Date() })
    .where(eq(syncState.tokenId, tokenId));

  // ---- RECOMPUTE HOLDERS ----
  await recomputeHolders(db, tokenId);

  return {
    finalizedBlock: finalizedBlockNumber,
    headBlock: latestBlockNumber,
  };
}

async function fetchAndInsertTransfers(
  client: PublicClient,
  db: Db,
  contractAddress: Address,
  tokenId: number,
  fromBlock: number,
  toBlock: number,
  isFinalized: boolean
): Promise<void> {
  const logs = await client.getLogs({
    address: contractAddress,
    event: TRANSFER_EVENT,
    fromBlock: BigInt(fromBlock),
    toBlock: BigInt(toBlock),
  });

  if (logs.length === 0) return;

  // Collect unique block numbers to fetch timestamps
  const uniqueBlockNumbers = [
    ...new Set(logs.map((log) => Number(log.blockNumber))),
  ];
  const blockTimestamps = new Map<number, Date>();

  // Fetch block timestamps in parallel (batches of 10)
  for (let i = 0; i < uniqueBlockNumbers.length; i += 10) {
    const batch = uniqueBlockNumbers.slice(i, i + 10);
    const blocks = await Promise.all(
      batch.map((bn) => client.getBlock({ blockNumber: BigInt(bn) }))
    );
    for (const block of blocks) {
      blockTimestamps.set(
        Number(block.number),
        new Date(Number(block.timestamp) * 1000)
      );
    }
  }

  const rows = logs.map((log) => ({
    tokenId,
    txHash: log.transactionHash!,
    logIndex: Number(log.logIndex!),
    blockNumber: Number(log.blockNumber),
    blockHash: log.blockHash!,
    blockTimestamp: blockTimestamps.get(Number(log.blockNumber))!,
    fromAddress: (log.args as { from: string; to: string; value: bigint }).from.toLowerCase(),
    toAddress: (log.args as { from: string; to: string; value: bigint }).to.toLowerCase(),
    value: (log.args as { from: string; to: string; value: bigint }).value.toString(),
    isFinalized,
  }));

  // Insert with ON CONFLICT DO NOTHING
  await db
    .insert(transfers)
    .values(rows)
    .onConflictDoNothing({ target: [transfers.txHash, transfers.logIndex] });
}

async function recomputeHolders(db: Db, tokenId: number): Promise<void> {
  // Compute net balances from all transfers (finalized + unfinalized)
  const balances = await db.execute<{
    address: string;
    balance: string;
    first_seen: Date;
    last_seen: Date;
  }>(sql`
    SELECT
      address,
      SUM(incoming) - SUM(outgoing) AS balance,
      MIN(ts) AS first_seen,
      MAX(ts) AS last_seen
    FROM (
      SELECT
        ${transfers.toAddress} AS address,
        CAST(${transfers.value} AS numeric) AS incoming,
        0 AS outgoing,
        ${transfers.blockTimestamp} AS ts
      FROM ${transfers}
      WHERE ${transfers.tokenId} = ${tokenId}
      UNION ALL
      SELECT
        ${transfers.fromAddress} AS address,
        0 AS incoming,
        CAST(${transfers.value} AS numeric) AS outgoing,
        ${transfers.blockTimestamp} AS ts
      FROM ${transfers}
      WHERE ${transfers.tokenId} = ${tokenId}
    ) AS combined
    GROUP BY address
    HAVING SUM(incoming) - SUM(outgoing) > 0
  `);

  // Delete existing holders for this token and reinsert
  await db.delete(holders).where(eq(holders.tokenId, tokenId));

  const rows = balances.rows;
  if (rows.length === 0) return;

  const holderRows = rows.map((row) => ({
    tokenId,
    address: row.address,
    balance: row.balance,
    firstSeenAt: new Date(row.first_seen),
    lastSeenAt: new Date(row.last_seen),
  }));

  // Insert in batches of 500
  for (let i = 0; i < holderRows.length; i += 500) {
    const batch = holderRows.slice(i, i + 500);
    await db.insert(holders).values(batch);
  }
}
