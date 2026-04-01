import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { tokens, transfers } from '@erc20-build/db';
import { eq, desc, sql } from 'drizzle-orm';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number(searchParams.get('page') ?? '1'));
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') ?? '10')));
    const offset = (page - 1) * limit;

    const db = getDb();

    const [token] = await db.select().from(tokens).limit(1);
    if (!token) {
      return NextResponse.json({ transfers: [], total: 0 });
    }

    const rows = await db
      .select()
      .from(transfers)
      .where(eq(transfers.tokenId, token.id))
      .orderBy(desc(transfers.blockNumber), desc(transfers.logIndex))
      .limit(limit)
      .offset(offset);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(transfers)
      .where(eq(transfers.tokenId, token.id));

    return NextResponse.json({
      transfers: rows,
      total: countResult?.count ?? 0,
      page,
      limit,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
