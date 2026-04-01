import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { tokens } from '@erc20-build/db';
import type { TokenSource } from '@erc20-build/shared';

interface CreateTokenBody {
  chainId: number;
  contractAddress: string;
  name: string;
  symbol: string;
  decimals: number;
  initialSupply: string;
  cap: string | null;
  mintingEnabled: boolean;
  ownerAddress: string;
  source: TokenSource;
  deployTxHash: string | null;
  deployBlock: number;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreateTokenBody;

    const db = getDb();
    const [token] = await db
      .insert(tokens)
      .values({
        chainId: body.chainId,
        contractAddress: body.contractAddress.toLowerCase(),
        name: body.name,
        symbol: body.symbol,
        decimals: body.decimals,
        initialSupply: body.initialSupply,
        cap: body.cap,
        mintingEnabled: body.mintingEnabled,
        ownerAddress: body.ownerAddress.toLowerCase(),
        source: body.source,
        deployTxHash: body.deployTxHash,
        deployBlock: body.deployBlock,
      })
      .returning();

    return NextResponse.json({ success: true, token });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
