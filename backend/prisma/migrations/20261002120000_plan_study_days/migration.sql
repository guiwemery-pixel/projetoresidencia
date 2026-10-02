-- Dias e horas de estudo da pessoa (o cronograma distribui os assuntos por esses dias)
ALTER TABLE "users" ADD COLUMN "study_weekdays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[];
ALTER TABLE "users" ADD COLUMN "daily_study_minutes" INTEGER NOT NULL DEFAULT 240;

-- Quem já usa a plataforma: parte das metas semanais (N dias → segunda em diante; horas ÷ dias)
UPDATE "users" SET
  "study_weekdays" = ARRAY(SELECT generate_series(1, LEAST(7, GREATEST(1, "weekly_study_days_target")))),
  "daily_study_minutes" = LEAST(960, GREATEST(30, ROUND("weekly_study_hours_target" * 60.0 / GREATEST(1, "weekly_study_days_target") / 30) * 30));

-- Dia previsto de cada assunto do cronograma (vazio = ainda não distribuído pela semana)
ALTER TABLE "plan_items" ADD COLUMN "planned_on" DATE;
