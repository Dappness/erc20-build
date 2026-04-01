import { getDb } from '@/lib/db';
import { tokens, holders } from '@erc20-build/db';
import { eq, desc, sql } from 'drizzle-orm';
import { formatUnits } from 'viem';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

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

export default async function HoldersPage({
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
    .from(holders)
    .where(eq(holders.tokenId, token.id))
    .orderBy(desc(sql`cast(${holders.balance} as numeric)`))
    .limit(limit)
    .offset(offset);

  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(holders)
    .where(eq(holders.tokenId, token.id));

  const total = countResult?.count ?? 0;
  const totalPages = Math.ceil(total / limit);

  const totalSupply = parseFloat(token.initialSupply);

  return (
    <main className="min-h-screen p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/" className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
            &larr; Dashboard
          </Link>
          <h1 className="text-xl font-bold mt-1">Holders</h1>
          <p className="text-sm text-gray-500">{total.toLocaleString()} total</p>
        </div>
      </div>

      <div className="rounded-lg border border-gray-800">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-800">
                <th className="px-4 py-3 font-medium w-12">#</th>
                <th className="px-4 py-3 font-medium">Address</th>
                <th className="px-4 py-3 font-medium text-right">Balance</th>
                <th className="px-4 py-3 font-medium text-right">% Supply</th>
                <th className="px-4 py-3 font-medium text-right">First Seen</th>
                <th className="px-4 py-3 font-medium text-right">Last Active</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((holder, i) => {
                const bal = parseFloat(holder.balance);
                const percentage = totalSupply > 0
                  ? ((bal / totalSupply) * 100).toFixed(2)
                  : '0';

                return (
                  <tr
                    key={holder.address}
                    className="border-b border-gray-800/30 hover:bg-gray-900/50"
                  >
                    <td className="px-4 py-2.5 text-xs text-gray-500">
                      {offset + i + 1}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-400">
                      {truncateAddress(holder.address)}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-right">
                      {formatAmount(holder.balance, token.decimals)}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 text-right">
                      {percentage}%
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 text-right">
                      {new Date(holder.firstSeenAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 text-right">
                      {new Date(holder.lastSeenAt).toLocaleDateString()}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-600 text-xs">
                    No holders yet
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
              href={`/holders?page=${page - 1}`}
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
              href={`/holders?page=${page + 1}`}
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
