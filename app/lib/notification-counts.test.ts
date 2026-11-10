import assert from "node:assert/strict";
import { test } from "node:test";
import { isNewerNotification, unreadNotificationWhere } from "./notification-counts";

test("unread badge excludes archived and deleted notifications and scopes the owner", () => {
  assert.deepEqual(unreadNotificationWhere("user-1"), {
    userId: "user-1", readAt: null, archivedAt: null, deletedAt: null,
  });
});

test("creation cursors announce newer arrivals, not restored older items", () => {
  const previous = { id: "b", createdAt: "2026-11-09T12:00:00.000Z" };
  assert.equal(isNewerNotification({ id: "c", createdAt: "2026-11-09T12:01:00.000Z" }, previous), true);
  assert.equal(isNewerNotification({ id: "c", createdAt: previous.createdAt }, previous), true);
  assert.equal(isNewerNotification(previous, previous), false);
  assert.equal(isNewerNotification(previous, null), true);
  assert.equal(isNewerNotification(null, null), false);
  assert.equal(isNewerNotification({ id: "z", createdAt: "2026-11-08T12:00:00.000Z" }, previous), false);
  assert.equal(isNewerNotification(null, previous), false);
  assert.equal(isNewerNotification({ id: "c", createdAt: "invalid" }, previous), false);
});
