import type { Metadata } from 'next'
import { Providers } from '@/providers'
import './globals.css'

export const metadata: Metadata = {
  title: 'ERC20 Template — Token Dashboard',
  description: 'ERC-20 token dashboard with live indexing.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-gray-950 text-white min-h-screen antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
