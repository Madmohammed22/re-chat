/*
  Warnings:

  - You are about to drop the column `sender` on the `Message` table. All the data in the column will be lost.
  - You are about to drop the column `emoji` on the `Reaction` table. All the data in the column will be lost.
  - You are about to drop the column `timestamp` on the `Reaction` table. All the data in the column will be lost.
  - You are about to drop the column `user` on the `Reaction` table. All the data in the column will be lost.
  - Added the required column `name` to the `Message` table without a default value. This is not possible if the table is not empty.
  - Added the required column `reaction` to the `Reaction` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Message" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Message" ("id", "message", "timestamp") SELECT "id", "message", "timestamp" FROM "Message";
DROP TABLE "Message";
ALTER TABLE "new_Message" RENAME TO "Message";
CREATE TABLE "new_Reaction" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "messageId" INTEGER NOT NULL,
    "reaction" TEXT NOT NULL,
    CONSTRAINT "Reaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Reaction" ("id", "messageId") SELECT "id", "messageId" FROM "Reaction";
DROP TABLE "Reaction";
ALTER TABLE "new_Reaction" RENAME TO "Reaction";
CREATE INDEX "Reaction_messageId_idx" ON "Reaction"("messageId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
