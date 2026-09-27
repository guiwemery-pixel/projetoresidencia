-- AlterTable
ALTER TABLE "flashcard_records" ADD COLUMN     "blob_size" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "flashcard_sync" ADD COLUMN     "media_bytes" BIGINT NOT NULL DEFAULT 0;
