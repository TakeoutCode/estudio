-- LEARNING-DESIGN §1: notas y tarjetas (LWW, SYNC §1). Sin FK entre entidades sincronizables
-- (BE8): deck_id y note_id los validan los handlers de sync (BE2).
-- CreateTable
CREATE TABLE "note" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "deck_id" UUID NOT NULL,
    "topic_id" UUID,
    "kind" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "origin" TEXT NOT NULL,
    "hlc" TEXT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    "deleted_at" BIGINT,
    "server_seq" BIGINT NOT NULL,

    CONSTRAINT "note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "note_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "created_at" BIGINT NOT NULL,
    "lapse_baseline" INTEGER NOT NULL,
    "hlc" TEXT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    "deleted_at" BIGINT,
    "server_seq" BIGINT NOT NULL,

    CONSTRAINT "card_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "note_user_id_server_seq_idx" ON "note"("user_id", "server_seq");

-- CreateIndex
CREATE INDEX "note_user_id_deck_id_idx" ON "note"("user_id", "deck_id");

-- CreateIndex
CREATE INDEX "card_user_id_server_seq_idx" ON "card"("user_id", "server_seq");

-- CreateIndex
CREATE INDEX "card_user_id_note_id_idx" ON "card"("user_id", "note_id");

-- AddForeignKey
ALTER TABLE "note" ADD CONSTRAINT "note_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card" ADD CONSTRAINT "card_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

