import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import { tokens, transfers, syncState, holders } from '../src/schema.js';
import * as schema from '../src/schema.js';

describe('db schema', () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });

    // Create tables manually via SQL (matching the Drizzle schema)
    await db.execute(sql`
      CREATE TABLE tokens (
        id SERIAL PRIMARY KEY,
        chain_id INTEGER NOT NULL,
        contract_address VARCHAR(42) NOT NULL,
        name VARCHAR(255) NOT NULL,
        symbol VARCHAR(32) NOT NULL,
        decimals INTEGER NOT NULL DEFAULT 18,
        initial_supply NUMERIC NOT NULL,
        cap NUMERIC,
        minting_enabled BOOLEAN NOT NULL DEFAULT false,
        owner_address VARCHAR(42) NOT NULL,
        source VARCHAR(10) NOT NULL,
        deploy_tx_hash VARCHAR(66),
        deploy_block INTEGER NOT NULL,
        deployed_at TIMESTAMP NOT NULL DEFAULT NOW(),
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE transfers (
        id SERIAL PRIMARY KEY,
        token_id INTEGER NOT NULL REFERENCES tokens(id),
        tx_hash VARCHAR(66) NOT NULL,
        log_index INTEGER NOT NULL,
        block_number INTEGER NOT NULL,
        block_hash VARCHAR(66) NOT NULL,
        block_timestamp TIMESTAMP NOT NULL,
        from_address VARCHAR(42) NOT NULL,
        to_address VARCHAR(42) NOT NULL,
        value NUMERIC NOT NULL,
        is_finalized BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE UNIQUE INDEX transfers_tx_log_idx ON transfers (tx_hash, log_index)`);
    await db.execute(sql`CREATE INDEX transfers_token_block_idx ON transfers (token_id, block_number)`);
    await db.execute(sql`CREATE INDEX transfers_token_finalized_idx ON transfers (token_id, is_finalized)`);
    await db.execute(sql`CREATE INDEX transfers_token_from_idx ON transfers (token_id, from_address)`);
    await db.execute(sql`CREATE INDEX transfers_token_to_idx ON transfers (token_id, to_address)`);

    await db.execute(sql`
      CREATE TABLE sync_state (
        id SERIAL PRIMARY KEY,
        token_id INTEGER NOT NULL REFERENCES tokens(id) UNIQUE,
        finalized_block INTEGER NOT NULL,
        head_block INTEGER NOT NULL,
        last_synced_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE holders (
        id SERIAL PRIMARY KEY,
        token_id INTEGER NOT NULL REFERENCES tokens(id),
        address VARCHAR(42) NOT NULL,
        balance NUMERIC NOT NULL DEFAULT '0',
        first_seen_at TIMESTAMP NOT NULL,
        last_seen_at TIMESTAMP NOT NULL
      )
    `);
    await db.execute(sql`CREATE UNIQUE INDEX holders_token_address_idx ON holders (token_id, address)`);
    await db.execute(sql`CREATE INDEX holders_token_balance_idx ON holders (token_id, balance)`);
  });

  afterAll(async () => {
    await client.close();
  });

  it('should insert and query a token', async () => {
    const [inserted] = await db.insert(tokens).values({
      chainId: 1,
      contractAddress: '0x1234567890abcdef1234567890abcdef12345678',
      name: 'Test Token',
      symbol: 'TST',
      decimals: 18,
      initialSupply: '1000000',
      ownerAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      source: 'created',
      deployBlock: 12345,
    }).returning();

    expect(inserted).toBeDefined();
    expect(inserted!.name).toBe('Test Token');
    expect(inserted!.symbol).toBe('TST');
    expect(inserted!.chainId).toBe(1);
    expect(inserted!.mintingEnabled).toBe(false);

    const result = await db.select().from(tokens);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(inserted!.id);
  });

  it('should enforce unique constraint on transfers (tx_hash, log_index)', async () => {
    const allTokens = await db.select().from(tokens);
    const tokenId = allTokens[0]!.id;

    await db.insert(transfers).values({
      tokenId,
      txHash: '0xaaaa000000000000000000000000000000000000000000000000000000000001',
      logIndex: 0,
      blockNumber: 100,
      blockHash: '0xbbbb000000000000000000000000000000000000000000000000000000000001',
      blockTimestamp: new Date('2024-01-01'),
      fromAddress: '0x0000000000000000000000000000000000000000',
      toAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      value: '500',
    });

    // Inserting same tx_hash + log_index should fail
    await expect(
      db.insert(transfers).values({
        tokenId,
        txHash: '0xaaaa000000000000000000000000000000000000000000000000000000000001',
        logIndex: 0,
        blockNumber: 100,
        blockHash: '0xbbbb000000000000000000000000000000000000000000000000000000000001',
        blockTimestamp: new Date('2024-01-01'),
        fromAddress: '0x0000000000000000000000000000000000000000',
        toAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        value: '500',
      })
    ).rejects.toThrow();

    // Different log_index should succeed
    await db.insert(transfers).values({
      tokenId,
      txHash: '0xaaaa000000000000000000000000000000000000000000000000000000000001',
      logIndex: 1,
      blockNumber: 100,
      blockHash: '0xbbbb000000000000000000000000000000000000000000000000000000000001',
      blockTimestamp: new Date('2024-01-01'),
      fromAddress: '0x0000000000000000000000000000000000000000',
      toAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      value: '250',
    });

    const result = await db.select().from(transfers);
    expect(result).toHaveLength(2);
  });

  it('should enforce unique constraint on holders (token_id, address)', async () => {
    const allTokens = await db.select().from(tokens);
    const tokenId = allTokens[0]!.id;
    const now = new Date();

    await db.insert(holders).values({
      tokenId,
      address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      balance: '1000',
      firstSeenAt: now,
      lastSeenAt: now,
    });

    // Same token_id + address should fail
    await expect(
      db.insert(holders).values({
        tokenId,
        address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        balance: '2000',
        firstSeenAt: now,
        lastSeenAt: now,
      })
    ).rejects.toThrow();

    // Different address should succeed
    await db.insert(holders).values({
      tokenId,
      address: '0x1111111111111111111111111111111111111111',
      balance: '500',
      firstSeenAt: now,
      lastSeenAt: now,
    });

    const result = await db.select().from(holders);
    expect(result).toHaveLength(2);
  });

  it('should insert and update sync_state', async () => {
    const allTokens = await db.select().from(tokens);
    const tokenId = allTokens[0]!.id;

    const [inserted] = await db.insert(syncState).values({
      tokenId,
      finalizedBlock: 100,
      headBlock: 110,
    }).returning();

    expect(inserted).toBeDefined();
    expect(inserted!.finalizedBlock).toBe(100);
    expect(inserted!.headBlock).toBe(110);

    // Update the sync state
    const [updated] = await db
      .update(syncState)
      .set({ finalizedBlock: 200, headBlock: 220 })
      .where(sql`${syncState.tokenId} = ${tokenId}`)
      .returning();

    expect(updated).toBeDefined();
    expect(updated!.finalizedBlock).toBe(200);
    expect(updated!.headBlock).toBe(220);
  });
});
