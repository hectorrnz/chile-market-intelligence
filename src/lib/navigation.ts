import type { Lang, Translation } from '@/lib/i18n'

export interface NavItem {
  key: 'home' | 'stocks' | 'compare' | 'charting' | 'macro' | 'earnings' | 'watchlist' | 'portfolio' | 'structuredNotes'
  href: string
  icon: string
  soon?: boolean
}

export const navItems: NavItem[] = [
  { key: 'home',            href: '/',                  icon: 'home' },
  { key: 'stocks',          href: '/stocks',             icon: 'chart' },
  { key: 'compare',         href: '/compare',            icon: 'compare' },
  { key: 'charting',        href: '/chart-builder',      icon: 'gf' },
  { key: 'macro',           href: '/macro',              icon: 'trending' },
  { key: 'earnings',        href: '/earnings',           icon: 'document' },
  { key: 'watchlist',       href: '/watchlist',          icon: 'star' },
  { key: 'portfolio',       href: '/portfolio',          icon: 'portfolio' },
  { key: 'structuredNotes', href: '/structured-notes',   icon: 'notes' },
]

export function getPageTitle(pathname: string, _lang: Lang, t: Translation): string {
  if (pathname === '/') return t.nav.home
  const item = navItems.find((n) => n.key !== 'home' && pathname.startsWith(n.href))
  if (item) return t.nav[item.key]
  if (pathname.startsWith('/companies/')) {
    const ticker = pathname.split('/')[2]?.toUpperCase()
    return ticker ? `${t.stocks.tag} · ${ticker}` : t.stocks.tag
  }
  return 'Nevada Market Intelligence'
}
