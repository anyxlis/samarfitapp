-- =====================================================================
-- SamarFit · Módulo de inventario · Esquema completo (Supabase / PostgreSQL)
-- Ejecutar completo en: Supabase > SQL Editor (o pgAdmin4 contra la BD)
-- =====================================================================

-- ---------- 1. CONFIGURACIÓN Y USUARIOS --------------------------------

create table empresa_config (
  id int primary key default 1 check (id = 1),          -- una sola fila
  nombre text not null default 'SamarFit',
  eslogan text default 'by Sandra Cochet',
  nit text,
  direccion text,
  telefono text,
  correo text,
  ciudad text,
  pie_factura text default 'Gracias por tu compra',
  plantilla_recordatorio text not null default
    'Hola {cliente}, te saludamos de {empresa}. Te recordamos que tu factura {factura} por {saldo} venció el {vencimiento}. Quedamos atentos a tu pago. ¡Gracias!',
  updated_at timestamptz not null default now()
);

create table perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text,
  created_at timestamptz not null default now()
);

create function handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.perfiles (id, nombre)
  values (new.id, coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1)));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function handle_new_user();

-- ---------- 2. TERCEROS ------------------------------------------------

create table clientes (
  id uuid primary key default gen_random_uuid(),
  tipo_documento text not null default 'CC',
  documento text,
  nombre text not null,
  telefono text,
  correo text,
  direccion text,
  ciudad text,
  notas text,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index clientes_documento_uq on clientes (documento) where documento is not null;

create table proveedores (
  id uuid primary key default gen_random_uuid(),
  tipo_documento text not null default 'NIT',
  documento text,
  nombre text not null,
  contacto text,
  telefono text,
  correo text,
  direccion text,
  ciudad text,
  notas text,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index proveedores_documento_uq on proveedores (documento) where documento is not null;

-- ---------- 3. INVENTARIO ----------------------------------------------

create table categorias (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  activo boolean not null default true
);

create table productos (
  id uuid primary key default gen_random_uuid(),
  categoria_id uuid references categorias(id),
  nombre text not null,
  descripcion text,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
create index productos_categoria_idx on productos (categoria_id);

create table variantes (
  id uuid primary key default gen_random_uuid(),
  producto_id uuid not null references productos(id) on delete cascade,
  sku text not null unique,
  talla text,
  color text,
  costo numeric(14,2) not null default 0 check (costo >= 0),    -- costo promedio ponderado
  precio numeric(14,2) not null default 0 check (precio >= 0),
  stock int not null default 0 check (stock >= 0),
  stock_minimo int not null default 0 check (stock_minimo >= 0),
  activo boolean not null default true
);
create unique index variantes_prod_talla_color_uq
  on variantes (producto_id, coalesce(talla, ''), coalesce(color, ''));

create table movimientos_inventario (                            -- kardex
  id uuid primary key default gen_random_uuid(),
  variante_id uuid not null references variantes(id),
  tipo text not null check (tipo in ('entrada_compra','salida_venta','ajuste_entrada','ajuste_salida','anulacion')),
  cantidad int not null check (cantidad <> 0),                   -- + entra, - sale
  costo_unitario numeric(14,2) not null default 0,
  referencia_tipo text,                                          -- 'FC' | 'FV' | 'AJ'
  referencia_id uuid,
  notas text,
  fecha timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index mov_variante_idx on movimientos_inventario (variante_id, fecha desc);

create function trg_aplicar_movimiento() returns trigger
language plpgsql set search_path = public as $$
begin
  update variantes set stock = stock + new.cantidad where id = new.variante_id;
  return new;
end $$;
create trigger aplicar_movimiento after insert on movimientos_inventario
for each row execute function trg_aplicar_movimiento();

-- ---------- 4. CONSECUTIVOS --------------------------------------------

create table secuencias (
  tipo text primary key,                 -- 'FV' venta, 'FC' compra
  nombre text not null,
  prefijo text not null,
  ultimo bigint not null default 0,
  longitud int not null default 4
);

create function siguiente_consecutivo(p_tipo text) returns text
language plpgsql set search_path = public as $$
declare v text;
begin
  update secuencias set ultimo = ultimo + 1 where tipo = p_tipo
  returning prefijo || '-' || lpad(ultimo::text, longitud, '0') into v;
  if v is null then raise exception 'Secuencia % no existe', p_tipo; end if;
  return v;
end $$;

-- ---------- 5. FACTURAS DE COMPRA --------------------------------------

create table facturas_compra (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique,
  proveedor_id uuid not null references proveedores(id),
  numero_proveedor text,
  fecha date not null default current_date,
  fecha_vencimiento date,
  forma_pago text not null default 'contado' check (forma_pago in ('contado','credito')),
  subtotal numeric(14,2) not null default 0,
  descuento_tipo text not null default 'valor' check (descuento_tipo in ('valor','porcentaje')),
  descuento_valor numeric(14,2) not null default 0 check (descuento_valor >= 0),
  descuento numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  pagado numeric(14,2) not null default 0,
  estado text not null default 'pendiente' check (estado in ('pendiente','parcial','pagada','anulada')),
  notas text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index fc_proveedor_idx on facturas_compra (proveedor_id);
create index fc_fecha_idx on facturas_compra (fecha);

create table factura_compra_items (
  id uuid primary key default gen_random_uuid(),
  factura_id uuid not null references facturas_compra(id) on delete cascade,
  variante_id uuid not null references variantes(id),
  cantidad int not null check (cantidad > 0),
  costo_unitario numeric(14,2) not null check (costo_unitario >= 0),
  subtotal numeric(14,2) generated always as (cantidad * costo_unitario) stored
);
create index fci_factura_idx on factura_compra_items (factura_id);
create index fci_variante_idx on factura_compra_items (variante_id);

create table pagos_compra (
  id uuid primary key default gen_random_uuid(),
  factura_id uuid not null references facturas_compra(id) on delete cascade,
  fecha date not null default current_date,
  valor numeric(14,2) not null check (valor > 0),
  metodo text not null default 'efectivo' check (metodo in ('efectivo','transferencia','nequi','daviplata','tarjeta','otro')),
  referencia text,
  notas text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index pc_factura_idx on pagos_compra (factura_id);

-- ---------- 6. FACTURAS DE VENTA ---------------------------------------

create table facturas_venta (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique,
  cliente_id uuid not null references clientes(id),
  fecha date not null default current_date,
  fecha_vencimiento date,
  forma_pago text not null default 'contado' check (forma_pago in ('contado','credito')),
  subtotal numeric(14,2) not null default 0,
  descuento_tipo text not null default 'valor' check (descuento_tipo in ('valor','porcentaje')),
  descuento_valor numeric(14,2) not null default 0 check (descuento_valor >= 0),
  descuento numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  pagado numeric(14,2) not null default 0,
  estado text not null default 'pendiente' check (estado in ('pendiente','parcial','pagada','anulada')),
  notas text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index fv_cliente_idx on facturas_venta (cliente_id);
create index fv_fecha_idx on facturas_venta (fecha);

create table factura_venta_items (
  id uuid primary key default gen_random_uuid(),
  factura_id uuid not null references facturas_venta(id) on delete cascade,
  variante_id uuid not null references variantes(id),
  cantidad int not null check (cantidad > 0),
  precio_unitario numeric(14,2) not null check (precio_unitario >= 0),
  costo_unitario numeric(14,2) not null default 0,               -- costo congelado al vender
  subtotal numeric(14,2) generated always as (cantidad * precio_unitario) stored
);
create index fvi_factura_idx on factura_venta_items (factura_id);
create index fvi_variante_idx on factura_venta_items (variante_id);

create table abonos_venta (
  id uuid primary key default gen_random_uuid(),
  factura_id uuid not null references facturas_venta(id) on delete cascade,
  fecha date not null default current_date,
  valor numeric(14,2) not null check (valor > 0),
  metodo text not null default 'efectivo' check (metodo in ('efectivo','transferencia','nequi','daviplata','tarjeta','otro')),
  referencia text,
  notas text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index av_factura_idx on abonos_venta (factura_id);

-- ---------- 7. GASTOS DEL NEGOCIO --------------------------------------

create table categorias_gasto (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  activo boolean not null default true
);

create table gastos (
  id uuid primary key default gen_random_uuid(),
  fecha date not null default current_date,
  categoria_id uuid not null references categorias_gasto(id),
  proveedor_id uuid references proveedores(id),
  descripcion text not null,
  valor numeric(14,2) not null check (valor > 0),
  metodo_pago text not null default 'efectivo' check (metodo_pago in ('efectivo','transferencia','nequi','daviplata','tarjeta','otro')),
  numero_soporte text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index gastos_fecha_idx on gastos (fecha);
create index gastos_categoria_idx on gastos (categoria_id);

-- ---------- 8. RECORDATORIOS DE COBRO ----------------------------------

create table recordatorios_cobro (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id),
  factura_id uuid references facturas_venta(id),
  mensaje text not null,
  canal text not null default 'whatsapp',
  enviado_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index rc_cliente_idx on recordatorios_cobro (cliente_id);

-- ---------- 9. TRIGGERS DE NEGOCIO -------------------------------------

-- Compra: costo promedio ponderado (con el descuento prorrateado) + entrada al kardex
create function trg_item_compra() returns trigger
language plpgsql set search_path = public as $$
declare
  v variantes%rowtype;
  h facturas_compra%rowtype;
  costo_ef numeric;
begin
  select * into h from facturas_compra where id = new.factura_id;
  select * into v from variantes where id = new.variante_id for update;
  costo_ef := case when h.subtotal > 0 then new.costo_unitario * h.total / h.subtotal else new.costo_unitario end;

  update variantes
     set costo = round((v.stock * v.costo + new.cantidad * costo_ef) / (v.stock + new.cantidad), 2)
   where id = v.id;

  insert into movimientos_inventario (variante_id, tipo, cantidad, costo_unitario, referencia_tipo, referencia_id)
  values (new.variante_id, 'entrada_compra', new.cantidad, round(costo_ef, 2), 'FC', new.factura_id);
  return new;
end $$;
create trigger item_compra after insert on factura_compra_items
for each row execute function trg_item_compra();

-- Venta: congela el costo y valida stock antes; descuenta del kardex después
create function trg_item_venta_before() returns trigger
language plpgsql set search_path = public as $$
declare v variantes%rowtype;
begin
  select * into v from variantes where id = new.variante_id for update;
  if v.stock < new.cantidad then
    raise exception 'Stock insuficiente para % (disponible: %, solicitado: %)', v.sku, v.stock, new.cantidad;
  end if;
  new.costo_unitario := v.costo;
  return new;
end $$;
create trigger item_venta_before before insert on factura_venta_items
for each row execute function trg_item_venta_before();

create function trg_item_venta_after() returns trigger
language plpgsql set search_path = public as $$
begin
  insert into movimientos_inventario (variante_id, tipo, cantidad, costo_unitario, referencia_tipo, referencia_id)
  values (new.variante_id, 'salida_venta', -new.cantidad, new.costo_unitario, 'FV', new.factura_id);
  return new;
end $$;
create trigger item_venta_after after insert on factura_venta_items
for each row execute function trg_item_venta_after();

-- Abonos / pagos: validan que no excedan el saldo y recalculan pagado + estado
create function trg_validar_abono_venta() returns trigger
language plpgsql set search_path = public as $$
declare f facturas_venta%rowtype;
begin
  select * into f from facturas_venta where id = new.factura_id;
  if f.estado = 'anulada' then raise exception 'La factura % está anulada', f.numero; end if;
  if new.valor > f.total - f.pagado then
    raise exception 'El abono (%) supera el saldo de la factura % (%)', new.valor, f.numero, f.total - f.pagado;
  end if;
  return new;
end $$;
create trigger validar_abono_venta before insert on abonos_venta
for each row execute function trg_validar_abono_venta();

create function trg_sync_pagado_venta() returns trigger
language plpgsql set search_path = public as $$
declare v_id uuid := coalesce(new.factura_id, old.factura_id);
begin
  update facturas_venta f
     set pagado = p.s,
         estado = case when f.estado = 'anulada' then f.estado
                       when p.s >= f.total then 'pagada'
                       when p.s > 0 then 'parcial'
                       else 'pendiente' end
    from (select coalesce(sum(valor), 0) s from abonos_venta where factura_id = v_id) p
   where f.id = v_id;
  return null;
end $$;
create trigger sync_pagado_venta after insert or update or delete on abonos_venta
for each row execute function trg_sync_pagado_venta();

create function trg_validar_pago_compra() returns trigger
language plpgsql set search_path = public as $$
declare f facturas_compra%rowtype;
begin
  select * into f from facturas_compra where id = new.factura_id;
  if f.estado = 'anulada' then raise exception 'La factura % está anulada', f.numero; end if;
  if new.valor > f.total - f.pagado then
    raise exception 'El pago (%) supera el saldo de la factura % (%)', new.valor, f.numero, f.total - f.pagado;
  end if;
  return new;
end $$;
create trigger validar_pago_compra before insert on pagos_compra
for each row execute function trg_validar_pago_compra();

create function trg_sync_pagado_compra() returns trigger
language plpgsql set search_path = public as $$
declare v_id uuid := coalesce(new.factura_id, old.factura_id);
begin
  update facturas_compra f
     set pagado = p.s,
         estado = case when f.estado = 'anulada' then f.estado
                       when p.s >= f.total then 'pagada'
                       when p.s > 0 then 'parcial'
                       else 'pendiente' end
    from (select coalesce(sum(valor), 0) s from pagos_compra where factura_id = v_id) p
   where f.id = v_id;
  return null;
end $$;
create trigger sync_pagado_compra after insert or update or delete on pagos_compra
for each row execute function trg_sync_pagado_compra();

-- ---------- 10. FUNCIONES (RPC) PARA CREAR / ANULAR FACTURAS -----------
-- Cada factura se crea completa en una sola transacción, con consecutivo automático.
-- p_items: [{"variante_id":"uuid","cantidad":2,"precio_unitario":50000}]  (venta)
--          [{"variante_id":"uuid","cantidad":2,"costo_unitario":30000}]   (compra)

create function crear_factura_venta(
  p_cliente_id uuid,
  p_fecha date,
  p_forma_pago text,
  p_fecha_vencimiento date,
  p_descuento_tipo text,
  p_descuento_valor numeric,
  p_notas text,
  p_items jsonb,
  p_metodo_pago text default 'efectivo'
) returns uuid
language plpgsql set search_path = public as $$
declare
  v_sub numeric; v_desc numeric; v_total numeric; v_id uuid;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'La factura no tiene ítems'; end if;
  if p_forma_pago = 'credito' and p_fecha_vencimiento is null then raise exception 'Una venta a crédito requiere fecha de vencimiento'; end if;
  if p_descuento_tipo = 'porcentaje' and p_descuento_valor > 100 then raise exception 'El descuento no puede superar 100%%'; end if;

  select sum(cantidad * precio_unitario) into v_sub
    from jsonb_to_recordset(p_items) as x(variante_id uuid, cantidad int, precio_unitario numeric);

  v_desc  := case when p_descuento_tipo = 'porcentaje' then round(v_sub * p_descuento_valor / 100, 2)
                  else least(coalesce(p_descuento_valor, 0), v_sub) end;
  v_total := v_sub - v_desc;

  insert into facturas_venta (numero, cliente_id, fecha, fecha_vencimiento, forma_pago,
                              subtotal, descuento_tipo, descuento_valor, descuento, total, notas)
  values (siguiente_consecutivo('FV'), p_cliente_id, coalesce(p_fecha, current_date),
          case when p_forma_pago = 'credito' then p_fecha_vencimiento end, p_forma_pago,
          v_sub, p_descuento_tipo, coalesce(p_descuento_valor, 0), v_desc, v_total, p_notas)
  returning id into v_id;

  insert into factura_venta_items (factura_id, variante_id, cantidad, precio_unitario)
  select v_id, variante_id, cantidad, precio_unitario
    from jsonb_to_recordset(p_items) as x(variante_id uuid, cantidad int, precio_unitario numeric);

  if p_forma_pago = 'contado' and v_total > 0 then
    insert into abonos_venta (factura_id, fecha, valor, metodo, notas)
    values (v_id, coalesce(p_fecha, current_date), v_total, p_metodo_pago, 'Pago de contado');
  end if;
  return v_id;
end $$;

create function crear_factura_compra(
  p_proveedor_id uuid,
  p_fecha date,
  p_forma_pago text,
  p_fecha_vencimiento date,
  p_numero_proveedor text,
  p_descuento_tipo text,
  p_descuento_valor numeric,
  p_notas text,
  p_items jsonb,
  p_metodo_pago text default 'efectivo'
) returns uuid
language plpgsql set search_path = public as $$
declare
  v_sub numeric; v_desc numeric; v_total numeric; v_id uuid;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'La factura no tiene ítems'; end if;
  if p_forma_pago = 'credito' and p_fecha_vencimiento is null then raise exception 'Una compra a crédito requiere fecha de vencimiento'; end if;
  if p_descuento_tipo = 'porcentaje' and p_descuento_valor > 100 then raise exception 'El descuento no puede superar 100%%'; end if;

  select sum(cantidad * costo_unitario) into v_sub
    from jsonb_to_recordset(p_items) as x(variante_id uuid, cantidad int, costo_unitario numeric);

  v_desc  := case when p_descuento_tipo = 'porcentaje' then round(v_sub * p_descuento_valor / 100, 2)
                  else least(coalesce(p_descuento_valor, 0), v_sub) end;
  v_total := v_sub - v_desc;

  insert into facturas_compra (numero, proveedor_id, numero_proveedor, fecha, fecha_vencimiento, forma_pago,
                               subtotal, descuento_tipo, descuento_valor, descuento, total, notas)
  values (siguiente_consecutivo('FC'), p_proveedor_id, p_numero_proveedor, coalesce(p_fecha, current_date),
          case when p_forma_pago = 'credito' then p_fecha_vencimiento end, p_forma_pago,
          v_sub, p_descuento_tipo, coalesce(p_descuento_valor, 0), v_desc, v_total, p_notas)
  returning id into v_id;

  insert into factura_compra_items (factura_id, variante_id, cantidad, costo_unitario)
  select v_id, variante_id, cantidad, costo_unitario
    from jsonb_to_recordset(p_items) as x(variante_id uuid, cantidad int, costo_unitario numeric);

  if p_forma_pago = 'contado' and v_total > 0 then
    insert into pagos_compra (factura_id, fecha, valor, metodo, notas)
    values (v_id, coalesce(p_fecha, current_date), v_total, p_metodo_pago, 'Pago de contado');
  end if;
  return v_id;
end $$;

-- Anular: revierte el inventario. Requiere que la factura no tenga abonos/pagos.
create function anular_factura_venta(p_id uuid) returns void
language plpgsql set search_path = public as $$
declare f facturas_venta%rowtype;
begin
  select * into f from facturas_venta where id = p_id for update;
  if f.estado = 'anulada' then raise exception 'La factura ya está anulada'; end if;
  if f.pagado > 0 then raise exception 'Elimina primero los abonos de la factura %', f.numero; end if;
  insert into movimientos_inventario (variante_id, tipo, cantidad, costo_unitario, referencia_tipo, referencia_id)
  select variante_id, 'anulacion', cantidad, costo_unitario, 'FV', p_id from factura_venta_items where factura_id = p_id;
  update facturas_venta set estado = 'anulada' where id = p_id;
end $$;

create function anular_factura_compra(p_id uuid) returns void
language plpgsql set search_path = public as $$
declare f facturas_compra%rowtype;
begin
  select * into f from facturas_compra where id = p_id for update;
  if f.estado = 'anulada' then raise exception 'La factura ya está anulada'; end if;
  if f.pagado > 0 then raise exception 'Elimina primero los pagos de la factura %', f.numero; end if;
  insert into movimientos_inventario (variante_id, tipo, cantidad, costo_unitario, referencia_tipo, referencia_id)
  select variante_id, 'anulacion', -cantidad, costo_unitario, 'FC', p_id from factura_compra_items where factura_id = p_id;
  update facturas_compra set estado = 'anulada' where id = p_id;
end $$;

-- ---------- 11. VISTAS (cartera, informes, dashboard) ------------------

create view v_cartera_cobrar with (security_invoker = true) as
select f.id as factura_id, f.numero, f.fecha, f.fecha_vencimiento,
       f.cliente_id, c.nombre as cliente, c.telefono,
       f.total, f.pagado, f.total - f.pagado as saldo,
       greatest(((now() at time zone 'America/Bogota')::date - f.fecha_vencimiento), 0) as dias_mora,
       case when f.fecha_vencimiento is null or f.fecha_vencimiento >= (now() at time zone 'America/Bogota')::date then 'vigente'
            when (now() at time zone 'America/Bogota')::date - f.fecha_vencimiento <= 30 then '1-30'
            when (now() at time zone 'America/Bogota')::date - f.fecha_vencimiento <= 60 then '31-60'
            else '60+' end as rango
  from facturas_venta f join clientes c on c.id = f.cliente_id
 where f.estado in ('pendiente','parcial');

create view v_cartera_pagar with (security_invoker = true) as
select f.id as factura_id, f.numero, f.numero_proveedor, f.fecha, f.fecha_vencimiento,
       f.proveedor_id, p.nombre as proveedor, p.telefono,
       f.total, f.pagado, f.total - f.pagado as saldo,
       greatest(((now() at time zone 'America/Bogota')::date - f.fecha_vencimiento), 0) as dias_mora,
       case when f.fecha_vencimiento is null or f.fecha_vencimiento >= (now() at time zone 'America/Bogota')::date then 'vigente'
            when (now() at time zone 'America/Bogota')::date - f.fecha_vencimiento <= 30 then '1-30'
            when (now() at time zone 'America/Bogota')::date - f.fecha_vencimiento <= 60 then '31-60'
            else '60+' end as rango
  from facturas_compra f join proveedores p on p.id = f.proveedor_id
 where f.estado in ('pendiente','parcial');

-- Estado de resultados por mes (ganancia bruta y neta)
create view v_resumen_mensual with (security_invoker = true) as
with ventas as (
  select date_trunc('month', fecha)::date mes, sum(subtotal) ventas_brutas, sum(descuento) descuentos, sum(total) ventas_netas
    from facturas_venta where estado <> 'anulada' group by 1
), costo as (
  select date_trunc('month', f.fecha)::date mes, sum(i.cantidad * i.costo_unitario) costo_ventas
    from facturas_venta f join factura_venta_items i on i.factura_id = f.id
   where f.estado <> 'anulada' group by 1
), compras as (
  select date_trunc('month', fecha)::date mes, sum(total) compras_inventario
    from facturas_compra where estado <> 'anulada' group by 1
), gas as (
  select date_trunc('month', fecha)::date mes, sum(valor) gastos_operativos from gastos group by 1
), meses as (
  select mes from ventas union select mes from costo union select mes from compras union select mes from gas
)
select m.mes,
       coalesce(v.ventas_brutas, 0)       as ventas_brutas,
       coalesce(v.descuentos, 0)          as descuentos,
       coalesce(v.ventas_netas, 0)        as ventas_netas,
       coalesce(c.costo_ventas, 0)        as costo_ventas,
       coalesce(v.ventas_netas, 0) - coalesce(c.costo_ventas, 0)                         as utilidad_bruta,
       coalesce(g.gastos_operativos, 0)   as gastos_operativos,
       coalesce(v.ventas_netas, 0) - coalesce(c.costo_ventas, 0) - coalesce(g.gastos_operativos, 0) as utilidad_neta,
       coalesce(p.compras_inventario, 0)  as compras_inventario
  from meses m
  left join ventas v on v.mes = m.mes
  left join costo c on c.mes = m.mes
  left join compras p on p.mes = m.mes
  left join gas g on g.mes = m.mes;

create view v_mas_vendidos with (security_invoker = true) as
select va.id as variante_id, pr.nombre as producto, va.sku, va.talla, va.color,
       sum(i.cantidad)::int as unidades,
       sum(i.subtotal) as ingresos,
       sum(i.cantidad * (i.precio_unitario - i.costo_unitario)) as margen
  from factura_venta_items i
  join facturas_venta f on f.id = i.factura_id and f.estado <> 'anulada'
  join variantes va on va.id = i.variante_id
  join productos pr on pr.id = va.producto_id
 group by va.id, pr.nombre, va.sku, va.talla, va.color;

-- ---------- 12. SEGURIDAD (RLS): solo usuarios autenticados -------------

do $$
declare t text;
begin
  foreach t in array array[
    'empresa_config','perfiles','clientes','proveedores','categorias','productos','variantes',
    'movimientos_inventario','secuencias','facturas_compra','factura_compra_items','pagos_compra',
    'facturas_venta','factura_venta_items','abonos_venta','categorias_gasto','gastos','recordatorios_cobro'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "autenticados_todo" on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ---------- 13. DATOS INICIALES ----------------------------------------

insert into empresa_config (id) values (1);

insert into secuencias (tipo, nombre, prefijo, ultimo, longitud) values
  ('FV', 'Factura de venta',  'FV', 0, 4),
  ('FC', 'Factura de compra', 'FC', 0, 4);

insert into categorias_gasto (nombre) values
  ('Publicidad'), ('Empaque y bolsas'), ('Ingeniería / Desarrollo'), ('Servicios públicos'),
  ('Arriendo'), ('Transporte y envíos'), ('Nómina / Honorarios'), ('Comisiones bancarias'), ('Otros');

insert into categorias (nombre) values
  ('Leggins'), ('Tops'), ('Conjuntos'), ('Shorts'), ('Camisetas'), ('Accesorios');
