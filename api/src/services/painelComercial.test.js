import { describe, it, expect } from 'vitest';
import { grupoDaEtapa, consolidar, calcularPainel, mesAnterior } from './painelComercial.js';

const AGORA = new Date('2026-09-20T12:00:00-03:00').getTime();
const deal = (o) => ({
  fonte: 'rd', id: Math.random().toString(36), funil: 'Consultorias', etapa: 'Proposta enviada',
  status: 'aberto', valor: 0, executivo: 'Alex', origem: 'Prospecção Ativa', produto: 'Consultoria',
  uf: 'SP', regiao: 'Sudeste', pausado: false, temProxima: false, criado: '2026-09-01',
  fechado: null, previsao: null, atualizado: '2026-09-15', chaves: [], ...o,
  grupo: o.status && o.status !== 'aberto' ? o.status : grupoDaEtapa(o.etapa ?? 'Proposta enviada'),
});

describe('grupoDaEtapa', () => {
  it('normaliza etapas do RD e do CRM', () => {
    expect(grupoDaEtapa('Contato feito')).toBe('Qualificação');
    expect(grupoDaEtapa('Identificação do interesse')).toBe('Qualificação');
    expect(grupoDaEtapa('Demostração')).toBe('Apresentação');
    expect(grupoDaEtapa('Degustação 7 Dias')).toBe('Apresentação');
    expect(grupoDaEtapa('Proposta enviada')).toBe('Proposta');
    expect(grupoDaEtapa('Negociacao')).toBe('Negociação');
    expect(grupoDaEtapa('fechada')).toBe('Fechamento');
    expect(grupoDaEtapa('Pós Venda')).toBe('cliente');
    expect(grupoDaEtapa('Fechado')).toBe('cliente');
    expect(grupoDaEtapa('Perdidos')).toBe('fora');
    expect(grupoDaEtapa('Novo Lead')).toBe('Sem contato');
  });
});

describe('consolidar', () => {
  it('negócio nos dois lados conta uma vez, pela versão mais recente', () => {
    const rd = [deal({ id: 'rd1', chaves: ['t99887766'], atualizado: '2026-09-10' }), deal({ id: 'rd2', chaves: ['t11112222'] })];
    const crm = [deal({ fonte: 'crm', id: 'c1', chaves: ['t99887766'], atualizado: '2026-09-18' }), deal({ fonte: 'crm', id: 'c2', chaves: ['t11112222'], atualizado: '2026-01-01' })];
    expect(consolidar(rd, crm).map((d) => d.id).sort()).toEqual(['c1', 'rd2']);
  });
});

describe('calcularPainel', () => {
  const linhas = [
    deal({ status: 'ganho', valor: 100_000, fechado: '2026-09-05T10:00:00-03:00' }),
    deal({ status: 'ganho', valor: 50_000, fechado: '2026-08-10T10:00:00-03:00', executivo: 'Lúcia' }),
    deal({ status: 'perdido', fechado: '2026-09-02T10:00:00-03:00' }),
    deal({ etapa: 'Negociação', valor: 40_000 }),
    deal({ etapa: 'Proposta enviada', valor: 60_000, executivo: 'Lúcia', atualizado: '2026-07-01' }),
    deal({ etapa: 'Sem contato', valor: 0 }),
    deal({ etapa: 'Pós Venda', valor: 999_999 }),
    deal({ etapa: 'Negociação', valor: 500_000, pausado: true }),
  ];
  const metas = [{ mes: '2026-09', executivo: null, valor: 300_000 }, { mes: '2026-09', executivo: 'Alex', valor: 200_000 }];

  it('KPIs do mês: só valor informado, sem pós-venda nem pausados', () => {
    const p = calcularPainel(linhas, metas, { mes: '2026-09' }, AGORA);
    expect(p.kpis.meta).toBe(300_000);
    expect(p.kpis.vendido).toBe(100_000);
    expect(p.kpis.vendidoAnt).toBe(50_000);
    expect(p.kpis.gap).toBe(200_000);
    expect(p.kpis.pipeline).toBe(100_000);
    expect(p.kpis.ponderado).toBeCloseTo(40_000 * 0.7 + 60_000 * 0.5);
    expect(p.kpis.commit).toBe(40_000);
    expect(p.kpis.cobertura).toBeCloseTo(0.5);
    expect(p.qualidade.abertosSemValor).toBe(1);
    expect(p.metaRealizadoForecast.projecao).toBe(140_000);
  });

  it('filtro de executivo usa a meta dele', () => {
    const p = calcularPainel(linhas, metas, { mes: '2026-09', executivo: 'Alex' }, AGORA);
    expect(p.kpis.meta).toBe(200_000);
    expect(p.kpis.pipeline).toBe(40_000);
  });

  it('tabela por executivo, parados e canais do ano', () => {
    const p = calcularPainel(linhas, metas, { mes: '2026-09' }, AGORA);
    const lucia = p.executivos.find((e) => e.nome === 'Lúcia');
    expect(lucia).toMatchObject({ pipeline: 60_000, parados: 1, meta: null });
    const canal = p.canais.find((c) => c.canal === 'Prospecção Ativa');
    expect(canal).toMatchObject({ clientes: 2, receita: 150_000 });
    expect(canal.conversao).toBeCloseTo(2 / 3);
  });

  it('forecast por etapa quando não há previsão de fechamento', () => {
    const p = calcularPainel(linhas, metas, { mes: '2026-09' }, AGORA);
    expect(p.forecast.find((f) => f.dias === 30).valor).toBeCloseTo(28_000);
    expect(p.forecast.find((f) => f.dias === 60).valor).toBeCloseTo(58_000);
  });

  it('mesAnterior vira o ano', () => {
    expect(mesAnterior('2026-01')).toBe('2025-12');
  });
});
