import { BtnPdfComponent } from '../../shared/btn-pdf.component';
import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { SupabaseService } from '../../core/supabase.service';
import { ToastService } from '../../core/toast.service';
import { PdfService } from '../../core/pdf.service';
import { EmpresaService } from '../../core/empresa.service';
import { CopPipe, cop, fechaCorta, linkWhatsapp, mensajeError, normalizar } from '../../shared/format';

type TipoCartera = 'cobrar' | 'pagar';
type Rango = 'vigente' | '1-30' | '31-60' | '60+';

interface FilaCartera {
  factura_id: string; numero: string; fecha: string; fecha_vencimiento: string | null;
  tercero_id: string; tercero: string; telefono: string | null;
  total: number; pagado: number; saldo: number; dias_mora: number; rango: Rango;
}

interface Grupo {
  id: string; nombre: string; telefono: string | null; facturas: FilaCartera[];
  saldo: number; vencido: number; maxMora: number; ultimoRecordatorio?: string;
}

const RANGOS: { id: Rango; nombre: string; clase: string }[] = [
  { id: 'vigente', nombre: 'Al día', clase: 'success' },
  { id: '1-30', nombre: '1 a 30 días', clase: 'warning' },
  { id: '31-60', nombre: '31 a 60 días', clase: 'orange' },
  { id: '60+', nombre: 'Más de 60 días', clase: 'danger' },
];

@Component({
  selector: 'app-cartera',
  standalone: true,
  imports: [BtnPdfComponent, FormsModule, RouterLink, CopPipe, DatePipe],
  templateUrl: './cartera.component.html',
})
export class CarteraComponent implements OnInit {
  @Input() tipo: TipoCartera = 'cobrar';

  private readonly sb = inject(SupabaseService).client;
  private readonly toast = inject(ToastService);
  private readonly pdf = inject(PdfService);
  private readonly empresa = inject(EmpresaService);

  readonly rangos = RANGOS;
  readonly fechaCorta = fechaCorta;

  readonly filas = signal<FilaCartera[]>([]);
  readonly recordatorios = signal<Record<string, string>>({});
  readonly cargando = signal(true);
  readonly busqueda = signal('');
  readonly rango = signal<Rango | 'vencidas' | ''>('');
  readonly abiertos = signal<Set<string>>(new Set());

  // recordatorio
  readonly modal = signal(false);
  recordatorio = { grupo: null as Grupo | null, mensaje: '' };

  get esCobrar() { return this.tipo === 'cobrar'; }
  get titulo() { return this.esCobrar ? 'Cartera por cobrar' : 'Cartera por pagar'; }
  get tercero() { return this.esCobrar ? 'Cliente' : 'Proveedor'; }
  get rutaFacturas() { return this.esCobrar ? '/facturas-venta' : '/facturas-compra'; }

  readonly resumen = computed<Record<Rango | 'total' | 'vencido', number>>(() => {
    const r: Record<Rango, number> = { vigente: 0, '1-30': 0, '31-60': 0, '60+': 0 };
    for (const f of this.filas()) r[f.rango] += Number(f.saldo);
    const total = r.vigente + r['1-30'] + r['31-60'] + r['60+'];
    return { ...r, total, vencido: total - r.vigente };
  });

  readonly grupos = computed<Grupo[]>(() => {
    const q = normalizar(this.busqueda().trim());
    const rg = this.rango();
    const mapa = new Map<string, Grupo>();
    for (const f of this.filas()) {
      if (rg === 'vencidas' ? f.rango === 'vigente' : rg && f.rango !== rg) continue;
      if (q && !normalizar(`${f.tercero} ${f.numero} ${f.telefono ?? ''}`).includes(q)) continue;
      const g = mapa.get(f.tercero_id) ?? { id: f.tercero_id, nombre: f.tercero, telefono: f.telefono, facturas: [], saldo: 0, vencido: 0, maxMora: 0 };
      g.facturas.push(f);
      g.saldo += Number(f.saldo);
      if (f.dias_mora > 0) g.vencido += Number(f.saldo);
      g.maxMora = Math.max(g.maxMora, f.dias_mora);
      mapa.set(f.tercero_id, g);
    }
    const rec = this.recordatorios();
    return [...mapa.values()]
      .map((g) => ({ ...g, ultimoRecordatorio: rec[g.id], facturas: g.facturas.sort((a, b) => b.dias_mora - a.dias_mora) }))
      .sort((a, b) => b.maxMora - a.maxMora || b.saldo - a.saldo);
  });

  readonly totalFiltrado = computed(() => this.grupos().reduce((s, g) => s + g.saldo, 0));

  ngOnInit() { this.cargar(); }

  async cargar() {
    this.cargando.set(true);
    const vista = this.esCobrar ? 'v_cartera_cobrar' : 'v_cartera_pagar';
    const campoId = this.esCobrar ? 'cliente_id' : 'proveedor_id';
    const campoNombre = this.esCobrar ? 'cliente' : 'proveedor';
    const [c, r] = await Promise.all([
      this.sb.from(vista).select('*').order('fecha'),
      this.esCobrar
        ? this.sb.from('recordatorios_cobro').select('cliente_id, enviado_at').order('enviado_at', { ascending: false }).limit(500)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    this.cargando.set(false);
    if (c.error) return this.toast.error(mensajeError(c.error));
    this.filas.set((c.data as any[]).map((x) => ({
      ...x, tercero_id: x[campoId], tercero: x[campoNombre],
      total: Number(x.total), pagado: Number(x.pagado), saldo: Number(x.saldo),
    })));
    const rec: Record<string, string> = {};
    for (const x of (r.data ?? []) as any[]) rec[x.cliente_id] ??= x.enviado_at;
    this.recordatorios.set(rec);
  }

  alternar(id: string) {
    this.abiertos.update((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  claseMora(d: number) {
    return d === 0 ? 'text-bg-success' : d <= 30 ? 'text-bg-warning' : d <= 60 ? 'sf-bg-orange' : 'text-bg-danger';
  }

  // ---------- Recordatorio WhatsApp ----------
  async abrirRecordatorio(g: Grupo) {
    const emp = await this.empresa.get().catch(() => null);
    const plantilla = emp?.plantilla_recordatorio
      ?? 'Hola {cliente}, te recordamos que tu factura {factura} por {saldo} venció el {vencimiento}. ¡Gracias!';
    const venc = g.facturas.filter((f) => f.dias_mora > 0);
    const base = venc.length ? venc : g.facturas;
    const masAntigua = [...base].sort((a, b) => (a.fecha_vencimiento ?? '').localeCompare(b.fecha_vencimiento ?? ''))[0];
    const mensaje = plantilla
      .replaceAll('{cliente}', g.nombre)
      .replaceAll('{empresa}', emp?.nombre ?? 'SamarFit')
      .replaceAll('{factura}', base.map((f) => f.numero).join(', ').replace(/, ([^,]*)$/, ' y $1'))
      .replaceAll('{saldo}', cop(base.reduce((s, f) => s + f.saldo, 0)))
      .replaceAll('{vencimiento}', fechaCorta(masAntigua?.fecha_vencimiento) || 'la fecha acordada');
    this.recordatorio = { grupo: g, mensaje };
    this.modal.set(true);
  }

  async enviarRecordatorio() {
    const { grupo: g, mensaje } = this.recordatorio;
    if (!g) return;
    window.open(linkWhatsapp(g.telefono, mensaje), '_blank');
    const { error } = await this.sb.from('recordatorios_cobro').insert({
      cliente_id: g.id, factura_id: g.facturas[0]?.factura_id ?? null, mensaje, canal: 'whatsapp',
    });
    if (error) this.toast.error(mensajeError(error));
    else this.recordatorios.update((r) => ({ ...r, [g.id]: new Date().toISOString() }));
    this.modal.set(false);
  }

  async copiarMensaje() {
    try { await navigator.clipboard.writeText(this.recordatorio.mensaje); this.toast.ok('Mensaje copiado.'); }
    catch { this.toast.aviso('No se pudo copiar; selecciona el texto manualmente.'); }
  }

  // ---------- PDF ----------
  private filasPdf(fs: FilaCartera[]) {
    return fs.map((f) => [f.numero, fechaCorta(f.fecha), fechaCorta(f.fecha_vencimiento) || '—',
      f.dias_mora > 0 ? `${f.dias_mora} días` : 'Al día', cop(f.total), cop(f.pagado), cop(f.saldo)]);
  }

  /** Cartera completa (lo filtrado) */
  async exportarPdf() {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' });
    let y = await this.pdf.encabezado(doc, this.titulo, `Corte: ${new Date().toLocaleDateString('es-CO')}`);
    const r = this.resumen();
    autoTable(doc, {
      ...this.pdf.estiloTabla(), startY: y,
      head: [['Al día', '1 a 30 días', '31 a 60 días', 'Más de 60 días', 'Total vencido', 'TOTAL']],
      body: [[cop(r['vigente']), cop(r['1-30']), cop(r['31-60']), cop(r['60+']), cop(r.vencido), cop(r.total)]],
      styles: { ...this.pdf.estiloTabla().styles, halign: 'center' },
    });
    y = (doc as any).lastAutoTable.finalY + 6;
    const body: any[] = [];
    for (const g of this.grupos()) {
      body.push([{ content: `${g.nombre}${g.telefono ? '  ·  ' + g.telefono : ''}`, colSpan: 6, styles: { fontStyle: 'bold', lineWidth: { top: 0.3 }, lineColor: [20, 20, 20] } },
        { content: cop(g.saldo), styles: { fontStyle: 'bold', halign: 'right', lineWidth: { top: 0.3 }, lineColor: [20, 20, 20] } }]);
      body.push(...this.filasPdf(g.facturas));
    }
    autoTable(doc, {
      ...this.pdf.estiloTabla(), startY: y,
      head: [['Factura', 'Fecha', 'Vence', 'Mora', 'Total', this.esCobrar ? 'Abonado' : 'Pagado', 'Saldo']],
      body,
      foot: [['', '', '', '', '', 'Total', { content: cop(this.totalFiltrado()), styles: { halign: 'right' } }]],
      columnStyles: { 3: { halign: 'center' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
    });
    this.pdf.piePaginas(doc);
    this.pdf.salida(doc, this.esCobrar ? 'cartera-por-cobrar.pdf' : 'cartera-por-pagar.pdf');
  }

  /** Estado de cuenta de un cliente / proveedor (para enviárselo) */
  async estadoCuenta(g: Grupo) {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    let y = await this.pdf.encabezado(doc, 'Estado de cuenta', `Corte: ${new Date().toLocaleDateString('es-CO')}`);
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(130).text(this.tercero.toUpperCase(), 12, y);
    doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(20, 20, 20).text(g.nombre, 12, y + 6);
    if (g.telefono) doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(90).text(g.telefono, 12, y + 11);
    doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(130).text('SALDO PENDIENTE', doc.internal.pageSize.getWidth() - 12, y, { align: 'right' });
    doc.setFontSize(16).setTextColor(20, 20, 20).text(cop(g.saldo), doc.internal.pageSize.getWidth() - 12, y + 8, { align: 'right' });
    autoTable(doc, {
      ...this.pdf.estiloTabla(), startY: y + 16,
      head: [['Factura', 'Fecha', 'Vence', 'Mora', 'Total', this.esCobrar ? 'Abonado' : 'Pagado', 'Saldo']],
      body: this.filasPdf(g.facturas),
      foot: [['', '', '', '', '', 'Total', { content: cop(g.saldo), styles: { halign: 'right' } }]],
      columnStyles: { 3: { halign: 'center' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
    });
    this.pdf.piePaginas(doc);
    this.pdf.salida(doc, `estado-cuenta-${normalizar(g.nombre).replace(/[^a-z0-9]+/g, '-')}.pdf`);
  }
}
