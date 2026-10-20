-- NOTIFICATIONS §2: suscripciones Web Push, recordatorios (uno por usuario y día local, NT-T6),
-- fin de descanso programado (uno por bloque, NT-T8) y estado de la reducción por ignorados (§3f).
-- Son solo del servidor: no se sincronizan.
-- CreateTable
CREATE TABLE "push_subscription" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_success_at" TIMESTAMPTZ(3),
    "failures" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "push_subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_event" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kinds" TEXT[],
    "local_date" TEXT NOT NULL,
    "scheduled_for" BIGINT NOT NULL,
    "sent_at" BIGINT,
    "opened_at" BIGINT,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "payload_key" TEXT,
    "payload_params" JSONB,
    "exam_days" TEXT[],

    CONSTRAINT "notification_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_notification" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "timer_session_id" UUID NOT NULL,
    "block_index" INTEGER NOT NULL,
    "fire_at" BIGINT NOT NULL,
    "cancelled_at" BIGINT,
    "sent_at" BIGINT,

    CONSTRAINT "scheduled_notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_state" (
    "user_id" UUID NOT NULL,
    "backoff_reset_at" BIGINT,
    "backoff_question_answered_at" BIGINT,

    CONSTRAINT "notification_state_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "push_subscription_endpoint_key" ON "push_subscription"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscription_user_id_idx" ON "push_subscription"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_event_user_id_local_date_key" ON "notification_event"("user_id", "local_date");

-- CreateIndex
CREATE INDEX "scheduled_notification_fire_at_idx" ON "scheduled_notification"("fire_at");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_notification_timer_session_id_block_index_key" ON "scheduled_notification"("timer_session_id", "block_index");

-- AddForeignKey
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_event" ADD CONSTRAINT "notification_event_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_notification" ADD CONSTRAINT "scheduled_notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_state" ADD CONSTRAINT "notification_state_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

