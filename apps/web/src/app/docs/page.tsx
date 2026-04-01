import { cn } from '@/lib/utils'

const GITHUB_URL = 'https://github.com/dappness/erc20-build'

const ENV_VARS = [
  {
    name: 'DATABASE_URL',
    description:
      'Neon Postgres connection string. Automatically provisioned when you deploy via the Vercel integration.',
  },
  {
    name: 'RPC_URL',
    description:
      'Ethereum JSON-RPC endpoint. Use a provider like Alchemy, Infura, or Ankr.',
  },
  {
    name: 'NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID',
    description:
      'WalletConnect Cloud project ID. Get one free at cloud.walletconnect.com.',
  },
]

const CHAINS = [
  { name: 'Ethereum', chainId: 1 },
  { name: 'Base', chainId: 8453 },
  { name: 'Arbitrum', chainId: 42161 },
  { name: 'Optimism', chainId: 10 },
  { name: 'Polygon', chainId: 137 },
]

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-mono text-2xl font-bold tracking-tight text-white">
      {children}
    </h2>
  )
}

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-black">
      <div className="mx-auto max-w-3xl px-6 py-24">
        <a
          href="/"
          className="text-sm text-gray-500 transition-colors hover:text-white"
        >
          &larr; Back to home
        </a>

        <h1 className="mt-8 font-mono text-4xl font-bold tracking-tight text-white">
          Documentation
        </h1>
        <p className="mt-4 text-gray-400">
          Everything you need to deploy and configure your ERC20 token builder.
        </p>

        {/* Getting Started */}
        <section className="mt-16">
          <SectionHeading>Getting Started</SectionHeading>
          <div className="mt-6 space-y-4 text-sm leading-relaxed text-gray-400">
            <p>
              The fastest way to get started is the one-click deploy button on
              the home page. It will:
            </p>
            <ol className="list-inside list-decimal space-y-2 pl-2">
              <li>Fork the repository into your GitHub account</li>
              <li>
                Provision a Neon Postgres database via the Vercel integration
              </li>
              <li>Prompt you for the required environment variables</li>
              <li>Deploy your app to Vercel</li>
            </ol>
            <p>
              Once deployed, open your app and configure your first token: set
              the name, symbol, initial supply, and optional features like
              minting or burning.
            </p>
            <p>Alternatively, clone the repo and run locally:</p>
            <pre
              className={cn(
                'mt-2 overflow-x-auto rounded-lg border border-gray-800 bg-gray-950 p-4',
                'font-mono text-xs text-gray-300'
              )}
            >
{`git clone ${GITHUB_URL}.git
cd erc20-build
pnpm install
cp .env.example .env.local
# Fill in your env vars
pnpm turbo dev`}
            </pre>
          </div>
        </section>

        {/* Configuration */}
        <section className="mt-16">
          <SectionHeading>Configuration</SectionHeading>
          <p className="mt-4 text-sm text-gray-400">
            The following environment variables are required:
          </p>
          <div className="mt-6 space-y-4">
            {ENV_VARS.map((v) => (
              <div
                key={v.name}
                className="rounded-lg border border-gray-800 bg-gray-950 p-4"
              >
                <code className="font-mono text-sm text-white">{v.name}</code>
                <p className="mt-1 text-sm text-gray-400">{v.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Supported Chains */}
        <section className="mt-16">
          <SectionHeading>Supported Chains</SectionHeading>
          <p className="mt-4 text-sm text-gray-400">
            ERC20.Build supports deploying tokens to the following networks:
          </p>
          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-500">
                  <th className="pb-3 font-medium">Network</th>
                  <th className="pb-3 font-medium">Chain ID</th>
                </tr>
              </thead>
              <tbody className="text-gray-300">
                {CHAINS.map((chain) => (
                  <tr key={chain.chainId} className="border-b border-gray-900">
                    <td className="py-3">{chain.name}</td>
                    <td className="py-3 font-mono text-gray-500">
                      {chain.chainId}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Links */}
        <section className="mt-16">
          <SectionHeading>Resources</SectionHeading>
          <div className="mt-6 space-y-3 text-sm">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-gray-400 transition-colors hover:text-white"
            >
              GitHub Repository &rarr;
            </a>
            <a
              href={`${GITHUB_URL}/issues`}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-gray-400 transition-colors hover:text-white"
            >
              Report an Issue &rarr;
            </a>
          </div>
        </section>

        {/* Footer */}
        <footer className="mt-24 border-t border-gray-900 pt-8 text-sm text-gray-500">
          <a
            href="/"
            className="transition-colors hover:text-white"
          >
            &larr; Back to home
          </a>
        </footer>
      </div>
    </div>
  )
}
