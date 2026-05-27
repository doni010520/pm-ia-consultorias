import { useNavigate } from 'react-router-dom'
import { Bot } from 'lucide-react'
import { PageContainer } from '@/components/layout/PageContainer'
import { RicaDashboard } from '@/components/crm/RicaDashboard'

export default function Rica() {
  const navigate = useNavigate()

  const handleDealClick = (dealId: string) => {
    navigate(`/crm?deal=${dealId}`)
  }

  return (
    <PageContainer>
      <div className="flex items-center gap-3 mb-2">
        <Bot className="h-6 w-6 text-indigo-500" />
        <div>
          <h1 className="text-xl font-bold text-slate-800">Rica AI</h1>
          <p className="text-sm text-slate-500">Acompanhamento de leads qualificados pela Rica</p>
        </div>
      </div>
      <RicaDashboard onDealClick={handleDealClick} />
    </PageContainer>
  )
}
