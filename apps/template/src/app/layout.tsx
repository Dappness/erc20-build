import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'ERC20 Template — Token Dashboard',
  description: 'ERC-20 token dashboard with live indexing.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
