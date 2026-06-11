import { listCaptures, listProductionBundles } from '@/lib/data'
import { ExportWizard } from '@/components/export-wizard'
import type { ProductionBundleSummary } from '@/lib/types'
import Link from 'next/link'

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function getString(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function statusLabel(status: ProductionBundleSummary['status']): string {
  if (status === 'production-ready') return 'Ready'
  if (status === 'review-needed') return 'Review'
  return 'Draft'
}

function statusClass(status: ProductionBundleSummary['status']): string {
  if (status === 'production-ready') return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
  if (status === 'review-needed') return 'border-amber-400/30 bg-amber-400/10 text-amber-200'
  return 'border-zinc-600 bg-zinc-900 text-zinc-300'
}

function ProductionBundles({ bundles }: { bundles: ProductionBundleSummary[] }) {
  return (
    <section className="space-y-3 border-t border-zinc-800 pt-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-zinc-50">
          Production Bundles <span className="ml-1 text-sm font-normal text-zinc-500">{bundles.length}</span>
        </h2>
      </div>

      {bundles.length === 0 ? (
        <p className="text-sm text-zinc-500">No production bundles yet.</p>
      ) : (
        <div className="divide-y divide-zinc-800 rounded-lg border border-zinc-800">
          {bundles.slice(0, 8).map((bundle) => (
            <Link
              key={bundle.id}
              href={`/productions/${bundle.id}`}
              className="grid gap-3 p-4 transition-colors hover:bg-zinc-900/60 sm:grid-cols-[minmax(0,1fr)_auto]"
            >
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-sm font-medium text-zinc-100">{bundle.title}</h3>
                  <span className={`rounded-md border px-2 py-0.5 text-xs ${statusClass(bundle.status)}`}>
                    {statusLabel(bundle.status)}
                  </span>
                  {bundle.preset && (
                    <span className="rounded-md border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400">
                      {bundle.preset}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                  <span>{formatDate(bundle.createdAt)}</span>
                  <span>{bundle.sourceCount} source{bundle.sourceCount === 1 ? '' : 's'}</span>
                  <span>{bundle.assetCount} asset{bundle.assetCount === 1 ? '' : 's'}</span>
                  <span>{formatBytes(bundle.totalSize)}</span>
                  <span>{bundle.score}/100</span>
                </div>
                <code className="block truncate text-xs text-zinc-500">{bundle.path}</code>
              </div>
              <div className="min-w-0 text-xs text-zinc-500 sm:text-right">
                <p className="truncate">Manifest: {bundle.manifestPath}</p>
                {bundle.qualityReportPath && <p className="truncate">Quality: {bundle.qualityReportPath}</p>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}

export default async function ExportPage({ searchParams }: PageProps) {
  const sp = await searchParams
  const selectedParam = getString(sp.selected)
  const preselectedIds = selectedParam ? selectedParam.split(',').filter(Boolean) : []

  const [captures, bundles] = await Promise.all([
    listCaptures(),
    listProductionBundles(),
  ])

  return (
    <main className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-zinc-50 mb-1">Export</h1>
        <p className="text-sm text-zinc-500">Select captures, add captions, and export in your preferred format.</p>
      </div>

      <ExportWizard captures={captures} preselectedIds={preselectedIds} />
      <ProductionBundles bundles={bundles} />
    </main>
  )
}
