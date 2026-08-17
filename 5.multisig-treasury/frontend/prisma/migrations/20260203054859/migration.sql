-- CreateTable
CREATE TABLE "Treasury" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "owner" TEXT NOT NULL DEFAULT '',
    "image" TEXT NOT NULL,
    "threshold" INTEGER NOT NULL,
    "allowance" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Treasury_pkey" PRIMARY KEY ("id")
);
