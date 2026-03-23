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
            <div className="flex justify-between text-xs mb-1">
              <span className="text-zinc-300 capitalize">{label}</span>
              <span className="text-zinc-500">{formatBytes(value)}</span>
            </div>
            <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
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
    <div className="space-y-6">
      {/* Total */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 flex items-baseline gap-3">
        <span className="text-3xl font-bold text-zinc-50">{formatBytes(stats.totalSize)}</span>
        <span className="text-sm text-zinc-400">total storage used</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* By platform */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-4">By Platform</h3>
          <HorizontalBarChart entries={platformEntries} total={stats.totalSize} />
        </div>

        {/* By type */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-4">By File Type</h3>
          <HorizontalBarChart entries={typeEntries} total={stats.totalSize} />
        </div>
      </div>

      {/* Largest sessions */}
      {stats.largestSessions.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-4">Largest Sessions</h3>
          <div className="divide-y divide-zinc-800">
            {stats.largestSessions.map((s) => (
              <div key={s.sessionId} className="flex justify-between items-center py-2">
                <span className="text-sm text-zinc-300 truncate max-w-[60%]">{s.name}</span>
                <span className="text-xs text-zinc-500">{formatBytes(s.size)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
