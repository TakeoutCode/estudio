-- STUDY-METHODS P7, LEARNING-DESIGN LD13: simulacros como StudySession (LWW, SYNC §1).
-- items es JSON con preguntas, confianza, respuesta y calificación; exam_id y cada card_id los
-- valida el handler (BE2); sin FK entre entidades sincronizables (BE8).
-- CreateTable
CREATE TABLE "study_session" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "mode" TEXT NOT NULL,
    "exam_id" UUID NOT NULL,
    "feedback_timing" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "started_at" BIGINT NOT NULL,
    "finished_at" BIGINT,
    "hlc" TEXT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    "deleted_at" BIGINT,
    "server_seq" BIGINT NOT NULL,

    CONSTRAINT "study_session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "study_session_user_id_server_seq_idx" ON "study_session"("user_id", "server_seq");

-- CreateIndex
CREATE INDEX "study_session_user_id_exam_id_idx" ON "study_session"("user_id", "exam_id");

-- AddForeignKey
ALTER TABLE "study_session" ADD CONSTRAINT "study_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

