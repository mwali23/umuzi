import { test } from "node:test";
import assert from "node:assert/strict";
import { connection, layout, relatives } from "../src/graph.ts";
const people = ["a", "b", "c", "d"].map((id) => ({ id, name: `Person ${id}` }));
const edges = [
  {
    id: "ab",
    from_id: "a",
    to_id: "b",
    kind: "parent",
    status: "approved",
    parent_type: "biological",
  },
  {
    id: "ac",
    from_id: "a",
    to_id: "c",
    kind: "parent",
    status: "approved",
    parent_type: "adoptive",
  },
  {
    id: "bd",
    from_id: "b",
    to_id: "d",
    kind: "parent",
    status: "pending",
    parent_type: "unspecified",
  },
];
test("stats count distinct reviewed ancestors and descendants only", () => {
  assert.deepEqual([...relatives("a", edges, "descendants")], ["b", "c"]);
  assert.deepEqual([...relatives("b", edges, "ancestors")], ["a"]);
  assert.equal(relatives("d", edges, "ancestors").size, 0);
});
test("connection paths describe recorded links without inventing kinship", () => {
  assert.match(
    connection("b", "c", people, edges),
    /parent: Person a.*child: Person c/,
  );
  assert.match(connection("b", "d", people, edges), /No connection/);
});
test("layout derives generations from records, not fixed demo positions", () => {
  const positions = layout(people, edges);
  assert.ok(
    positions.find((p) => p.id === "b").y >
      positions.find((p) => p.id === "a").y,
  );
  assert.notEqual(
    positions.find((p) => p.id === "b").x,
    positions.find((p) => p.id === "c").x,
  );
});
test("traversal remains finite even with corrupted cyclic data", () => {
  assert.equal(
    relatives(
      "a",
      [
        ...edges,
        { from_id: "b", to_id: "a", kind: "parent", status: "approved" },
      ],
      "descendants",
    ).size,
    2,
  );
});
test("a partner without recorded parents is aligned with their partner", () => {
  const positions = layout(people, [
    ...edges,
    { from_id: "b", to_id: "d", kind: "partner", status: "approved" },
  ]);
  assert.equal(
    positions.find((p) => p.id === "b").y,
    positions.find((p) => p.id === "d").y,
  );
});
