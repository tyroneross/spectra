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
    <nav className="w-full h-12 bg-zinc-900 border-b border-zinc-800 flex items-center px-6 gap-6">
      {/* Logo */}
      <span className="font-semibold text-zinc-50 mr-2 shrink-0">Spectra</span>

      {/* Tabs */}
      <div className="flex items-center gap-1 flex-1">
        {tabs.map((tab) => {
          const isActive = pathname === tab.href || pathname.startsWith(tab.href + '/')
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={[
                'relative px-3 h-12 flex items-center text-sm transition-colors',
                isActive
                  ? 'text-zinc-50 font-medium after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-white'
                  : 'text-zinc-400 hover:text-zinc-200',
              ].join(' ')}
            >
              {tab.label}
            </Link>
          )
        })}
      </div>

      {/* Version badge */}
      <span className="text-xs px-2 py-0.5 rounded bg-zinc-700 text-zinc-300 shrink-0">
        v0.1.0
      </span>
    </nav>
  )
}
