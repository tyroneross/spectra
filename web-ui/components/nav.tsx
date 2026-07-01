'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

const tabs = [
  { label: 'Captures', href: '/captures' },
  { label: 'Sessions', href: '/sessions' },
  { label: 'Export', href: '/export' },
  { label: 'Guidance', href: '/guidance' },
  { label: 'Archive', href: '/archive' },
]

const THEMES = [
  { label: 'Indigo', value: 'indigo' },
  { label: 'Warm', value: 'warm' },
  { label: 'Glass', value: 'glass' },
] as const

/**
 * Reads `?theme` from the browser location directly (not `useSearchParams`)
 * so this component never forces the surrounding route out of static
 * rendering — Nav lives in the root layout across every page. The no-flash
 * inline script in layout.tsx already sets `data-theme` before paint; this
 * only needs to reflect which link is "active" after hydration.
 */
function ThemeSwitcher() {
  const pathname = usePathname()
  const [currentTheme, setCurrentTheme] = useState('indigo')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setCurrentTheme(params.get('theme') ?? 'indigo')
  }, [pathname])

  return (
    <div className="flex items-center gap-2.5 text-xs" aria-label="Theme">
      {THEMES.map((theme) => {
        const isActive = currentTheme === theme.value
        return (
          <Link
            key={theme.value}
            href={`${pathname}?theme=${theme.value}`}
            className={
              isActive ? 'font-medium text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'
            }
          >
            {theme.label}
          </Link>
        )
      })}
    </div>
  )
}

export function Nav() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Primary"
      className="flex h-14 w-full items-center gap-4 border-b border-[var(--surface-border)] bg-zinc-950 px-4 sm:px-6"
    >
      <div className="mr-1 flex shrink-0 items-center gap-1.5">
        <span className="size-1.5 rounded-full bg-[var(--accent)]" aria-hidden="true" />
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
                'relative flex h-14 shrink-0 items-center border-b-2 px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]',
                isActive
                  ? 'border-[var(--accent)] font-medium text-zinc-50'
                  : 'border-transparent text-zinc-400 hover:text-zinc-200',
              ].join(' ')}
            >
              {tab.label}
            </Link>
          )
        })}
      </div>

      <div className="hidden shrink-0 items-center gap-3 sm:flex">
        <ThemeSwitcher />
        <span className="font-mono text-xs text-zinc-500">v0.1.0</span>
      </div>
    </nav>
  )
}
