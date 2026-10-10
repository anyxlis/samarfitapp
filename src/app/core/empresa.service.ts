import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';

export interface Empresa {
  nombre: string;
  eslogan: string | null;
  nit: string | null;
  direccion: string | null;
  telefono: string | null;
  correo: string | null;
  ciudad: string | null;
  pie_factura: string | null;
  plantilla_recordatorio: string;
  // Datos fiscales (DIAN)
  razon_social: string | null;
  tipo_persona: 'natural' | 'juridica';
  dv: string | null;
  regimen: string | null;
  responsabilidades: string | null;
  actividad_ciiu: string | null;
  sitio_web: string | null;
  resolucion_numero: string | null;
  resolucion_fecha: string | null;
  resolucion_prefijo: string | null;
  resolucion_desde: number | null;
  resolucion_hasta: number | null;
  resolucion_vigencia_hasta: string | null;
  factura_electronica: boolean;
}

/** Texto legal de la resolución de numeración (va en las facturas de venta) */
export function textoResolucion(e: Empresa | null): string {
  if (!e?.resolucion_numero) return '';
  const f = (d: string | null) => (d ? d.split('-').reverse().join('/') : '');
  return `${e.factura_electronica ? 'Factura electrónica' : 'Numeración'} autorizada por la DIAN, Resolución No. ${e.resolucion_numero}`
    + `${e.resolucion_fecha ? ' del ' + f(e.resolucion_fecha) : ''}`
    + `${e.resolucion_prefijo ? ', prefijo ' + e.resolucion_prefijo : ''}`
    + `${e.resolucion_desde ? ` del ${e.resolucion_desde} al ${e.resolucion_hasta ?? ''}` : ''}`
    + `${e.resolucion_vigencia_hasta ? ', vigente hasta ' + f(e.resolucion_vigencia_hasta) : ''}.`;
}

@Injectable({ providedIn: 'root' })
export class EmpresaService {
  private readonly sb = inject(SupabaseService).client;
  private cache?: Promise<Empresa>;

  get(): Promise<Empresa> {
    return (this.cache ??= Promise.resolve(
      this.sb.from('empresa_config').select('*').eq('id', 1).single(),
    ).then(({ data, error }) => {
      if (error) { this.cache = undefined; throw error; }
      return data as Empresa;
    }));
  }

  refrescar() { this.cache = undefined; }
}
