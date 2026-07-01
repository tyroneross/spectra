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
    <nav
      aria-label="Primary"
      className="flex h-14 w-full items-center gap-4 border-b border-white/[0.08] bg-zinc-950 px-4 sm:px-6"
    >
      <div className="mr-1 flex shrink-0 items-center gap-1.5">
        <span className="size-1.5 rounded-full bg-indigo-400" aria-hidden="true" />
        <span className="text-sm font-semibold text-zinc-50">Spectra</span>
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const isActive = pathname === tab.href || pathname.startsWith(tab.href + '/')
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={isActive ? 'page' : undefined}
              className={[
                'relative flex shrink-0 items-center rounded-md px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60',
                isActive
                  ? 'h-10 self-center bg-indigo-400/10 font-medium text-indigo-300'
                  : 'h-14 text-zinc-400 hover:text-zinc-200',
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
