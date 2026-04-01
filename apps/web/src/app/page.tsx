import { cn } from '@/lib/utils'

const DEPLOY_URL =
  'https://vercel.com/new/clone?repository-url=https://github.com/dappness/erc20-build/tree/main/apps/template&project-name=my-erc20-token&repository-name=my-erc20-token&env=RPC_URL,NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID&envDescription=RPC%20endpoint%20and%20WalletConnect%20project%20ID&envLink=https://erc20.build/docs/setup&products=[{"type":"integration","integrationSlug":"neon","productSlug":"neon","protocol":"storage"}]'

const GITHUB_URL = 'https://github.com/dappness/erc20-build'

const STEPS = [
  {
    number: '01',
    title: 'Deploy to Vercel',
    description:
      'Clone the repo and provision your database automatically.',
  },
  {
    number: '02',
    title: 'Configure your token',
    description:
      'Set name, symbol, supply, and features. Or import an existing token.',
  },
  {
    number: '03',
    title: 'Launch & Track',
    description:
      'Deploy on-chain and monitor transfers, holders, and stats in real-time.',
  },
]

const FEATURES = [
  {
    title: 'Multi-chain support',
    description: 'Ethereum, Base, Arbitrum, Optimism, Polygon.',
  },
  {
    title: 'Configurable features',
    description: 'Mintable, Burnable, Pausable, Capped.',
  },
  {
    title: 'Live dashboard',
    description: 'Transfers, holders, stats — updated in real-time.',
  },
  {
    title: 'Import existing tokens',
    description: 'Track any ERC20 by pasting its address.',
  },
  {
    title: 'Open source',
    description: 'MIT licensed, fully transparent.',
  },
  {
    title: 'One-click deploy',
    description: 'Vercel + Neon, zero infrastructure.',
  },
]

const CHAINS = ['Ethereum', 'Base', 'Arbitrum', 'Optimism', 'Polygon']

function Hero() {
  return (
    <section className="relative flex flex-col items-center justify-center px-6 pt-32 pb-24 text-center">
      <div className="absolute inset-0 bg-gradient-to-b from-gray-950 via-black to-black" />
      <div className="relative z-10 max-w-3xl">
        <h1 className="font-mono text-5xl font-bold tracking-tight text-white sm:text-6xl lg:text-7xl">
          Deploy your own ERC20 token in 60 seconds
        </h1>
        <p className="mt-6 text-lg text-gray-400 sm:text-xl">
          Open-source token builder with a live dashboard. One-click deploy to
          Vercel.
        </p>
        <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <a href={DEPLOY_URL} target="_blank" rel="noopener noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://vercel.com/button"
              alt="Deploy with Vercel"
              width={152}
              height={32}
            />
          </a>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'inline-flex items-center gap-2 rounded-md border border-gray-700 px-5 py-2',
              'text-sm font-medium text-white transition-colors hover:border-gray-500 hover:bg-gray-900'
            )}
          >
            GitHub
          </a>
        </div>
      </div>
    </section>
  )
}

function HowItWorks() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-24">
      <h2 className="text-center font-mono text-3xl font-bold tracking-tight text-white">
        How it works
      </h2>
      <div className="mt-16 grid gap-12 sm:grid-cols-3">
        {STEPS.map((step) => (
          <div key={step.number} className="flex flex-col">
            <span className="font-mono text-sm text-gray-500">
              {step.number}
            </span>
            <h3 className="mt-2 text-lg font-semibold text-white">
              {step.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-gray-400">
              {step.description}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}

function Features() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-24">
      <h2 className="text-center font-mono text-3xl font-bold tracking-tight text-white">
        Features
      </h2>
      <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature) => (
          <div
            key={feature.title}
            className={cn(
              'rounded-lg border border-gray-800 bg-gray-950 p-6',
              'transition-colors hover:border-gray-700'
            )}
          >
            <h3 className="text-base font-semibold text-white">
              {feature.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-gray-400">
              {feature.description}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}

function SupportedChains() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-16">
      <h2 className="text-center font-mono text-sm font-medium uppercase tracking-widest text-gray-500">
        Supported Chains
      </h2>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-6">
        {CHAINS.map((chain) => (
          <span
            key={chain}
            className="rounded-full border border-gray-800 px-4 py-1.5 text-sm text-gray-300"
          >
            {chain}
          </span>
        ))}
      </div>
    </section>
  )
}

function OpenSourceCta() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-24 text-center">
      <h2 className="font-mono text-3xl font-bold tracking-tight text-white">
        Built in the open
      </h2>
      <p className="mt-4 text-gray-400">
        ERC20.Build is open source and MIT licensed. Contributions welcome.
      </p>
      <a
        href={GITHUB_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          'mt-8 inline-flex items-center gap-2 rounded-md border border-gray-700 px-6 py-2.5',
          'text-sm font-medium text-white transition-colors hover:border-gray-500 hover:bg-gray-900'
        )}
      >
        View on GitHub
      </a>
    </section>
  )
}

function Footer() {
  return (
    <footer className="border-t border-gray-900 px-6 py-8">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 sm:flex-row">
        <span className="text-sm text-gray-500">
          Built by{' '}
          <a
            href="https://dappness.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-400 transition-colors hover:text-white"
          >
            Dappness
          </a>
        </span>
        <div className="flex items-center gap-6 text-sm text-gray-500">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-white"
          >
            GitHub
          </a>
          <span>MIT License</span>
        </div>
      </div>
    </footer>
  )
}

export default function HomePage() {
  return (
    <div className="min-h-screen bg-black">
      <Hero />
      <HowItWorks />
      <Features />
      <SupportedChains />
      <OpenSourceCta />
      <Footer />
    </div>
  )
}
