import { BtnPdfComponent } from '../../shared/btn-pdf.component';
import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SupabaseService } from '../../core/supabase.service';
import { ToastService } from '../../core/toast.service';
import { FacturaPdfService } from '../../core/factura-pdf.service';
import { CopPipe, fechaCorta, hoyISO, mensajeError } from '../../shared/format';
import { NumeroDirective } from '../../shared/numero.directive';
import {
  CONFIG, ConfigFactura, ESTADOS, FacturaDetalle, METODOS, TipoFactura, descripcionVariante, nombreMetodo,
} from './factura.config';

@Component({
  selector: 'app-factura-detalle',
  standalone: true,
  imports: [BtnPdfComponent, FormsModule, RouterLink, CopPipe, NumeroDirective],
  templateUrl: './factura-detalle.component.html',
})
export class FacturaDetalleComponent implements OnInit {
  @Input() tipo: TipoFactura = 'compra';
  @Input() id = '';
  cfg: ConfigFactura = CONFIG.compra;

  private readonly sb = inject(SupabaseService).client;
  private readonly toast = inject(ToastService);
  private readonly facturaPdf = inject(FacturaPdfService);

  readonly estados = ESTADOS;
  readonly metodos = METODOS;
  readonly fechaCorta = fechaCorta;
  readonly descripcion = descripcionVariante;
  readonly nombreMetodo = nombreMetodo;

  readonly f = signal<FacturaDetalle | null>(null);
  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly modalPago = signal(false);
  pago = { fecha: hoyISO(), valor: null as number | null, metodo: 'efectivo', referencia: '' };

  get saldo() { const f = this.f(); return f ? Number(f.total) - Number(f.pagado) : 0; }
  get vencida() { const f = this.f(); return !!f?.fecha_vencimiento && this.saldo > 0 && f.estado !== 'anulada' && f.fecha_vencimiento < hoyISO(); }

  ngOnInit() {
    this.cfg = CONFIG[this.tipo];
    this.cargar();
  }

  async cargar() {
    this.cargando.set(true);
    const c = this.cfg;
    const { data, error } = await this.sb.from(c.tabla)
      .select(`*, tercero:${c.tablaTercero}(nombre, tipo_documento, documento, telefono, correo, direccion, ciudad),
               items:${c.tablaItems}(id, cantidad, ${c.campoPrecio}, subtotal, variante:variantes(sku, talla, color, producto:productos(nombre))),
               pagos:${c.tablaPagos}(id, fecha, valor, metodo, referencia, notas)`)
      .eq('id', this.id).single();
    this.cargando.set(false);
    if (error) return this.toast.error(mensajeError(error));
    const f = data as unknown as FacturaDetalle;
    f.pagos.sort((a, b) => a.fecha.localeCompare(b.fecha));
    this.f.set(f);
  }

  precio(i: any) { return Number(i[this.cfg.campoPrecio]); }

  abrirPago() {
    this.pago = { fecha: hoyISO(), valor: this.saldo, metodo: 'efectivo', referencia: '' };
    this.modalPago.set(true);
  }

  async guardarPago() {
    const p = this.pago;
    if (!p.valor || p.valor <= 0) return this.toast.aviso('Escribe el valor.');
    if (p.valor > this.saldo) return this.toast.aviso(`El valor supera el saldo (${this.saldo.toLocaleString('es-CO')}).`);
    this.guardando.set(true);
    const { error } = await this.sb.from(this.cfg.tablaPagos).insert({
      factura_id: this.id, fecha: p.fecha, valor: p.valor, metodo: p.metodo, referencia: p.referencia.trim() || null,
    });
    this.guardando.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.toast.ok(`${this.cfg.pago} registrado.`);
    this.modalPago.set(false);
    this.cargar();
  }

  async eliminarPago(id: string) {
    if (!confirm(`¿Eliminar este ${this.cfg.pago.toLowerCase()}? El saldo de la factura volverá a subir.`)) return;
    const { error } = await this.sb.from(this.cfg.tablaPagos).delete().eq('id', id);
    if (error) return this.toast.error(mensajeError(error));
    this.toast.ok(`${this.cfg.pago} eliminado.`);
    this.cargar();
  }

  async anular() {
    const f = this.f()!;
    const msg = this.cfg.tipo === 'compra'
      ? `¿Anular la factura ${f.numero}?\n\n• Las prendas saldrán del inventario.\n• Se eliminarán los pagos registrados.\n\nEsta acción no se puede deshacer.`
      : `¿Anular la factura ${f.numero}?\n\n• Las prendas regresarán al inventario.\n• Se eliminarán los abonos registrados.\n\nEsta acción no se puede deshacer.`;
    if (!confirm(msg)) return;
    this.guardando.set(true);
    const { error } = await this.sb.rpc(this.cfg.rpcAnular, { p_id: this.id });
    this.guardando.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.toast.ok(`Factura ${f.numero} anulada.`);
    this.cargar();
  }

  async descargarPdf() {
    await this.facturaPdf.descargar(this.cfg, this.f()!);
  }
}
