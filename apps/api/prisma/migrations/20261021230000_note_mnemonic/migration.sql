-- STUDY-METHODS R14: mnemotecnia opcional de la nota, que ella escribe tras entender el
-- contenido. Nullable: las notas existentes y los clientes con el contrato 20 quedan sin ella.
-- AlterTable
ALTER TABLE "note" ADD COLUMN     "mnemonic" TEXT;
