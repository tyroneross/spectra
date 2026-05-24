export default function Loading() {
  return (
    <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] w-full max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6">
      <div className="space-y-2">
        <div className="h-6 w-36 animate-pulse rounded bg-zinc-800" />
        <div className="h-4 w-64 animate-pulse rounded bg-zinc-900" />
      </div>
      <div className="rounded-lg border border-zinc-800">
        <div className="grid grid-cols-2 gap-px bg-zinc-800 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="aspect-[16/10] animate-pulse bg-zinc-900" />
          ))}
        </div>
      </div>
    </main>
  )
}
