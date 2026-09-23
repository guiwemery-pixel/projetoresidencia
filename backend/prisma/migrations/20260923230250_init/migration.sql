-- CreateEnum
CREATE TYPE "StudyMethod" AS ENUM ('TEORIA', 'QUESTOES', 'FLASHCARDS', 'RECALL', 'REVISAO', 'AULA', 'VIDEO', 'LEITURA', 'RESUMO', 'SIMULADO', 'OUTRO');

-- CreateEnum
CREATE TYPE "SubjectSize" AS ENUM ('SMALL', 'MEDIUM', 'LARGE');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'DONE', 'SKIPPED');

-- CreateEnum
CREATE TYPE "GroupRole" AS ENUM ('OWNER', 'MEMBER');

-- CreateEnum
CREATE TYPE "GoalMetric" AS ENUM ('QUESTIONS', 'CORRECT_ANSWERS', 'STUDY_MINUTES', 'STUDY_SESSIONS', 'STUDY_DAYS', 'REVIEWS_DONE', 'MOCK_EXAMS', 'CLEAR_OVERDUE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "GoalPeriod" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'EXPIRED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MockExamStatus" AS ENUM ('PLANNED', 'DONE');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "avatar" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "domain" TEXT NOT NULL DEFAULT 'medicina',
    "share_progress" BOOLEAN NOT NULL DEFAULT true,
    "weekly_study_hours_target" INTEGER NOT NULL DEFAULT 20,
    "weekly_study_days_target" INTEGER NOT NULL DEFAULT 5,
    "daily_questions_target" INTEGER NOT NULL DEFAULT 30,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "groups" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "invite_code" TEXT NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_members" (
    "group_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "GroupRole" NOT NULL DEFAULT 'MEMBER',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_members_pkey" PRIMARY KEY ("group_id","user_id")
);

-- CreateTable
CREATE TABLE "areas" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subjects" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "area_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "size" "SubjectSize" NOT NULL DEFAULT 'MEDIUM',
    "notes" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "study_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "studied_on" DATE NOT NULL,
    "duration_minutes" INTEGER NOT NULL DEFAULT 0,
    "methods" "StudyMethod"[],
    "quality" INTEGER,
    "difficulty" INTEGER,
    "notes" TEXT,
    "is_first_contact" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "study_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "study_session_id" TEXT,
    "done_on" DATE NOT NULL,
    "total" INTEGER NOT NULL,
    "correct" INTEGER NOT NULL,
    "wrong" INTEGER NOT NULL,
    "accuracy" DOUBLE PRECISION NOT NULL,
    "board" TEXT,
    "exam_name" TEXT,
    "difficulty" INTEGER,
    "time_spent_minutes" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_states" (
    "subject_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "stage" INTEGER NOT NULL DEFAULT 0,
    "ease" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "interval_days" INTEGER NOT NULL DEFAULT 1,
    "last_contact_on" DATE NOT NULL,
    "last_score" DOUBLE PRECISION,
    "contacts" INTEGER NOT NULL DEFAULT 1,
    "lapses" INTEGER NOT NULL DEFAULT 0,
    "algorithm_version" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learning_states_pkey" PRIMARY KEY ("subject_id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "stage" INTEGER NOT NULL,
    "scheduled_for" DATE NOT NULL,
    "original_scheduled_on" DATE,
    "interval_days" INTEGER NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "completed_on" DATE,
    "elapsed_days" INTEGER,
    "performance" DOUBLE PRECISION,
    "quality" INTEGER,
    "score" DOUBLE PRECISION,
    "next_interval_days" INTEGER,
    "suggested_methods" "StudyMethod"[],
    "suggested_questions" INTEGER,
    "suggest_theory" BOOLEAN NOT NULL DEFAULT false,
    "explanation" JSONB,
    "study_session_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "algorithm_configs" (
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "config" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "algorithm_configs_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "goals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "metric" "GoalMetric" NOT NULL,
    "period" "GoalPeriod" NOT NULL,
    "target" DOUBLE PRECISION NOT NULL,
    "manual_progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "area_id" TEXT,
    "subject_id" TEXT,
    "start_date" DATE NOT NULL,
    "due_date" DATE,
    "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mock_exams" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "exam_id" TEXT,
    "name" TEXT NOT NULL,
    "board" TEXT,
    "exam_name" TEXT,
    "year" INTEGER,
    "taken_on" DATE NOT NULL,
    "status" "MockExamStatus" NOT NULL DEFAULT 'DONE',
    "total_questions" INTEGER,
    "correct" INTEGER,
    "accuracy" DOUBLE PRECISION,
    "duration_minutes" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mock_exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mock_exam_area_results" (
    "id" TEXT NOT NULL,
    "mock_exam_id" TEXT NOT NULL,
    "area_id" TEXT NOT NULL,
    "total" INTEGER NOT NULL,
    "correct" INTEGER NOT NULL,

    CONSTRAINT "mock_exam_area_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boards" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "boards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exams" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "board_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "year" INTEGER,
    "total_questions" INTEGER,
    "file_url" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_attempts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "exam_id" TEXT NOT NULL,
    "taken_on" DATE NOT NULL,
    "total_questions" INTEGER NOT NULL,
    "correct" INTEGER NOT NULL,
    "accuracy" DOUBLE PRECISION NOT NULL,
    "duration_minutes" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "dedupe_key" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "groups_invite_code_key" ON "groups"("invite_code");

-- CreateIndex
CREATE INDEX "group_members_user_id_idx" ON "group_members"("user_id");

-- CreateIndex
CREATE INDEX "areas_user_id_parent_id_idx" ON "areas"("user_id", "parent_id");

-- CreateIndex
CREATE INDEX "subjects_user_id_area_id_idx" ON "subjects"("user_id", "area_id");

-- CreateIndex
CREATE INDEX "subjects_user_id_name_idx" ON "subjects"("user_id", "name");

-- CreateIndex
CREATE INDEX "study_sessions_user_id_studied_on_idx" ON "study_sessions"("user_id", "studied_on");

-- CreateIndex
CREATE INDEX "study_sessions_subject_id_studied_on_idx" ON "study_sessions"("subject_id", "studied_on");

-- CreateIndex
CREATE INDEX "question_sessions_user_id_done_on_idx" ON "question_sessions"("user_id", "done_on");

-- CreateIndex
CREATE INDEX "question_sessions_subject_id_done_on_idx" ON "question_sessions"("subject_id", "done_on");

-- CreateIndex
CREATE INDEX "learning_states_user_id_idx" ON "learning_states"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_study_session_id_key" ON "reviews"("study_session_id");

-- CreateIndex
CREATE INDEX "reviews_user_id_status_scheduled_for_idx" ON "reviews"("user_id", "status", "scheduled_for");

-- CreateIndex
CREATE INDEX "reviews_subject_id_status_idx" ON "reviews"("subject_id", "status");

-- CreateIndex
CREATE INDEX "goals_user_id_status_idx" ON "goals"("user_id", "status");

-- CreateIndex
CREATE INDEX "mock_exams_user_id_taken_on_idx" ON "mock_exams"("user_id", "taken_on");

-- CreateIndex
CREATE INDEX "mock_exam_area_results_mock_exam_id_idx" ON "mock_exam_area_results"("mock_exam_id");

-- CreateIndex
CREATE UNIQUE INDEX "boards_user_id_name_key" ON "boards"("user_id", "name");

-- CreateIndex
CREATE INDEX "exams_user_id_board_id_idx" ON "exams"("user_id", "board_id");

-- CreateIndex
CREATE INDEX "exam_attempts_user_id_taken_on_idx" ON "exam_attempts"("user_id", "taken_on");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_user_id_dedupe_key_key" ON "notifications"("user_id", "dedupe_key");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "areas" ADD CONSTRAINT "areas_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "areas" ADD CONSTRAINT "areas_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "areas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "areas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_sessions" ADD CONSTRAINT "question_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_sessions" ADD CONSTRAINT "question_sessions_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_sessions" ADD CONSTRAINT "question_sessions_study_session_id_fkey" FOREIGN KEY ("study_session_id") REFERENCES "study_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_states" ADD CONSTRAINT "learning_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_states" ADD CONSTRAINT "learning_states_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_study_session_id_fkey" FOREIGN KEY ("study_session_id") REFERENCES "study_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mock_exams" ADD CONSTRAINT "mock_exams_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mock_exams" ADD CONSTRAINT "mock_exams_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mock_exam_area_results" ADD CONSTRAINT "mock_exam_area_results_mock_exam_id_fkey" FOREIGN KEY ("mock_exam_id") REFERENCES "mock_exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mock_exam_area_results" ADD CONSTRAINT "mock_exam_area_results_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "areas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boards" ADD CONSTRAINT "boards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
