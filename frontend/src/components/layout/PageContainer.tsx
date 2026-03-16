import type { ReactNode } from 'react'

export function PageContainer({ children }: { children: ReactNode }) {
  return <main className="flex-1 p-4 md:p-6 space-y-6">{children}</main>
}
