import { listArchived, getStorageStats } from '@/lib/data'
import { StorageStats } from '@/components/storage-stats'
import { ArchiveClient } from './archive-client'

export default async function ArchivePage() {
  const [captures, stats] = await Promise.all([
    listArchived(),
    getStorageStats(),
  ])

  return (
    <main className="p-6 space-y-8">
      <div>
        <h1 className="text-lg font-semibold text-zinc-50 mb-1">Archive</h1>
        <p className="text-sm text-zinc-500">Archived captures are stored separately and excluded from the main captures view.</p>
      </div>

      {/* Archive browser */}
      <section>
        <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wide mb-4">
          Archived captures
          {captures.length > 0 && <span className="ml-2 text-zinc-600">{captures.length}</span>}
        </h2>
        <ArchiveClient initialCaptures={captures} />
      </section>

      {/* Storage stats */}
      <section>
        <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wide mb-4">Storage</h2>
        <StorageStats stats={stats} />
      </section>
    </main>
  )
}
