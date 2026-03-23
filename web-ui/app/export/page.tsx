import { listCaptures } from '@/lib/data'
import { ExportWizard } from '@/components/export-wizard'

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function getString(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

export default async function ExportPage({ searchParams }: PageProps) {
  const sp = await searchParams
  const selectedParam = getString(sp.selected)
  const preselectedIds = selectedParam ? selectedParam.split(',').filter(Boolean) : []

  const captures = await listCaptures()

  return (
    <main className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-zinc-50 mb-1">Export</h1>
        <p className="text-sm text-zinc-500">Select captures, add captions, and export in your preferred format.</p>
      </div>

      <ExportWizard captures={captures} preselectedIds={preselectedIds} />
    </main>
  )
}
