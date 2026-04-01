import { NextResponse } from 'next/server';
import { readTokenMetadata, findDeployBlock } from '@/lib/indexer';
import type { Address } from 'viem';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      contractAddress: string;
      chainId: number;
    };

    const rpcUrl = process.env.RPC_URL;
    if (!rpcUrl) {
      return NextResponse.json(
        { error: 'RPC_URL not configured' },
        { status: 500 }
      );
    }

    const metadata = await readTokenMetadata(
      rpcUrl,
      body.contractAddress as Address,
      body.chainId
    );

    const deployBlock = await findDeployBlock(
      rpcUrl,
      body.contractAddress as Address,
      body.chainId
    );

    return NextResponse.json({ success: true, metadata, deployBlock });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
