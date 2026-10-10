import { Pipe, PipeTransform } from '@angular/core';

const fmtCop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

export function cop(v: number | string | null | undefined): string {
  return fmtCop.format(Number(v ?? 0));
}

/** Quita tildes y pasa a minúsculas para búsquedas */
export function normalizar(t: unknown): string {
  return String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function hoyISO(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function mensajeError(e: any): string {
  switch (e?.code) {
    case '23505': return 'Ya existe un registro con ese documento o código.';
    case '23503': return 'No se puede eliminar porque tiene documentos asociados. Puedes desactivarlo.';
    case '23514': return 'La operación dejaría el inventario en negativo (puede que esas prendas ya se hayan vendido).';
    default: return e?.message ?? 'Ocurrió un error inesperado.';
  }
}

@Pipe({ name: 'cop', standalone: true })
export class CopPipe implements PipeTransform {
  transform(v: number | string | null | undefined): string { return cop(v); }
}

export function sumarDias(fechaISO: string, dias: number): string {
  const d = new Date(fechaISO + 'T12:00:00');
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function fechaCorta(fechaISO: string | null | undefined): string {
  if (!fechaISO) return '';
  const [y, m, d] = fechaISO.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** Enlace de WhatsApp (agrega 57 si es un celular colombiano de 10 dígitos) */
export function linkWhatsapp(tel: string | null | undefined, texto = ''): string {
  const n = (tel ?? '').replace(/\D/g, '');
  const num = n.length === 10 ? '57' + n : n;
  return `https://wa.me/${num}${texto ? '?text=' + encodeURIComponent(texto) : ''}`;
}
