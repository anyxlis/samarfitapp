import { BtnPdfComponent } from '../../shared/btn-pdf.component';
import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../../core/supabase.service';
import { ToastService } from '../../core/toast.service';
import { PdfService } from '../../core/pdf.service';
import { CopPipe, cop, mensajeError, normalizar } from '../../shared/format';

type Tipo = 'clientes' | 'proveedores';

export interface Tercero {
  id?: string;
  tipo_documento: string;
  documento: string | null;
  nombre: string;
  contacto?: string | null;
  telefono: string | null;
  correo: string | null;
  direccion: string | null;
  ciudad: string | null;
  notas: string | null;
  activo: boolean;
}

const VACIO = (tipo: Tipo): Tercero => ({
  tipo_documento: tipo === 'clientes' ? 'CC' : 'NIT',
  documento: null, nombre: '', contacto: null, telefono: null, correo: null,
  direccion: null, ciudad: null, notas: null, activo: true,
});

@Component({
  selector: 'app-terceros',
  standalone: true,
  imports: [BtnPdfComponent, FormsModule, CopPipe],
  templateUrl: './terceros.component.html',
})
export class TercerosComponent implements OnInit {
  /** Llega desde la ruta (data: { tipo }) */
  @Input() tipo: Tipo = 'clientes';

  private readonly sb = inject(SupabaseService).client;
  private readonly toast = inject(ToastService);
  private readonly pdf = inject(PdfService);

  readonly tiposDoc = ['CC', 'NIT', 'CE', 'TI', 'PAS', 'PPT'];
  readonly porPagina = 15;

  readonly lista = signal<Tercero[]>([]);
  readonly saldos = signal<Record<string, number>>({});
  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly busqueda = signal('');
  readonly estado = signal<'todos' | 'activos' | 'inactivos'>('activos');
  readonly pagina = signal(1);
  readonly modal = signal(false);
  form: Tercero = VACIO('clientes');

  get esCliente() { return this.tipo === 'clientes'; }
  get singular() { return this.esCliente ? 'Cliente' : 'Proveedor'; }
  get plural() { return this.esCliente ? 'Clientes' : 'Proveedores'; }
  get etiquetaSaldo() { return this.esCliente ? 'Nos debe' : 'Le debemos'; }

  readonly filtrados = computed(() => {
    const q = normalizar(this.busqueda().trim());
    const est = this.estado();
    return this.lista().filter((t) =>
      (est === 'todos' || (est === 'activos') === t.activo) &&
      (!q || normalizar([t.nombre, t.documento, t.telefono, t.correo, t.ciudad, t.contacto].join(' ')).includes(q)),
    );
  });
  readonly totalPaginas = computed(() => Math.max(1, Math.ceil(this.filtrados().length / this.porPagina)));
  readonly visibles = computed(() => {
    const p = Math.min(this.pagina(), this.totalPaginas());
    return this.filtrados().slice((p - 1) * this.porPagina, p * this.porPagina);
  });
  readonly totalSaldo = computed(() => this.filtrados().reduce((s, t) => s + this.saldo(t), 0));

  ngOnInit() { this.cargar(); }

  async cargar() {
    this.cargando.set(true);
    const vista = this.esCliente ? 'v_cartera_cobrar' : 'v_cartera_pagar';
    const campo = this.esCliente ? 'cliente_id' : 'proveedor_id';
    const [r1, r2] = await Promise.all([
      this.sb.from(this.tipo).select('*').order('nombre'),
      this.sb.from(vista).select(`${campo}, saldo`),
    ]);
    this.cargando.set(false);
    if (r1.error) return this.toast.error(mensajeError(r1.error));
    this.lista.set(r1.data as Tercero[]);
    const mapa: Record<string, number> = {};
    for (const r of (r2.data ?? []) as any[]) mapa[r[campo]] = (mapa[r[campo]] ?? 0) + Number(r.saldo);
    this.saldos.set(mapa);
  }

  saldo(t: Tercero): number { return this.saldos()[t.id!] ?? 0; }

  buscar(v: string) { this.busqueda.set(v); this.pagina.set(1); }

  nuevo() { this.form = VACIO(this.tipo); this.modal.set(true); }
  editar(t: Tercero) { this.form = { ...t }; this.modal.set(true); }

  async guardar() {
    const f = this.form;
    if (!f.nombre?.trim()) return this.toast.aviso('El nombre es obligatorio.');
    const limpio = (v: string | null | undefined) => (v ?? '').trim() || null;
    const datos: Partial<Tercero> = {
      tipo_documento: f.tipo_documento,
      documento: limpio(f.documento),
      nombre: f.nombre.trim(),
      telefono: limpio(f.telefono),
      correo: limpio(f.correo),
      direccion: limpio(f.direccion),
      ciudad: limpio(f.ciudad),
      notas: limpio(f.notas),
      activo: f.activo,
    };
    if (!this.esCliente) datos.contacto = limpio(f.contacto);

    this.guardando.set(true);
    const { error } = f.id
      ? await this.sb.from(this.tipo).update(datos).eq('id', f.id)
      : await this.sb.from(this.tipo).insert(datos);
    this.guardando.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.toast.ok(`${this.singular} ${f.id ? 'actualizado' : 'creado'}.`);
    this.modal.set(false);
    this.cargar();
  }

  async alternarActivo(t: Tercero) {
    const { error } = await this.sb.from(this.tipo).update({ activo: !t.activo }).eq('id', t.id!);
    if (error) return this.toast.error(mensajeError(error));
    this.lista.update((l) => l.map((x) => (x.id === t.id ? { ...x, activo: !x.activo } : x)));
  }

  async eliminar(t: Tercero) {
    if (!confirm(`¿Eliminar a "${t.nombre}"? Esta acción no se puede deshacer.`)) return;
    const { error } = await this.sb.from(this.tipo).delete().eq('id', t.id!);
    if (error) return this.toast.error(mensajeError(error));
    this.toast.ok(`${this.singular} eliminado.`);
    this.lista.update((l) => l.filter((x) => x.id !== t.id));
  }

  whatsapp(tel: string | null): string {
    const n = (tel ?? '').replace(/\D/g, '');
    return `https://wa.me/${n.length === 10 ? '57' + n : n}`;
  }

  async exportarPdf() {
    const filas = this.filtrados().map((t) => [
      `${t.tipo_documento} ${t.documento ?? ''}`.trim(),
      t.nombre,
      ...(this.esCliente ? [] : [t.contacto ?? '']),
      t.telefono ?? '',
      t.correo ?? '',
      t.ciudad ?? '',
      cop(this.saldo(t)),
    ]);
    const cols = ['Documento', 'Nombre', ...(this.esCliente ? [] : ['Contacto']), 'Teléfono', 'Correo', 'Ciudad', this.etiquetaSaldo];
    const totales = cols.map((_, i) => (i === 0 ? `${filas.length} registros` : i === cols.length - 1 ? cop(this.totalSaldo()) : ''));
    await this.pdf.tabla(`Listado de ${this.plural.toLowerCase()}`, cols, filas, this.tipo, {
      derecha: [cols.length - 1], totales, horizontal: !this.esCliente,
    });
  }
}
