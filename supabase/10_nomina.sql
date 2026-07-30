-- ============================================================================
-- Ambiente y Salud RD (ASA SRL) — 10. Empleados, comisiones y nómina (TSS/ISR)
-- ============================================================================

set search_path = public, extensions;

-- ── Guarda de dependencias ──────────────────────────────────────────────────
do $$
begin
  if to_regtype('public.asa_rol_usuario') is null then
    raise exception
      'DEPENDENCIA FALTANTE. Ejecuta primero: 01_extensiones_y_tipos.sql. O usa 00_INSTALL_COMPLETO.sql, que instala todo en el orden correcto.';
  end if;
end $$;

create table if not exists asa_empleados (
  id                uuid primary key default gen_random_uuid(),
  nombre_completo   text not null,
  cedula            text unique,
  rol               asa_rol_usuario not null default 'tecnico_plagas',
  especialidad      text,            -- para veterinarios
  licencia_profesional text,         -- colegio médico veterinario, etc.
  telefono          text,
  email             text,
  salario_base      numeric(10,2) default 0,
  fecha_ingreso     date default current_date,
  activo            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Ahora que existe asa_empleados, se documentan (no se fuerzan por FK real
-- para evitar orden estricto de migraciones) las referencias lógicas usadas
-- en archivos anteriores: asa_ordenes_trabajo.tecnico_id,
-- asa_fichas_clinicas.veterinario_id, asa_citas.especialista_id,
-- asa_estetica_ordenes.groomer_id, asa_ipm_lecturas.tecnico_id,
-- asa_aplicaciones_productos.tecnico_id, asa_ventas_pos.cajero_id.
-- Si se prefiere integridad referencial estricta, ejecutar tras este archivo:
--
-- alter table asa_ordenes_trabajo        add constraint asa_ot_tecnico_fk        foreign key (tecnico_id)       references asa_empleados(id);
-- alter table asa_fichas_clinicas        add constraint asa_ficha_vet_fk         foreign key (veterinario_id)   references asa_empleados(id);
-- alter table asa_citas                  add constraint asa_citas_especialista_fk foreign key (especialista_id) references asa_empleados(id);
-- alter table asa_estetica_ordenes       add constraint asa_estetica_groomer_fk  foreign key (groomer_id)       references asa_empleados(id);
-- alter table asa_ipm_lecturas           add constraint asa_ipm_tecnico_fk       foreign key (tecnico_id)       references asa_empleados(id);
-- alter table asa_aplicaciones_productos add constraint asa_aplic_tecnico_fk     foreign key (tecnico_id)       references asa_empleados(id);
-- alter table asa_ventas_pos             add constraint asa_ventas_cajero_fk     foreign key (cajero_id)        references asa_empleados(id);
-- alter table asa_tratamientos_aplicados add constraint asa_trat_vet_fk         foreign key (veterinario_id)   references asa_empleados(id);

create table if not exists asa_comisiones (
  id            uuid primary key default gen_random_uuid(),
  empleado_id   uuid not null references asa_empleados(id) on delete cascade,
  origen_tipo   text not null check (origen_tipo in ('orden_trabajo','cita','venta_pos','estetica')),
  origen_id     uuid not null,
  monto         numeric(10,2) not null default 0,
  periodo_nomina_id uuid,           -- referencia lógica a asa_nomina_periodos
  pagada        boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists asa_comisiones_empleado_idx on asa_comisiones (empleado_id);

create table if not exists asa_nomina_periodos (
  id            uuid primary key default gen_random_uuid(),
  fecha_inicio  date not null,
  fecha_fin     date not null,
  estado        text not null default 'abierto' check (estado in ('abierto','calculado','pagado','cerrado')),
  total_bruto   numeric(12,2) default 0,
  total_neto    numeric(12,2) default 0,
  created_at    timestamptz not null default now()
);

create table if not exists asa_nomina_detalle (
  id                uuid primary key default gen_random_uuid(),
  periodo_id        uuid not null references asa_nomina_periodos(id) on delete cascade,
  empleado_id       uuid not null references asa_empleados(id) on delete cascade,
  salario_bruto     numeric(10,2) not null default 0,
  comisiones        numeric(10,2) not null default 0,
  horas_extra       numeric(10,2) not null default 0,
  tss_sfs           numeric(10,2) not null default 0,   -- Seguro Familiar de Salud
  tss_afp           numeric(10,2) not null default 0,   -- Pensiones (AFP)
  tss_riesgo_laboral numeric(10,2) not null default 0,
  isr               numeric(10,2) not null default 0,
  infotep           numeric(10,2) not null default 0,
  otros_descuentos  numeric(10,2) not null default 0,
  salario_neto      numeric(10,2) not null default 0,
  created_at        timestamptz not null default now()
);
create index if not exists asa_nomina_detalle_periodo_idx on asa_nomina_detalle (periodo_id);
create index if not exists asa_nomina_detalle_empleado_idx on asa_nomina_detalle (empleado_id);
