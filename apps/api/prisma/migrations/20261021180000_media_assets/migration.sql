-- FRONTEND §5, ADR-010: imágenes subidas a Cloudinary (LWW, SYNC §1). public_id y version
-- quedan en NULL hasta que el dispositivo que la tiene termina de subirla (FE8).
-- CreateTable
CREATE TABLE "media_asset" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "public_id" TEXT,
    "version" BIGINT,
    "hlc" TEXT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    "deleted_at" BIGINT,
    "server_seq" BIGINT NOT NULL,

    CONSTRAINT "media_asset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "media_asset_user_id_server_seq_idx" ON "media_asset"("user_id", "server_seq");

-- AddForeignKey
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
