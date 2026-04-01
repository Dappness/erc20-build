import { getDb } from '@/lib/db';
import { tokens, transfers } from '@erc20-build/db';
import { eq, desc, sql } from 'drizzle-orm';
import { formatUnits } from 'viem';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatAmount(value: string, decimals: number): string {
  try {
    const formatted = formatUnits(BigInt(value), decimals);
    const num = parseFloat(formatted);
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K`;
    return num.toFixed(2);
  } catch {
    return '0';
  }
}

function timeAgo(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default async function TransfersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? '1'));
  const limit = 25;
  const offset = (page - 1) * limit;

  const db = getDb();
  const [token] = await db.select().from(tokens).limit(1);

  if (!token) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">No token configured.</p>
      </main>
    );
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

  const total = countResult?.count ?? 0;
  const totalPages = Math.ceil(total / limit);

  return (
    <main className="min-h-screen p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/" className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
            &larr; Dashboard
          </Link>
          <h1 className="text-xl font-bold mt-1">Transfers</h1>
          <p className="text-sm text-gray-500">{total.toLocaleString()} total</p>
        </div>
      </div>

      <div className="rounded-lg border border-gray-800">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-800">
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Tx Hash</th>
                <th className="px-4 py-3 font-medium">Block</th>
                <th className="px-4 py-3 font-medium">From</th>
                <th className="px-4 py-3 font-medium">To</th>
                <th className="px-4 py-3 font-medium text-right">Amount</th>
                <th className="px-4 py-3 font-medium text-right">Time</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((tx) => {
                const isMint = tx.fromAddress === ZERO_ADDRESS;
                const isBurn = tx.toAddress === ZERO_ADDRESS;
                const type = isMint ? 'Mint' : isBurn ? 'Burn' : 'Transfer';
                const typeColor = isMint
                  ? 'text-green-400'
                  : isBurn
                    ? 'text-red-400'
                    : 'text-gray-400';

                return (
                  <tr
                    key={`${tx.txHash}-${tx.logIndex}`}
                    className="border-b border-gray-800/30 hover:bg-gray-900/50"
                  >
                    <td className={`px-4 py-2.5 text-xs font-medium ${typeColor}`}>
                      {type}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-400">
                      {truncateAddress(tx.txHash)}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-400">
                      {tx.blockNumber.toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-400">
                      {isMint ? '—' : truncateAddress(tx.fromAddress)}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-400">
                      {isBurn ? '—' : truncateAddress(tx.toAddress)}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-right">
                      {formatAmount(tx.value, token.decimals)}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 text-right">
                      {timeAgo(tx.blockTimestamp)}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-600 text-xs">
                    No transfers yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-6">
          {page > 1 && (
            <Link
              href={`/transfers?page=${page - 1}`}
              className="rounded-lg border border-gray-800 px-4 py-2 text-sm text-gray-400 hover:text-white hover:border-gray-600 transition-colors"
            >
              Previous
            </Link>
          )}
          <span className="text-sm text-gray-500">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <Link
              href={`/transfers?page=${page + 1}`}
              className="rounded-lg border border-gray-800 px-4 py-2 text-sm text-gray-400 hover:text-white hover:border-gray-600 transition-colors"
            >
              Next
            </Link>
          )}
        </div>
      )}
    </main>
  );
}
