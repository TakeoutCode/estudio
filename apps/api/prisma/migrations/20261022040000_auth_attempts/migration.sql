-- BACKEND BE12 y ADR-018: la API corre en varias instancias de función que no comparten memoria,
-- así que los límites de login y registro (por IP y por correo) cuentan los intentos aquí. `key`
-- es el SHA-256 de "ip:<ip>" o "email:<correo>": ni la IP ni el correo quedan en claro.
-- CreateTable
CREATE TABLE "auth_attempt" (
    "id" BIGSERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "auth_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auth_attempt_key_at_idx" ON "auth_attempt"("key", "at");
