import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'erc20.build',
  description: 'Coming Soon',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
