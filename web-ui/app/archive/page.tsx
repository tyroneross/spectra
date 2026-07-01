import { listArchived, getStorageStats } from '@/lib/data'
import { StorageStats } from '@/components/storage-stats'
import { ArchiveClient } from './archive-client'

export default async function ArchivePage() {
  const [captures, stats] = await Promise.all([
    listArchived(),
    getStorageStats(),
  ])

  return (
    <main className="space-y-8 p-6">
      <div>
        <h1 className="mb-1 text-2xl font-bold text-zinc-50">Archive</h1>
        <p className="text-sm text-zinc-500">Archived captures are stored separately and excluded from the main captures view.</p>
      </div>

      {/* Archive browser */}
      <section>
        <h2 className="mb-4 text-xs font-medium uppercase tracking-wider text-zinc-500">
          Archived captures
          {captures.length > 0 && <span className="ml-2 text-zinc-600">{captures.length}</span>}
        </h2>
        <ArchiveClient initialCaptures={captures} />
      </section>

      {/* Storage stats */}
      <section>
        <h2 className="mb-4 text-xs font-medium uppercase tracking-wider text-zinc-500">Storage</h2>
        <StorageStats stats={stats} />
      </section>
    </main>
  )
}
