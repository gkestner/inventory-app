import assert from "node:assert/strict";
import { test } from "node:test";
import { getNotificationTargetHref, notificationInboxHref, notificationInboxWhere, notificationMutation, parseInboxFilters } from "./notification-inbox";

test("untrusted inbox filters cannot choose arbitrary folders, types, or redirects", () => {
  const filters = parseInboxFilters({ view: "https://evil.test", type: "bogus", q: " x ", page: "-1" });
  assert.deepEqual(filters, { view: "inbox", type: "", q: "x", page: 1 });
  assert.equal(notificationInboxHref(filters), "/notifications?q=x");
  assert.equal(parseInboxFilters({ page: "Infinity" }).page, 1);
  assert.equal(parseInboxFilters({ q: "x".repeat(201) }).q.length, 200);
  assert.equal(parseInboxFilters({ view: ["trash", "unread"] }).view, "inbox");
});

test("folder searches retain ownership and exclude other folder states", () => {
  const filters = parseInboxFilters({ view: "unread", q: "pump", type: "WORK_ORDER" });
  const where = notificationInboxWhere("owner", filters);
  assert.equal(where.userId, "owner");
  assert.equal(where.deletedAt, null);
  assert.equal(where.archivedAt, null);
  assert.equal(where.readAt, null);
  assert.equal(where.type, "WORK_ORDER");
  assert.equal(where.OR?.length, 2);
  assert.deepEqual(notificationInboxWhere("owner", { ...filters, view: "archived" }).archivedAt, { not: null });
  assert.deepEqual(notificationInboxWhere("owner", { ...filters, view: "trash" }).deletedAt, { not: null });
});

test("every bulk and individual operation scopes IDs to the signed-in owner", () => {
  for (const operation of ["read", "unread", "archive", "unarchive", "trash", "restore"]) {
    const mutation = notificationMutation("owner", operation, ["someone-elses-id", "mine", "mine"]);
    assert.equal(mutation?.where.userId, "owner");
    assert.deepEqual(mutation?.where.id, { in: ["someone-elses-id", "mine"] });
    assert.deepEqual(mutation?.where.deletedAt, operation === "restore" ? { not: null } : null);
  }
  assert.equal(notificationMutation("owner", "purge", ["mine"]), null);
  assert.equal(notificationMutation("owner", "archive", []), null);
  assert.equal(notificationMutation("owner", "archive", ["x".repeat(129)]), null);
});

test("read-all and archive-read affect only the entire active inbox", () => {
  for (const operation of ["readAll", "archiveRead"]) {
    const mutation = notificationMutation("owner", operation, []);
    assert.equal(mutation?.where.userId, "owner");
    assert.equal(mutation?.where.archivedAt, null);
    assert.equal(mutation?.where.deletedAt, null);
    assert.equal(mutation?.where.id, undefined);
  }
  assert.equal(notificationMutation("owner", "readAll", [])?.where.readAt, null);
  assert.deepEqual(notificationMutation("owner", "archiveRead", [])?.where.readAt, { not: null });
});

test("archive, trash and restore preserve original read history and folder", () => {
  const now = new Date("2026-11-09T12:00:00Z");
  assert.deepEqual(notificationMutation("owner", "archive", ["one"], now)?.data, { archivedAt: now });
  assert.deepEqual(notificationMutation("owner", "trash", ["one"], now)?.data, { deletedAt: now });
  assert.deepEqual(notificationMutation("owner", "restore", ["one"], now)?.data, { deletedAt: null });
  assert.equal(notificationMutation("owner", "read", ["one"], now)?.where.readAt, null);
});

test("notification destinations permit local detail links and reject unsafe URLs", () => {
  for (const href of ["https://evil.test", "javascript:alert(1)", "//evil.test", "/a/..//evil.test", "/%2e%2e//evil.test", "/\\evil.test", "/%2fevil.test", "/%5cevil.test", "/\nevil.test", "/%0aevil.test", "/%ZZ", ""]) {
    assert.equal(getNotificationTargetHref(href), null, href);
  }
  assert.equal(getNotificationTargetHref("/admin/work-orders?id=123#details"), "/admin/work-orders?id=123#details");
  assert.equal(getNotificationTargetHref("/maintenance?query=water%20pump"), "/maintenance?query=water%20pump");
});
