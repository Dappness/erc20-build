import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { syncToken } from '@/lib/indexer';
import { tokens } from '@erc20-build/db';

export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rpcUrl = process.env.RPC_URL;
  if (!rpcUrl) {
    return NextResponse.json(
      { error: 'RPC_URL not configured' },
      { status: 500 }
    );
  }

  try {
    const db = getDb();

    // Sync all tokens
    const allTokens = await db.select({ id: tokens.id }).from(tokens);

    const results: Array<{
      tokenId: number;
      finalizedBlock: number;
      headBlock: number;
    }> = [];

    for (const token of allTokens) {
      const syncState = await syncToken(db, rpcUrl, token.id);
      results.push({ tokenId: token.id, ...syncState });
    }

    return NextResponse.json({ success: true, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
