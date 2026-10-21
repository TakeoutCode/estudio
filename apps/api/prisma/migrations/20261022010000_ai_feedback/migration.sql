-- LEARNING-DESIGN LD14: retroalimentación de IA de respuestas abiertas (solo inserción, SYNC §1).
-- CreateTable
CREATE TABLE "ai_feedback" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "card_id" UUID NOT NULL,
    "requested_at" BIGINT NOT NULL,
    "feedback" JSONB NOT NULL,
    "server_seq" BIGINT NOT NULL,

    CONSTRAINT "ai_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_feedback_user_id_server_seq_idx" ON "ai_feedback"("user_id", "server_seq");

-- AddForeignKey
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- No lo modela Prisma (BACKEND BE8). No borrar en migraciones futuras.
-- ---------------------------------------------------------------------------

-- SYNC §1: AiFeedback es solo de inserción, como review_log. DELETE /me lo salta con
-- SET LOCAL app.allow_purge = 'on' (ver forbid_append_only_change en la migración init).
CREATE TRIGGER "ai_feedback_append_only"
  BEFORE UPDATE OR DELETE ON "ai_feedback"
  FOR EACH ROW EXECUTE FUNCTION forbid_append_only_change();
