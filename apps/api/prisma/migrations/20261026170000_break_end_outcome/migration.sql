-- NOTIFICATIONS §2: cada fin de descanso guarda cómo terminó, también si se suprimió.
ALTER TABLE "scheduled_notification" ADD COLUMN "status" TEXT,
ADD COLUMN "reason" TEXT;

-- Antes no se guardaba el resultado: lo cancelado al volver a la app se sabe; lo ya procesado
-- queda en NULL (sin registro) y lo que todavía espera, pendiente.
UPDATE "scheduled_notification" SET "status" = 'suppressed', "reason" = 'foreground'
WHERE "cancelled_at" IS NOT NULL AND "sent_at" IS NULL;
UPDATE "scheduled_notification" SET "status" = 'pending'
WHERE "cancelled_at" IS NULL AND "sent_at" IS NULL;
