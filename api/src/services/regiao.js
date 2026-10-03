/**
 * UF e região de um negócio, a partir do endereço da empresa ou do DDD do
 * telefone do contato. Nem o RD nem o nosso CRM têm um campo de região.
 */

const UFS = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]);

const DDD_UF = {
  11: 'SP', 12: 'SP', 13: 'SP', 14: 'SP', 15: 'SP', 16: 'SP', 17: 'SP', 18: 'SP', 19: 'SP',
  21: 'RJ', 22: 'RJ', 24: 'RJ', 27: 'ES', 28: 'ES',
  31: 'MG', 32: 'MG', 33: 'MG', 34: 'MG', 35: 'MG', 37: 'MG', 38: 'MG',
  41: 'PR', 42: 'PR', 43: 'PR', 44: 'PR', 45: 'PR', 46: 'PR', 47: 'SC', 48: 'SC', 49: 'SC',
  51: 'RS', 53: 'RS', 54: 'RS', 55: 'RS',
  61: 'DF', 62: 'GO', 64: 'GO', 63: 'TO', 65: 'MT', 66: 'MT', 67: 'MS', 68: 'AC', 69: 'RO',
  71: 'BA', 73: 'BA', 74: 'BA', 75: 'BA', 77: 'BA', 79: 'SE',
  81: 'PE', 87: 'PE', 82: 'AL', 83: 'PB', 84: 'RN', 85: 'CE', 88: 'CE', 86: 'PI', 89: 'PI',
  91: 'PA', 93: 'PA', 94: 'PA', 92: 'AM', 97: 'AM', 95: 'RR', 96: 'AP', 98: 'MA', 99: 'MA',
};

const REGIAO_UF = {
  Norte: ['AC', 'AP', 'AM', 'PA', 'RO', 'RR', 'TO'],
  Nordeste: ['AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'RN', 'SE'],
  'Centro-Oeste': ['DF', 'GO', 'MT', 'MS'],
  Sudeste: ['ES', 'MG', 'RJ', 'SP'],
  Sul: ['PR', 'RS', 'SC'],
};

/** "Rua X, 10 - Centro, Paulínia - SP, 13141-010" → "SP" */
export function ufDoEndereco(endereco) {
  if (!endereco) return null;
  const achados = String(endereco).toUpperCase().match(/\b[A-Z]{2}\b/g) || [];
  // O último par de letras que é UF costuma ser o estado (o bairro vem antes).
  for (let i = achados.length - 1; i >= 0; i--) if (UFS.has(achados[i])) return achados[i];
  return null;
}

/** "+5519983440110" → "SP". Só números brasileiros. */
export function ufDoTelefone(telefone) {
  let d = String(telefone || '').replace(/\D/g, '');
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  if (d.length < 10) return null;
  return DDD_UF[Number(d.slice(0, 2))] || null;
}

export function regiaoDaUf(uf) {
  if (!uf) return null;
  for (const [regiao, ufs] of Object.entries(REGIAO_UF)) if (ufs.includes(uf)) return regiao;
  return null;
}
