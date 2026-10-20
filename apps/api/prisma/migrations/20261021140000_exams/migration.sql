-- STUDY-METHODS R11, LEARNING-DESIGN LD11: exámenes con fecha y alcance (LWW, SYNC §1).
-- topic_ids es JSON: cada tema lo valida el handler (BE2); sin FK entre entidades sincronizables (BE8).
-- CreateTable
CREATE TABLE "exam" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "date" BIGINT NOT NULL,
    "topic_ids" JSONB NOT NULL,
    "hlc" TEXT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    "deleted_at" BIGINT,
    "server_seq" BIGINT NOT NULL,

    CONSTRAINT "exam_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exam_user_id_server_seq_idx" ON "exam"("user_id", "server_seq");

-- AddForeignKey
ALTER TABLE "exam" ADD CONSTRAINT "exam_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

