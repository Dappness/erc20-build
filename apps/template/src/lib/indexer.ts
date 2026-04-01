import {
  createPublicClient,
  http,
  parseAbiItem,
  type Address,
  type PublicClient,
  type Log,
} from 'viem';
import { eq, sql, and, gte, lte } from 'drizzle-orm';
import { tokens, transfers, syncState, holders } from '@erc20-build/db';
import { chainMeta, type TokenMetadata } from '@erc20-build/shared';
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http';

type Db = NeonHttpDatabase<typeof import('@erc20-build/db')>;

const TRANSFER_EVENT = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)'
);

const BATCH_SIZE = 2000;

/**
 * Derive a WebSocket URL from an HTTP RPC URL.
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
  contractAddress: Address,
  chainId: number = 1
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

  if (nameResult.status === 'failure') throw new Error('Failed to read name()');
  if (symbolResult.status === 'failure') throw new Error('Failed to read symbol()');
  if (decimalsResult.status === 'failure') throw new Error('Failed to read decimals()');
  if (totalSupplyResult.status === 'failure') throw new Error('Failed to read totalSupply()');

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
 * Find the block a contract was deployed at.
 * 1. Try Etherscan-compatible API first
 * 2. Fallback to binary search on eth_getCode
 */
export async function findDeployBlock(
  rpcUrl: string,
  contractAddress: Address,
  chainId: number
): Promise<number> {
  // Step 1: Try Etherscan API
  const meta = chainMeta[chainId];
  if (meta) {
    try {
      const url = `${meta.explorerApi}?module=contract&action=getcontractcreation&contractaddresses=${contractAddress}`;
      const resp = await fetch(url);
      const data = await resp.json() as {
        status: string;
        result: Array<{ txHash: string }>;
      };
      if (data.status === '1' && data.result?.[0]?.txHash) {
        const client = createPublicClient({ transport: http(rpcUrl) });
        const tx = await client.getTransaction({
          hash: data.result[0].txHash as `0x${string}`,
        });
        if (tx.blockNumber !== null && tx.blockNumber !== undefined) {
          return Number(tx.blockNumber);
        }
      }
    } catch {
      // Etherscan failed, fall through to binary search
    }
  }

  // Step 2: Binary search on eth_getCode
  return findDeployBlockBinarySearch(rpcUrl, contractAddress);
}

/**
 * Binary search for deploy block by checking eth_getCode at various heights.
 */
export async function findDeployBlockBinarySearch(
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
 * Fetch Transfer event logs in batched chunks.
 */
async function fetchTransferLogs(
  client: PublicClient,
  contractAddress: Address,
  fromBlock: number,
  toBlock: number
): Promise<Log<bigint, number, false, typeof TRANSFER_EVENT, true>[]> {
  const allLogs: Log<bigint, number, false, typeof TRANSFER_EVENT, true>[] = [];

  for (let start = fromBlock; start <= toBlock; start += BATCH_SIZE) {
    const end = Math.min(start + BATCH_SIZE - 1, toBlock);
    const logs = await client.getLogs({
      address: contractAddress,
      event: TRANSFER_EVENT,
      fromBlock: BigInt(start),
      toBlock: BigInt(end),
    });
    allLogs.push(...logs);
  }

  return allLogs;
}

/**
 * Recompute holder balances from all transfers for a given token.
 * Uses a single SQL query to compute net balances.
 */
async function recomputeHolders(db: Db, tokenId: number): Promise<void> {
  // Compute balances from all transfers (finalized + unfinalized)
  const balances = await db.execute<{
    address: string;
    balance: string;
    first_seen: Date;
    last_seen: Date;
  }>(sql`
    SELECT
      address,
      SUM(incoming) - SUM(outgoing) AS balance,
      MIN(block_timestamp) AS first_seen,
      MAX(block_timestamp) AS last_seen
    FROM (
      SELECT
        to_address AS address,
        CAST(value AS numeric) AS incoming,
        0 AS outgoing,
        block_timestamp
      FROM transfers
      WHERE token_id = ${tokenId}
      UNION ALL
      SELECT
        from_address AS address,
        0 AS incoming,
        CAST(value AS numeric) AS outgoing,
        block_timestamp
      FROM transfers
      WHERE token_id = ${tokenId}
    ) AS t
    GROUP BY address
    HAVING SUM(incoming) - SUM(outgoing) > 0
  `);

  // Delete existing holders for this token
  await db.delete(holders).where(eq(holders.tokenId, tokenId));

  // Insert new holder balances
  const rows = balances.rows;
  if (rows.length > 0) {
    await db.insert(holders).values(
      rows.map((row) => ({
        tokenId,
        address: row.address,
        balance: row.balance.toString(),
        firstSeenAt: new Date(row.first_seen),
        lastSeenAt: new Date(row.last_seen),
      }))
    );
  }
}

/**
 * Two-phase sync for a token: finalized phase then unfinalized phase.
 */
export async function syncToken(
  db: Db,
  rpcUrl: string,
  tokenId: number
): Promise<{ finalizedBlock: number; headBlock: number }> {
  // 1. Read sync_state and token info
  const [state] = await db
    .select()
    .from(syncState)
    .where(eq(syncState.tokenId, tokenId));

  const [token] = await db
    .select()
    .from(tokens)
    .where(eq(tokens.id, tokenId));

  if (!token) {
    throw new Error(`Token ${tokenId} not found`);
  }

  const contractAddress = token.contractAddress as Address;

  // 2. Create viem client
  const client = createPublicClient({ transport: http(rpcUrl) });

  // 3. Fetch finalized block
  const finalizedBlockData = await client.getBlock({ blockTag: 'finalized' });
  const newFinalizedBlock = Number(finalizedBlockData.number);

  const currentFinalizedBlock = state?.finalizedBlock ?? token.deployBlock - 1;
  let finalizedBlock = currentFinalizedBlock;

  // 4. FINALIZED PHASE
  if (newFinalizedBlock > currentFinalizedBlock) {
    const logs = await fetchTransferLogs(
      client,
      contractAddress,
      currentFinalizedBlock + 1,
      newFinalizedBlock
    );

    if (logs.length > 0) {
      // Get block timestamps for each unique block
      const uniqueBlocks = [...new Set(logs.map((l) => Number(l.blockNumber)))];
      const blockTimestamps = new Map<number, Date>();
      for (const blockNum of uniqueBlocks) {
        const block = await client.getBlock({ blockNumber: BigInt(blockNum) });
        blockTimestamps.set(blockNum, new Date(Number(block.timestamp) * 1000));
      }

      // Insert finalized transfers
      for (const log of logs) {
        const blockNum = Number(log.blockNumber);
        const timestamp = blockTimestamps.get(blockNum)!;
        await db
          .insert(transfers)
          .values({
            tokenId,
            txHash: log.transactionHash,
            logIndex: Number(log.logIndex),
            blockNumber: blockNum,
            blockHash: log.blockHash,
            blockTimestamp: timestamp,
            fromAddress: log.args.from.toLowerCase(),
            toAddress: log.args.to.toLowerCase(),
            value: log.args.value.toString(),
            isFinalized: true,
          })
          .onConflictDoNothing({ target: [transfers.txHash, transfers.logIndex] });
      }
    }

    // Promote any existing unfinalized rows that fall within the newly finalized range
    await db
      .update(transfers)
      .set({ isFinalized: true })
      .where(
        and(
          eq(transfers.tokenId, tokenId),
          eq(transfers.isFinalized, false),
          lte(transfers.blockNumber, newFinalizedBlock)
        )
      );

    finalizedBlock = newFinalizedBlock;
  }

  // 5. UNFINALIZED PHASE
  // Delete all unfinalized transfers for this token
  await db
    .delete(transfers)
    .where(
      and(
        eq(transfers.tokenId, tokenId),
        eq(transfers.isFinalized, false)
      )
    );

  // Fetch logs from finalized+1 to latest
  const latestBlock = await client.getBlock({ blockTag: 'latest' });
  const latestBlockNumber = Number(latestBlock.number);

  if (latestBlockNumber > finalizedBlock) {
    const unfinalizedLogs = await fetchTransferLogs(
      client,
      contractAddress,
      finalizedBlock + 1,
      latestBlockNumber
    );

    if (unfinalizedLogs.length > 0) {
      const uniqueBlocks = [...new Set(unfinalizedLogs.map((l) => Number(l.blockNumber)))];
      const blockTimestamps = new Map<number, Date>();
      for (const blockNum of uniqueBlocks) {
        const block = await client.getBlock({ blockNumber: BigInt(blockNum) });
        blockTimestamps.set(blockNum, new Date(Number(block.timestamp) * 1000));
      }

      for (const log of unfinalizedLogs) {
        const blockNum = Number(log.blockNumber);
        const timestamp = blockTimestamps.get(blockNum)!;
        await db
          .insert(transfers)
          .values({
            tokenId,
            txHash: log.transactionHash,
            logIndex: Number(log.logIndex),
            blockNumber: blockNum,
            blockHash: log.blockHash,
            blockTimestamp: timestamp,
            fromAddress: log.args.from.toLowerCase(),
            toAddress: log.args.to.toLowerCase(),
            value: log.args.value.toString(),
            isFinalized: false,
          })
          .onConflictDoNothing({ target: [transfers.txHash, transfers.logIndex] });
      }
    }
  }

  // 6. Recompute holders from all transfers
  await recomputeHolders(db, tokenId);

  // 7. Upsert sync_state
  if (state) {
    await db
      .update(syncState)
      .set({
        finalizedBlock,
        headBlock: latestBlockNumber,
        lastSyncedAt: new Date(),
      })
      .where(eq(syncState.tokenId, tokenId));
  } else {
    await db.insert(syncState).values({
      tokenId,
      finalizedBlock,
      headBlock: latestBlockNumber,
      lastSyncedAt: new Date(),
    });
  }

  return { finalizedBlock, headBlock: latestBlockNumber };
}
