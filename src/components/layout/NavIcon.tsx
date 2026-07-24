// Minimal stroke-based SVG icons — no icon library. Shared by the mobile nav
// drawer (the desktop pill rail is text-only, matching the Fable reference).

export function NavIcon({ name }: { name: string }) {
  const icons: Record<string, React.ReactNode> = {
    home: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 9.5L10 3l7 6.5V17a.5.5 0 01-.5.5H13v-4.5h-6V17.5H3.5A.5.5 0 013 17V9.5z" />
      </svg>
    ),
    chart: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2 14l4.5-5 3 3L14 6l4 4" />
        <path strokeLinecap="round" d="M2 17h16" />
      </svg>
    ),
    trending: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2 13l4-5 3 3 4-5.5 3 2.5" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M14 7h4v4" />
      </svg>
    ),
    document: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 2.5h7l3.5 3.5V17a.5.5 0 01-.5.5h-10A.5.5 0 014.5 17V3a.5.5 0 01.5-.5z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 2.5V6.5H16" />
        <path strokeLinecap="round" d="M7 10h6M7 13h4" />
      </svg>
    ),
    star: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 2l2 5.5h5.5l-4.5 3.5 1.5 5.5L10 13.5 5.5 16.5 7 11 2.5 7.5H8L10 2z" />
      </svg>
    ),
    compare: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
        <rect x="3" y="4" width="5" height="12" rx="1" />
        <rect x="12" y="8" width="5" height="8" rx="1" />
      </svg>
    ),
    gf: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
        <path strokeLinecap="round" d="M3 17h14" />
        <rect x="4" y="10" width="2.5" height="5" rx="0.5" />
        <rect x="8.75" y="7" width="2.5" height="8" rx="0.5" />
        <rect x="13.5" y="12" width="2.5" height="3" rx="0.5" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 7l5-3 4 2 4-3" />
      </svg>
    ),
    portfolio: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 6.5a1.5 1.5 0 011.5-1.5h11a1.5 1.5 0 011.5 1.5V15a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 013 15V6.5z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 5V4a1 1 0 011-1h4a1 1 0 011 1v1" />
        <path strokeLinecap="round" d="M3 9.5h14" />
      </svg>
    ),
    notes: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 3.5h7l3 3V16a1 1 0 01-1 1H5a1 1 0 01-1-1V4.5a1 1 0 011-1z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3.5V6a1 1 0 001 1h2" />
        <path strokeLinecap="round" d="M6.5 10.5h7M6.5 13h5" />
      </svg>
    ),
    settings: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
        <circle cx="10" cy="10" r="2.5" />
        <path strokeLinecap="round" d="M10 3v2M10 15v2M3 10h2M15 10h2M5.3 5.3l1.4 1.4M13.3 13.3l1.4 1.4M14.7 5.3l-1.4 1.4M6.7 13.3l-1.4 1.4" />
      </svg>
    ),
  }
  return <>{icons[name] ?? null}</>
}
