import { BtnPdfComponent } from '../../shared/btn-pdf.component';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgSelectModule } from '@ng-select/ng-select';
import { SupabaseService } from '../../core/supabase.service';
import { ToastService } from '../../core/toast.service';
import { PdfService } from '../../core/pdf.service';
import { CopPipe, cop, mensajeError, normalizar } from '../../shared/format';
import { NumeroDirective } from '../../shared/numero.directive';

interface Categoria { id: string; nombre: string }

interface Producto {
  id: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  categoria_id: string | null;
  categoria: { nombre: string } | null;
}

interface Variante {
  id?: string;
  producto_id?: string;
  sku: string;
  talla: string | null;
  color: string | null;
  costo: number | null;
  precio: number | null;
  stock: number;
  stock_minimo: number | null;
  activo: boolean;
  stock_inicial?: number | null;   // solo al crear
}

interface Fila extends Variante { producto: Producto }

interface Movimiento {
  id: string; fecha: string; tipo: string; cantidad: number; costo_unitario: number;
  referencia_tipo: string | null; referencia_id: string | null; notas: string | null;
  referencia?: string; saldo?: number;
}

const TIPOS_MOV: Record<string, string> = {
  entrada_compra: 'Compra', salida_venta: 'Venta', ajuste_entrada: 'Ajuste (+)',
  ajuste_salida: 'Ajuste (−)', anulacion: 'Anulación',
};

@Component({
  selector: 'app-inventario',
  standalone: true,
  imports: [BtnPdfComponent, FormsModule, NgSelectModule, CopPipe, DecimalPipe, DatePipe, NumeroDirective],
  templateUrl: './inventario.component.html',
})
export class InventarioComponent implements OnInit {
  private readonly sb = inject(SupabaseService).client;
  private readonly toast = inject(ToastService);
  private readonly pdf = inject(PdfService);

  readonly motivos = ['Inventario inicial', 'Conteo físico', 'Devolución de cliente', 'Daño o pérdida', 'Regalo / muestra', 'Uso interno', 'Otro'];

  readonly filas = signal<Fila[]>([]);
  readonly categorias = signal<Categoria[]>([]);
  readonly cargando = signal(true);
  readonly guardando = signal(false);

  // filtros
  readonly busqueda = signal('');
  readonly categoriaId = signal<string | null>(null);
  readonly vista = signal<'todos' | 'bajo' | 'agotado' | 'inactivos'>('todos');

  readonly filtradas = computed(() => {
    const q = normalizar(this.busqueda().trim());
    const cat = this.categoriaId();
    const v = this.vista();
    return this.filas().filter((f) => {
      const activo = f.activo && f.producto.activo;
      if (v === 'inactivos' ? activo : !activo) return false;
      if (v === 'agotado' && f.stock > 0) return false;
      if (v === 'bajo' && !this.esBajo(f)) return false;
      if (cat && f.producto.categoria_id !== cat) return false;
      return !q || normalizar([f.producto.nombre, f.sku, f.talla, f.color, f.producto.categoria?.nombre].join(' ')).includes(q);
    });
  });

  readonly kpis = computed(() => {
    const act = this.filas().filter((f) => f.activo && f.producto.activo);
    return {
      referencias: act.length,
      unidades: act.reduce((s, f) => s + f.stock, 0),
      valorCosto: act.reduce((s, f) => s + f.stock * Number(f.costo), 0),
      valorVenta: act.reduce((s, f) => s + f.stock * Number(f.precio), 0),
      bajos: act.filter((f) => this.esBajo(f)).length,
    };
  });

  readonly totalesFiltro = computed(() => {
    const l = this.filtradas();
    return {
      unidades: l.reduce((s, f) => s + f.stock, 0),
      valorCosto: l.reduce((s, f) => s + f.stock * Number(f.costo), 0),
    };
  });

  // modal producto
  readonly modalProducto = signal(false);
  prod: { id?: string; nombre: string; descripcion: string | null; categoria_id: string | null; activo: boolean } = this.prodVacio();
  variantes: Variante[] = [];
  tallasTxt = '';
  coloresTxt = '';

  // modal ajuste
  readonly modalAjuste = signal(false);
  ajuste = { fila: null as Fila | null, tipo: 'ajuste_entrada', cantidad: null as number | null, motivo: 'Conteo físico', notas: '' };

  // modal kardex
  readonly modalKardex = signal(false);
  readonly kardexFila = signal<Fila | null>(null);
  readonly movimientos = signal<Movimiento[]>([]);
  readonly cargandoKardex = signal(false);

  // vista en cuadros / lista (se recuerda en este navegador)
  readonly modo = signal<'cuadros' | 'lista'>(this.leerModo());

  private leerModo(): 'cuadros' | 'lista' {
    try { return localStorage.getItem('sf-inv-modo') === 'lista' ? 'lista' : 'cuadros'; } catch { return 'cuadros'; }
  }

  cambiarModo(m: 'cuadros' | 'lista') {
    this.modo.set(m);
    try { localStorage.setItem('sf-inv-modo', m); } catch { /* sin almacenamiento */ }
  }

  /** Productos agrupados con sus variantes por color */
  readonly grupos = computed(() => {
    const mapa = new Map<string, Fila[]>();
    for (const f of this.filtradas()) {
      const l = mapa.get(f.producto.id) ?? [];
      l.push(f);
      mapa.set(f.producto.id, l);
    }
    return [...mapa.values()].map((vs) => {
      const colores = new Map<string, Fila[]>();
      for (const v of vs) {
        const k = v.color ?? '';
        colores.set(k, [...(colores.get(k) ?? []), v]);
      }
      const precios = vs.map((v) => Number(v.precio));
      const costos = vs.map((v) => Number(v.costo));
      return {
        producto: vs[0].producto,
        variantes: vs,
        stock: vs.reduce((s, v) => s + v.stock, 0),
        valorCosto: vs.reduce((s, v) => s + v.stock * Number(v.costo), 0),
        precioMin: Math.min(...precios), precioMax: Math.max(...precios),
        costoMin: Math.min(...costos), costoMax: Math.max(...costos),
        colores: [...colores.entries()].map(([color, variantes]) => ({
          color, variantes: variantes.sort((a, b) => this.ordenTalla(a.talla) - this.ordenTalla(b.talla)),
        })),
      };
    });
  });

  rango(min: number, max: number) { return min === max ? cop(min) : `${cop(min)} – ${cop(max)}`; }

  colorCss(nombre: string): string {
    const n = normalizar(nombre);
    const mapa: [string, string][] = [
      ['negr', '#1f1f22'], ['blanc', '#ffffff'], ['gris', '#9a9aa0'], ['plat', '#c9ccd1'], ['beige', '#e8d9bd'], ['crema', '#f3e9d2'],
      ['nude', '#e3bc9a'], ['cafe', '#7a4e2d'], ['marron', '#7a4e2d'], ['camel', '#c19a6b'], ['vino', '#7b1e3a'], ['rojo', '#d62f2f'],
      ['palo de rosa', '#d8a7a7'], ['fucsia', '#e0218a'], ['rosad', '#f4a6c1'], ['rosa', '#f4a6c1'], ['coral', '#ff7f6a'], ['naranj', '#f28c28'],
      ['amarill', '#f5d442'], ['mostaza', '#d4a017'], ['dorad', '#c9a227'], ['verde', '#2e9b5b'], ['menta', '#9fe2bf'], ['oliva', '#708238'],
      ['turquesa', '#30c5c5'], ['celeste', '#8ec9f0'], ['azul', '#2f5fd0'], ['lila', '#c8a2e8'], ['lavanda', '#c8a2e8'], ['morad', '#6f3fa8'],
    ];
    return mapa.find(([k]) => n.includes(k))?.[1] ?? 'linear-gradient(135deg, #e6c76a, #b8923a)';
  }

  ngOnInit() { this.cargar(); }

  nombreTipo(t: string) { return TIPOS_MOV[t] ?? t; }

  async cargar() {
    this.cargando.set(true);
    const [v, c] = await Promise.all([
      this.sb.from('variantes')
        .select('*, producto:productos(id, nombre, descripcion, activo, categoria_id, categoria:categorias(nombre))')
        .order('sku'),
      this.sb.from('categorias').select('id, nombre').order('nombre'),
    ]);
    this.cargando.set(false);
    if (v.error) return this.toast.error(mensajeError(v.error));
    const filas = (v.data as unknown as Fila[]).sort((a, b) =>
      a.producto.nombre.localeCompare(b.producto.nombre) || (a.color ?? '').localeCompare(b.color ?? '') || this.ordenTalla(a.talla) - this.ordenTalla(b.talla));
    this.filas.set(filas);
    this.categorias.set((c.data ?? []) as Categoria[]);
  }

  esBajo(f: Variante) { return f.stock === 0 || (Number(f.stock_minimo) > 0 && f.stock <= Number(f.stock_minimo)); }

  margen(f: Variante) {
    const p = Number(f.precio);
    return p > 0 ? ((p - Number(f.costo)) / p) * 100 : 0;
  }

  private ordenTalla(t: string | null) {
    const orden = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'U', 'UNICA'];
    const i = orden.indexOf((t ?? '').toUpperCase());
    return i >= 0 ? i : 100 + (Number(t) || 0);
  }

  // ---------- Producto ----------
  private prodVacio() { return { nombre: '', descripcion: null, categoria_id: null, activo: true }; }

  private varianteVacia(talla: string | null = null, color: string | null = null): Variante {
    return { sku: '', talla, color, costo: null, precio: null, stock: 0, stock_minimo: null, activo: true, stock_inicial: null };
  }

  nuevoProducto() {
    this.prod = this.prodVacio();
    this.variantes = [this.varianteVacia()];
    this.tallasTxt = '';
    this.coloresTxt = '';
    this.modalProducto.set(true);
  }

  editarProducto(f: Fila) {
    const p = f.producto;
    this.prod = { id: p.id, nombre: p.nombre, descripcion: p.descripcion, categoria_id: p.categoria_id, activo: p.activo };
    this.variantes = this.filas().filter((x) => x.producto.id === p.id).map(({ producto, ...v }) => ({ ...v }));
    this.tallasTxt = '';
    this.coloresTxt = '';
    this.modalProducto.set(true);
  }

  /** Crea una categoría nueva escribiéndola dentro del selector */
  crearCategoria = async (nombre: string): Promise<Categoria | null> => {
    const { data, error } = await this.sb.from('categorias').insert({ nombre: nombre.trim() }).select('id, nombre').single();
    if (error) { this.toast.error(mensajeError(error)); return null; }
    this.categorias.update((l) => [...l, data as Categoria].sort((a, b) => a.nombre.localeCompare(b.nombre)));
    return data as Categoria;
  };

  generarCombinaciones() {
    const lista = (t: string) => t.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
    const tallas = lista(this.tallasTxt);
    const colores = lista(this.coloresTxt);
    if (!tallas.length && !colores.length) return this.toast.aviso('Escribe tallas y/o colores separados por coma.');
    const base = this.variantes.find((v) => v.costo || v.precio);
    const existe = (t: string | null, c: string | null) =>
      this.variantes.some((v) => normalizar(v.talla) === normalizar(t) && normalizar(v.color) === normalizar(c));
    // Quita filas vacías iniciales
    this.variantes = this.variantes.filter((v) => v.id || v.talla || v.color || v.sku || v.costo || v.precio);
    for (const c of colores.length ? colores : [null]) {
      for (const t of tallas.length ? tallas : [null]) {
        if (existe(t, c)) continue;
        const v = this.varianteVacia(t, c);
        v.costo = base?.costo ?? null;
        v.precio = base?.precio ?? null;
        v.sku = this.generarSku(t, c);
        this.variantes.push(v);
      }
    }
  }

  /** Copia costo, precio y mínimo de la primera fila a todas */
  igualarPrecios() {
    const b = this.variantes[0];
    if (!b) return;
    for (const v of this.variantes) { v.costo = b.costo; v.precio = b.precio; v.stock_minimo = b.stock_minimo; }
  }

  agregarVariante() { this.variantes.push(this.varianteVacia()); }

  quitarVariante(i: number) {
    const v = this.variantes[i];
    if (v.id) return this.toast.aviso('Esta variante ya existe. Desactívala en lugar de quitarla.');
    this.variantes.splice(i, 1);
  }

  generarSku(talla: string | null, color: string | null): string {
    const limpiar = (s: string) => normalizar(s).replace(/[^a-z0-9 ]/g, '').trim();
    const base = limpiar(this.prod.nombre).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w.slice(0, 3)).join('').toUpperCase() || 'PRD';
    const col = color ? limpiar(color).replace(/\s/g, '').slice(0, 3).toUpperCase() : '';
    const tal = talla ? limpiar(talla).replace(/\s/g, '').toUpperCase() : '';
    return [base, col, tal].filter(Boolean).join('-');
  }

  async guardarProducto() {
    const p = this.prod;
    if (!p.nombre.trim()) return this.toast.aviso('El nombre del producto es obligatorio.');
    const vars = this.variantes.filter((v) => v.id || v.talla || v.color || v.sku || v.costo || v.precio);
    if (!vars.length) return this.toast.aviso('Agrega al menos una variante (talla/color).');
    for (const v of vars) {
      v.sku = (v.sku || this.generarSku(v.talla, v.color)).trim().toUpperCase();
      if (v.precio === null || v.precio === undefined) return this.toast.aviso(`Falta el precio de venta en ${v.sku}.`);
    }
    const skus = vars.map((v) => v.sku);
    if (new Set(skus).size !== skus.length) return this.toast.aviso('Hay códigos repetidos.');

    this.guardando.set(true);
    try {
      const datosProd = { nombre: p.nombre.trim(), descripcion: p.descripcion?.trim() || null, categoria_id: p.categoria_id, activo: p.activo };
      let productoId = p.id;
      if (productoId) {
        const { error } = await this.sb.from('productos').update(datosProd).eq('id', productoId);
        if (error) throw error;
      } else {
        const { data, error } = await this.sb.from('productos').insert(datosProd).select('id').single();
        if (error) throw error;
        productoId = data.id as string;
      }

      const fila = (v: Variante) => ({
        producto_id: productoId, sku: v.sku, talla: v.talla?.trim() || null, color: v.color?.trim() || null,
        costo: Number(v.costo ?? 0), precio: Number(v.precio ?? 0), stock_minimo: Number(v.stock_minimo ?? 0), activo: v.activo,
      });

      for (const v of vars.filter((x) => x.id)) {
        const { error } = await this.sb.from('variantes').update(fila(v)).eq('id', v.id!);
        if (error) throw error;
      }

      const nuevas = vars.filter((x) => !x.id);
      if (nuevas.length) {
        const { data, error } = await this.sb.from('variantes').insert(nuevas.map(fila)).select('id, sku, costo');
        if (error) {
          if (!p.id) await this.sb.from('productos').delete().eq('id', productoId!);
          throw error;
        }
        // Stock inicial → entra por el kardex
        const movs = nuevas
          .filter((v) => Number(v.stock_inicial) > 0)
          .map((v) => {
            const creada = (data as any[]).find((d) => d.sku === v.sku);
            return { variante_id: creada.id, tipo: 'ajuste_entrada', cantidad: Number(v.stock_inicial),
                     costo_unitario: Number(creada.costo), referencia_tipo: 'AJ', notas: 'Inventario inicial' };
          });
        if (movs.length) {
          const { error: e2 } = await this.sb.from('movimientos_inventario').insert(movs);
          if (e2) throw e2;
        }
      }

      this.toast.ok(p.id ? 'Producto actualizado.' : 'Producto creado.');
      this.modalProducto.set(false);
      this.cargar();
    } catch (e) {
      this.toast.error(mensajeError(e));
    } finally {
      this.guardando.set(false);
    }
  }

  // ---------- Ajuste ----------
  abrirAjuste(f: Fila) {
    this.ajuste = { fila: f, tipo: 'ajuste_entrada', cantidad: null, motivo: 'Conteo físico', notas: '' };
    this.modalAjuste.set(true);
  }

  get stockResultante() {
    const a = this.ajuste;
    if (!a.fila) return 0;
    return a.fila.stock + (a.tipo === 'ajuste_entrada' ? 1 : -1) * Number(a.cantidad ?? 0);
  }

  async guardarAjuste() {
    const a = this.ajuste;
    if (!a.fila || !a.cantidad) return this.toast.aviso('Escribe la cantidad.');
    if (this.stockResultante < 0) return this.toast.aviso('No puedes sacar más unidades de las que hay en stock.');
    this.guardando.set(true);
    const { error } = await this.sb.from('movimientos_inventario').insert({
      variante_id: a.fila.id, tipo: a.tipo,
      cantidad: a.tipo === 'ajuste_entrada' ? a.cantidad : -a.cantidad,
      costo_unitario: Number(a.fila.costo), referencia_tipo: 'AJ',
      notas: [a.motivo, a.notas.trim()].filter(Boolean).join(' · '),
    });
    this.guardando.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.toast.ok('Ajuste registrado.');
    this.modalAjuste.set(false);
    this.cargar();
  }

  // ---------- Kardex ----------
  async abrirKardex(f: Fila) {
    this.kardexFila.set(f);
    this.movimientos.set([]);
    this.modalKardex.set(true);
    this.cargandoKardex.set(true);
    const { data, error } = await this.sb.from('movimientos_inventario')
      .select('id, fecha, tipo, cantidad, costo_unitario, referencia_tipo, referencia_id, notas')
      .eq('variante_id', f.id!).order('fecha', { ascending: false }).limit(300);
    if (error) { this.cargandoKardex.set(false); return this.toast.error(mensajeError(error)); }
    const movs = data as Movimiento[];

    // Números de factura
    const ids = (t: string) => [...new Set(movs.filter((m) => m.referencia_tipo === t && m.referencia_id).map((m) => m.referencia_id!))];
    const [fv, fc] = await Promise.all([
      ids('FV').length ? this.sb.from('facturas_venta').select('id, numero').in('id', ids('FV')) : Promise.resolve({ data: [] as any[] }),
      ids('FC').length ? this.sb.from('facturas_compra').select('id, numero').in('id', ids('FC')) : Promise.resolve({ data: [] as any[] }),
    ]);
    const nums = new Map<string, string>([...(fv.data ?? []), ...(fc.data ?? [])].map((x: any) => [x.id, x.numero]));

    // Saldo corrido (de la más reciente hacia atrás)
    let saldo = f.stock;
    for (const m of movs) {
      m.referencia = (m.referencia_id && nums.get(m.referencia_id)) || (m.referencia_tipo === 'AJ' ? 'Ajuste' : '');
      m.saldo = saldo;
      saldo -= m.cantidad;
    }
    this.movimientos.set(movs);
    this.cargandoKardex.set(false);
  }

  async kardexPdf() {
    const f = this.kardexFila()!;
    const filas = this.movimientos().map((m) => [
      new Date(m.fecha).toLocaleString('es-CO'), this.nombreTipo(m.tipo), m.referencia ?? '', m.notas ?? '',
      m.cantidad > 0 ? String(m.cantidad) : '', m.cantidad < 0 ? String(-m.cantidad) : '', cop(m.costo_unitario), String(m.saldo),
    ]);
    await this.pdf.tabla('Kardex', ['Fecha', 'Tipo', 'Documento', 'Detalle', 'Entra', 'Sale', 'Costo u.', 'Saldo'], filas,
      `kardex-${f.sku}`, { subtitulo: `${f.producto.nombre} · ${f.sku}`, derecha: [4, 5, 6, 7], horizontal: true });
  }

  // ---------- PDF inventario ----------
  async exportarPdf() {
    const l = this.filtradas();
    const filas = l.map((f) => [
      f.producto.nombre, f.producto.categoria?.nombre ?? '', f.sku, f.talla ?? '', f.color ?? '',
      String(f.stock), cop(f.costo), cop(f.precio), cop(f.stock * Number(f.costo)),
    ]);
    const t = this.totalesFiltro();
    await this.pdf.tabla('Inventario', ['Producto', 'Categoría', 'Código', 'Talla', 'Color', 'Stock', 'Costo', 'Precio', 'Valor costo'], filas,
      'inventario', { derecha: [5, 6, 7, 8], horizontal: true,
        totales: [`${l.length} referencias`, '', '', '', '', String(t.unidades), '', '', cop(t.valorCosto)] });
  }
}
