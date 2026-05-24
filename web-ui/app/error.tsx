'use client'

import { Button } from '@/components/ui/button'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] w-full max-w-3xl items-center px-4 py-10 sm:px-6">
      <div className="w-full rounded-lg border border-red-900/50 bg-red-950/20 p-5">
        <p className="text-sm font-medium text-red-200">This view could not load.</p>
        <p className="mt-1 text-sm text-red-300/80">
          Spectra could not read the local capture data. Retry after the filesystem settles.
        </p>
        {error.digest && (
          <p className="mt-3 font-mono text-xs text-red-300/60">Digest: {error.digest}</p>
        )}
        <Button onClick={reset} className="mt-4 bg-red-200 text-red-950 hover:bg-red-100">
          Retry
        </Button>
      </div>
    </main>
  )
}
