import { BtnPdfComponent } from '../../shared/btn-pdf.component';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgSelectModule } from '@ng-select/ng-select';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { SupabaseService } from '../../core/supabase.service';
import { ToastService } from '../../core/toast.service';
import { PdfService } from '../../core/pdf.service';
import { CopPipe, cop, fechaCorta, hoyISO, mensajeError, normalizar } from '../../shared/format';
import { NumeroDirective } from '../../shared/numero.directive';
import { PERIODOS, Periodo, rangoPeriodo, textoRango } from '../../shared/periodo';
import { METODOS, nombreMetodo } from '../facturas/factura.config';

interface Opcion { id: string; nombre: string }

interface Gasto {
  id: string; fecha: string; categoria_id: string; proveedor_id: string | null; descripcion: string;
  valor: number; metodo_pago: string; numero_soporte: string | null;
  categoria: { nombre: string } | null; proveedor: { nombre: string } | null;
}

interface FormGasto {
  id?: string; fecha: string; categoria_id: string | null; proveedor_id: string | null; descripcion: string;
  valor: number | null; metodo_pago: string; numero_soporte: string;
}

@Component({
  selector: 'app-gastos',
  standalone: true,
  imports: [BtnPdfComponent, FormsModule, NgSelectModule, CopPipe, DecimalPipe, NumeroDirective],
  templateUrl: './gastos.component.html',
})
export class GastosComponent implements OnInit {
  private readonly sb = inject(SupabaseService).client;
  private readonly toast = inject(ToastService);
  private readonly pdf = inject(PdfService);

  readonly periodos = PERIODOS;
  readonly metodos = METODOS;
  readonly fechaCorta = fechaCorta;
  readonly nombreMetodo = nombreMetodo;

  readonly lista = signal<Gasto[]>([]);
  readonly categorias = signal<Opcion[]>([]);
  readonly proveedores = signal<Opcion[]>([]);
  readonly cargando = signal(true);
  readonly guardando = signal(false);

  readonly busqueda = signal('');
  readonly categoriaId = signal<string | null>(null);
  periodo: Periodo = 'mes';
  desde = '';
  hasta = '';

  readonly modal = signal(false);
  form: FormGasto = this.vacio();

  readonly filtrados = computed(() => {
    const q = normalizar(this.busqueda().trim());
    const c = this.categoriaId();
    return this.lista().filter((g) =>
      (!c || g.categoria_id === c) &&
      (!q || normalizar(`${g.descripcion} ${g.proveedor?.nombre ?? ''} ${g.numero_soporte ?? ''} ${g.categoria?.nombre ?? ''}`).includes(q)));
  });

  readonly total = computed(() => this.filtrados().reduce((s, g) => s + Number(g.valor), 0));

  /** Resumen por categoría, de mayor a menor */
  readonly porCategoria = computed(() => {
    const mapa = new Map<string, { id: string; nombre: string; valor: number; cantidad: number }>();
    for (const g of this.filtrados()) {
      const k = g.categoria?.nombre ?? 'Sin categoría';
      const r = mapa.get(k) ?? { id: g.categoria_id, nombre: k, valor: 0, cantidad: 0 };
      r.valor += Number(g.valor);
      r.cantidad++;
      mapa.set(k, r);
    }
    const total = this.total() || 1;
    return [...mapa.values()].sort((a, b) => b.valor - a.valor).map((r) => ({ ...r, pct: (r.valor / total) * 100 }));
  });

  get textoPeriodo() { return textoRango(this.desde, this.hasta); }

  ngOnInit() {
    this.cargarCatalogos();
    this.aplicarPeriodo('mes');
  }

  private vacio(): FormGasto {
    return { fecha: hoyISO(), categoria_id: null, proveedor_id: null, descripcion: '', valor: null, metodo_pago: 'efectivo', numero_soporte: '' };
  }

  async cargarCatalogos() {
    const [c, p] = await Promise.all([
      this.sb.from('categorias_gasto').select('id, nombre').eq('activo', true).order('nombre'),
      this.sb.from('proveedores').select('id, nombre').eq('activo', true).order('nombre'),
    ]);
    this.categorias.set((c.data ?? []) as Opcion[]);
    this.proveedores.set((p.data ?? []) as Opcion[]);
  }

  aplicarPeriodo(p: Periodo) {
    this.periodo = p;
    if (p !== 'personalizado') {
      ({ desde: this.desde, hasta: this.hasta } = rangoPeriodo(p));
      this.cargar();
    }
  }

  async cargar() {
    this.cargando.set(true);
    let q = this.sb.from('gastos').select('*, categoria:categorias_gasto(nombre), proveedor:proveedores(nombre)');
    if (this.desde) q = q.gte('fecha', this.desde);
    if (this.hasta) q = q.lte('fecha', this.hasta);
    const { data, error } = await q.order('fecha', { ascending: false }).order('created_at', { ascending: false });
    this.cargando.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.lista.set(data as Gasto[]);
  }

  // ---------- Crear categoría / proveedor desde el selector ----------
  crearCategoria = async (nombre: string): Promise<Opcion | null> => {
    const { data, error } = await this.sb.from('categorias_gasto').insert({ nombre: nombre.trim() }).select('id, nombre').single();
    if (error) { this.toast.error(mensajeError(error)); return null; }
    this.categorias.update((l) => [...l, data as Opcion].sort((a, b) => a.nombre.localeCompare(b.nombre)));
    return data as Opcion;
  };

  crearProveedor = async (nombre: string): Promise<Opcion | null> => {
    const { data, error } = await this.sb.from('proveedores').insert({ nombre: nombre.trim() }).select('id, nombre').single();
    if (error) { this.toast.error(mensajeError(error)); return null; }
    this.proveedores.update((l) => [...l, data as Opcion].sort((a, b) => a.nombre.localeCompare(b.nombre)));
    return data as Opcion;
  };

  // ---------- CRUD ----------
  nuevo() { this.form = this.vacio(); this.modal.set(true); }

  editar(g: Gasto) {
    this.form = {
      id: g.id, fecha: g.fecha, categoria_id: g.categoria_id, proveedor_id: g.proveedor_id, descripcion: g.descripcion,
      valor: Number(g.valor), metodo_pago: g.metodo_pago, numero_soporte: g.numero_soporte ?? '',
    };
    this.modal.set(true);
  }

  /** Copia un gasto (ej. arriendo, publicidad mensual) con la fecha de hoy */
  duplicar(g: Gasto) {
    this.editar(g);
    this.form.id = undefined;
    this.form.fecha = hoyISO();
    this.form.numero_soporte = '';
  }

  async guardar() {
    const f = this.form;
    if (!f.categoria_id) return this.toast.aviso('Selecciona la categoría.');
    if (!f.descripcion.trim()) return this.toast.aviso('Escribe una descripción.');
    if (!f.valor || f.valor <= 0) return this.toast.aviso('Escribe el valor.');
    const datos = {
      fecha: f.fecha, categoria_id: f.categoria_id, proveedor_id: f.proveedor_id, descripcion: f.descripcion.trim(),
      valor: f.valor, metodo_pago: f.metodo_pago, numero_soporte: f.numero_soporte.trim() || null,
    };
    this.guardando.set(true);
    const { error } = f.id
      ? await this.sb.from('gastos').update(datos).eq('id', f.id)
      : await this.sb.from('gastos').insert(datos);
    this.guardando.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.toast.ok(f.id ? 'Gasto actualizado.' : 'Gasto registrado.');
    this.modal.set(false);
    this.cargar();
  }

  async eliminar(g: Gasto) {
    if (!confirm(`¿Eliminar el gasto "${g.descripcion}" por ${cop(g.valor)}?`)) return;
    const { error } = await this.sb.from('gastos').delete().eq('id', g.id);
    if (error) return this.toast.error(mensajeError(error));
    this.toast.ok('Gasto eliminado.');
    this.lista.update((l) => l.filter((x) => x.id !== g.id));
  }

  // ---------- PDF ----------
  async exportarPdf() {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    let y = await this.pdf.encabezado(doc, 'Gastos del negocio', this.textoPeriodo);

    doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(20, 20, 20).text('Resumen por categoría', 12, y);
    autoTable(doc, {
      ...this.pdf.estiloTabla(),
      startY: y + 2,
      head: [['Categoría', 'Cantidad', '%', 'Valor']],
      body: this.porCategoria().map((c) => [c.nombre, String(c.cantidad), `${c.pct.toFixed(1)}%`, cop(c.valor)]),
      foot: [['Total', { content: String(this.filtrados().length), styles: { halign: 'center' } }, { content: '100%', styles: { halign: 'right' } }, { content: cop(this.total()), styles: { halign: 'right' } }]],
      columnStyles: { 1: { halign: 'center' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    });
    y = (doc as any).lastAutoTable.finalY + 8;

    doc.setFont('helvetica', 'bold').setFontSize(10).text('Detalle', 12, y);
    autoTable(doc, {
      ...this.pdf.estiloTabla(),
      startY: y + 2,
      head: [['Fecha', 'Descripción', 'Categoría', 'Proveedor', 'Método', 'Soporte', 'Valor']],
      body: this.filtrados().map((g) => [fechaCorta(g.fecha), g.descripcion, g.categoria?.nombre ?? '', g.proveedor?.nombre ?? '',
        nombreMetodo(g.metodo_pago), g.numero_soporte ?? '', cop(g.valor)]),
      foot: [['', '', '', '', '', 'Total', { content: cop(this.total()), styles: { halign: 'right' } }]],
      columnStyles: { 6: { halign: 'right' } },
    });
    this.pdf.piePaginas(doc);
    this.pdf.salida(doc, 'gastos.pdf');
  }
}
