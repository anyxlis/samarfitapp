export type TipoFactura = 'compra' | 'venta';

export interface ConfigFactura {
  tipo: TipoFactura;
  titulo: string;          // Factura de compra
  plural: string;          // Facturas de compra
  prefijo: string;         // FC
  ruta: string;            // /facturas-compra
  tabla: string;
  tablaItems: string;
  tablaPagos: string;
  tablaTercero: string;
  campoTercero: string;
  campoPrecio: 'costo_unitario' | 'precio_unitario';
  rpcCrear: string;
  rpcAnular: string;
  tercero: string;         // Proveedor / Cliente
  precio: string;          // Costo unitario / Precio unitario
  pago: string;            // Pago / Abono
}

export const CONFIG: Record<TipoFactura, ConfigFactura> = {
  compra: {
    tipo: 'compra', titulo: 'Factura de compra', plural: 'Facturas de compra', prefijo: 'FC', ruta: '/facturas-compra',
    tabla: 'facturas_compra', tablaItems: 'factura_compra_items', tablaPagos: 'pagos_compra',
    tablaTercero: 'proveedores', campoTercero: 'proveedor_id', campoPrecio: 'costo_unitario',
    rpcCrear: 'crear_factura_compra', rpcAnular: 'anular_factura_compra',
    tercero: 'Proveedor', precio: 'Costo unitario', pago: 'Pago',
  },
  venta: {
    tipo: 'venta', titulo: 'Factura de venta', plural: 'Facturas de venta', prefijo: 'FV', ruta: '/facturas-venta',
    tabla: 'facturas_venta', tablaItems: 'factura_venta_items', tablaPagos: 'abonos_venta',
    tablaTercero: 'clientes', campoTercero: 'cliente_id', campoPrecio: 'precio_unitario',
    rpcCrear: 'crear_factura_venta', rpcAnular: 'anular_factura_venta',
    tercero: 'Cliente', precio: 'Precio unitario', pago: 'Abono',
  },
};

export const METODOS = [
  { id: 'efectivo', nombre: 'Efectivo' },
  { id: 'transferencia', nombre: 'Transferencia' },
  { id: 'nequi', nombre: 'Nequi' },
  { id: 'daviplata', nombre: 'Daviplata' },
  { id: 'tarjeta', nombre: 'Tarjeta' },
  { id: 'otro', nombre: 'Otro' },
];

export const ESTADOS: Record<string, { texto: string; clase: string }> = {
  pendiente: { texto: 'Pendiente', clase: 'text-bg-warning' },
  parcial: { texto: 'Abonada', clase: 'text-bg-info' },
  pagada: { texto: 'Pagada', clase: 'text-bg-success' },
  anulada: { texto: 'Anulada', clase: 'text-bg-secondary' },
};

export interface Pago {
  id: string; fecha: string; valor: number; metodo: string; referencia: string | null; notas: string | null;
}

export interface ItemDetalle {
  id: string; cantidad: number; costo_unitario?: number; precio_unitario?: number; subtotal: number;
  variante: { sku: string; talla: string | null; color: string | null; producto: { nombre: string } };
}

export interface FacturaDetalle {
  id: string; numero: string; fecha: string; fecha_vencimiento: string | null; forma_pago: string;
  subtotal: number; descuento_tipo: string; descuento_valor: number; descuento: number; total: number;
  pagado: number; estado: string; notas: string | null; numero_proveedor?: string | null; created_at: string;
  tercero: { nombre: string; tipo_documento: string; documento: string | null; telefono: string | null;
             correo: string | null; direccion: string | null; ciudad: string | null };
  items: ItemDetalle[];
  pagos: Pago[];
}

export function descripcionVariante(v: { talla: string | null; color: string | null; producto: { nombre: string } }) {
  return [v.producto.nombre, v.talla, v.color].filter(Boolean).join(' · ');
}

export function nombreMetodo(id: string) {
  return METODOS.find((m) => m.id === id)?.nombre ?? id;
}
