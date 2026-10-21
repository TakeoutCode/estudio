-- STUDY-METHODS R9, P4; LEARNING-DESIGN LD10: grupos de notas que se confunden (LWW, SYNC §1).
-- note_ids es JSON: cada nota la valida el handler (BE2); sin FK entre entidades sincronizables (BE8).
-- CreateTable
CREATE TABLE "contrast_group" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "note_ids" JSONB NOT NULL,
    "ab_seed" BIGINT NOT NULL,
    "ab_arm" TEXT NOT NULL,
    "hlc" TEXT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    "deleted_at" BIGINT,
    "server_seq" BIGINT NOT NULL,

    CONSTRAINT "contrast_group_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contrast_group_user_id_server_seq_idx" ON "contrast_group"("user_id", "server_seq");

-- AddForeignKey
ALTER TABLE "contrast_group" ADD CONSTRAINT "contrast_group_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
