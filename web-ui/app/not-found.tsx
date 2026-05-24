import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] w-full max-w-3xl items-center px-4 py-10 sm:px-6">
      <div className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-5">
        <p className="text-sm font-medium text-zinc-100">Nothing matched that route.</p>
        <p className="mt-1 text-sm text-zinc-400">
          The capture, session, or playbook may have been deleted locally.
        </p>
        <Button asChild className="mt-4 bg-zinc-100 text-zinc-950 hover:bg-white">
          <Link href="/captures">Open Captures</Link>
        </Button>
      </div>
    </main>
  )
}
