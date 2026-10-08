-- Confirmação de e-mail e recuperação de senha
ALTER TABLE "users" ADD COLUMN "email_verified_at" TIMESTAMP(3);

CREATE TYPE "EmailTokenKind" AS ENUM ('VERIFY_EMAIL', 'RESET_PASSWORD');

CREATE TABLE "email_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "EmailTokenKind" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "email_tokens_token_hash_key" ON "email_tokens"("token_hash");
CREATE INDEX "email_tokens_user_id_kind_idx" ON "email_tokens"("user_id", "kind");

ALTER TABLE "email_tokens" ADD CONSTRAINT "email_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
