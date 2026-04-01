'use client';

import { useState, useCallback } from 'react';
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi';
import { parseUnits, type Address } from 'viem';
import artifact from '@/lib/erc20-artifact.json';

interface TokenActionsProps {
  contractAddress: string;
  chainId: number;
  decimals: number;
  symbol: string;
  mintingEnabled: boolean;
}

type ActionTab = 'mint' | 'burn' | 'transfer' | 'pause' | 'ownership';

const abi = artifact.abi;

export function TokenActions({
  contractAddress,
  chainId,
  decimals,
  symbol,
  mintingEnabled: dbMintingEnabled,
}: TokenActionsProps) {
  const { address, isConnected } = useAccount();
  const [activeTab, setActiveTab] = useState<ActionTab>('transfer');

  const contract = contractAddress as Address;

  // Read on-chain state
  const { data: owner } = useReadContract({
    address: contract,
    abi,
    functionName: 'owner',
    chainId,
  });

  const { data: paused } = useReadContract({
    address: contract,
    abi,
    functionName: 'paused',
    chainId,
  });

  const { data: onChainMintingEnabled } = useReadContract({
    address: contract,
    abi,
    functionName: 'mintingEnabled',
    chainId,
  });

  const { data: balance } = useReadContract({
    address: contract,
    abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId,
    query: { enabled: !!address },
  });

  const isOwner =
    !!address && !!owner && (address as string).toLowerCase() === (owner as string).toLowerCase();
  const canMint = onChainMintingEnabled ?? dbMintingEnabled;

  if (!isConnected) {
    return (
      <div className="rounded-lg border border-gray-800 p-6 mb-6">
        <h2 className="text-sm font-medium text-gray-400 mb-3">Token Actions</h2>
        <div className="flex items-center gap-3">
          <w3m-button />
          <span className="text-sm text-gray-500">Connect wallet to manage tokens</span>
        </div>
      </div>
    );
  }

  const tabs: { key: ActionTab; label: string; ownerOnly: boolean }[] = [
    { key: 'transfer', label: 'Transfer', ownerOnly: false },
    { key: 'burn', label: 'Burn', ownerOnly: false },
    { key: 'mint', label: 'Mint', ownerOnly: true },
    { key: 'pause', label: paused ? 'Unpause' : 'Pause', ownerOnly: true },
    { key: 'ownership', label: 'Ownership', ownerOnly: true },
  ];

  return (
    <div className="rounded-lg border border-gray-800 mb-6">
      <div className="flex items-center justify-between p-4 border-b border-gray-800">
        <h2 className="text-sm font-medium text-gray-400">Token Actions</h2>
        {isOwner && (
          <span className="rounded-full bg-green-950 px-2.5 py-0.5 text-xs text-green-400">
            Owner
          </span>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-gray-800 overflow-x-auto">
        {tabs.map((tab) => {
          const disabled = tab.ownerOnly && !isOwner;
          return (
            <button
              key={tab.key}
              onClick={() => !disabled && setActiveTab(tab.key)}
              disabled={disabled}
              className={`px-4 py-2.5 text-xs font-medium whitespace-nowrap transition-colors ${
                activeTab === tab.key
                  ? 'text-white border-b-2 border-white'
                  : disabled
                    ? 'text-gray-700 cursor-not-allowed'
                    : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="p-4">
        {activeTab === 'transfer' && (
          <TransferForm
            contract={contract}
            chainId={chainId}
            decimals={decimals}
            symbol={symbol}
            balance={balance as bigint | undefined}
          />
        )}
        {activeTab === 'burn' && (
          <BurnForm
            contract={contract}
            chainId={chainId}
            decimals={decimals}
            symbol={symbol}
            balance={balance as bigint | undefined}
          />
        )}
        {activeTab === 'mint' && (
          <MintForm
            contract={contract}
            chainId={chainId}
            decimals={decimals}
            symbol={symbol}
            canMint={!!canMint}
          />
        )}
        {activeTab === 'pause' && (
          <PauseForm
            contract={contract}
            chainId={chainId}
            paused={!!paused}
          />
        )}
        {activeTab === 'ownership' && (
          <OwnershipForm
            contract={contract}
            chainId={chainId}
            currentOwner={owner as string | undefined}
          />
        )}
      </div>
    </div>
  );
}

/* ────────────────────── Transfer Form ────────────────────── */

function TransferForm({
  contract,
  chainId,
  decimals,
  symbol,
  balance,
}: {
  contract: Address;
  chainId: number;
  decimals: number;
  symbol: string;
  balance: bigint | undefined;
}) {
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');

  const { writeContract, data: hash, isPending, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const handleSubmit = useCallback(() => {
    setError('');
    if (!/^0x[a-fA-F0-9]{40}$/.test(to)) {
      setError('Invalid recipient address.');
      return;
    }
    if (!amount || parseFloat(amount) <= 0) {
      setError('Enter a valid amount.');
      return;
    }
    try {
      const value = parseUnits(amount, decimals);
      writeContract({
        address: contract,
        abi,
        functionName: 'transfer',
        args: [to as Address, value],
        chainId,
      });
    } catch {
      setError('Failed to parse amount.');
    }
  }, [to, amount, decimals, contract, chainId, writeContract]);

  const handleReset = useCallback(() => {
    setTo('');
    setAmount('');
    setError('');
    reset();
  }, [reset]);

  if (isSuccess) {
    return <SuccessMessage hash={hash!} onReset={handleReset} label="Transfer sent" />;
  }

  return (
    <div className="space-y-3">
      {balance !== undefined && (
        <p className="text-xs text-gray-500">
          Your balance: <span className="font-mono">{formatBalance(balance, decimals)}</span> {symbol}
        </p>
      )}
      <input
        type="text"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        placeholder="Recipient address (0x...)"
        className={inputClass}
      />
      <input
        type="text"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
        placeholder="Amount"
        className={inputClass}
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <ActionButton
        onClick={handleSubmit}
        disabled={isPending || isConfirming}
        loading={isPending || isConfirming}
        isPending={isPending}
      >
        Transfer
      </ActionButton>
    </div>
  );
}

/* ────────────────────── Burn Form ────────────────────── */

function BurnForm({
  contract,
  chainId,
  decimals,
  symbol,
  balance,
}: {
  contract: Address;
  chainId: number;
  decimals: number;
  symbol: string;
  balance: bigint | undefined;
}) {
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');

  const { writeContract, data: hash, isPending, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const handleSubmit = useCallback(() => {
    setError('');
    if (!amount || parseFloat(amount) <= 0) {
      setError('Enter a valid amount.');
      return;
    }
    try {
      const value = parseUnits(amount, decimals);
      writeContract({
        address: contract,
        abi,
        functionName: 'burn',
        args: [value],
        chainId,
      });
    } catch {
      setError('Failed to parse amount.');
    }
  }, [amount, decimals, contract, chainId, writeContract]);

  const handleReset = useCallback(() => {
    setAmount('');
    setError('');
    reset();
  }, [reset]);

  if (isSuccess) {
    return <SuccessMessage hash={hash!} onReset={handleReset} label="Tokens burned" />;
  }

  return (
    <div className="space-y-3">
      {balance !== undefined && (
        <p className="text-xs text-gray-500">
          Your balance: <span className="font-mono">{formatBalance(balance, decimals)}</span> {symbol}
        </p>
      )}
      <input
        type="text"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
        placeholder="Amount to burn"
        className={inputClass}
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <ActionButton
        onClick={handleSubmit}
        disabled={isPending || isConfirming}
        loading={isPending || isConfirming}
        isPending={isPending}
        variant="danger"
      >
        Burn
      </ActionButton>
    </div>
  );
}

/* ────────────────────── Mint Form ────────────────────── */

function MintForm({
  contract,
  chainId,
  decimals,
  symbol,
  canMint,
}: {
  contract: Address;
  chainId: number;
  decimals: number;
  symbol: string;
  canMint: boolean;
}) {
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');

  const { writeContract, data: hash, isPending, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const handleSubmit = useCallback(() => {
    setError('');
    if (!/^0x[a-fA-F0-9]{40}$/.test(to)) {
      setError('Invalid recipient address.');
      return;
    }
    if (!amount || parseFloat(amount) <= 0) {
      setError('Enter a valid amount.');
      return;
    }
    try {
      const value = parseUnits(amount, decimals);
      writeContract({
        address: contract,
        abi,
        functionName: 'mint',
        args: [to as Address, value],
        chainId,
      });
    } catch {
      setError('Failed to parse amount.');
    }
  }, [to, amount, decimals, contract, chainId, writeContract]);

  const handleReset = useCallback(() => {
    setTo('');
    setAmount('');
    setError('');
    reset();
  }, [reset]);

  if (!canMint) {
    return (
      <p className="text-sm text-gray-500">
        Minting is disabled for this token.
      </p>
    );
  }

  if (isSuccess) {
    return <SuccessMessage hash={hash!} onReset={handleReset} label="Tokens minted" />;
  }

  return (
    <div className="space-y-3">
      <input
        type="text"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        placeholder="Recipient address (0x...)"
        className={inputClass}
      />
      <input
        type="text"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
        placeholder={`Amount of ${symbol} to mint`}
        className={inputClass}
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <ActionButton
        onClick={handleSubmit}
        disabled={isPending || isConfirming}
        loading={isPending || isConfirming}
        isPending={isPending}
      >
        Mint
      </ActionButton>
    </div>
  );
}

/* ────────────────────── Pause Form ────────────────────── */

function PauseForm({
  contract,
  chainId,
  paused,
}: {
  contract: Address;
  chainId: number;
  paused: boolean;
}) {
  const { writeContract, data: hash, isPending, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const handleToggle = useCallback(() => {
    writeContract({
      address: contract,
      abi,
      functionName: paused ? 'unpause' : 'pause',
      chainId,
    });
  }, [contract, chainId, paused, writeContract]);

  const handleReset = useCallback(() => {
    reset();
  }, [reset]);

  if (isSuccess) {
    return (
      <SuccessMessage
        hash={hash!}
        onReset={handleReset}
        label={paused ? 'Token unpaused' : 'Token paused'}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-2">
        <span
          className={`inline-block h-2 w-2 rounded-full ${paused ? 'bg-red-400' : 'bg-green-400'}`}
        />
        <span className="text-sm text-gray-400">
          Token is currently <span className="font-medium text-white">{paused ? 'paused' : 'active'}</span>
        </span>
      </div>
      <p className="text-xs text-gray-500">
        {paused
          ? 'Unpausing will allow all token transfers to resume.'
          : 'Pausing will prevent all token transfers until unpaused.'}
      </p>
      <ActionButton
        onClick={handleToggle}
        disabled={isPending || isConfirming}
        loading={isPending || isConfirming}
        isPending={isPending}
        variant={paused ? 'default' : 'danger'}
      >
        {paused ? 'Unpause Token' : 'Pause Token'}
      </ActionButton>
    </div>
  );
}

/* ────────────────────── Ownership Form ────────────────────── */

function OwnershipForm({
  contract,
  chainId,
  currentOwner,
}: {
  contract: Address;
  chainId: number;
  currentOwner: string | undefined;
}) {
  const [newOwner, setNewOwner] = useState('');
  const [error, setError] = useState('');

  const { writeContract, data: hash, isPending, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const handleSubmit = useCallback(() => {
    setError('');
    if (!/^0x[a-fA-F0-9]{40}$/.test(newOwner)) {
      setError('Invalid address.');
      return;
    }
    writeContract({
      address: contract,
      abi,
      functionName: 'transferOwnership',
      args: [newOwner as Address],
      chainId,
    });
  }, [newOwner, contract, chainId, writeContract]);

  const handleReset = useCallback(() => {
    setNewOwner('');
    setError('');
    reset();
  }, [reset]);

  if (isSuccess) {
    return <SuccessMessage hash={hash!} onReset={handleReset} label="Ownership transferred" />;
  }

  return (
    <div className="space-y-3">
      {currentOwner && (
        <p className="text-xs text-gray-500">
          Current owner: <span className="font-mono">{currentOwner}</span>
        </p>
      )}
      <input
        type="text"
        value={newOwner}
        onChange={(e) => setNewOwner(e.target.value)}
        placeholder="New owner address (0x...)"
        className={inputClass}
      />
      <p className="text-xs text-yellow-500">
        This action is irreversible. You will lose all owner privileges.
      </p>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <ActionButton
        onClick={handleSubmit}
        disabled={isPending || isConfirming}
        loading={isPending || isConfirming}
        isPending={isPending}
        variant="danger"
      >
        Transfer Ownership
      </ActionButton>
    </div>
  );
}

/* ────────────────────── Shared Components ────────────────────── */

function SuccessMessage({
  hash,
  onReset,
  label,
}: {
  hash: string;
  onReset: () => void;
  label: string;
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-green-900 bg-green-950/50 p-4">
        <p className="text-sm text-green-400">{label}</p>
        <p className="text-xs font-mono text-gray-500 mt-1 break-all">{hash}</p>
      </div>
      <button
        onClick={onReset}
        className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
      >
        Perform another action
      </button>
    </div>
  );
}

function ActionButton({
  onClick,
  disabled,
  loading,
  isPending,
  variant = 'default',
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  loading: boolean;
  isPending: boolean;
  variant?: 'default' | 'danger';
  children: React.ReactNode;
}) {
  const base =
    'w-full rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
  const variants = {
    default: 'bg-white text-black hover:bg-gray-200',
    danger: 'bg-red-600 text-white hover:bg-red-700',
  };

  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${variants[variant]}`}>
      {loading ? (isPending ? 'Confirm in wallet...' : 'Confirming...') : children}
    </button>
  );
}

/* ────────────────────── Utilities ────────────────────── */

function formatBalance(value: bigint, decimals: number): string {
  const str = value.toString().padStart(decimals + 1, '0');
  const whole = str.slice(0, str.length - decimals) || '0';
  const frac = str.slice(str.length - decimals, str.length - decimals + 4);
  return `${Number(whole).toLocaleString()}.${frac}`;
}

const inputClass =
  'w-full rounded-lg border border-gray-800 bg-gray-900 px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none font-mono';
