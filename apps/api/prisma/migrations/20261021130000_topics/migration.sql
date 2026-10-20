-- LEARNING-DESIGN LD5, STUDY-METHODS R5: temas con su explicación y autoexplicaciones (LWW, SYNC §1).
-- Sin FK entre entidades sincronizables (BE8): deck_id y topic_id los validan los handlers (BE2).
-- CreateTable
CREATE TABLE "topic" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "deck_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "hlc" TEXT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    "deleted_at" BIGINT,
    "server_seq" BIGINT NOT NULL,

    CONSTRAINT "topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "self_explanation" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "topic_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "written_at" BIGINT NOT NULL,
    "hlc" TEXT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    "deleted_at" BIGINT,
    "server_seq" BIGINT NOT NULL,

    CONSTRAINT "self_explanation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "topic_user_id_server_seq_idx" ON "topic"("user_id", "server_seq");

-- CreateIndex
CREATE INDEX "topic_user_id_deck_id_idx" ON "topic"("user_id", "deck_id");

-- CreateIndex
CREATE INDEX "self_explanation_user_id_server_seq_idx" ON "self_explanation"("user_id", "server_seq");

-- CreateIndex
CREATE INDEX "self_explanation_user_id_topic_id_idx" ON "self_explanation"("user_id", "topic_id");

-- AddForeignKey
ALTER TABLE "topic" ADD CONSTRAINT "topic_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "self_explanation" ADD CONSTRAINT "self_explanation_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

