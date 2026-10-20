-- STUDY-METHODS §5 (uso de descansos): el bloque de enfoque registra si usó "+N min" (§3).
-- Las filas anteriores no lo sabían: quedan en false.
-- AlterTable
ALTER TABLE "timer_block_log" ADD COLUMN     "extended" BOOLEAN NOT NULL DEFAULT false;
