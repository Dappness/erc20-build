import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { syncToken } from '@/lib/indexer';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { tokenId?: number };

    if (!body.tokenId) {
      return NextResponse.json(
        { error: 'tokenId is required' },
        { status: 400 }
      );
    }

    const rpcUrl = process.env.RPC_URL;
    if (!rpcUrl) {
      return NextResponse.json(
        { error: 'RPC_URL not configured' },
        { status: 500 }
      );
    }

    const db = getDb();
    const syncState = await syncToken(db, rpcUrl, body.tokenId);

    return NextResponse.json({ success: true, syncState });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
