'use client';

import { useQuery } from '@tanstack/react-query';
import { chainMeta } from '@erc20-build/shared';
import { formatUnits } from 'viem';
import Link from 'next/link';
import { useState, useCallback } from 'react';

/** Serializable version of the token row (Dates become ISO strings over the wire) */
interface Token {
  id: number;
  chainId: number;
  contractAddress: string;
  name: string;
  symbol: string;
  decimals: number;
  initialSupply: string;
  cap: string | null;
  mintingEnabled: boolean;
  ownerAddress: string;
  source: string;
  deployTxHash: string | null;
  deployBlock: number;
  deployedAt: string;
  createdAt: string;
}

interface Transfer {
  id: number;
  txHash: string;
  logIndex: number;
  blockNumber: number;
  blockTimestamp: string;
  fromAddress: string;
  toAddress: string;
  value: string;
  isFinalized: boolean;
}

interface Holder {
  id: number;
  address: string;
  balance: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

interface Stats {
  holderCount: number;
  transferCount: number;
  syncState: {
    finalizedBlock: number;
    headBlock: number;
    lastSyncedAt: string;
  } | null;
}

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

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;

  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export function Dashboard({ token }: { token: Token }) {
  const [copied, setCopied] = useState(false);
  const chain = chainMeta[token.chainId];

  const { data: stats } = useQuery<Stats>({
    queryKey: ['stats'],
    queryFn: async () => {
      const res = await fetch('/api/stats');
      return res.json() as Promise<Stats>;
    },
    refetchInterval: 15_000,
  });

  const { data: transfersData } = useQuery<{ transfers: Transfer[]; total: number }>({
    queryKey: ['transfers'],
    queryFn: async () => {
      const res = await fetch('/api/transfers?limit=10');
      return res.json() as Promise<{ transfers: Transfer[]; total: number }>;
    },
    refetchInterval: 15_000,
  });

  const { data: holdersData } = useQuery<{ holders: Holder[]; total: number }>({
    queryKey: ['holders'],
    queryFn: async () => {
      const res = await fetch('/api/holders?limit=10');
      return res.json() as Promise<{ holders: Holder[]; total: number }>;
    },
    refetchInterval: 30_000,
  });

  const copyAddress = useCallback(() => {
    navigator.clipboard.writeText(token.contractAddress).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      // clipboard not available
    });
  }, [token.contractAddress]);

  const totalSupplyFormatted = formatAmount(token.initialSupply, token.decimals);

  return (
    <main className="min-h-screen p-6 max-w-6xl mx-auto">
      {/* Header Card */}
      <div className="rounded-lg border border-gray-800 p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-bold">{token.name}</h1>
              <span className="text-sm font-mono text-gray-400">{token.symbol}</span>
              {chain && (
                <span className="rounded-full bg-gray-800 px-2.5 py-0.5 text-xs text-gray-300">
                  {chain.name}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-sm font-mono text-gray-400">
                {truncateAddress(token.contractAddress)}
              </span>
              <button
                onClick={copyAddress}
                className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
              {chain && (
                <a
                  href={`${chain.explorer}/address/${token.contractAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                >
                  Explorer
                </a>
              )}
            </div>
          </div>
          <div className="text-sm text-gray-500">
            Deployed {new Date(token.deployedAt).toLocaleDateString()}
          </div>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Total Supply"
          value={totalSupplyFormatted}
          sub={token.symbol}
        />
        <StatCard
          label="Holders"
          value={stats?.holderCount?.toLocaleString() ?? '—'}
        />
        <StatCard
          label="Transfers"
          value={stats?.transferCount?.toLocaleString() ?? '—'}
        />
        <StatCard
          label="Last Synced"
          value={
            stats?.syncState
              ? `Block ${stats.syncState.headBlock.toLocaleString()}`
              : '—'
          }
          sub={
            stats?.syncState?.lastSyncedAt
              ? timeAgo(stats.syncState.lastSyncedAt)
              : undefined
          }
        />
      </div>

      {/* Recent Transfers */}
      <div className="rounded-lg border border-gray-800 mb-6">
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <h2 className="text-sm font-medium text-gray-400">Recent Transfers</h2>
          <Link
            href="/transfers"
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            View all
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-800/50">
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">From</th>
                <th className="px-4 py-2 font-medium">To</th>
                <th className="px-4 py-2 font-medium text-right">Amount</th>
                <th className="px-4 py-2 font-medium text-right">Time</th>
              </tr>
            </thead>
            <tbody>
              {transfersData?.transfers && transfersData.transfers.length > 0 ? (
                transfersData.transfers.map((tx) => {
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
                      <td className={`px-4 py-2.5 ${typeColor} text-xs font-medium`}>
                        {type}
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
                })
              ) : (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-600 text-xs">
                    No transfers yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Top Holders */}
      <div className="rounded-lg border border-gray-800">
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <h2 className="text-sm font-medium text-gray-400">Top Holders</h2>
          <Link
            href="/holders"
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            View all
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-800/50">
                <th className="px-4 py-2 font-medium w-12">#</th>
                <th className="px-4 py-2 font-medium">Address</th>
                <th className="px-4 py-2 font-medium text-right">Balance</th>
                <th className="px-4 py-2 font-medium text-right">% Supply</th>
              </tr>
            </thead>
            <tbody>
              {holdersData?.holders && holdersData.holders.length > 0 ? (
                holdersData.holders.map((holder, i) => {
                  let percentage = '0';
                  try {
                    const bal = parseFloat(holder.balance);
                    const supply = parseFloat(token.initialSupply);
                    if (supply > 0) {
                      percentage = ((bal / supply) * 100).toFixed(2);
                    }
                  } catch {
                    // skip
                  }

                  return (
                    <tr
                      key={holder.address}
                      className="border-b border-gray-800/30 hover:bg-gray-900/50"
                    >
                      <td className="px-4 py-2.5 text-xs text-gray-500">
                        {i + 1}
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
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-gray-600 text-xs">
                    No holders yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-800 p-4">
      <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">{label}</p>
      <p className="text-lg font-semibold font-mono">{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}
