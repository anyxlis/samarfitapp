import { Component, ElementRef, OnInit, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../../core/supabase.service';
import { ToastService } from '../../core/toast.service';
import { Empresa, EmpresaService, textoResolucion } from '../../core/empresa.service';
import { cop, mensajeError } from '../../shared/format';
import { NumeroDirective } from '../../shared/numero.directive';

type Pestana = 'empresa' | 'recordatorio' | 'consecutivos' | 'categorias' | 'seguridad';

interface Secuencia { tipo: string; nombre: string; prefijo: string; ultimo: number; longitud: number; siguiente: number | null }
interface Categoria { id: string; nombre: string; activo: boolean; editando?: boolean; nuevoNombre?: string }

const VARIABLES = [
  { clave: '{cliente}', ejemplo: 'María Gómez', desc: 'Nombre del cliente' },
  { clave: '{empresa}', ejemplo: 'SamarFit', desc: 'Nombre de tu negocio' },
  { clave: '{factura}', ejemplo: 'FV-0003 y FV-0007', desc: 'Facturas pendientes' },
  { clave: '{saldo}', ejemplo: cop(145000), desc: 'Total que debe' },
  { clave: '{vencimiento}', ejemplo: '31/08/2026', desc: 'Fecha de vencimiento' },
];

@Component({
  selector: 'app-configuracion',
  standalone: true,
  imports: [FormsModule, NumeroDirective],
  templateUrl: './configuracion.component.html',
})
export class ConfiguracionComponent implements OnInit {
  private readonly sb = inject(SupabaseService).client;
  private readonly toast = inject(ToastService);
  private readonly empresaSvc = inject(EmpresaService);

  @ViewChild('plantillaRef') plantillaRef?: ElementRef<HTMLTextAreaElement>;

  readonly variables = VARIABLES;
  readonly pestana = signal<Pestana>('empresa');
  readonly guardando = signal(false);

  empresa: Record<string, any> = {
    nombre: '', eslogan: '', nit: '', direccion: '', telefono: '', correo: '', ciudad: '', pie_factura: '', plantilla_recordatorio: '',
    razon_social: '', tipo_persona: 'natural', dv: '', regimen: 'No responsable de IVA', responsabilidades: 'R-99-PN', actividad_ciiu: '',
    sitio_web: '', resolucion_numero: '', resolucion_fecha: '', resolucion_prefijo: '', resolucion_desde: null, resolucion_hasta: null,
    resolucion_vigencia_hasta: '', factura_electronica: false,
  };
  readonly regimenes = ['No responsable de IVA', 'Responsable de IVA', 'Régimen Simple de Tributación (RST)'];
  secuencias: Secuencia[] = [];
  categoriasProd: Categoria[] = [];
  categoriasGasto: Categoria[] = [];
  nuevaProd = '';
  nuevaGasto = '';
  clave = { nueva: '', confirmar: '' };

  ngOnInit() { this.cargar(); }

  async cargar() {
    const [e, s, cp, cg] = await Promise.all([
      this.sb.from('empresa_config').select('*').eq('id', 1).single(),
      this.sb.from('secuencias').select('*').order('tipo', { ascending: false }),
      this.sb.from('categorias').select('id, nombre, activo').order('nombre'),
      this.sb.from('categorias_gasto').select('id, nombre, activo').order('nombre'),
    ]);
    if (e.error) return this.toast.error(mensajeError(e.error));
    for (const k of Object.keys(this.empresa)) this.empresa[k] = e.data[k] ?? (typeof this.empresa[k] === 'boolean' ? false : typeof this.empresa[k] === 'number' ? null : '');
    this.secuencias = ((s.data ?? []) as any[]).map((x) => ({ ...x, ultimo: Number(x.ultimo), siguiente: Number(x.ultimo) + 1 }));
    this.categoriasProd = (cp.data ?? []) as Categoria[];
    this.categoriasGasto = (cg.data ?? []) as Categoria[];
  }

  // ---------- Empresa ----------
  async guardarEmpresa() {
    if (!String(this.empresa['nombre']).trim()) return this.toast.aviso('El nombre de la empresa es obligatorio.');
    if (!String(this.empresa['plantilla_recordatorio']).trim()) return this.toast.aviso('La plantilla del recordatorio no puede quedar vacía.');
    const datos: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(this.empresa)) datos[k] = typeof v === 'string' ? v.trim() || null : v ?? null;
    datos['tipo_persona'] = this.empresa['tipo_persona'] || 'natural';
    datos['regimen'] = (this.empresa['regimen'] || 'No responsable de IVA').trim();
    datos['nombre'] = String(this.empresa['nombre']).trim();
    datos['plantilla_recordatorio'] = String(this.empresa['plantilla_recordatorio']).trim();
    this.guardando.set(true);
    const { error } = await this.sb.from('empresa_config').update({ ...datos, updated_at: new Date().toISOString() }).eq('id', 1);
    this.guardando.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.empresaSvc.refrescar();
    this.toast.ok('Configuración guardada.');
  }

  get textoResolucionPrev() { return textoResolucion(this.empresa as unknown as Empresa); }

  // ---------- Plantilla ----------
  insertarVariable(clave: string) {
    const ta = this.plantillaRef?.nativeElement;
    const t = this.empresa['plantilla_recordatorio'];
    const ini = ta?.selectionStart ?? t.length;
    const fin = ta?.selectionEnd ?? t.length;
    this.empresa['plantilla_recordatorio'] = t.slice(0, ini) + clave + t.slice(fin);
    setTimeout(() => { ta?.focus(); ta?.setSelectionRange(ini + clave.length, ini + clave.length); });
  }

  get vistaPrevia() {
    let m = this.empresa['plantilla_recordatorio'];
    for (const v of VARIABLES) m = m.replaceAll(v.clave, v.clave === '{empresa}' ? this.empresa['nombre'] || v.ejemplo : v.ejemplo);
    return m;
  }

  restaurarPlantilla() {
    this.empresa['plantilla_recordatorio'] =
      'Hola {cliente}, te saludamos de {empresa}. Te recordamos que tu factura {factura} por {saldo} venció el {vencimiento}. Quedamos atentos a tu pago. ¡Gracias!';
  }

  // ---------- Consecutivos ----------
  ejemplo(s: Secuencia) {
    return `${s.prefijo || '?'}-${String(s.siguiente ?? 1).padStart(Number(s.longitud) || 1, '0')}`;
  }

  async guardarSecuencia(s: Secuencia) {
    const prefijo = s.prefijo.trim().toUpperCase();
    if (!prefijo) return this.toast.aviso('El prefijo no puede quedar vacío.');
    if (!s.siguiente || s.siguiente < 1) return this.toast.aviso('El próximo número debe ser 1 o mayor.');
    if (s.siguiente <= s.ultimo &&
        !confirm(`El próximo número (${s.siguiente}) es menor o igual al último usado (${s.ultimo}). Podría repetir números y la factura no se guardaría. ¿Continuar?`)) return;
    const { error } = await this.sb.from('secuencias')
      .update({ prefijo, longitud: Math.min(Math.max(Number(s.longitud) || 4, 1), 10), ultimo: s.siguiente - 1 }).eq('tipo', s.tipo);
    if (error) return this.toast.error(mensajeError(error));
    this.toast.ok(`Consecutivo de ${s.nombre.toLowerCase()} actualizado.`);
    this.cargar();
  }

  // ---------- Categorías ----------
  private tabla(tipo: 'prod' | 'gasto') { return tipo === 'prod' ? 'categorias' : 'categorias_gasto'; }

  async agregarCategoria(tipo: 'prod' | 'gasto') {
    const nombre = (tipo === 'prod' ? this.nuevaProd : this.nuevaGasto).trim();
    if (!nombre) return;
    const { error } = await this.sb.from(this.tabla(tipo)).insert({ nombre });
    if (error) return this.toast.error(mensajeError(error));
    if (tipo === 'prod') this.nuevaProd = ''; else this.nuevaGasto = '';
    this.toast.ok('Categoría creada.');
    this.cargar();
  }

  async renombrar(tipo: 'prod' | 'gasto', c: Categoria) {
    const nombre = (c.nuevoNombre ?? '').trim();
    if (!nombre || nombre === c.nombre) { c.editando = false; return; }
    const { error } = await this.sb.from(this.tabla(tipo)).update({ nombre }).eq('id', c.id);
    if (error) return this.toast.error(mensajeError(error));
    c.nombre = nombre;
    c.editando = false;
  }

  async alternarCategoria(tipo: 'prod' | 'gasto', c: Categoria) {
    const { error } = await this.sb.from(this.tabla(tipo)).update({ activo: !c.activo }).eq('id', c.id);
    if (error) return this.toast.error(mensajeError(error));
    c.activo = !c.activo;
  }

  // ---------- Seguridad ----------
  async cambiarClave() {
    if (this.clave.nueva.length < 8) return this.toast.aviso('La contraseña debe tener al menos 8 caracteres.');
    if (this.clave.nueva !== this.clave.confirmar) return this.toast.aviso('Las contraseñas no coinciden.');
    this.guardando.set(true);
    const { error } = await this.sb.auth.updateUser({ password: this.clave.nueva });
    this.guardando.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.clave = { nueva: '', confirmar: '' };
    this.toast.ok('Contraseña actualizada.');
  }
}
