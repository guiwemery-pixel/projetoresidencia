-- Contas gratuitas para sempre: todas as contas que já existem ficam gratuitas
-- (nunca serão cobradas). Contas novas começam sem a marca; a Administração pode liberar.
ALTER TABLE "users" ADD COLUMN "free_access" BOOLEAN NOT NULL DEFAULT false;

UPDATE "users" SET "free_access" = true;
