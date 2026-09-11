-- The "tagged" status value is renamed to "resolved": a resolved bookmark means the user is
-- done deciding what it is, not "has tags" (a resolved bookmark can have zero tags). The
-- column itself is unchanged (plain text, no enum constraint) — this only migrates the data.
UPDATE "bookmarks" SET "status" = 'resolved' WHERE "status" = 'tagged';
