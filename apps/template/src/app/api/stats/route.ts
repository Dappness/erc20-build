import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { tokens, transfers, holders, syncState } from '@erc20-build/db';
import { eq, sql } from 'drizzle-orm';

export async function GET() {
  try {
    const db = getDb();

    const [token] = await db.select().from(tokens).limit(1);
    if (!token) {
      return NextResponse.json({ error: 'No token found' }, { status: 404 });
    }

    const [holderCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(holders)
      .where(eq(holders.tokenId, token.id));

    const [transferCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(transfers)
      .where(eq(transfers.tokenId, token.id));

    const [sync] = await db
      .select()
      .from(syncState)
      .where(eq(syncState.tokenId, token.id));

    return NextResponse.json({
      holderCount: holderCount?.count ?? 0,
      transferCount: transferCount?.count ?? 0,
      syncState: sync
        ? {
            finalizedBlock: sync.finalizedBlock,
            headBlock: sync.headBlock,
            lastSyncedAt: sync.lastSyncedAt,
          }
        : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
