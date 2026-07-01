'use client'

import type { StorageStats } from '@/lib/types'
import { formatBytes } from '@/lib/utils'

interface StorageStatsProps {
  stats: StorageStats
}

const PLATFORM_COLORS: Record<string, string> = {
  web: 'bg-blue-500',
  macos: 'bg-purple-500',
  ios: 'bg-green-500',
  watchos: 'bg-orange-500',
}

function platformColor(platform: string): string {
  return PLATFORM_COLORS[platform] ?? 'bg-zinc-500'
}

const TYPE_COLORS: Record<string, string> = {
  png: 'bg-blue-400',
  jpg: 'bg-green-400',
  jpeg: 'bg-green-400',
  mp4: 'bg-red-400',
  mov: 'bg-orange-400',
  webp: 'bg-purple-400',
}

function typeColor(ext: string): string {
  return TYPE_COLORS[ext.toLowerCase()] ?? 'bg-zinc-500'
}

interface BarChartProps {
  entries: { label: string; value: number; colorClass: string }[]
  total: number
}

function HorizontalBarChart({ entries, total }: BarChartProps) {
  if (entries.length === 0) {
    return <p className="text-xs text-zinc-500">No data</p>
  }
  return (
    <div className="space-y-2">
      {entries.map(({ label, value, colorClass }) => {
        const pct = total > 0 ? Math.max(1, Math.round((value / total) * 100)) : 0
        return (
          <div key={label}>
            <div className="mb-1 flex justify-between text-xs">
              <span className="capitalize text-zinc-300">{label}</span>
              <span className="text-zinc-500">{formatBytes(value)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className={`h-full rounded-full ${colorClass}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function StorageStats({ stats }: StorageStatsProps) {
  const platformEntries = Object.entries(stats.byPlatform).map(([label, value]) => ({
    label,
    value,
    colorClass: platformColor(label),
  }))

  const typeEntries = Object.entries(stats.byType).map(([label, value]) => ({
    label,
    value,
    colorClass: typeColor(label),
  }))

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-5">
      <div className="space-y-5">
        {/* Total KPI */}
        <div>
          <span className="text-sm font-bold text-zinc-50">{formatBytes(stats.totalSize)}</span>
          <p className="mt-0.5 text-[10px] uppercase tracking-wider text-zinc-500">Total Storage</p>
        </div>

        <div className="border-t border-white/[0.06]" />

        {/* By platform + by type */}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <div>
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500">
              By Platform
            </h3>
            <HorizontalBarChart entries={platformEntries} total={stats.totalSize} />
          </div>
          <div>
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500">
              By File Type
            </h3>
            <HorizontalBarChart entries={typeEntries} total={stats.totalSize} />
          </div>
        </div>

        {/* Largest sessions */}
        {stats.largestSessions.length > 0 && (
          <>
            <div className="border-t border-white/[0.06]" />
            <div>
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500">
                Largest Sessions
              </h3>
              <div className="divide-y divide-white/[0.06]">
                {stats.largestSessions.map((s) => (
                  <div key={s.sessionId} className="flex items-center justify-between py-2">
                    <span className="max-w-[60%] truncate text-sm text-zinc-300">{s.name}</span>
                    <span className="text-xs text-zinc-500">{formatBytes(s.size)}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
