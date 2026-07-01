import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon: ReactNode
  title: string
  description: string
  action?: ReactNode
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 text-zinc-500">{icon}</div>
      <h3 className="mb-1 text-base font-medium text-zinc-200">{title}</h3>
      <p className="max-w-xs text-sm text-zinc-500">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}
