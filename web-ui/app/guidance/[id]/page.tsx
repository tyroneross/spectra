import Link from 'next/link'
import { getPlaybook } from '@/lib/data'
import { PlaybookPageClient } from './playbook-page-client'
import type { Playbook } from '@/lib/types'

interface PageProps {
  params: Promise<{ id: string }>
}

const NEW_PLAYBOOK: Playbook = {
  id: '',
  name: '',
  description: '',
  target: '',
  platform: 'web',
  steps: [],
  createdAt: 0,
  updatedAt: 0,
}

export default async function PlaybookDetailPage({ params }: PageProps) {
  const { id } = await params
  const isNew = id === 'new'

  const playbook = isNew ? NEW_PLAYBOOK : await getPlaybook(id)

  return (
    <main className="p-6 max-w-3xl mx-auto space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link href="/guidance" className="text-zinc-500 hover:text-zinc-300 transition-colors">
          Guidance
        </Link>
        <span className="text-zinc-700">/</span>
        <span className="text-zinc-300">{isNew ? 'New Playbook' : (playbook?.name || id)}</span>
      </div>

      <h1 className="text-lg font-semibold text-zinc-50">
        {isNew ? 'New Playbook' : 'Edit Playbook'}
      </h1>

      <PlaybookPageClient
        playbook={playbook ?? NEW_PLAYBOOK}
        isNew={isNew || !playbook}
      />
    </main>
  )
}
