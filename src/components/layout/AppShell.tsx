import { LangProvider } from '@/components/providers/LangProvider'
import { MobileNavProvider } from '@/components/providers/MobileNavProvider'
import { MarketDataProvider } from '@/components/providers/MarketDataProvider'
import { MacroDataProvider } from '@/components/providers/MacroDataProvider'
import { ModuleAccessProvider } from '@/components/providers/ModuleAccessProvider'
import { TopBar } from './TopBar'
import { SecondaryNav } from './SecondaryNav'
import { MobileNavDrawer } from './MobileNavDrawer'
import { CommandPalette } from '@/components/ui/CommandPalette'

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <LangProvider>
      <ModuleAccessProvider>
        <MarketDataProvider>
          <MacroDataProvider>
            <MobileNavProvider>
              {/* R13.R1 § 6 — `relative` here and on <main> is LOAD-BEARING, not
                  cosmetic.

                  An `overflow` value clips only those descendants for which the
                  element is their CONTAINING BLOCK. Both of these were statically
                  positioned, so every `position: absolute` descendant with no
                  positioned ancestor resolved its containing block to the INITIAL
                  containing block — escaping `overflow-hidden` here and
                  `overflow-y-auto` on <main>, refusing to scroll with the content,
                  and inflating the DOCUMENT's scrollable height. The shell is
                  `h-full`, so everything past the viewport was empty: a page-level
                  scrollbar into a blank region roughly a viewport tall.

                  Measured on the Portfolio Summary before this fix:
                  documentElement.scrollHeight 5241 against innerHeight 844, with
                  the two `sr-only` spans of DualFreshnessBadge reporting viewport
                  positions ~1612px (= main.scrollTop) below their own parent
                  chips — proof they were not in <main>'s scroll space.

                  Positioning the scroll container fixes the whole class of defect
                  rather than one component's `sr-only`. Nothing regresses: every
                  other absolutely-positioned element in the app already sits
                  inside an explicit `relative` parent, and overlays use `fixed`,
                  which a `relative` ancestor does not affect. */}
              <div className="relative flex flex-col h-full overflow-hidden bg-background print:block print:h-auto print:overflow-visible">
                <TopBar />
                <SecondaryNav />
                {/* The scroll container spans the full window width so the
                    vertical scrollbar sits at the screen edge at every viewport;
                    the --content-max-w Fable cap lives on the inner wrapper
                    (same split TopBar/SecondaryNav already use). */}
                <main className="relative flex-1 min-h-0 overflow-y-auto px-3 py-4 sm:px-6 sm:py-5 bg-background print:overflow-visible print:px-0 print:py-0 w-full">
                  <div className="w-full max-w-(--content-max-w) mx-auto">
                    {children}
                  </div>
                </main>
                <MobileNavDrawer />
              </div>
              <CommandPalette />
            </MobileNavProvider>
          </MacroDataProvider>
        </MarketDataProvider>
      </ModuleAccessProvider>
    </LangProvider>
  )
}
