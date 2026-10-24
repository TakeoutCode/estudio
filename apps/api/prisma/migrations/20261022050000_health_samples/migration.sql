-- QUALITY QA8 y ADR-018: la función de la API y el daemon `scheduler` no comparten memoria, así
-- que las muestras de GET /health/checks viven aquí. Sin datos de ella; el tick del cron purga
-- las de más de 24 h.
-- CreateTable
CREATE TABLE "health_sample" (
    "id" BIGSERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "ms" INTEGER,
    "failed" BOOLEAN,
    "share" DOUBLE PRECISION,

    CONSTRAINT "health_sample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "health_sample_kind_at_idx" ON "health_sample"("kind", "at");
