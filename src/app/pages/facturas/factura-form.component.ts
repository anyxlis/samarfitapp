import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { NgSelectModule } from '@ng-select/ng-select';
import { SupabaseService } from '../../core/supabase.service';
import { ToastService } from '../../core/toast.service';
import { CopPipe, hoyISO, mensajeError, normalizar, sumarDias } from '../../shared/format';
import { NumeroDirective } from '../../shared/numero.directive';
import { CONFIG, ConfigFactura, METODOS, TipoFactura } from './factura.config';

interface Tercero { id: string; nombre: string; documento: string | null; telefono: string | null }

interface OpcionVariante {
  id: string; sku: string; talla: string | null; color: string | null;
  costo: number; precio: number; stock: number; nombre: string; etiqueta: string; busqueda: string;
}

interface Item {
  variante_id: string; nombre: string; detalle: string; sku: string;
  cantidad: number | null; precio: number | null; stock: number;
}

@Component({
  selector: 'app-factura-form',
  standalone: true,
  imports: [FormsModule, NgSelectModule, RouterLink, CopPipe, NumeroDirective],
  templateUrl: './factura-form.component.html',
})
export class FacturaFormComponent implements OnInit {
  @Input() tipo: TipoFactura = 'compra';
  cfg: ConfigFactura = CONFIG.compra;

  private readonly sb = inject(SupabaseService).client;
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  readonly metodos = METODOS;
  readonly terceros = signal<Tercero[]>([]);
  readonly variantes = signal<OpcionVariante[]>([]);
  readonly consecutivo = signal('');
  readonly guardando = signal(false);

  f = {
    tercero_id: null as string | null,
    fecha: hoyISO(),
    forma_pago: 'contado' as 'contado' | 'credito',
    fecha_vencimiento: null as string | null,
    metodo_pago: 'efectivo',
    numero_proveedor: '',
    notas: '',
    descuento_tipo: 'valor' as 'valor' | 'porcentaje',
    descuento_valor: null as number | null,
  };
  items: Item[] = [];
  buscador: OpcionVariante | null = null;

  get esCompra() { return this.tipo === 'compra'; }

  ngOnInit() {
    this.cfg = CONFIG[this.tipo];
    this.cargar();
  }

  async cargar() {
    const [t, v, s] = await Promise.all([
      this.sb.from(this.cfg.tablaTercero).select('id, nombre, documento, telefono').eq('activo', true).order('nombre'),
      this.sb.from('variantes')
        .select('id, sku, talla, color, costo, precio, stock, activo, producto:productos!inner(nombre, activo)')
        .eq('activo', true).eq('producto.activo', true),
      this.sb.from('secuencias').select('prefijo, ultimo, longitud').eq('tipo', this.cfg.prefijo).single(),
    ]);
    if (t.error || v.error) return this.toast.error(mensajeError(t.error ?? v.error));
    this.terceros.set(t.data as Tercero[]);
    this.variantes.set(
      (v.data as any[])
        .map((x) => {
          const detalle = [x.talla, x.color].filter(Boolean).join(' · ');
          return {
            id: x.id, sku: x.sku, talla: x.talla, color: x.color, costo: Number(x.costo), precio: Number(x.precio), stock: x.stock,
            nombre: x.producto.nombre, etiqueta: `${x.producto.nombre}${detalle ? ' · ' + detalle : ''}`,
            busqueda: normalizar(`${x.producto.nombre} ${x.talla ?? ''} ${x.color ?? ''} ${x.sku}`),
          } as OpcionVariante;
        })
        .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta)),
    );
    if (s.data) this.consecutivo.set(`${s.data.prefijo}-${String(Number(s.data.ultimo) + 1).padStart(s.data.longitud, '0')}`);
  }

  /** Búsqueda en el selector: todas las palabras, sin tildes, en nombre/talla/color/código */
  buscarVariante = (term: string, item: OpcionVariante) =>
    normalizar(term).split(/\s+/).every((p) => item.busqueda.includes(p));

  buscarTercero = (term: string, item: Tercero) =>
    normalizar(`${item.nombre} ${item.documento ?? ''} ${item.telefono ?? ''}`).includes(normalizar(term));

  /** Crea el proveedor/cliente escribiendo su nombre en el selector */
  crearTercero = async (nombre: string): Promise<Tercero | null> => {
    const { data, error } = await this.sb.from(this.cfg.tablaTercero).insert({ nombre: nombre.trim() })
      .select('id, nombre, documento, telefono').single();
    if (error) { this.toast.error(mensajeError(error)); return null; }
    this.terceros.update((l) => [...l, data as Tercero].sort((a, b) => a.nombre.localeCompare(b.nombre)));
    this.toast.ok(`${this.cfg.tercero} "${data.nombre}" creado. Completa sus datos luego en su módulo.`);
    return data as Tercero;
  };

  agregar(v: OpcionVariante | null) {
    if (!v) return;
    const existente = this.items.find((i) => i.variante_id === v.id);
    if (existente) {
      existente.cantidad = (existente.cantidad ?? 0) + 1;
    } else {
      this.items.push({
        variante_id: v.id, nombre: v.nombre, detalle: [v.talla, v.color].filter(Boolean).join(' · '), sku: v.sku,
        cantidad: 1, precio: this.esCompra ? v.costo || null : v.precio, stock: v.stock,
      });
    }
    setTimeout(() => (this.buscador = null));
  }

  quitar(i: number) { this.items.splice(i, 1); }

  vencerEn(dias: number) { this.f.fecha_vencimiento = sumarDias(this.f.fecha, dias); }

  // ---------- Totales ----------
  subtotalItem(i: Item) { return Number(i.cantidad ?? 0) * Number(i.precio ?? 0); }
  get subtotal() { return this.items.reduce((s, i) => s + this.subtotalItem(i), 0); }
  get unidades() { return this.items.reduce((s, i) => s + Number(i.cantidad ?? 0), 0); }
  get descuento() {
    const v = Number(this.f.descuento_valor ?? 0);
    return this.f.descuento_tipo === 'porcentaje' ? Math.round((this.subtotal * Math.min(v, 100)) / 100) : Math.min(v, this.subtotal);
  }
  get total() { return this.subtotal - this.descuento; }

  sinStock(i: Item) { return !this.esCompra && Number(i.cantidad) > i.stock; }

  async guardar() {
    const f = this.f;
    if (!f.tercero_id) return this.toast.aviso(`Selecciona el ${this.cfg.tercero.toLowerCase()}.`);
    if (!this.items.length) return this.toast.aviso('Agrega al menos un producto.');
    if (this.items.some((i) => !i.cantidad)) return this.toast.aviso('Hay productos sin cantidad.');
    if (this.items.some((i) => i.precio === null)) return this.toast.aviso(`Hay productos sin ${this.cfg.precio.toLowerCase()}.`);
    if (this.items.some((i) => this.sinStock(i))) return this.toast.aviso('Hay productos con más unidades de las disponibles.');
    if (f.forma_pago === 'credito' && !f.fecha_vencimiento) return this.toast.aviso('Indica la fecha de vencimiento del crédito.');
    if (f.descuento_tipo === 'porcentaje' && Number(f.descuento_valor) > 100) return this.toast.aviso('El descuento no puede superar el 100%.');

    const params: Record<string, unknown> = {
      [this.esCompra ? 'p_proveedor_id' : 'p_cliente_id']: f.tercero_id,
      p_fecha: f.fecha,
      p_forma_pago: f.forma_pago,
      p_fecha_vencimiento: f.forma_pago === 'credito' ? f.fecha_vencimiento : null,
      p_descuento_tipo: f.descuento_tipo,
      p_descuento_valor: Number(f.descuento_valor ?? 0),
      p_notas: f.notas.trim() || null,
      p_items: this.items.map((i) => ({ variante_id: i.variante_id, cantidad: i.cantidad, [this.cfg.campoPrecio]: i.precio })),
      p_metodo_pago: f.metodo_pago,
    };
    if (this.esCompra) params['p_numero_proveedor'] = f.numero_proveedor.trim() || null;

    this.guardando.set(true);
    const { data, error } = await this.sb.rpc(this.cfg.rpcCrear, params);
    this.guardando.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.toast.ok(`${this.cfg.titulo} guardada.`);
    this.router.navigate([this.cfg.ruta, data]);
  }
}
