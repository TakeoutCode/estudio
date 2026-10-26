-- SYNC §6: ids de filas LWW ya purgadas, para que una edición vieja no las reviva.
CREATE TABLE "purged_row" (
    "user_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "table" TEXT NOT NULL,
    "purged_at" BIGINT NOT NULL,

    CONSTRAINT "purged_row_pkey" PRIMARY KEY ("user_id","id")
);

ALTER TABLE "purged_row" ADD CONSTRAINT "purged_row_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
