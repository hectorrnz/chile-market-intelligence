import type { Metadata, Viewport } from 'next'
import { AppShell } from '@/components/layout/AppShell'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Nevada Market Intelligence',
    template: '%s · NMI',
  },
  description:
    'Chile-focused buyside market intelligence dashboard for equities, macro, earnings, filings, and market news.',
  applicationName: 'Nevada Market Intelligence',
  keywords: ['Chile', 'equities', 'macro', 'earnings', 'CMF', 'IPSA', 'buyside', 'market intelligence'],
  authors: [{ name: 'Nevada Inversiones' }],
  robots: { index: false, follow: false },
  icons: {
    icon: '/favicon.svg?v=2',
    shortcut: '/favicon.svg?v=2',
  },
  openGraph: {
    type: 'website',
    title: 'Nevada Market Intelligence',
    description: 'Buyside market intelligence dashboard — Chilean equities, macro, earnings, and filings.',
    siteName: 'NMI',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    /*
     * THEME MECHANISM (decision D2 — resolved, single system).
     *
     *   - ONE class system: `.dark` on <html>. Light values live under `:root`
     *     in globals.css, dark values under `.dark`. There is no separate
     *     light-mode body class (the Fable prototype's own mechanism is
     *     deliberately not carried over), no second theme provider, and no
     *     second localStorage key.
     *   - DARK IS THE FIRST-VISIT DEFAULT, so the server already renders
     *     `class="dark"`. The inline script below only *removes* it when the user
     *     has explicitly stored 'light' — a stored preference always wins over
     *     the default.
     *   - Because dark is the server-rendered default and the removal runs in
     *     <head> before the body paints, neither direction can flash.
     *   - localStorage key ('theme') and its 'dark' | 'light' values are
     *     unchanged, so ThemeToggle's existing read/write behavior still applies.
     *
     * suppressHydrationWarning prevents React from complaining when the class
     * list differs between the server render and the pre-paint script.
     */
    <html lang="en" className="h-full dark" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(localStorage.getItem('theme')==='light'){document.documentElement.classList.remove('dark')}}catch(e){}})()`,
          }}
        />
      </head>
      <body className="h-full bg-background text-foreground">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  )
}
