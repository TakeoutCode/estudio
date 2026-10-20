-- AlterTable
ALTER TABLE "user" ADD COLUMN     "purged_through_seq" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "refresh_token" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "rotated_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "refresh_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applied_mutation" (
    "user_id" UUID NOT NULL,
    "mutation_id" UUID NOT NULL,
    "applied_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "applied_mutation_pkey" PRIMARY KEY ("user_id","mutation_id")
);

-- CreateTable
CREATE TABLE "deck" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "hlc" TEXT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    "deleted_at" BIGINT,
    "server_seq" BIGINT NOT NULL DEFAULT nextval('sync_seq'::regclass),

    CONSTRAINT "deck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_settings" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "section" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "hlc" TEXT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    "deleted_at" BIGINT,
    "server_seq" BIGINT NOT NULL DEFAULT nextval('sync_seq'::regclass),

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_log" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "card_id" UUID NOT NULL,
    "card_kind" TEXT NOT NULL,
    "reviewed_at" BIGINT NOT NULL,
    "rating" SMALLINT NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "confidence" SMALLINT,
    "session_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "answer" JSONB,
    "server_seq" BIGINT NOT NULL DEFAULT nextval('sync_seq'::regclass),

    CONSTRAINT "review_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "refresh_token_token_hash_key" ON "refresh_token"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_token_family_id_idx" ON "refresh_token"("family_id");

-- CreateIndex
CREATE INDEX "deck_user_id_server_seq_idx" ON "deck"("user_id", "server_seq");

-- CreateIndex
CREATE INDEX "user_settings_user_id_server_seq_idx" ON "user_settings"("user_id", "server_seq");

-- CreateIndex
CREATE UNIQUE INDEX "user_settings_user_id_section_key" ON "user_settings"("user_id", "section");

-- CreateIndex
CREATE INDEX "review_log_user_id_server_seq_idx" ON "review_log"("user_id", "server_seq");

-- CreateIndex
CREATE INDEX "review_log_user_id_card_id_idx" ON "review_log"("user_id", "card_id");

-- AddForeignKey
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applied_mutation" ADD CONSTRAINT "applied_mutation_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deck" ADD CONSTRAINT "deck_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_log" ADD CONSTRAINT "review_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- No lo modela Prisma (BACKEND BE8). No borrar en migraciones futuras.
-- ---------------------------------------------------------------------------

-- R3, SYNC §1: el ReviewLog es solo de inserción. DELETE /me lo salta con
-- SET LOCAL app.allow_purge = 'on' (ver forbid_append_only_change en la migración init).
CREATE TRIGGER "review_log_append_only"
  BEFORE UPDATE OR DELETE ON "review_log"
  FOR EACH ROW EXECUTE FUNCTION forbid_append_only_change();
