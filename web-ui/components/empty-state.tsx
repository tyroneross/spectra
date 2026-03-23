import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon: ReactNode
  title: string
  description: string
  action?: ReactNode
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
      <div className="text-zinc-600 mb-4">{icon}</div>
      <h3 className="text-sm font-medium text-zinc-300 mb-1">{title}</h3>
      <p className="text-sm text-zinc-500 max-w-xs">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}
