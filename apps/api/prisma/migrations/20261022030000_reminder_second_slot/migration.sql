-- STUDY-METHODS §3d y NOTIFICATIONS NT3: hasta 2 recordatorios al día, uno por cada hora que ella
-- elige (slot 1 = dailyReminderTime, slot 2 = secondReminderTime). La unicidad que reclama el
-- evento pasa de (usuario, día) a (usuario, día, slot); los eventos existentes quedan en el slot 1.
-- AlterTable
ALTER TABLE "notification_event" ADD COLUMN     "slot" INTEGER NOT NULL DEFAULT 1;

-- DropIndex
DROP INDEX "notification_event_user_id_local_date_key";

-- CreateIndex
CREATE UNIQUE INDEX "notification_event_user_id_local_date_slot_key" ON "notification_event"("user_id", "local_date", "slot");
