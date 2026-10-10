import { BtnPdfComponent } from '../../shared/btn-pdf.component';
import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SupabaseService } from '../../core/supabase.service';
import { ToastService } from '../../core/toast.service';
import { PdfService } from '../../core/pdf.service';
import { CopPipe, cop, fechaCorta, hoyISO, mensajeError, normalizar } from '../../shared/format';
import { CONFIG, ConfigFactura, ESTADOS, TipoFactura } from './factura.config';

interface FilaFactura {
  id: string; numero: string; fecha: string; fecha_vencimiento: string | null; forma_pago: string;
  total: number; pagado: number; estado: string; numero_proveedor?: string | null;
  tercero: { nombre: string };
}

type Periodo = 'mes' | 'mes_anterior' | 'anio' | 'todo' | 'personalizado';

@Component({
  selector: 'app-facturas-lista',
  standalone: true,
  imports: [BtnPdfComponent, FormsModule, RouterLink, CopPipe],
  templateUrl: './facturas-lista.component.html',
})
export class FacturasListaComponent implements OnInit {
  @Input() tipo: TipoFactura = 'compra';
  cfg: ConfigFactura = CONFIG.compra;

  private readonly sb = inject(SupabaseService).client;
  private readonly toast = inject(ToastService);
  private readonly pdf = inject(PdfService);

  readonly estados = ESTADOS;
  readonly fechaCorta = fechaCorta;
  readonly lista = signal<FilaFactura[]>([]);
  readonly cargando = signal(true);
  readonly busqueda = signal('');
  readonly estado = signal('');
  periodo: Periodo = 'mes';
  desde = '';
  hasta = '';

  readonly filtradas = computed(() => {
    const q = normalizar(this.busqueda().trim());
    const e = this.estado();
    return this.lista().filter((f) =>
      (!e || f.estado === e) &&
      (!q || normalizar(`${f.numero} ${f.tercero.nombre} ${f.numero_proveedor ?? ''}`).includes(q)));
  });

  readonly kpis = computed(() => {
    const v = this.filtradas().filter((f) => f.estado !== 'anulada');
    const total = v.reduce((s, f) => s + Number(f.total), 0);
    const pagado = v.reduce((s, f) => s + Number(f.pagado), 0);
    return { cantidad: v.length, total, pagado, saldo: total - pagado };
  });

  get esCompra() { return this.tipo === 'compra'; }

  ngOnInit() {
    this.cfg = CONFIG[this.tipo];
    this.aplicarPeriodo('mes');
  }

  aplicarPeriodo(p: Periodo) {
    this.periodo = p;
    const hoy = new Date();
    const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    if (p === 'mes') { this.desde = iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)); this.hasta = hoyISO(); }
    if (p === 'mes_anterior') {
      this.desde = iso(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1));
      this.hasta = iso(new Date(hoy.getFullYear(), hoy.getMonth(), 0));
    }
    if (p === 'anio') { this.desde = iso(new Date(hoy.getFullYear(), 0, 1)); this.hasta = hoyISO(); }
    if (p === 'todo') { this.desde = ''; this.hasta = ''; }
    if (p !== 'personalizado') this.cargar();
  }

  async cargar() {
    this.cargando.set(true);
    const campos = `id, numero, fecha, fecha_vencimiento, forma_pago, total, pagado, estado${this.esCompra ? ', numero_proveedor' : ''}, tercero:${this.cfg.tablaTercero}(nombre)`;
    let q = this.sb.from(this.cfg.tabla).select(campos);
    if (this.desde) q = q.gte('fecha', this.desde);
    if (this.hasta) q = q.lte('fecha', this.hasta);
    const { data, error } = await q.order('fecha', { ascending: false }).order('numero', { ascending: false });
    this.cargando.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.lista.set(data as unknown as FilaFactura[]);
  }

  vencida(f: FilaFactura) {
    return f.fecha_vencimiento && f.estado !== 'pagada' && f.estado !== 'anulada' && f.fecha_vencimiento < hoyISO();
  }

  get textoPeriodo() {
    if (!this.desde && !this.hasta) return 'Todas las fechas';
    return `Del ${fechaCorta(this.desde) || '…'} al ${fechaCorta(this.hasta) || 'hoy'}`;
  }

  async exportarPdf() {
    const l = this.filtradas();
    const k = this.kpis();
    await this.pdf.tabla(`Listado de ${this.cfg.plural.toLowerCase()}`,
      ['Número', 'Fecha', this.cfg.tercero, 'Forma pago', 'Estado', 'Total', 'Saldo'],
      l.map((f) => [f.numero, fechaCorta(f.fecha), f.tercero.nombre, f.forma_pago === 'credito' ? 'Crédito' : 'Contado',
        ESTADOS[f.estado]?.texto ?? f.estado, cop(f.total), f.estado === 'anulada' ? '' : cop(Number(f.total) - Number(f.pagado))]),
      this.cfg.tabla,
      { subtitulo: this.textoPeriodo, derecha: [5, 6], horizontal: true,
        totales: [`${k.cantidad} facturas`, '', '', '', '', cop(k.total), cop(k.saldo)] });
  }
}
