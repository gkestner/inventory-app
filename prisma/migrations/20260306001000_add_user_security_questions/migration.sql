-- AddFields
ALTER TABLE "User"
  ADD COLUMN "securityQuestionsEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "securityQuestionPrompt" TEXT,
  ADD COLUMN "securityQuestionAnswerHash" TEXT;
