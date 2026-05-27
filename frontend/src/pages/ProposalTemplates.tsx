import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, ChevronDown, ChevronUp, FileSignature, X } from 'lucide-react'
import { PageContainer } from '@/components/layout/PageContainer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { crmApi } from '@/services/api'
import type { ProposalTemplate } from '@/types'

// ── Variable editor ────────────────────────────────────────────────────────────

function VariableEditor({
  variables,
  onChange,
}: {
  variables: ProposalTemplate['variables']
  onChange: (v: ProposalTemplate['variables']) => void
}) {
  const add = () => onChange([...variables, { key: '', label: '', default: '' }])
  const remove = (i: number) => onChange(variables.filter((_, idx) => idx !== i))
  const update = (i: number, field: 'key' | 'label' | 'default', val: string) =>
    onChange(variables.map((v, idx) => idx === i ? { ...v, [field]: val } : v))

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-slate-600">Variáveis (Handlebars)</label>
        <Button type="button" variant="ghost" size="sm" className="h-6 text-xs" onClick={add}>
          <Plus className="h-3 w-3 mr-1" /> Adicionar
        </Button>
      </div>
      {variables.map((v, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
          <Input
            placeholder="chave"
            value={v.key}
            onChange={e => update(i, 'key', e.target.value)}
            className="text-xs h-7 font-mono"
          />
          <Input
            placeholder="Rótulo"
            value={v.label}
            onChange={e => update(i, 'label', e.target.value)}
            className="text-xs h-7"
          />
          <Input
            placeholder="padrão"
            value={v.default ?? ''}
            onChange={e => update(i, 'default', e.target.value)}
            className="text-xs h-7"
          />
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-red-500" onClick={() => remove(i)}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      {variables.length === 0 && (
        <p className="text-xs text-slate-400 italic">Nenhuma variável. Use {'{{chave}}'} no corpo do template.</p>
      )}
    </div>
  )
}

// ── Template form dialog ───────────────────────────────────────────────────────

function TemplateFormDialog({
  template,
  onClose,
}: {
  template?: ProposalTemplate | null
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(template?.name ?? '')
  const [description, setDescription] = useState(template?.description ?? '')
  const [body, setBody] = useState(template?.body_markdown ?? '')
  const [variables, setVariables] = useState<ProposalTemplate['variables']>(template?.variables ?? [])

  const saveMutation = useMutation({
    mutationFn: () => {
      const data = { name, description, body_markdown: body, variables }
      return template
        ? crmApi.proposalTemplates.update(template.id, data)
        : crmApi.proposalTemplates.create(data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-proposal-templates'] })
      onClose()
    },
  })

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{template ? 'Editar Template' : 'Novo Template de Proposta'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">Nome *</label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Proposta Padrão" className="text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">Descrição</label>
            <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Breve descrição do template" className="text-sm" />
          </div>
          <VariableEditor variables={variables} onChange={setVariables} />
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">Corpo (Markdown + Handlebars)</label>
            <Textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder={'# {{titulo_proposta}}\n\nPrezado **{{nome_cliente}}**,\n\n...'}
              className="text-xs font-mono min-h-[280px]"
            />
            <p className="text-[10px] text-slate-400 mt-1">
              Use Markdown para formatação e {'{{variavel}}'} para campos dinâmicos. O PDF é gerado via Puppeteer.
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button
              disabled={!name.trim() || !body.trim() || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? 'Salvando…' : template ? 'Salvar alterações' : 'Criar template'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function ProposalTemplates() {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<ProposalTemplate | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['crm-proposal-templates'],
    queryFn: () => crmApi.proposalTemplates.list(),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => crmApi.proposalTemplates.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['crm-proposal-templates'] }),
  })

  const templates = data?.templates ?? []

  return (
    <PageContainer>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Templates de Proposta</h1>
          <p className="text-sm text-slate-500">Crie modelos de proposta em Markdown para geração automática de PDF</p>
        </div>
        <Button onClick={() => { setEditing(null); setShowForm(true) }}>
          <Plus className="h-4 w-4 mr-2" /> Novo Template
        </Button>
      </div>
      {isLoading ? (
        <div className="text-center py-12 text-slate-400">Carregando templates…</div>
      ) : templates.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
            <FileSignature className="h-12 w-12 opacity-30" />
            <p className="text-sm font-medium">Nenhum template criado</p>
            <p className="text-xs">Crie um template para gerar propostas comerciais em PDF automaticamente</p>
            <Button variant="outline" className="mt-2" onClick={() => { setEditing(null); setShowForm(true) }}>
              <Plus className="h-4 w-4 mr-2" /> Criar primeiro template
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {templates.map(t => (
            <Card key={t.id} className="overflow-hidden">
              <CardContent className="p-0">
                <div className="flex items-center gap-3 px-4 py-3">
                  <FileSignature className="h-5 w-5 text-violet-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-slate-800">{t.name}</p>
                      {!t.is_active && <Badge variant="outline" className="text-xs text-slate-400">Inativo</Badge>}
                      <Badge variant="outline" className="text-xs">
                        {t.variables.length} variável{t.variables.length !== 1 ? 'is' : ''}
                      </Badge>
                    </div>
                    {t.description && <p className="text-xs text-slate-500 mt-0.5">{t.description}</p>}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-slate-700"
                      onClick={() => { setEditing(t); setShowForm(true) }}
                      title="Editar"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-red-600"
                      onClick={() => { if (confirm(`Remover template "${t.name}"?`)) deleteMutation.mutate(t.id) }}
                      title="Remover"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost" size="icon" className="h-7 w-7 text-slate-400"
                      onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
                    >
                      {expandedId === t.id ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </div>

                {expandedId === t.id && (
                  <div className="border-t border-slate-100 px-4 py-3">
                    {t.variables.length > 0 && (
                      <div className="mb-3">
                        <p className="text-xs font-medium text-slate-500 mb-1.5">Variáveis</p>
                        <div className="flex flex-wrap gap-1.5">
                          {t.variables.map(v => (
                            <code key={v.key} className="text-[10px] bg-violet-50 text-violet-700 px-1.5 py-0.5 rounded">
                              {`{{${v.key}}}`} <span className="text-violet-400">— {v.label}</span>
                            </code>
                          ))}
                        </div>
                      </div>
                    )}
                    <p className="text-xs font-medium text-slate-500 mb-1.5">Prévia do corpo (Markdown)</p>
                    <pre className="text-[10px] font-mono bg-slate-50 rounded p-3 overflow-x-auto text-slate-700 max-h-48 whitespace-pre-wrap">
                      {t.body_markdown.slice(0, 800)}{t.body_markdown.length > 800 ? '\n…' : ''}
                    </pre>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {(showForm || editing) && (
        <TemplateFormDialog
          template={editing}
          onClose={() => { setShowForm(false); setEditing(null) }}
        />
      )}
    </PageContainer>
  )
}
