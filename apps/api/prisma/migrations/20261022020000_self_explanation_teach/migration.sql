-- STUDY-METHODS §1 (técnica Feynman): "Explícaselo a alguien" se guarda como otra autoexplicación
-- del tema, con kind 'teach' y, opcional, lo que ella notó que le faltó (gaps). Las existentes
-- y los clientes con el contrato 24 quedan como 'self' (LD5), sin huecos.
-- AlterTable
ALTER TABLE "self_explanation" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'self',
ADD COLUMN     "gaps" TEXT;
