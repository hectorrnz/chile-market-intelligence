import { LangProvider } from '@/components/providers/LangProvider'
import { SidebarProvider } from '@/components/providers/SidebarProvider'
import { MarketDataProvider } from '@/components/providers/MarketDataProvider'
import { MacroDataProvider } from '@/components/providers/MacroDataProvider'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { CommandPalette } from '@/components/ui/CommandPalette'

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <LangProvider>
      <MarketDataProvider>
        <MacroDataProvider>
          <SidebarProvider>
            <div className="flex h-full overflow-hidden bg-background print:block print:h-auto print:overflow-visible">
              <Sidebar />
              <div className="flex flex-col flex-1 min-w-0 overflow-hidden print:overflow-visible">
                <TopBar />
                <main className="flex-1 overflow-y-auto px-3 py-4 sm:px-6 sm:py-5 bg-background print:overflow-visible print:px-0 print:py-0">
                  {children}
                </main>
              </div>
            </div>
            <CommandPalette />
          </SidebarProvider>
        </MacroDataProvider>
      </MarketDataProvider>
    </LangProvider>
  )
}
