-- =====================================================================
-- SamarFit · 02 · Anular facturas aunque tengan pagos (todo en una transacción)
-- Ejecutar en Supabase > SQL Editor
-- =====================================================================

create or replace function anular_factura_venta(p_id uuid) returns void
language plpgsql set search_path = public as $$
declare f facturas_venta%rowtype;
begin
  select * into f from facturas_venta where id = p_id for update;
  if not found then raise exception 'Factura no encontrada'; end if;
  if f.estado = 'anulada' then raise exception 'La factura % ya está anulada', f.numero; end if;

  delete from abonos_venta where factura_id = p_id;              -- se reversan los abonos
  insert into movimientos_inventario (variante_id, tipo, cantidad, costo_unitario, referencia_tipo, referencia_id, notas)
  select variante_id, 'anulacion', cantidad, costo_unitario, 'FV', p_id, 'Anulación ' || f.numero
    from factura_venta_items where factura_id = p_id;            -- las prendas regresan al inventario
  update facturas_venta set estado = 'anulada', pagado = 0 where id = p_id;
end $$;

create or replace function anular_factura_compra(p_id uuid) returns void
language plpgsql set search_path = public as $$
declare f facturas_compra%rowtype;
begin
  select * into f from facturas_compra where id = p_id for update;
  if not found then raise exception 'Factura no encontrada'; end if;
  if f.estado = 'anulada' then raise exception 'La factura % ya está anulada', f.numero; end if;

  delete from pagos_compra where factura_id = p_id;
  insert into movimientos_inventario (variante_id, tipo, cantidad, costo_unitario, referencia_tipo, referencia_id, notas)
  select variante_id, 'anulacion', -cantidad, costo_unitario, 'FC', p_id, 'Anulación ' || f.numero
    from factura_compra_items where factura_id = p_id;           -- falla si esas prendas ya se vendieron
  update facturas_compra set estado = 'anulada', pagado = 0 where id = p_id;
end $$;
