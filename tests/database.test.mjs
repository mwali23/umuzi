import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import {
  after,
  afterEach,
  before,
  beforeEach,
  describe,
  test,
} from "node:test";
import { PGlite } from "@electric-sql/pglite";

const admin = "00000000-0000-0000-0000-000000000001";
const member = "00000000-0000-0000-0000-000000000002";
const pending = "00000000-0000-0000-0000-000000000003";
const stranger = "00000000-0000-0000-0000-000000000004";
const unverified = "00000000-0000-0000-0000-000000000005";
let db;
async function as(id, aal = "aal1") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: id, aal }),
  ]);
  await db.exec(`set role ${id ? "authenticated" : "anon"}`);
}
async function call(action, payload = {}) {
  return (
    await db.query("select public.umuzi($1, $2::jsonb) as result", [
      action,
      JSON.stringify(payload),
    ])
  ).rows[0].result;
}
async function rejected(fn, pattern) {
  await db.exec("savepoint denied_operation");
  try {
    await assert.rejects(fn, pattern);
  } finally {
    await db.exec("rollback to savepoint denied_operation");
  }
}
async function person(name = "Test Person") {
  return (await call("save_person", { name, biography: "Synthetic test only" }))
    .id;
}

describe("PostgreSQL authorization and integrity (real migration, synthetic users)", () => {
  before(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated;
      create schema auth;
      create table auth.users(id uuid primary key, email_confirmed_at timestamptz);
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
      grant usage on schema auth to anon,authenticated;
      grant execute on all functions in schema auth to anon,authenticated;
      insert into auth.users values ('${admin}',now()),('${member}',now()),('${pending}',now()),('${stranger}',now()),('${unverified}',null);`);
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/202609250001_umuzi.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(`insert into public.memberships(user_id,display_name,status,role) values
      ('${admin}','Test Admin','approved','admin'),('${member}','Test Member','approved','member'),('${pending}','Test Pending','pending','member');`);
  });
  beforeEach(async () => {
    await db.exec("begin");
    await as(member);
  });
  afterEach(async () => {
    await db.exec("reset role; rollback");
  });
  after(async () => {
    await db.close();
  });

  test("anonymous visitors cannot call the RPC or read family records", async () => {
    await person();
    await as(null);
    await rejected(() => call("snapshot"), /permission denied/i);
    await rejected(
      () => db.query("select * from public.people"),
      /permission denied/i,
    );
  });
  test("pending and unregistered users receive no family records via RPC or RLS", async () => {
    await person();
    await as(pending);
    assert.equal((await call("snapshot")).people, undefined);
    assert.equal(
      (await db.query("select * from public.people")).rows.length,
      0,
    );
    await rejected(() => person("Unauthorized"), /approve your account/i);
    await as(stranger);
    assert.equal((await call("snapshot")).membership, null);
    assert.equal(
      (await db.query("select * from public.memberships")).rows.length,
      0,
    );
  });
  test("request payload cannot grant membership or self-promote", async () => {
    await as(stranger);
    await call("request_access", {
      name: "Test New Member",
      introduction: "A relative knows me",
      role: "admin",
      status: "approved",
      user_id: admin,
    });
    const me = (await call("snapshot")).membership;
    assert.equal(me.user_id, stranger);
    assert.equal(me.role, "member");
    assert.equal(me.status, "pending");
    await rejected(
      () =>
        call("update_membership", {
          user_id: stranger,
          status: "approved",
          role: "admin",
        }),
      /approve your account/i,
    );
    await as(member);
    await rejected(
      () =>
        call("update_membership", {
          user_id: member,
          status: "approved",
          role: "admin",
        }),
      /Administrator access/i,
    );
    await rejected(
      () => db.exec("update public.memberships set role='admin'"),
      /permission denied/i,
    );
  });
  test("unverified email cannot request membership", async () => {
    await as(unverified);
    await rejected(
      () => call("request_access", { name: "Test", introduction: "Hello" }),
      /Verify your email/i,
    );
  });
  test("admin operations require AAL2, and an admin cannot remove their own access", async () => {
    await as(admin);
    await rejected(
      () =>
        call("update_membership", {
          user_id: pending,
          status: "approved",
          role: "member",
        }),
      /two-step verification/i,
    );
    await as(admin, "aal2");
    await call("update_membership", {
      user_id: pending,
      status: "approved",
      role: "member",
    });
    await rejected(
      () =>
        call("update_membership", {
          user_id: admin,
          status: "suspended",
          role: "member",
        }),
      /Another administrator/i,
    );
    await as(pending);
    assert.equal((await call("snapshot")).membership.status, "approved");
  });
  test("normalized duplicate names cannot be inserted, and failed insert is atomic", async () => {
    await person("  Test   Person  ");
    await rejected(() => person("test person"), /already exists/i);
    await rejected(
      () =>
        call("save_person", {
          name: "Invalid Dates",
          birth_date: "2000-01-01",
          deceased: true,
          death_date: "1999-01-01",
        }),
      /check constraint/i,
    );
    const data = await call("snapshot");
    assert.equal(data.people.length, 1);
    assert.equal(
      (await db.query("select * from public.audit_log")).rows.length,
      0,
    );
    await as(admin, "aal2");
    await call("save_person", {
      name: "Test Person",
      distinct_reason: "Confirmed two different people with the same name.",
    });
    assert.equal((await call("snapshot")).people.length, 2);
  });
  test("claiming is reviewed, exclusive, and cannot edit other profiles", async () => {
    const first = await person("Person One"),
      second = await person("Person Two");
    const claim = await call("claim_profile", {
      person_id: first,
      reason: "Test relative can confirm",
    });
    const original = (await call("snapshot")).people.find(
      (p) => p.id === first,
    );
    await rejected(
      () => call("save_person", { ...original, name: "Stolen Profile" }),
      /approved claimed profile/i,
    );
    await rejected(
      () =>
        call("claim_profile", {
          person_id: second,
          reason: "A second pending claim",
        }),
      /unique constraint/i,
    );
    await as(admin, "aal2");
    await call("review_claim", { id: claim.id, status: "approved" });
    await as(member);
    await call("save_person", {
      ...original,
      biography: "Updated by the verified claimant",
    });
    await rejected(
      () => call("save_person", { ...original, biography: "Outdated edit" }),
      /Refresh before editing/i,
    );
    await rejected(
      () =>
        call("claim_profile", { person_id: second, reason: "Another claim" }),
      /already linked/i,
    );
    await as(admin, "aal2");
    await rejected(
      () => call("review_claim", { id: claim.id, status: "approved" }),
      /no longer/i,
    );
    await call("review_claim", { id: claim.id, status: "revoked" });
    await as(member);
    const current = (await call("snapshot")).people.find((p) => p.id === first);
    await rejected(
      () => call("save_person", current),
      /approved claimed profile/i,
    );
  });
  test("competing claims resolve to one account and deceased profiles cannot be claimed", async () => {
    const id = await person();
    const winner = await call("claim_profile", {
      person_id: id,
      reason: "Known family member",
    });
    await as(admin, "aal2");
    const loser = await call("claim_profile", {
      person_id: id,
      reason: "Competing claim for test",
    });
    await call("review_claim", { id: winner.id, status: "approved" });
    assert.equal(
      (await call("snapshot")).claims.find((c) => c.id === loser.id).status,
      "rejected",
    );
    await rejected(
      () => call("review_claim", { id: loser.id, status: "approved" }),
      /no longer/i,
    );
    const deceased = await call("save_person", {
      name: "Remembered Test",
      deceased: true,
    });
    await rejected(
      () =>
        call("claim_profile", {
          person_id: deceased.id,
          reason: "Not permitted",
        }),
      /living person/i,
    );
  });
  test("relationships are pending, canonical, and reject self-links and ancestry cycles", async () => {
    const a = await person("Test A"),
      b = await person("Test B"),
      c = await person("Test C");
    const ab = await call("propose_relationship", {
      from_id: a,
      to_id: b,
      kind: "parent",
    });
    const bc = await call("propose_relationship", {
      from_id: b,
      to_id: c,
      kind: "parent",
    });
    const ca = await call("propose_relationship", {
      from_id: c,
      to_id: a,
      kind: "parent",
    });
    assert.equal((await call("snapshot")).relationships[0].status, "pending");
    await rejected(
      () => call("review_relationship", { id: ab.id, status: "approved" }),
      /Administrator access/i,
    );
    await rejected(
      () =>
        call("propose_relationship", { from_id: a, to_id: a, kind: "parent" }),
      /check constraint/i,
    );
    await call("propose_relationship", {
      from_id: b,
      to_id: a,
      kind: "partner",
    });
    await rejected(
      () =>
        call("propose_relationship", { from_id: a, to_id: b, kind: "partner" }),
      /unique constraint/i,
    );
    await as(admin, "aal2");
    await call("review_relationship", { id: ab.id, status: "approved" });
    await call("review_relationship", { id: bc.id, status: "approved" });
    await rejected(
      () => call("review_relationship", { id: ca.id, status: "approved" }),
      /ancestry loop/i,
    );
  });
  test("cause of death stays admin-only through both RLS and the API", async () => {
    await as(admin, "aal2");
    const id = (
      await call("save_person", { name: "Restricted Test", deceased: true })
    ).id;
    await call("save_sensitive", {
      person_id: id,
      cause_of_death: "Synthetic private detail",
      source_note: "Synthetic permission note",
    });
    assert.equal((await call("snapshot")).sensitive.length, 1);
    await as(admin);
    assert.equal(
      (await db.query("select * from public.person_sensitive")).rows.length,
      0,
    );
    await as(member);
    assert.equal((await call("snapshot")).sensitive.length, 0);
    assert.equal(
      (await db.query("select * from public.person_sensitive")).rows.length,
      0,
    );
    await rejected(
      () =>
        call("save_sensitive", {
          person_id: id,
          cause_of_death: "Changed",
          source_note: "Test source",
        }),
      /Administrator access/i,
    );
  });
  test("suspension immediately removes backend access, including for a still-valid token", async () => {
    await person();
    await as(admin, "aal2");
    await call("update_membership", {
      user_id: member,
      status: "suspended",
      role: "member",
    });
    await as(member);
    assert.equal((await call("snapshot")).people, undefined);
    assert.equal(
      (await db.query("select * from public.people")).rows.length,
      0,
    );
    await rejected(() => person("No more access"), /approve your account/i);
  });
  test("direct table writes are denied and invalid requests do not bypass validation", async () => {
    await rejected(
      () => db.exec("insert into public.people(name) values ('Bypass')"),
      /permission denied/i,
    );
    await rejected(
      () => call("save_person", { name: ["Not a name"] }),
      /name is required/i,
    );
    await rejected(() => call("unknown"), /Unknown action/i);
    await rejected(
      () => call("save_person", { name: "x".repeat(200) }),
      /check constraint/i,
    );
    await rejected(() => call("save_person", null), /Invalid request/i);
  });
  test("successful mutations are limited per account and audit entries are atomic", async () => {
    for (let i = 0; i < 60; i++) await person(`Rate Test ${i}`);
    await rejected(() => person("Rate Test Blocked"), /Too many changes/i);
    await as(admin, "aal2");
    assert.equal(
      (await db.query("select count(*)::int as n from public.audit_log"))
        .rows[0].n,
      60,
    );
    assert.equal((await call("snapshot")).people.length, 60);
  });
});
