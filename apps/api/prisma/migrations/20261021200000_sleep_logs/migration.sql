-- STUDY-METHODS §5: calidad del sueño de una noche (1-5), opcional (LWW, SYNC §1).
-- id = uuidv5(user_id, date): una fila por noche; el handler lo verifica (BE2).
-- CreateTable
CREATE TABLE "sleep_log" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "date" TEXT NOT NULL,
    "quality" SMALLINT NOT NULL,
    "logged_at" BIGINT NOT NULL,
    "hlc" TEXT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    "deleted_at" BIGINT,
    "server_seq" BIGINT NOT NULL,

    CONSTRAINT "sleep_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sleep_log_user_id_server_seq_idx" ON "sleep_log"("user_id", "server_seq");

-- AddForeignKey
ALTER TABLE "sleep_log" ADD CONSTRAINT "sleep_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
