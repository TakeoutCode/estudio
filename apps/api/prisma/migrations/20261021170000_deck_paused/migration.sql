-- Pausar un mazo (diseño): sus tarjetas salen de Hoy, de la carga y de los recordatorios;
-- FSRS no cambia (LEARNING-DESIGN LD9). Los mazos anteriores quedan activos (NULL).
-- AlterTable
ALTER TABLE "deck" ADD COLUMN     "paused_at" BIGINT;
