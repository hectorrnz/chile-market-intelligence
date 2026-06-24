import type { Metadata, Viewport } from 'next'
import { AppShell } from '@/components/layout/AppShell'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Chile Market Intelligence',
    template: '%s · CMI',
  },
  description:
    'Chile-focused buyside market intelligence dashboard for equities, macro, earnings, filings, and market news.',
  applicationName: 'Chile Market Intelligence',
  keywords: ['Chile', 'equities', 'macro', 'earnings', 'CMF', 'IPSA', 'buyside', 'market intelligence'],
  authors: [{ name: 'CMI' }],
  robots: { index: false, follow: false },
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
  },
  openGraph: {
    type: 'website',
    title: 'Chile Market Intelligence',
    description: 'Buyside market intelligence dashboard — Chilean equities, macro, earnings, and filings.',
    siteName: 'CMI',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    /*
     * suppressHydrationWarning prevents React from complaining that the server
     * rendered <html> without "dark" but the client might add it before hydration.
     * The inline script below reads localStorage and applies .dark before paint,
     * which eliminates the flash of wrong theme without needing an extra library.
     */
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||(t===null&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}})()`,
          }}
        />
      </head>
      <body className="h-full bg-background text-foreground">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  )
}
