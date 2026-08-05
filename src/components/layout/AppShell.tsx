import { LangProvider } from '@/components/providers/LangProvider'
import { MobileNavProvider } from '@/components/providers/MobileNavProvider'
import { MarketDataProvider } from '@/components/providers/MarketDataProvider'
import { MacroDataProvider } from '@/components/providers/MacroDataProvider'
import { TopBar } from './TopBar'
import { SecondaryNav } from './SecondaryNav'
import { MobileNavDrawer } from './MobileNavDrawer'
import { CommandPalette } from '@/components/ui/CommandPalette'

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <LangProvider>
      <MarketDataProvider>
        <MacroDataProvider>
          <MobileNavProvider>
            <div className="flex flex-col h-full overflow-hidden bg-background print:block print:h-auto print:overflow-visible">
              <TopBar />
              <SecondaryNav />
              {/* The scroll container spans the full window width so the
                  vertical scrollbar sits at the screen edge at every viewport;
                  the --content-max-w Fable cap lives on the inner wrapper
                  (same split TopBar/SecondaryNav already use). */}
              <main className="flex-1 overflow-y-auto px-3 py-4 sm:px-6 sm:py-5 bg-background print:overflow-visible print:px-0 print:py-0 w-full">
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
    </LangProvider>
  )
}
