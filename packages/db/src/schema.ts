import { pgTable, serial, integer, varchar, numeric, boolean, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';

export const tokens = pgTable('tokens', {
  id: serial('id').primaryKey(),
  chainId: integer('chain_id').notNull(),
  contractAddress: varchar('contract_address', { length: 42 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  symbol: varchar('symbol', { length: 32 }).notNull(),
  decimals: integer('decimals').notNull().default(18),
  initialSupply: numeric('initial_supply').notNull(),
  cap: numeric('cap'),
  mintingEnabled: boolean('minting_enabled').notNull().default(false),
  ownerAddress: varchar('owner_address', { length: 42 }).notNull(),
  source: varchar('source', { length: 10 }).notNull(),
  deployTxHash: varchar('deploy_tx_hash', { length: 66 }),
  deployBlock: integer('deploy_block').notNull(),
  deployedAt: timestamp('deployed_at').notNull().defaultNow(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const transfers = pgTable('transfers', {
  id: serial('id').primaryKey(),
  tokenId: integer('token_id').notNull().references(() => tokens.id),
  txHash: varchar('tx_hash', { length: 66 }).notNull(),
  logIndex: integer('log_index').notNull(),
  blockNumber: integer('block_number').notNull(),
  blockHash: varchar('block_hash', { length: 66 }).notNull(),
  blockTimestamp: timestamp('block_timestamp').notNull(),
  fromAddress: varchar('from_address', { length: 42 }).notNull(),
  toAddress: varchar('to_address', { length: 42 }).notNull(),
  value: numeric('value').notNull(),
  isFinalized: boolean('is_finalized').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('transfers_tx_log_idx').on(table.txHash, table.logIndex),
  index('transfers_token_block_idx').on(table.tokenId, table.blockNumber),
  index('transfers_token_finalized_idx').on(table.tokenId, table.isFinalized),
  index('transfers_token_from_idx').on(table.tokenId, table.fromAddress),
  index('transfers_token_to_idx').on(table.tokenId, table.toAddress),
]);

export const syncState = pgTable('sync_state', {
  id: serial('id').primaryKey(),
  tokenId: integer('token_id').notNull().references(() => tokens.id).unique(),
  finalizedBlock: integer('finalized_block').notNull(),
  headBlock: integer('head_block').notNull(),
  lastSyncedAt: timestamp('last_synced_at').notNull().defaultNow(),
});

export const holders = pgTable('holders', {
  id: serial('id').primaryKey(),
  tokenId: integer('token_id').notNull().references(() => tokens.id),
  address: varchar('address', { length: 42 }).notNull(),
  balance: numeric('balance').notNull().default('0'),
  firstSeenAt: timestamp('first_seen_at').notNull(),
  lastSeenAt: timestamp('last_seen_at').notNull(),
}, (table) => [
  uniqueIndex('holders_token_address_idx').on(table.tokenId, table.address),
  index('holders_token_balance_idx').on(table.tokenId, table.balance),
]);
