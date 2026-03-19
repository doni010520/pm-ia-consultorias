import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { PageContainer } from '@/components/layout/PageContainer'
import { CapacityTimeline } from '@/components/capacity/CapacityTimeline'
import { CapacityMonthView } from '@/components/capacity/CapacityMonthView'
import { CapacityCharts } from '@/components/capacity/CapacityCharts'
import { Calendar, BarChart3, GanttChart } from 'lucide-react'

export default function CapacityCalendar() {
  return (
    <PageContainer>
      <div className="mb-4">
        <h1 className="text-2xl font-bold">Capacidade</h1>
        <p className="text-sm text-muted-foreground">Planejamento de capacidade e disponibilidade dos consultores</p>
      </div>

      <Tabs defaultValue="timeline" className="space-y-4">
        <TabsList>
          <TabsTrigger value="timeline" className="flex items-center gap-1.5">
            <GanttChart className="h-4 w-4" />
            Timeline
          </TabsTrigger>
          <TabsTrigger value="calendar" className="flex items-center gap-1.5">
            <Calendar className="h-4 w-4" />
            Calendario
          </TabsTrigger>
          <TabsTrigger value="charts" className="flex items-center gap-1.5">
            <BarChart3 className="h-4 w-4" />
            Graficos
          </TabsTrigger>
        </TabsList>

        <TabsContent value="timeline">
          <CapacityTimeline />
        </TabsContent>

        <TabsContent value="calendar">
          <CapacityMonthView />
        </TabsContent>

        <TabsContent value="charts">
          <CapacityCharts />
        </TabsContent>
      </Tabs>
    </PageContainer>
  )
}
