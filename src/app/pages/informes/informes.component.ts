import { BtnPdfComponent } from '../../shared/btn-pdf.component';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { SupabaseService } from '../../core/supabase.service';
import { ToastService } from '../../core/toast.service';
import { PdfService } from '../../core/pdf.service';
import { CopPipe, cop, mensajeError } from '../../shared/format';
import { PERIODOS, Periodo, rangoPeriodo, textoRango } from '../../shared/periodo';

type Pestana = 'resultados' | 'estado' | 'balance' | 'inicial' | 'productos' | 'clientes' | 'proveedores';

interface Inicial { clave: string; nombre: string; categoria: string; detalle: string; fecha: string; unidades: number; costo: number; precio: number }

interface Mes {
  mes: string; ventas_brutas: number; descuentos: number; ventas_netas: number; costo_ventas: number;
  utilidad_bruta: number; gastos_operativos: number; utilidad_neta: number; compras_inventario: number;
  /** Todo incluido: ventas netas - compras de inventario - gastos */
  balance: number;
}

interface Ranking { clave: string; nombre: string; detalle: string; unidades: number; ingresos: number; costo: number; facturas: number }

/** Explicaciones en palabras sencillas para cada concepto de los informes */
export const EXPLICA = {
  ventasBrutas: 'Lo que sumaron tus facturas de venta del mes, antes de descuentos.',
  descuentos: 'Las rebajas que les diste a tus clientes en las facturas.',
  ventasNetas: 'Lo que realmente les facturaste a tus clientes. Si vendiste a crédito, una parte aún te la pueden deber.',
  costoVendido: 'Lo que te costaron (a precio de compra) solo las prendas que vendiste este mes.',
  gananciaBruta: 'Lo que te dejaron las prendas vendidas, antes de pagar los gastos del negocio.',
  gastos: 'Pagos para que el negocio funcione: publicidad, bolsas, ingeniería, envíos…',
  gananciaNeta: 'Lo que de verdad ganó el negocio en el mes, después de pagar las prendas vendidas y los gastos.',
  ventasNetasBal: 'Lo que les facturaste a tus clientes en el mes.',
  compras: 'Todo lo que pagaste por mercancía nueva en el mes (facturas de compra), la hayas vendido o no.',
  balance: 'Lo que queda al restar TODO lo que salió del negocio. Si es negativo, ese mes invertiste más de lo que vendiste, normalmente porque surtiste mercancía.',
};

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const CAMPOS: (keyof Mes)[] = ['ventas_brutas', 'descuentos', 'ventas_netas', 'costo_ventas', 'utilidad_bruta', 'gastos_operativos', 'utilidad_neta', 'compras_inventario', 'balance'];

@Component({
  selector: 'app-informes',
  standalone: true,
  imports: [BtnPdfComponent, FormsModule, CopPipe, DecimalPipe],
  templateUrl: './informes.component.html',
})
export class InformesComponent implements OnInit {
  private readonly sb = inject(SupabaseService).client;
  private readonly toast = inject(ToastService);
  private readonly pdf = inject(PdfService);

  readonly periodos = PERIODOS;
  readonly Math = Math;
  readonly EXPLICA = EXPLICA;
  readonly pestana = signal<Pestana>('resultados');
  readonly cargando = signal(false);

  // ---------- Estado de resultados ----------
  readonly anioActual = new Date().getFullYear();
  readonly anios = Array.from({ length: 5 }, (_, i) => this.anioActual - i);
  anio = this.anioActual;
  readonly meses = signal<Mes[]>([]);
  readonly mesSel = signal<string>('');
  readonly gastosMes = signal<{ nombre: string; valor: number }[]>([]);

  readonly totalAnio = computed(() => {
    const t = Object.fromEntries(CAMPOS.map((c) => [c, 0])) as unknown as Mes;
    for (const m of this.meses()) for (const c of CAMPOS) (t as any)[c] += Number(m[c]);
    return t;
  });

  readonly detalleMes = computed(() => this.meses().find((m) => m.mes === this.mesSel()) ?? null);

  readonly maxGrafico = computed(() => Math.max(1, ...this.meses().map((m) => Math.max(m.ventas_netas, Math.abs(m.utilidad_neta)))));

  // ---------- Rankings ----------
  periodo: Periodo = 'mes';
  desde = '';
  hasta = '';
  agruparPor: 'producto' | 'variante' = 'producto';
  readonly ranking = signal<Ranking[]>([]);
  readonly totalRanking = computed(() => this.ranking().reduce(
    (t, r) => ({ unidades: t.unidades + r.unidades, ingresos: t.ingresos + r.ingresos, costo: t.costo + r.costo }),
    { unidades: 0, ingresos: 0, costo: 0 }));
  readonly maxRanking = computed(() => Math.max(1, ...this.ranking().map((r) => (this.pestana() === 'productos' ? r.unidades : r.ingresos))));

  get textoPeriodo() { return textoRango(this.desde, this.hasta); }

  ngOnInit() {
    ({ desde: this.desde, hasta: this.hasta } = rangoPeriodo('mes'));
    this.cargarResultados();
  }

  cambiarPestana(p: Pestana) {
    this.pestana.set(p);
    if (p === 'resultados' || p === 'estado' || p === 'balance') this.cargarResultados();
    else if (p === 'inicial') this.cargarInicial();
    else this.cargarRanking();
  }

  nombreMes(iso: string, corto = false) {
    const [y, m] = iso.split('-').map(Number);
    const n = MESES[m - 1];
    return corto ? n.slice(0, 3) : `${n} ${y}`;
  }

  margen(valor: number, base: number) { return base ? (valor / base) * 100 : 0; }

  // ---------- Carga: estado de resultados ----------
  async cargarResultados() {
    this.cargando.set(true);
    const { data, error } = await this.sb.from('v_resumen_mensual').select('*')
      .gte('mes', `${this.anio}-01-01`).lte('mes', `${this.anio}-12-31`).order('mes');
    this.cargando.set(false);
    if (error) return this.toast.error(mensajeError(error));

    // Completa los meses sin movimiento hasta el mes actual (o diciembre si es un año pasado)
    const ultimo = this.anio === this.anioActual ? new Date().getMonth() + 1 : 12;
    const porMes = new Map((data as any[]).map((d) => [String(d.mes).slice(0, 10), d]));
    const lista: Mes[] = [];
    for (let i = 1; i <= ultimo; i++) {
      const k = `${this.anio}-${String(i).padStart(2, '0')}-01`;
      const d = porMes.get(k) ?? {};
      const m = { mes: k, ...Object.fromEntries(CAMPOS.map((c) => [c, Number(d[c] ?? 0)])) } as Mes;
      m.balance = m.ventas_netas - m.compras_inventario - m.gastos_operativos;
      lista.push(m);
    }
    this.meses.set(lista);
    if (!lista.some((m) => m.mes === this.mesSel())) this.seleccionarMes(lista[lista.length - 1]?.mes ?? '');
    else this.cargarGastosMes();
  }

  /** Resumen en palabras del estado de resultados */
  resumenEstado(d: Mes): string {
    const mes = this.nombreMes(d.mes).split(' ')[0].toLowerCase();
    if (!d.ventas_netas && !d.gastos_operativos) return `En ${mes} todavía no hay ventas ni gastos registrados.`;
    const por100 = Math.round(this.margen(d.utilidad_neta, d.ventas_netas));
    const base = `En ${mes} vendiste ${cop(d.ventas_netas)}. Las prendas que vendiste te habían costado ${cop(d.costo_ventas)} `
      + `y pagaste ${cop(d.gastos_operativos)} en gastos del negocio. `;
    return d.utilidad_neta >= 0
      ? base + `Te quedó una ganancia de ${cop(d.utilidad_neta)}: de cada $100 que vendiste, ganaste $${por100}.`
      : base + `Ese mes el negocio perdió ${cop(Math.abs(d.utilidad_neta))}: los gastos fueron más que lo que dejaron las ventas.`;
  }

  /** Resumen en palabras del balance total */
  resumenBalance(d: Mes): string {
    const mes = this.nombreMes(d.mes).split(' ')[0].toLowerCase();
    const salio = d.compras_inventario + d.gastos_operativos;
    const base = `En ${mes} entraron ${cop(d.ventas_netas)} por ventas y salieron ${cop(salio)}: `
      + `${cop(d.compras_inventario)} en mercancía y ${cop(d.gastos_operativos)} en gastos. `;
    return d.balance >= 0
      ? base + `Al final quedaron ${cop(d.balance)} a favor.`
      : base + `Salió ${cop(Math.abs(d.balance))} más de lo que entró, pero esa plata no se perdió del todo: buena parte está en la mercancía que aún tienes para vender.`;
  }

  /** Mercancía comprada en el mes que no se vendió (diferencia entre ambos informes) */
  quedoEnInventario(d: Mes) { return d.compras_inventario - d.costo_ventas; }

  verEstado(mes: string) {
    this.mesSel.set(mes);
    this.cambiarPestana('estado');
  }

  seleccionarMes(mes: string) {
    this.mesSel.set(mes);
    this.cargarGastosMes();
  }

  async cargarGastosMes() {
    const mes = this.mesSel();
    if (!mes) return this.gastosMes.set([]);
    const [y, m] = mes.split('-').map(Number);
    const fin = new Date(y, m, 0).getDate();
    const { data } = await this.sb.from('gastos').select('valor, categoria:categorias_gasto(nombre)')
      .gte('fecha', mes).lte('fecha', `${y}-${String(m).padStart(2, '0')}-${fin}`);
    const mapa = new Map<string, number>();
    for (const g of (data ?? []) as any[]) {
      const k = g.categoria?.nombre ?? 'Sin categoría';
      mapa.set(k, (mapa.get(k) ?? 0) + Number(g.valor));
    }
    this.gastosMes.set([...mapa.entries()].map(([nombre, valor]) => ({ nombre, valor })).sort((a, b) => b.valor - a.valor));
  }

  // ---------- Inventario inicial ----------
  readonly inicial = signal<Inicial[]>([]);
  readonly totInicial = computed(() => this.inicial().reduce(
    (t, i) => ({ unidades: t.unidades + i.unidades, costo: t.costo + i.unidades * i.costo, venta: t.venta + i.unidades * i.precio }),
    { unidades: 0, costo: 0, venta: 0 }));
  readonly acumulado = signal({ ventas: 0, compras: 0, gastos: 0, inventarioHoy: 0 });
  readonly balanceAcumulado = computed(() => {
    const a = this.acumulado();
    return a.ventas - this.totInicial().costo - a.compras - a.gastos;
  });

  async cargarInicial() {
    this.cargando.set(true);
    const [m, r, v] = await Promise.all([
      this.sb.from('movimientos_inventario')
        .select('variante_id, fecha, cantidad, costo_unitario, variante:variantes(sku, talla, color, precio, producto:productos(nombre, categoria:categorias(nombre)))')
        .eq('tipo', 'ajuste_entrada').ilike('notas', 'Inventario inicial%').order('fecha'),
      this.sb.from('v_resumen_mensual').select('ventas_netas, compras_inventario, gastos_operativos'),
      this.sb.from('variantes').select('stock, costo'),
    ]);
    this.cargando.set(false);
    if (m.error) return this.toast.error(mensajeError(m.error));
    const mapa = new Map<string, Inicial>();
    for (const x of m.data as any[]) {
      const va = x.variante;
      const i = mapa.get(x.variante_id) ?? {
        clave: x.variante_id, nombre: va.producto.nombre, categoria: va.producto.categoria?.nombre ?? '',
        detalle: [va.talla, va.color, va.sku].filter(Boolean).join(' · '), fecha: x.fecha, unidades: 0, costo: Number(x.costo_unitario), precio: Number(va.precio),
      };
      i.unidades += Number(x.cantidad);
      mapa.set(x.variante_id, i);
    }
    this.inicial.set([...mapa.values()].sort((a, b) => a.nombre.localeCompare(b.nombre) || a.detalle.localeCompare(b.detalle)));
    const sum = (k: string) => ((r.data ?? []) as any[]).reduce((s, d) => s + Number(d[k]), 0);
    this.acumulado.set({
      ventas: sum('ventas_netas'), compras: sum('compras_inventario'), gastos: sum('gastos_operativos'),
      inventarioHoy: ((v.data ?? []) as any[]).reduce((s, d) => s + Number(d.stock) * Number(d.costo), 0),
    });
  }

  // ---------- Carga: rankings ----------
  aplicarPeriodo(p: Periodo) {
    this.periodo = p;
    if (p !== 'personalizado') {
      ({ desde: this.desde, hasta: this.hasta } = rangoPeriodo(p));
      this.cargarRanking();
    }
  }

  async cargarRanking() {
    this.cargando.set(true);
    const p = this.pestana();
    let filas: Ranking[] = [];
    try {
      if (p === 'productos') filas = await this.rankingProductos();
      else filas = await this.rankingTerceros(p === 'clientes' ? 'venta' : 'compra');
    } catch (e) {
      this.toast.error(mensajeError(e));
    }
    this.ranking.set(filas);
    this.cargando.set(false);
  }

  private async rankingProductos(): Promise<Ranking[]> {
    let q = this.sb.from('factura_venta_items')
      .select('cantidad, subtotal, costo_unitario, variante_id, variante:variantes(sku, talla, color, producto:productos(id, nombre, categoria:categorias(nombre))), factura:facturas_venta!inner(fecha, estado, total, subtotal)')
      .neq('factura.estado', 'anulada');
    if (this.desde) q = q.gte('factura.fecha', this.desde);
    if (this.hasta) q = q.lte('factura.fecha', this.hasta);
    const { data, error } = await q;
    if (error) throw error;
    const mapa = new Map<string, Ranking>();
    for (const i of data as any[]) {
      const v = i.variante;
      const porVariante = this.agruparPor === 'variante';
      const clave = porVariante ? i.variante_id : v.producto.id;
      // ingreso neto: prorratea el descuento de la factura
      const factor = Number(i.factura.subtotal) > 0 ? Number(i.factura.total) / Number(i.factura.subtotal) : 1;
      const r = mapa.get(clave) ?? {
        clave, nombre: v.producto.nombre,
        detalle: porVariante ? [v.talla, v.color, v.sku].filter(Boolean).join(' · ') : (v.producto.categoria?.nombre ?? ''),
        unidades: 0, ingresos: 0, costo: 0, facturas: 0,
      };
      r.unidades += Number(i.cantidad);
      r.ingresos += Number(i.subtotal) * factor;
      r.costo += Number(i.cantidad) * Number(i.costo_unitario);
      r.facturas++;
      mapa.set(clave, r);
    }
    return [...mapa.values()].sort((a, b) => b.unidades - a.unidades || b.ingresos - a.ingresos);
  }

  private async rankingTerceros(tipo: 'venta' | 'compra'): Promise<Ranking[]> {
    const tabla = tipo === 'venta' ? 'facturas_venta' : 'facturas_compra';
    const tercero = tipo === 'venta' ? 'clientes' : 'proveedores';
    const campo = tipo === 'venta' ? 'cliente_id' : 'proveedor_id';
    let q = this.sb.from(tabla).select(`${campo}, total, pagado, tercero:${tercero}(nombre, telefono)`).neq('estado', 'anulada');
    if (this.desde) q = q.gte('fecha', this.desde);
    if (this.hasta) q = q.lte('fecha', this.hasta);
    const { data, error } = await q;
    if (error) throw error;
    const mapa = new Map<string, Ranking>();
    for (const f of data as any[]) {
      const r = mapa.get(f[campo]) ?? { clave: f[campo], nombre: f.tercero.nombre, detalle: f.tercero.telefono ?? '', unidades: 0, ingresos: 0, costo: 0, facturas: 0 };
      r.ingresos += Number(f.total);
      r.costo += Number(f.total) - Number(f.pagado); // aquí "costo" = saldo pendiente
      r.facturas++;
      mapa.set(f[campo], r);
    }
    return [...mapa.values()].sort((a, b) => b.ingresos - a.ingresos);
  }

  // ---------- PDF ----------
  async exportarPdf(): Promise<void> {
    const p = this.pestana();
    const doc = new jsPDF({ orientation: p === 'resultados' ? 'landscape' : 'portrait', unit: 'mm', format: 'letter' });
    const est = this.pdf.estiloTabla();
    const der = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [i + 1, { halign: 'right' as const }]));
    const pie = (vals: string[]) => vals.map((v, i) => ({ content: v, styles: { halign: i ? ('right' as const) : ('left' as const) } }));

    if (p === 'estado' || p === 'balance') {
      const d = this.detalleMes();
      if (!d) return;
      const docV = new jsPDF({ unit: 'mm', format: 'letter' });
      const esEstado = p === 'estado';
      const w = docV.internal.pageSize.getWidth();
      let y = await this.pdf.encabezado(docV, esEstado ? 'Estado de resultados' : 'Balance total', this.nombreMes(d.mes));

      // Resumen en palabras
      const resumen = docV.setFont('helvetica', 'normal').setFontSize(9.5).splitTextToSize(esEstado ? this.resumenEstado(d) : this.resumenBalance(d), w - 36);
      docV.setDrawColor(20).setLineWidth(0.6).line(12, y, 12, y + resumen.length * 4.6 + 7);
      docV.setFont('helvetica', 'bold').setFontSize(7).setTextColor(90).text('EN POCAS PALABRAS', 16, y + 3.5);
      docV.setFont('helvetica', 'normal').setFontSize(9).setTextColor(20, 20, 20).text(resumen, 16, y + 8);
      y += resumen.length * 4.6 + 14;

      const pct = (v: number) => `${this.margen(v, d.ventas_netas).toFixed(1)}%`;
      const gastos = this.gastosMes().map((g) => [`     (-) ${g.nombre}`, cop(g.valor), esEstado ? pct(g.valor) : '', '']);
      const body = esEstado
        ? [['Ventas brutas', cop(d.ventas_brutas), '', EXPLICA.ventasBrutas], ['(-) Descuentos', cop(d.descuentos), '', EXPLICA.descuentos],
           ['= Ventas netas', cop(d.ventas_netas), '100%', EXPLICA.ventasNetas],
           ['(-) Costo de lo vendido', cop(d.costo_ventas), pct(d.costo_ventas), EXPLICA.costoVendido],
           ['= GANANCIA BRUTA', cop(d.utilidad_bruta), pct(d.utilidad_bruta), EXPLICA.gananciaBruta],
           ...gastos, ['(-) Total gastos del negocio', cop(d.gastos_operativos), pct(d.gastos_operativos), EXPLICA.gastos],
           ['= GANANCIA NETA', cop(d.utilidad_neta), pct(d.utilidad_neta), EXPLICA.gananciaNeta]]
        : [['Ventas netas', cop(d.ventas_netas), '', EXPLICA.ventasNetasBal], ['(-) Compras de inventario', cop(d.compras_inventario), '', EXPLICA.compras],
           ...gastos, ['(-) Total gastos del negocio', cop(d.gastos_operativos), '', EXPLICA.gastos],
           ['= BALANCE TOTAL', cop(d.balance), '', EXPLICA.balance]];
      const ult = esEstado ? 3 : 2;
      autoTable(docV, {
        ...est, startY: y,
        head: esEstado ? [['Concepto', { content: 'Valor', styles: { halign: 'right' as const } }, { content: '% ventas', styles: { halign: 'right' as const } }, '¿Qué significa?']] : [['Concepto', { content: 'Valor', styles: { halign: 'right' as const } }, '¿Qué significa?']],
        body: esEstado ? body : body.map((r) => [r[0], r[1], r[3]]),
        columnStyles: esEstado
          ? { 0: { cellWidth: 48 }, 1: { halign: 'right', cellWidth: 26 }, 2: { halign: 'right', cellWidth: 18 }, 3: { fontSize: 7.5, textColor: [100, 100, 105] } }
          : { 0: { cellWidth: 52 }, 1: { halign: 'right', cellWidth: 28 }, 2: { fontSize: 7.5, textColor: [100, 100, 105] } },
        didParseCell: (c) => {
          if (c.section === 'body' && String((c.row.raw as any)[0]).startsWith('= ')) {
            c.cell.styles.fontStyle = c.column.index === ult ? 'normal' : 'bold'; c.cell.styles.lineWidth = { top: 0.3, bottom: 0.3 }; c.cell.styles.lineColor = [20, 20, 20];
          }
        },
      });
      y = (docV as any).lastAutoTable.finalY + 7;

      // Diferencia entre ambos informes
      const q = this.quedoEnInventario(d);
      const nota = esEstado
        ? `Este informe NO resta las compras de inventario (${cop(d.compras_inventario)}), porque esa mercancía sigue siendo tuya hasta que la vendes; solo resta lo que costaron las prendas vendidas (${cop(d.costo_ventas)}). Para ver todo lo que salió, revisa el Balance total.`
        : `¿Por qué es distinto a la ganancia neta (${cop(d.utilidad_neta)})? La ganancia neta solo resta lo que costaron las prendas vendidas (${cop(d.costo_ventas)}); este balance resta toda la mercancía comprada (${cop(d.compras_inventario)}). `
          + (q >= 0 ? `La diferencia, ${cop(q)}, es mercancía que quedó en tu inventario para vender después.` : `Ese mes vendiste también prendas que ya tenías de meses anteriores (${cop(-q)} a costo).`);
      docV.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(90).text(docV.splitTextToSize(nota, w - 24), 12, y);
      this.pdf.piePaginas(docV);
      this.pdf.salida(docV, `${esEstado ? 'estado-resultados' : 'balance-total'}-${d.mes.slice(0, 7)}.pdf`);
      return;
    }

    if (p === 'resultados') {
      const y = await this.pdf.encabezado(doc, 'Ganancias por mes', `Año ${this.anio}`);
      const t = this.totalAnio();
      autoTable(doc, {
        ...est, startY: y,
        head: [['Mes', 'Ventas brutas', 'Descuentos', 'Ventas netas', 'Costo de ventas', 'Utilidad bruta', 'Gastos', 'Utilidad neta', 'Margen neto', 'Compras inv.', 'Balance total']],
        body: this.meses().map((m) => [this.nombreMes(m.mes), cop(m.ventas_brutas), cop(m.descuentos), cop(m.ventas_netas), cop(m.costo_ventas),
          cop(m.utilidad_bruta), cop(m.gastos_operativos), cop(m.utilidad_neta), `${this.margen(m.utilidad_neta, m.ventas_netas).toFixed(1)}%`, cop(m.compras_inventario), cop(m.balance)]),
        foot: [pie(['Total ' + this.anio, cop(t.ventas_brutas), cop(t.descuentos), cop(t.ventas_netas), cop(t.costo_ventas), cop(t.utilidad_bruta),
          cop(t.gastos_operativos), cop(t.utilidad_neta), `${this.margen(t.utilidad_neta, t.ventas_netas).toFixed(1)}%`, cop(t.compras_inventario), cop(t.balance)])],
        columnStyles: der(10),
      });
      this.pdf.piePaginas(doc);
      this.pdf.salida(doc, `ganancias-por-mes-${this.anio}.pdf`);
      return;
    }

    if (p === 'inicial') {
      const y0 = await this.pdf.encabezado(doc, 'Inventario inicial', 'Mercancía con la que arrancó el negocio');
      const t = this.totInicial();
      autoTable(doc, {
        ...est, startY: y0,
        head: [['Producto', 'Categoría', 'Talla · Color · Código', 'Unid.', 'Costo u.', 'Valor costo']],
        body: this.inicial().map((i) => [i.nombre, i.categoria, i.detalle, String(i.unidades), cop(i.costo), cop(i.unidades * i.costo)]),
        foot: [pie(['Total', '', '', String(t.unidades), '', cop(t.costo)])],
        columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
      });
      const a = this.acumulado();
      const y1 = (doc as any).lastAutoTable.finalY + 8;
      doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(20, 20, 20).text('Balance acumulado (todo incluido, desde el inicio)', 12, y1);
      autoTable(doc, {
        ...est, startY: y1 + 2, tableWidth: 120,
        body: [['Ventas netas', cop(a.ventas)], ['(-) Inventario inicial', cop(t.costo)], ['(-) Compras de inventario', cop(a.compras)],
          ['(-) Gastos del negocio', cop(a.gastos)], ['= BALANCE ACUMULADO', cop(this.balanceAcumulado())],
          ['Mercancía que tienes hoy (al costo)', cop(a.inventarioHoy)]],
        columnStyles: { 1: { halign: 'right' } },
        didParseCell: (c) => { if (String(c.row.raw && (c.row.raw as any)[0]).startsWith('= ')) c.cell.styles.fontStyle = 'bold'; },
      });
      this.pdf.piePaginas(doc);
      this.pdf.salida(doc, 'inventario-inicial.pdf');
      return;
    }

    const titulos = { productos: 'Productos más vendidos', clientes: 'Ventas por cliente', proveedores: 'Compras por proveedor' };
    const y = await this.pdf.encabezado(doc, titulos[p], this.textoPeriodo);
    const t = this.totalRanking();
    if (p === 'productos') {
      autoTable(doc, {
        ...est, startY: y,
        head: [['#', 'Producto', 'Detalle', 'Unidades', 'Ingresos', 'Costo', 'Ganancia', 'Margen']],
        body: this.ranking().map((r, i) => [String(i + 1), r.nombre, r.detalle, String(r.unidades), cop(r.ingresos), cop(r.costo),
          cop(r.ingresos - r.costo), `${this.margen(r.ingresos - r.costo, r.ingresos).toFixed(0)}%`]),
        foot: [pie(['', 'Total', '', String(t.unidades), cop(t.ingresos), cop(t.costo), cop(t.ingresos - t.costo), `${this.margen(t.ingresos - t.costo, t.ingresos).toFixed(0)}%`])],
        columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' } },
      });
    } else {
      autoTable(doc, {
        ...est, startY: y,
        head: [['#', p === 'clientes' ? 'Cliente' : 'Proveedor', 'Teléfono', 'Facturas', p === 'clientes' ? 'Total comprado' : 'Total comprado', 'Saldo pendiente']],
        body: this.ranking().map((r, i) => [String(i + 1), r.nombre, r.detalle, String(r.facturas), cop(r.ingresos), cop(r.costo)]),
        foot: [pie(['', 'Total', '', String(this.ranking().reduce((s, r) => s + r.facturas, 0)), cop(t.ingresos), cop(t.costo)])],
        columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
      });
    }
    this.pdf.piePaginas(doc);
    this.pdf.salida(doc, `${p}.pdf`);
  }
}
