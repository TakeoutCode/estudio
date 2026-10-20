-- CreateTable
CREATE TABLE "user" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- ---------------------------------------------------------------------------
-- Lo siguiente no lo modela Prisma (BACKEND BE8). No borrar en migraciones futuras.
-- ---------------------------------------------------------------------------

-- SYNC §3, ADR-005: contador global de cambios. Bajo pg_advisory_xact_lock por usuario
-- crece en orden de confirmación para cada usuario, así que el pull nunca se salta filas.
CREATE SEQUENCE "sync_seq" AS BIGINT;

-- SYNC §1: las tablas de solo inserción (review_log, timer_block_log, ...) llevan
--   CREATE TRIGGER <tabla>_append_only BEFORE UPDATE OR DELETE ON <tabla>
--   FOR EACH ROW EXECUTE FUNCTION forbid_append_only_change();
-- DELETE /me lo salta dentro de su transacción con SET LOCAL app.allow_purge = 'on'.
CREATE FUNCTION forbid_append_only_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.allow_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'append_only_table: % en %', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;
