# Design Principles — Chile Market Intelligence

These principles govern every visual and UX decision. They exist so that future prompts to Claude Code do not drift toward generic SaaS aesthetics. If a design decision conflicts with these principles, raise it before implementing.

---

## 1. Institutional Over Consumer

This is an internal tool for a professional investor. It should feel like a Goldman Sachs internal research terminal or a buyside workbench — not a startup's marketing site, not a consumer finance app, and not an AI demo.

---

## 2. Palette — Light-First Institutional Design

### Source
The color palette is inspired by Goldman Sachs brand guidelines (institutional finance colors only). No Goldman logos, names, or proprietary marks are used. This is a family-office internal dashboard.

### Default Mode
**Light mode is the default.** Dark mode is user-selectable and persisted in localStorage.

### Light Mode Color Reference

| Role | Hex | Usage |
|---|---|---|
| Page background | `#F1F1F1` | Main area behind panels |
| Surface | `#FFFFFF` | Cards, panels, table rows |
| Surface-2 | `#E8EAEB` | Table headers, alternate rows, input fills |
| Foreground | `#231F20` | Primary text |
| Muted | `#58575A` | Secondary text, sublabels |
| Muted-fg | `#8A8887` | Metadata, source labels, timestamps |
| Border | `#D0D0D0` | Panel borders, table lines |
| Border-strong | `#ABABAB` | Emphasis borders |
| Primary | `#004A64` | Institutional deep navy — nav accent, links |
| Accent | `#7399C6` | Institutional blue — highlights, active states |
| Link | `#007FC3` | Interactive links and actions |
| Positive | `#1A6630` | Green signal (gains, beats) |
| Negative | `#8B0E04` | Red signal (losses, misses, errors) |
| Warning | `#7A5200` | Amber signal (pending, MVP state) |
| Sidebar background | `#004A64` | Always dark navy — even in light mode |
| Topbar background | `#FFFFFF` | White strip above main content |

### Dark Mode Color Reference

Dark mode uses the same palette shifted for dark backgrounds. It is a CSS-variable override (`.dark` class on `<html>`), not a separate design.

| Role | Hex | Usage |
|---|---|---|
| Page background | `#202324` | Main area |
| Surface | `#2A2D2E` | Panels, table rows |
| Surface-2 | `#333638` | Table headers, hover state |
| Foreground | `#E6E5E4` | Primary text |
| Muted | `#9A9897` | Secondary text |
| Muted-fg | `#6E6C6B` | Metadata |
| Border | `#3A3D3E` | Panel borders |
| Primary | `#7399C6` | Institutional blue (lighter for dark) |
| Accent | `#88CBDF` | Soft cyan accent |
| Positive | `#3DAA60` | Green |
| Negative | `#D05050` | Red |
| Warning | `#CC9010` | Amber |
| Sidebar background | `#191C1D` | Even darker than main background |

### Contrast Requirement
All text-on-background combinations must meet WCAG AA (4.5:1 for normal text). Dark mode must not reduce contrast below this threshold.

---

## 3. Semantic Token System

All colors in components must reference semantic CSS custom properties — never hardcoded hex values or raw Tailwind color scale names.

**Allowed:**
```tsx
className="bg-surface text-foreground border-border"
className="text-positive"     // signal color
style={{ color: 'var(--sidebar-fg)' }}  // when Tailwind utility not registered
```

**Forbidden in components:**
```tsx
className="bg-gray-900"    // hardcoded Tailwind scale
className="text-emerald-400"  // hardcoded Tailwind scale
style={{ color: '#004A64' }}   // hardcoded hex
```

**Token list** (defined in `src/app/globals.css`):
- `background`, `surface`, `surface-2`
- `foreground`, `muted`, `muted-fg`
- `border`, `border-strong`
- `primary`, `primary-fg`, `accent`, `accent-fg`, `link`
- `positive`, `negative`, `warning`
- `sidebar`, `sidebar-fg`, `sidebar-muted`, `sidebar-active`, `sidebar-accent`
- `topbar`, `topbar-fg`, `topbar-border`

---

## 4. Information Density

Every pixel carries information. White space separates data groups, not fills space.

- Tables are the default layout for lists of companies, indicators, and filings.
- Cards are used only for KPI summary strips or where a table would have 1–2 rows.
- Font sizes: body 13px, labels 11–12px, section heads 13–14px max.
- Table row height: tight. `py-2.5 px-3` is the standard cell padding.
- Do not add decorative spacing between rows.

---

## 5. Typography

- Font: institutional sans-serif stack — Helvetica Neue first, then system fallbacks. No web font downloads.
  ```
  "Helvetica Neue", Helvetica, Arial, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
  ```
- Monospace for all numeric data, prices, timestamps, tickers, codes:
  ```
  ui-monospace, 'Cascadia Code', 'Fira Mono', 'Roboto Mono', monospace
  ```
- `tabular-nums` (`font-variant-numeric: tabular-nums`) on all number columns.
- **Body font is the default for ALL UI text.** Labels, headers, table headers, badges, eyebrows — all use the sans-serif stack. Only data values use `font-mono`.
- Use CSS utility classes `ui-label` and `ui-table-header` (defined in `globals.css`) for section titles and table column headers. These set 11px / 500 weight / uppercase / 0.04em tracking using the body font.
- `font-mono` is reserved for: prices, numbers, financial data, tickers/codes in data cells, timestamps in data rows, version strings.
- Section labels: `className="ui-label text-muted-fg"` — NO `font-mono`, NO explicit tracking class.
- Page titles: `text-sm font-semibold text-foreground`.
- Short monograms or abbreviations (e.g. "CMI" brand mark): `tracking-wider` (0.05em) is acceptable.
- `tracking-widest` (0.1em) is forbidden — generic AI dashboard anti-pattern.
- Do not use decorative fonts. Do not use condensed or display typefaces.

---

## 6. Bilingual Interface

The interface supports English (default) and Spanish. All UI labels are in the translation dictionary at `src/lib/i18n.ts`. Language is toggled via a button in the TopBar and persisted in localStorage.

Rules:
- Default language: English.
- All navigation labels, table headers, placeholders, and status text must use `t.key` from the translation dictionary.
- Data values (company names, financial figures, CMF filing text) are not translated.
- Spanish is for Chilean institutional users. English is for broader legibility.
- If a new UI label is added, it must be added to both `en` and `es` dictionaries simultaneously.

---

## 7. Light/Dark Toggle

- Light mode is the default and first-class design.
- Dark mode is derived from the same palette — not redesigned separately.
- Toggle is in the TopBar as an **icon-only button** — sun icon in light mode, moon icon in dark mode.
- No text label on the toggle. Uses `aria-label` for accessibility.
- Preference is persisted in localStorage (`theme` key).
- System preference is respected only on first load when no saved preference exists.
- An inline `<script>` in `layout.tsx` applies the `.dark` class before paint to prevent flash.
- No extra theme library is used.
- Do not replace the icon toggle with a text label ("Theme: Light" / "Theme: Dark") — that is the deprecated approach.

---

## 8. Layout Structure

- Left sidebar: fixed `w-52`, always dark navy (`--sidebar`).
- TopBar: `h-10` strip above the main content.
- Main content: `px-6 py-5`, scrollable.
- Tables: `bg-surface`, header row `bg-surface-2`, hover `hover:bg-surface-2`.
- No centered hero layouts. Content starts at the top-left.
- Sticky table headers when tables scroll vertically (add in Phase 2).

---

## 9. Sidebar Design

The sidebar is always dark navy regardless of light/dark mode. This provides a consistent visual anchor.

- Active item: `border-l-2` with `--sidebar-accent` color + `--sidebar-active` background.
- Inactive item: `--sidebar-muted` text, transparent background.
- Brand mark: "CMI" in `--sidebar-accent`, subtitle in `--sidebar-muted`.

---

## 10. Anti-patterns (Forbidden)

These patterns are explicitly banned. If a future prompt produces any of these, reject and revise before merging.

| Pattern | Reason |
|---|---|
| `bg-gray-900` or any raw Tailwind scale on themed elements | Breaks dark mode — use semantic tokens |
| `rounded-2xl` or larger | Too consumer-SaaS |
| Gradient backgrounds (`bg-gradient-to-*`) | Decorative, not institutional |
| `text-purple-*` anywhere | Associated with generic AI UI |
| Hero sections or full-viewport imagery | Not a landing page |
| Animated number counters or transitions | Distracting |
| Glassmorphism (`backdrop-blur`, transparent panels) | Not appropriate |
| 3D effects or drop shadows (`shadow-2xl`, `drop-shadow-lg`) | Flat design only |
| Skeleton loading screens (MVP) | Placeholder bars are fine |
| Auto-playing animations | Distracting |
| Hardcoded colors in component files | Use CSS variables |
| `tracking-widest` on section headers | Too wide — generic AI dashboard aesthetic. Use `tracking-wide`. |
| Text-label theme toggle ("Theme: Light") | Use icon-only sun/moon button with `aria-label`. |

---

## 11. Theme Toggle Design

The TopBar theme toggle is a **segmented pill** showing both options:

```
[ ☀ Light  |  ☽ Dark ]
```

- Container: `bg-surface-2 border border-border rounded-full p-0.5`
- Active segment: inline style `backgroundColor: var(--surface), color: var(--foreground)` + `rounded-full`
- Inactive segment: `color: var(--muted-fg)`, transparent background
- Each segment: `text-xs`, icon + text label
- Uses `role="group"` on the container for accessibility
- Preference persisted in `localStorage` (`theme` key)

Do not replace with icon-only or text-only versions. Do not use neumorphic shadows.

---

## 12. News Module Design

The News module on the Home dashboard is an institutional monitoring panel, not a blog feed. Module title: **NEWS** (English) / **NOTICIAS** (Spanish).

- Each item displays: headline (14px / font-medium) → meta row (body font; timestamp alone uses `font-mono`) → AI summary → affected chips.

### Materiality badge color system

| Materiality | EN label | ES label | Color variable | Rationale |
|---|---|---|---|---|
| High | High | Alta | `--negative` (red) | Requires immediate attention |
| Medium | Medium | Media | `--warning` (amber/gold) | Monitor closely |
| Low | Low | Baja | `--accent` (institutional blue) | For awareness |

All badge backgrounds use `color-mix(in oklab, var(--color) N%, var(--surface))` — adapts automatically to light and dark mode.

### Affected chips

- Ticker chips (`BSANTANDER`, `COPEC`, etc.): `font-mono bg-surface-2 text-foreground border-border` — identifiers, monospace intentional.
- Macro variable chips (`TPM`, `UF`, etc.): `font-mono bg-surface-2 text-muted border-border`.
- "Affected:" label: body font, no `font-mono`.
- Items separated by `divide-y divide-border` — no card stack, no box-shadow.
- Live news ingestion is future work. MVP data: `src/data/news_mock.ts`.

---

## 12. Data Presentation Standards

- Every number must show its source and timestamp. No orphan data points.
- Chilean locale for financial data: period as thousands separator, comma as decimal: `$1.234.567,50`
- Use `formatters.ts` functions — never inline `toLocaleString()`.
- Abbreviate large numbers: M (millones), MM (miles de millones).
- Show units in column headers, not inline per cell.
- Timestamps: `DD/MM/YYYY HH:MM` for Chilean filings; English locale for interface dates.
