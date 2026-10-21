-- LEARNING-DESIGN §8: borradores de la IA que ella revisa (ai_draft, LWW) y uso por intento para
-- la cuota diaria (ai_usage, solo servidor; nunca guarda su texto ni la respuesta, BE6).
-- CreateTable
CREATE TABLE "ai_draft" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "deck_id" UUID NOT NULL,
    "draft" JSONB NOT NULL,
    "supported" BOOLEAN NOT NULL,
    "edited" BOOLEAN NOT NULL,
    "status" TEXT NOT NULL,
    "note_id" UUID,
    "created_at" BIGINT NOT NULL,
    "hlc" TEXT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    "deleted_at" BIGINT,
    "server_seq" BIGINT NOT NULL,

    CONSTRAINT "ai_draft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "local_date" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "attempt" SMALLINT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "latency_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_draft_user_id_server_seq_idx" ON "ai_draft"("user_id", "server_seq");

-- CreateIndex
CREATE INDEX "ai_usage_user_id_local_date_idx" ON "ai_usage"("user_id", "local_date");

-- AddForeignKey
ALTER TABLE "ai_draft" ADD CONSTRAINT "ai_draft_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

