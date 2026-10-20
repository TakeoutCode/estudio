-- SYNC §3: server_seq lo asigna cada escritura con nextval('sync_seq') explícito. Con un
-- DEFAULT nextval, Prisma cree que la secuencia es suya y propone borrarla en cada diff.
-- La secuencia "sync_seq" se queda: la creó la migración init y Prisma no la gestiona.
ALTER TABLE "deck" ALTER COLUMN "server_seq" DROP DEFAULT;
ALTER TABLE "review_log" ALTER COLUMN "server_seq" DROP DEFAULT;
ALTER TABLE "user_settings" ALTER COLUMN "server_seq" DROP DEFAULT;
