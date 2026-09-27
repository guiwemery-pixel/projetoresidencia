-- CreateTable
CREATE TABLE "flashcard_sync" (
    "user_id" TEXT NOT NULL,
    "version" BIGINT NOT NULL DEFAULT 0,
    "epoch" INTEGER NOT NULL DEFAULT 1,
    "bytes" BIGINT NOT NULL DEFAULT 0,
    "purged_version" BIGINT NOT NULL DEFAULT 0,
    "summary" JSONB,
    "summary_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flashcard_sync_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "flashcard_records" (
    "user_id" TEXT NOT NULL,
    "store" VARCHAR(32) NOT NULL,
    "id" VARCHAR(200) NOT NULL,
    "data" TEXT,
    "size" INTEGER NOT NULL DEFAULT 0,
    "version" BIGINT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flashcard_records_pkey" PRIMARY KEY ("user_id","store","id")
);

-- CreateIndex
CREATE INDEX "flashcard_records_user_id_version_idx" ON "flashcard_records"("user_id", "version");

-- AddForeignKey
ALTER TABLE "flashcard_sync" ADD CONSTRAINT "flashcard_sync_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flashcard_records" ADD CONSTRAINT "flashcard_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
