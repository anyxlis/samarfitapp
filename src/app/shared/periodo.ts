import { fechaCorta, hoyISO } from './format';

export type Periodo = 'mes' | 'mes_anterior' | 'anio' | 'todo' | 'personalizado';

export const PERIODOS: { id: Periodo; nombre: string }[] = [
  { id: 'mes', nombre: 'Este mes' },
  { id: 'mes_anterior', nombre: 'Mes anterior' },
  { id: 'anio', nombre: 'Este año' },
  { id: 'todo', nombre: 'Todo' },
  { id: 'personalizado', nombre: 'Personalizado' },
];

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

/** Devuelve el rango de fechas (YYYY-MM-DD) del periodo; '' = sin límite */
export function rangoPeriodo(p: Periodo): { desde: string; hasta: string } {
  const h = new Date();
  switch (p) {
    case 'mes': return { desde: iso(new Date(h.getFullYear(), h.getMonth(), 1)), hasta: hoyISO() };
    case 'mes_anterior': return { desde: iso(new Date(h.getFullYear(), h.getMonth() - 1, 1)), hasta: iso(new Date(h.getFullYear(), h.getMonth(), 0)) };
    case 'anio': return { desde: iso(new Date(h.getFullYear(), 0, 1)), hasta: hoyISO() };
    default: return { desde: '', hasta: '' };
  }
}

export function textoRango(desde: string, hasta: string): string {
  if (!desde && !hasta) return 'Todas las fechas';
  return `Del ${fechaCorta(desde) || '…'} al ${fechaCorta(hasta) || 'hoy'}`;
}
