-- =====================================================================
-- SamarFit · 03 · Datos fiscales de la empresa (requisitos de factura DIAN)
-- Ejecutar en Supabase > SQL Editor
-- =====================================================================
alter table empresa_config
  add column if not exists razon_social text,                                  -- nombre legal (persona natural o jurídica)
  add column if not exists tipo_persona text not null default 'natural'
      check (tipo_persona in ('natural', 'juridica')),
  add column if not exists dv text,                                            -- dígito de verificación del NIT
  add column if not exists regimen text not null default 'No responsable de IVA',
  add column if not exists responsabilidades text default 'R-99-PN',          -- código RUT (casilla 53)
  add column if not exists actividad_ciiu text,                                -- ej: 4771
  add column if not exists sitio_web text,
  -- Resolución de autorización de numeración (DIAN)
  add column if not exists resolucion_numero text,
  add column if not exists resolucion_fecha date,
  add column if not exists resolucion_prefijo text,
  add column if not exists resolucion_desde bigint,
  add column if not exists resolucion_hasta bigint,
  add column if not exists resolucion_vigencia_hasta date,
  add column if not exists factura_electronica boolean not null default false;

-- Campos para la futura factura electrónica (se llenan al integrar un proveedor tecnológico)
alter table facturas_venta
  add column if not exists cufe text,
  add column if not exists qr_url text;
