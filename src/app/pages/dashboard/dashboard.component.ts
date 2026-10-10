import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SupabaseService } from '../../core/supabase.service';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { CopPipe, fechaCorta, hoyISO, linkWhatsapp, mensajeError, sumarDias } from '../../shared/format';
import { Periodo, rangoPeriodo, textoRango } from '../../shared/periodo';

interface Mes { mes: string; ventas_netas: number; utilidad_bruta: number; gastos_operativos: number; utilidad_neta: number; compras_inventario: number }
interface Deudor { id: string; nombre: string; telefono: string | null; saldo: number; maxMora: number; facturas: number }
interface Cobro { factura_id: string; numero: string; cliente: string; telefono: string | null; saldo: number; fecha_vencimiento: string; dias: number }
interface Top { nombre: string; unidades: number; ingresos: number }
interface Bajo { id: string; nombre: string; detalle: string; stock: number; minimo: number }

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterLink, CopPipe, DecimalPipe],
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent implements OnInit {
  private readonly sb = inject(SupabaseService).client;
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  readonly fechaCorta = fechaCorta;
  readonly linkWhatsapp = linkWhatsapp;
  readonly Math = Math;

  readonly cargando = signal(true);
  readonly periodo = signal<Periodo>('mes');
  readonly meses = signal<Mes[]>([]);
  readonly numVentas = signal(0);
  readonly deudores = signal<Deudor[]>([]);
  readonly totalCobrar = signal({ total: 0, vencido: 0 });
  readonly totalPagar = signal({ total: 0, vencido: 0 });
  readonly proximos = signal<Cobro[]>([]);
  readonly top = signal<Top[]>([]);
  readonly bajos = signal<Bajo[]>([]);

  readonly saludo = computed(() => {
    const h = new Date().getHours();
    const nombre = (this.auth.user()?.user_metadata?.['nombre'] as string) || '';
    return `${h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches'}${nombre ? ', ' + nombre : ''}`;
  });

  get rango() { return rangoPeriodo(this.periodo()); }
  get textoPeriodo() { const r = this.rango; return textoRango(r.desde, r.hasta); }

  /** Totales del periodo elegido (a partir del resumen mensual) */
  readonly kpi = computed(() => {
    const { desde, hasta } = rangoPeriodo(this.periodo());
    const d = desde.slice(0, 7), h = hasta.slice(0, 7);
    const sel = this.meses().filter((m) => m.mes.slice(0, 7) >= d && m.mes.slice(0, 7) <= h);
    const s = (k: keyof Mes) => sel.reduce((t, m) => t + Number(m[k]), 0);
    const ventas = s('ventas_netas');
    return {
      ventas, bruta: s('utilidad_bruta'), gastos: s('gastos_operativos'), neta: s('utilidad_neta'), compras: s('compras_inventario'),
      margen: ventas ? (s('utilidad_neta') / ventas) * 100 : 0,
    };
  });

  /** Últimos 6 meses para el gráfico */
  readonly grafico = computed(() => {
    const hoy = new Date();
    const lista: { etiqueta: string; ventas: number; neta: number; actual: boolean }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const m = this.meses().find((x) => x.mes.startsWith(k));
      lista.push({ etiqueta: MESES[d.getMonth()], ventas: Number(m?.ventas_netas ?? 0), neta: Number(m?.utilidad_neta ?? 0), actual: i === 0 });
    }
    return lista;
  });
  readonly maxGrafico = computed(() => Math.max(1, ...this.grafico().map((g) => Math.max(g.ventas, Math.abs(g.neta)))));
  readonly maxTop = computed(() => Math.max(1, ...this.top().map((t) => t.unidades)));

  ngOnInit() { this.cargarTodo(); }

  cambiarPeriodo(p: Periodo) {
    this.periodo.set(p);
    this.cargarPeriodo();
  }

  async cargarTodo() {
    this.cargando.set(true);
    try {
      await Promise.all([this.cargarFijos(), this.cargarPeriodo()]);
    } catch (e) {
      this.toast.error(mensajeError(e));
    }
    this.cargando.set(false);
  }

  /** Lo que no depende del periodo: resumen mensual, cartera e inventario */
  private async cargarFijos() {
    const hoy = new Date();
    const desde = `${hoy.getFullYear() - 1}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`;
    const [res, cc, cp, inv] = await Promise.all([
      this.sb.from('v_resumen_mensual').select('*').gte('mes', desde).order('mes'),
      this.sb.from('v_cartera_cobrar').select('*'),
      this.sb.from('v_cartera_pagar').select('saldo, dias_mora'),
      this.sb.from('variantes').select('id, sku, talla, color, stock, stock_minimo, activo, producto:productos!inner(nombre, activo)')
        .eq('activo', true).eq('producto.activo', true),
    ]);
    for (const r of [res, cc, cp, inv]) if (r.error) throw r.error;

    this.meses.set((res.data as any[]).map((m) => ({ ...m, mes: String(m.mes).slice(0, 10) })));

    // Quién me debe
    const cobrar = cc.data as any[];
    const mapa = new Map<string, Deudor>();
    for (const f of cobrar) {
      const d = mapa.get(f.cliente_id) ?? { id: f.cliente_id, nombre: f.cliente, telefono: f.telefono, saldo: 0, maxMora: 0, facturas: 0 };
      d.saldo += Number(f.saldo);
      d.maxMora = Math.max(d.maxMora, f.dias_mora);
      d.facturas++;
      mapa.set(f.cliente_id, d);
    }
    this.deudores.set([...mapa.values()].sort((a, b) => b.maxMora - a.maxMora || b.saldo - a.saldo).slice(0, 6));
    this.totalCobrar.set({
      total: cobrar.reduce((s, f) => s + Number(f.saldo), 0),
      vencido: cobrar.filter((f) => f.dias_mora > 0).reduce((s, f) => s + Number(f.saldo), 0),
    });
    const pagar = cp.data as any[];
    this.totalPagar.set({
      total: pagar.reduce((s, f) => s + Number(f.saldo), 0),
      vencido: pagar.filter((f) => f.dias_mora > 0).reduce((s, f) => s + Number(f.saldo), 0),
    });

    // Próximos cobros: vencen en los próximos 15 días
    const hoyIso = hoyISO();
    const limite = sumarDias(hoyIso, 15);
    this.proximos.set(cobrar
      .filter((f) => f.fecha_vencimiento && f.fecha_vencimiento >= hoyIso && f.fecha_vencimiento <= limite)
      .map((f) => ({
        factura_id: f.factura_id, numero: f.numero, cliente: f.cliente, telefono: f.telefono, saldo: Number(f.saldo),
        fecha_vencimiento: f.fecha_vencimiento,
        dias: Math.round((new Date(f.fecha_vencimiento + 'T12:00:00').getTime() - new Date(hoyIso + 'T12:00:00').getTime()) / 86400000),
      }))
      .sort((a, b) => a.fecha_vencimiento.localeCompare(b.fecha_vencimiento))
      .slice(0, 6));

    // Por agotarse
    this.bajos.set((inv.data as any[])
      .filter((v) => v.stock === 0 || (Number(v.stock_minimo) > 0 && v.stock <= Number(v.stock_minimo)))
      .map((v) => ({ id: v.id, nombre: v.producto.nombre, detalle: [v.talla, v.color].filter(Boolean).join(' · '), stock: v.stock, minimo: Number(v.stock_minimo) }))
      .sort((a, b) => a.stock - b.stock)
      .slice(0, 8));
  }

  /** Lo que depende del periodo: número de ventas y lo más vendido */
  async cargarPeriodo() {
    const { desde, hasta } = this.rango;
    let qn = this.sb.from('facturas_venta').select('id', { count: 'exact', head: true }).neq('estado', 'anulada');
    let qt = this.sb.from('factura_venta_items')
      .select('cantidad, subtotal, variante:variantes(producto:productos(id, nombre)), factura:facturas_venta!inner(fecha, estado, total, subtotal)')
      .neq('factura.estado', 'anulada');
    if (desde) { qn = qn.gte('fecha', desde); qt = qt.gte('factura.fecha', desde); }
    if (hasta) { qn = qn.lte('fecha', hasta); qt = qt.lte('factura.fecha', hasta); }
    const [n, t] = await Promise.all([qn, qt]);
    if (n.error || t.error) return this.toast.error(mensajeError(n.error ?? t.error));
    this.numVentas.set(n.count ?? 0);
    const mapa = new Map<string, Top>();
    for (const i of t.data as any[]) {
      const p = i.variante.producto;
      const factor = Number(i.factura.subtotal) > 0 ? Number(i.factura.total) / Number(i.factura.subtotal) : 1;
      const r = mapa.get(p.id) ?? { nombre: p.nombre, unidades: 0, ingresos: 0 };
      r.unidades += Number(i.cantidad);
      r.ingresos += Number(i.subtotal) * factor;
      mapa.set(p.id, r);
    }
    this.top.set([...mapa.values()].sort((a, b) => b.unidades - a.unidades).slice(0, 5));
  }

  /** 620000 -> 620 mil · 1420000 -> 1,4 M */
  corto(n: number) {
    if (!n) return '';
    return n >= 1_000_000 ? `${(n / 1_000_000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} M` : `${Math.round(n / 1000)} mil`;
  }

  claseMora(d: number) {
    return d === 0 ? 'text-bg-success' : d <= 30 ? 'text-bg-warning' : d <= 60 ? 'sf-bg-orange' : 'text-bg-danger';
  }
}
