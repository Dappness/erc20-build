'use client';

import { useState, useCallback } from 'react';
import { useAccount, useDeployContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseUnits, type Address } from 'viem';
import artifact from '@/lib/erc20-artifact.json';
import { chainMeta } from '@erc20-build/shared';
import { useRouter } from 'next/navigation';

type Tab = 'create' | 'track';

interface MetadataPreview {
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  deployBlock: number;
}

export function SetupForm() {
  const [activeTab, setActiveTab] = useState<Tab>('create');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <h1 className="text-3xl font-bold text-center mb-2">ERC20 Template</h1>
        <p className="text-gray-400 text-center mb-8">
          Deploy a new token or track an existing one
        </p>

        <div className="flex border-b border-gray-800 mb-6">
          <button
            onClick={() => setActiveTab('create')}
            className={`flex-1 pb-3 text-sm font-medium transition-colors ${
              activeTab === 'create'
                ? 'text-white border-b-2 border-white'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            Create New Token
          </button>
          <button
            onClick={() => setActiveTab('track')}
            className={`flex-1 pb-3 text-sm font-medium transition-colors ${
              activeTab === 'track'
                ? 'text-white border-b-2 border-white'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            Track Existing Token
          </button>
        </div>

        {activeTab === 'create' ? <CreateTokenForm /> : <TrackTokenForm />}
      </div>
    </main>
  );
}

function CreateTokenForm() {
  const router = useRouter();
  const { address, isConnected, chainId } = useAccount();
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [initialSupply, setInitialSupply] = useState('');
  const [mintingEnabled, setMintingEnabled] = useState(false);
  const [capped, setCapped] = useState(false);
  const [capAmount, setCapAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const { deployContract, data: deployHash, isPending: isDeploying } = useDeployContract();

  const { data: receipt, isLoading: isWaiting } = useWaitForTransactionReceipt({
    hash: deployHash,
  });

  const chainName = chainId && chainMeta[chainId]
    ? chainMeta[chainId].name
    : chainId
      ? `Chain ${chainId}`
      : 'Not connected';

  const handleDeploy = useCallback(() => {
    setError('');
    if (!address || !chainId) {
      setError('Please connect your wallet first.');
      return;
    }
    if (!name.trim() || !symbol.trim() || !initialSupply.trim()) {
      setError('Please fill in all required fields.');
      return;
    }

    const supplyWei = parseUnits(initialSupply, 18);
    const capWei = capped && capAmount.trim()
      ? parseUnits(capAmount, 18)
      : BigInt(0);

    deployContract({
      abi: artifact.abi,
      bytecode: artifact.bytecode as `0x${string}`,
      args: [name, symbol, supplyWei, capWei, mintingEnabled, address],
    });
  }, [address, chainId, name, symbol, initialSupply, capped, capAmount, mintingEnabled, deployContract]);

  // Save to DB after deploy succeeds
  const handleSaveToken = useCallback(async () => {
    if (!receipt || !address || !chainId) return;

    setSaving(true);
    setError('');
    try {
      const contractAddress = receipt.contractAddress;
      if (!contractAddress) {
        setError('Could not determine contract address from receipt.');
        return;
      }

      const blockNumber = Number(receipt.blockNumber);
      const supplyWei = parseUnits(initialSupply, 18);
      const capWei = capped && capAmount.trim()
        ? parseUnits(capAmount, 18).toString()
        : null;

      const res = await fetch('/api/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chainId,
          contractAddress,
          name,
          symbol: symbol.toUpperCase(),
          decimals: 18,
          initialSupply: supplyWei.toString(),
          cap: capWei,
          mintingEnabled,
          ownerAddress: address,
          source: 'created',
          deployTxHash: receipt.transactionHash,
          deployBlock: blockNumber,
        }),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? 'Failed to save token');
      }

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save token');
    } finally {
      setSaving(false);
    }
  }, [receipt, address, chainId, initialSupply, capped, capAmount, name, symbol, mintingEnabled, router]);

  const isProcessing = isDeploying || isWaiting || saving;

  return (
    <div className="space-y-5">
      {/* Wallet Connection */}
      <div className="rounded-lg border border-gray-800 p-4">
        <label className="block text-xs text-gray-500 uppercase tracking-wider mb-2">
          Wallet
        </label>
        <w3m-button />
      </div>

      {/* Chain */}
      <div className="rounded-lg border border-gray-800 p-4">
        <label className="block text-xs text-gray-500 uppercase tracking-wider mb-2">
          Chain
        </label>
        <p className="text-sm font-mono">{chainName}</p>
      </div>

      {/* Token Name */}
      <div>
        <label className="block text-xs text-gray-500 uppercase tracking-wider mb-2">
          Token Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Token"
          className="w-full rounded-lg border border-gray-800 bg-gray-900 px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
        />
      </div>

      {/* Token Symbol */}
      <div>
        <label className="block text-xs text-gray-500 uppercase tracking-wider mb-2">
          Token Symbol
        </label>
        <input
          type="text"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          placeholder="MTK"
          className="w-full rounded-lg border border-gray-800 bg-gray-900 px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none font-mono"
        />
      </div>

      {/* Initial Supply */}
      <div>
        <label className="block text-xs text-gray-500 uppercase tracking-wider mb-2">
          Initial Supply
        </label>
        <input
          type="text"
          inputMode="numeric"
          value={initialSupply}
          onChange={(e) => setInitialSupply(e.target.value.replace(/[^0-9.]/g, ''))}
          placeholder="1000000"
          className="w-full rounded-lg border border-gray-800 bg-gray-900 px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none font-mono"
        />
      </div>

      {/* Feature Toggles */}
      <div className="space-y-3">
        <label className="block text-xs text-gray-500 uppercase tracking-wider">
          Features
        </label>

        <div className="flex items-center justify-between rounded-lg border border-gray-800 p-3">
          <span className="text-sm">Burnable</span>
          <span className="text-xs text-gray-500">Always on</span>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-gray-800 p-3">
          <span className="text-sm">Pausable</span>
          <span className="text-xs text-gray-500">Always on</span>
        </div>

        <label className="flex items-center justify-between rounded-lg border border-gray-800 p-3 cursor-pointer">
          <span className="text-sm">Mintable</span>
          <input
            type="checkbox"
            checked={mintingEnabled}
            onChange={(e) => setMintingEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-gray-700 bg-gray-900 accent-white"
          />
        </label>

        <label className="flex items-center justify-between rounded-lg border border-gray-800 p-3 cursor-pointer">
          <span className="text-sm">Capped</span>
          <input
            type="checkbox"
            checked={capped}
            onChange={(e) => setCapped(e.target.checked)}
            className="h-4 w-4 rounded border-gray-700 bg-gray-900 accent-white"
          />
        </label>

        {capped && (
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wider mb-2">
              Cap Amount
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={capAmount}
              onChange={(e) => setCapAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              placeholder="10000000"
              className="w-full rounded-lg border border-gray-800 bg-gray-900 px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none font-mono"
            />
          </div>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-400">{error}</p>
      )}

      {/* Deploy / Save buttons */}
      {!receipt ? (
        <button
          onClick={handleDeploy}
          disabled={!isConnected || isProcessing}
          className="w-full rounded-lg bg-white px-4 py-3 text-sm font-medium text-black transition-colors hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isDeploying
            ? 'Confirm in wallet...'
            : isWaiting
              ? 'Deploying...'
              : 'Deploy Token'}
        </button>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg border border-green-900 bg-green-950/50 p-4">
            <p className="text-sm text-green-400">
              Token deployed at{' '}
              <span className="font-mono">{receipt.contractAddress}</span>
            </p>
          </div>
          <button
            onClick={handleSaveToken}
            disabled={saving}
            className="w-full rounded-lg bg-white px-4 py-3 text-sm font-medium text-black transition-colors hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Continue to Dashboard'}
          </button>
        </div>
      )}
    </div>
  );
}

function TrackTokenForm() {
  const router = useRouter();
  const [contractAddress, setContractAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<MetadataPreview | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fetchMetadata = useCallback(async (address: string) => {
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return;

    setLoading(true);
    setError('');
    setPreview(null);

    try {
      const res = await fetch('/api/metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractAddress: address,
          chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '1'),
        }),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? 'Failed to fetch metadata');
      }

      const data = await res.json() as {
        metadata: { name: string; symbol: string; decimals: number; totalSupply: string };
        deployBlock: number;
      };

      setPreview({
        name: data.metadata.name,
        symbol: data.metadata.symbol,
        decimals: data.metadata.decimals,
        totalSupply: data.metadata.totalSupply,
        deployBlock: data.deployBlock,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read contract');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!preview) return;

    setSaving(true);
    setError('');

    try {
      const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '1');

      const res = await fetch('/api/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chainId,
          contractAddress: contractAddress.toLowerCase(),
          name: preview.name,
          symbol: preview.symbol,
          decimals: preview.decimals,
          initialSupply: preview.totalSupply,
          cap: null,
          mintingEnabled: false,
          ownerAddress: '0x0000000000000000000000000000000000000000',
          source: 'imported',
          deployTxHash: null,
          deployBlock: preview.deployBlock,
        }),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? 'Failed to save token');
      }

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save token');
    } finally {
      setSaving(false);
    }
  }, [preview, contractAddress, router]);

  return (
    <div className="space-y-5">
      <div>
        <label className="block text-xs text-gray-500 uppercase tracking-wider mb-2">
          Contract Address
        </label>
        <input
          type="text"
          value={contractAddress}
          onChange={(e) => setContractAddress(e.target.value)}
          onBlur={() => fetchMetadata(contractAddress)}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData('text');
            setTimeout(() => fetchMetadata(pasted), 0);
          }}
          placeholder="0x..."
          className="w-full rounded-lg border border-gray-800 bg-gray-900 px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none font-mono"
        />
      </div>

      {loading && (
        <p className="text-sm text-gray-400">Reading contract...</p>
      )}

      {error && (
        <p className="text-sm text-red-400">{error}</p>
      )}

      {preview && (
        <div className="rounded-lg border border-gray-800 p-4 space-y-2">
          <h3 className="text-sm font-medium text-gray-400">Token Preview</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-gray-500">Name</p>
              <p className="text-sm">{preview.name}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Symbol</p>
              <p className="text-sm font-mono">{preview.symbol}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Decimals</p>
              <p className="text-sm font-mono">{preview.decimals}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Total Supply</p>
              <p className="text-sm font-mono truncate">{preview.totalSupply}</p>
            </div>
          </div>
        </div>
      )}

      <button
        onClick={handleConfirm}
        disabled={!preview || saving}
        className="w-full rounded-lg bg-white px-4 py-3 text-sm font-medium text-black transition-colors hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {saving ? 'Saving...' : 'Confirm & Track Token'}
      </button>
    </div>
  );
}
