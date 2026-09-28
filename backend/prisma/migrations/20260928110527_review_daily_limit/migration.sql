-- AlterTable
ALTER TABLE "reviews" ADD COLUMN     "shifted_from" DATE;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "daily_review_limit" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "requeue_overdue_days" INTEGER NOT NULL DEFAULT 20;
