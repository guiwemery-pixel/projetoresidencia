-- CreateEnum
CREATE TYPE "AccessRole" AS ENUM ('ADMIN', 'MEMBER');

-- CreateTable
CREATE TABLE "access_emails" (
    "email" VARCHAR(160) NOT NULL,
    "role" "AccessRole" NOT NULL DEFAULT 'MEMBER',
    "note" VARCHAR(120),
    "added_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_emails_pkey" PRIMARY KEY ("email")
);

-- CreateTable
CREATE TABLE "site_settings" (
    "key" VARCHAR(64) NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_settings_pkey" PRIMARY KEY ("key")
);
