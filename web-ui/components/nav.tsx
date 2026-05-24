'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const tabs = [
  { label: 'Captures', href: '/captures' },
  { label: 'Sessions', href: '/sessions' },
  { label: 'Export', href: '/export' },
  { label: 'Guidance', href: '/guidance' },
  { label: 'Archive', href: '/archive' },
]

export function Nav() {
  const pathname = usePathname()

  return (
    <nav aria-label="Primary" className="flex h-14 w-full items-center gap-4 border-b border-zinc-800 bg-zinc-950 px-4 sm:px-6">
      <span className="mr-1 shrink-0 text-sm font-semibold text-zinc-50">Spectra</span>

      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const isActive = pathname === tab.href || pathname.startsWith(tab.href + '/')
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={isActive ? 'page' : undefined}
              // Aurora Glass §"Sidebar": active state = accent-glow background
              // pill + primary text (NOT a bottom border, which is Calm
              // Precision). Rounded 8px matches Aurora Glass nav-item radius.
              className={[
                'relative flex h-14 shrink-0 items-center px-3 text-sm transition-colors',
                isActive
                  ? 'aurora-nav-active font-medium rounded-md my-2 h-10 px-3 self-center'
                  : 'text-zinc-400 hover:text-zinc-200',
              ].join(' ')}
            >
              {tab.label}
            </Link>
          )
        })}
      </div>

      <span className="hidden shrink-0 font-mono text-xs text-zinc-500 sm:inline">
        v0.1.0
      </span>
    </nav>
  )
}
