-- LEARNING-DESIGN §1, §6 (diseño): etiquetas de ella entre mazos (LWW, SYNC §1).
-- note.tag_ids es JSON: cada etiqueta la valida el handler (BE2); sin FK entre entidades sincronizables (BE8).
-- Expandir: las notas que ya existen y las de un cliente del contrato 12 quedan sin etiquetas.
-- AlterTable
ALTER TABLE "note" ADD COLUMN     "tag_ids" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "tag" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "hlc" TEXT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    "deleted_at" BIGINT,
    "server_seq" BIGINT NOT NULL,

    CONSTRAINT "tag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tag_user_id_server_seq_idx" ON "tag"("user_id", "server_seq");

-- AddForeignKey
ALTER TABLE "tag" ADD CONSTRAINT "tag_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
