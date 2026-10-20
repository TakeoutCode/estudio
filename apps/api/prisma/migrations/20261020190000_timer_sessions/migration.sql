-- STUDY-METHODS §3, SYNC SY7: sesión del temporizador (LWW) y bloques cerrados (solo inserción).
-- Sin FK entre entidades sincronizables (BE8): timer_session_id lo valida el handler (BE2).
-- CreateTable
CREATE TABLE "timer_session" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "state" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "started_at" BIGINT,
    "paused_at" BIGINT,
    "paused_ms" BIGINT NOT NULL,
    "block_index" INTEGER NOT NULL,
    "completed_blocks" INTEGER NOT NULL,
    "planned_ms" BIGINT NOT NULL,
    "extended_this_block" BOOLEAN NOT NULL,
    "owner_device_id" UUID NOT NULL,
    "last_seen_at" BIGINT,
    "ended_reason" TEXT,
    "hlc" TEXT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    "deleted_at" BIGINT,
    "server_seq" BIGINT NOT NULL,

    CONSTRAINT "timer_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timer_block_log" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "timer_session_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "block_index" INTEGER NOT NULL,
    "mode" TEXT NOT NULL,
    "started_at" BIGINT NOT NULL,
    "ended_at" BIGINT NOT NULL,
    "planned_ms" BIGINT NOT NULL,
    "active_ms" BIGINT NOT NULL,
    "outcome" TEXT NOT NULL,
    "server_seq" BIGINT NOT NULL,

    CONSTRAINT "timer_block_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "timer_session_user_id_server_seq_idx" ON "timer_session"("user_id", "server_seq");

-- CreateIndex
CREATE INDEX "timer_session_user_id_state_idx" ON "timer_session"("user_id", "state");

-- CreateIndex
CREATE INDEX "timer_block_log_user_id_server_seq_idx" ON "timer_block_log"("user_id", "server_seq");

-- CreateIndex
CREATE INDEX "timer_block_log_user_id_timer_session_id_idx" ON "timer_block_log"("user_id", "timer_session_id");

-- AddForeignKey
ALTER TABLE "timer_session" ADD CONSTRAINT "timer_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timer_block_log" ADD CONSTRAINT "timer_block_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- No lo modela Prisma (BACKEND BE8). No borrar en migraciones futuras.
-- ---------------------------------------------------------------------------

-- SYNC §1: TimerBlockLog es solo de inserción, como review_log. DELETE /me lo salta con
-- SET LOCAL app.allow_purge = 'on' (ver forbid_append_only_change en la migración init).
CREATE TRIGGER "timer_block_log_append_only"
  BEFORE UPDATE OR DELETE ON "timer_block_log"
  FOR EACH ROW EXECUTE FUNCTION forbid_append_only_change();
