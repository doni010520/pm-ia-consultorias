import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, formatDistanceToNow, parseISO, isValid } from 'date-fns'
import { ptBR } from 'date-fns/locale'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '-'
  const d = typeof date === 'string' ? parseISO(date) : date
  if (!isValid(d)) return '-'
  return format(d, 'dd/MM/yyyy', { locale: ptBR })
}

export function formatDateTime(date: string | Date | null | undefined): string {
  if (!date) return '-'
  const d = typeof date === 'string' ? parseISO(date) : date
  if (!isValid(d)) return '-'
  return format(d, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
}

export function formatRelative(date: string | Date | null | undefined): string {
  if (!date) return '-'
  const d = typeof date === 'string' ? parseISO(date) : date
  if (!isValid(d)) return '-'
  return formatDistanceToNow(d, { addSuffix: true, locale: ptBR })
}

export function formatCurrency(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return 'R$ 0,00'
  const num = typeof value === 'string' ? parseFloat(value) : value
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(num)
}

export function formatHours(hours: number | string | null | undefined): string {
  if (hours === null || hours === undefined) return '0h'
  const num = typeof hours === 'string' ? parseFloat(hours) : hours
  return `${num.toFixed(1)}h`
}

export function getProgressColor(percent: number): string {
  if (percent >= 80) return 'bg-success'
  if (percent >= 50) return 'bg-primary'
  if (percent >= 25) return 'bg-warning'
  return 'bg-destructive'
}
