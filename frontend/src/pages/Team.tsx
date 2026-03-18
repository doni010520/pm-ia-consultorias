import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageContainer } from '@/components/layout/PageContainer'
import { LoadingSpinner, EmptyState, ErrorState } from '@/components/shared/LoadingSpinner'
import { InviteModal } from '@/components/team/InviteModal'
import { usersApi, invitesApi } from '@/services/api'
import { useAuthStore } from '@/stores/authStore'
import { UserPlus, Mail, RotateCcw, X, Copy, Clock, CheckCircle2, XCircle, Users, Send } from 'lucide-react'

const roleLabels: Record<string, string> = {
  admin: 'Admin',
  manager: 'Gerente',
  member: 'Membro',
}

const roleBadgeVariant: Record<string, 'default' | 'secondary' | 'outline'> = {
  admin: 'default',
  manager: 'secondary',
  member: 'outline',
}

export default function Team() {
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [tab, setTab] = useState<'members' | 'invites'>('members')
  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.role === 'admin'
  const qc = useQueryClient()

  // Fetch members
  const { data: membersData, isLoading: membersLoading, error: membersError } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.list(),
  })

  // Fetch invites (only for admin)
  const { data: invitesData, isLoading: invitesLoading } = useQuery({
    queryKey: ['invites'],
    queryFn: () => invitesApi.list(),
    enabled: isAdmin,
  })

  // Resend invite
  const resendMutation = useMutation({
    mutationFn: (id: string) => invitesApi.resend(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invites'] }),
  })

  // Cancel invite
  const cancelMutation = useMutation({
    mutationFn: (id: string) => invitesApi.cancel(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invites'] }),
  })

  const members = membersData?.users || []
  const invites = invitesData?.invites || []
  const pendingCount = invites.filter((i) => i.status === 'pending').length

  return (
    <PageContainer>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Equipe</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {members.length} membro{members.length !== 1 ? 's' : ''}
            {pendingCount > 0 && ` · ${pendingCount} convite${pendingCount !== 1 ? 's' : ''} pendente${pendingCount !== 1 ? 's' : ''}`}
          </p>
        </div>
        {isAdmin && (
          <Button onClick={() => setShowInviteModal(true)}>
            <UserPlus className="h-4 w-4 mr-2" />
            Convidar Membro
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b">
        <button
          onClick={() => setTab('members')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'members'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Users className="h-4 w-4 inline mr-1.5 -mt-0.5" />
          Membros
        </button>
        {isAdmin && (
          <button
            onClick={() => setTab('invites')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === 'invites'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Send className="h-4 w-4 inline mr-1.5 -mt-0.5" />
            Convites
            {pendingCount > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center h-5 w-5 rounded-full bg-primary text-primary-foreground text-xs">
                {pendingCount}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Members Tab */}
      {tab === 'members' && (
        <>
          {membersLoading && <LoadingSpinner />}
          {membersError && <ErrorState message="Erro ao carregar membros" />}
          {!membersLoading && !membersError && members.length === 0 && (
            <EmptyState message="Nenhum membro cadastrado" />
          )}
          {!membersLoading && members.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {members.map((m) => (
                <Card key={m.id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{m.name}</CardTitle>
                      <Badge variant={roleBadgeVariant[m.role] || 'outline'}>
                        {roleLabels[m.role] || m.role}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-1 text-sm text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <Mail className="h-3.5 w-3.5" />
                        {m.email}
                      </div>
                      {!m.is_active && (
                        <Badge variant="destructive" className="mt-2">Inativo</Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {/* Invites Tab */}
      {tab === 'invites' && isAdmin && (
        <>
          {invitesLoading && <LoadingSpinner />}
          {!invitesLoading && invites.length === 0 && (
            <EmptyState message="Nenhum convite enviado" />
          )}
          {!invitesLoading && invites.length > 0 && (
            <div className="space-y-3">
              {invites.map((inv) => (
                <Card key={inv.id}>
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{inv.name}</span>
                          <Badge variant={roleBadgeVariant[inv.role] || 'outline'} className="text-xs">
                            {roleLabels[inv.role] || inv.role}
                          </Badge>
                          {inv.status === 'pending' && (
                            <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 bg-amber-50">
                              <Clock className="h-3 w-3 mr-1" />
                              Pendente
                            </Badge>
                          )}
                          {inv.status === 'accepted' && (
                            <Badge variant="outline" className="text-xs text-green-600 border-green-300 bg-green-50">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Aceito
                            </Badge>
                          )}
                          {inv.status === 'cancelled' && (
                            <Badge variant="outline" className="text-xs text-gray-500 border-gray-300 bg-gray-50">
                              <XCircle className="h-3 w-3 mr-1" />
                              Cancelado
                            </Badge>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground">{inv.email}</div>
                        <div className="text-xs text-muted-foreground">
                          Enviado em {new Date(inv.created_at).toLocaleDateString('pt-BR')}
                          {inv.expires_at && inv.status === 'pending' && (
                            <> · Expira em {new Date(inv.expires_at).toLocaleDateString('pt-BR')}</>
                          )}
                        </div>
                      </div>

                      {inv.status === 'pending' && (
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => resendMutation.mutate(inv.id)}
                            disabled={resendMutation.isPending}
                            title="Reenviar convite"
                          >
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              if (confirm('Cancelar este convite?')) {
                                cancelMutation.mutate(inv.id)
                              }
                            }}
                            disabled={cancelMutation.isPending}
                            title="Cancelar convite"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {/* Invite Modal */}
      <InviteModal
        open={showInviteModal}
        onOpenChange={setShowInviteModal}
        onSuccess={() => {
          qc.invalidateQueries({ queryKey: ['invites'] })
        }}
      />
    </PageContainer>
  )
}
