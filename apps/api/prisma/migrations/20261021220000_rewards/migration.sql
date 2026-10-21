-- UI-UX UX10 (diseño · sin evidencia): premios que ella define (LWW) y sus canjes (solo
-- inserción). El saldo de monedas no se guarda: se calcula con srs a partir de los logs.
-- CreateTable
CREATE TABLE "reward" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "cost" INTEGER NOT NULL,
    "hlc" TEXT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    "deleted_at" BIGINT,
    "server_seq" BIGINT NOT NULL,

    CONSTRAINT "reward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_redemption" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "reward_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "cost" INTEGER NOT NULL,
    "redeemed_at" BIGINT NOT NULL,
    "device_id" UUID NOT NULL,
    "server_seq" BIGINT NOT NULL,

    CONSTRAINT "reward_redemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reward_user_id_server_seq_idx" ON "reward"("user_id", "server_seq");

-- CreateIndex
CREATE INDEX "reward_redemption_user_id_server_seq_idx" ON "reward_redemption"("user_id", "server_seq");

-- AddForeignKey
ALTER TABLE "reward" ADD CONSTRAINT "reward_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_redemption" ADD CONSTRAINT "reward_redemption_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- No lo modela Prisma (BACKEND BE8). No borrar en migraciones futuras.
-- ---------------------------------------------------------------------------

-- SYNC §1: RewardRedemption es solo de inserción, como review_log. DELETE /me lo salta con
-- SET LOCAL app.allow_purge = 'on' (ver forbid_append_only_change en la migración init).
CREATE TRIGGER "reward_redemption_append_only"
  BEFORE UPDATE OR DELETE ON "reward_redemption"
  FOR EACH ROW EXECUTE FUNCTION forbid_append_only_change();
