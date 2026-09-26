export type Person = {
  id: string;
  name: string;
  birth_date: string | null;
  birth_place: string;
  tribe: string;
  occupation: string;
  biography: string;
  deceased: boolean;
  death_date: string | null;
  death_place: string;
  updated_at: string;
};
export type Relationship = {
  id: string;
  from_id: string;
  to_id: string;
  kind: "parent" | "partner";
  parent_type: string | null;
  status: string;
  created_by: string;
};

export function relatives(
  id: string,
  edges: Relationship[],
  direction: "ancestors" | "descendants",
) {
  const found = new Set<string>();
  const queue = [id];
  while (queue.length) {
    const current = queue.shift()!;
    for (const e of edges.filter(
      (e) => e.status === "approved" && e.kind === "parent",
    )) {
      const match = direction === "ancestors" ? e.to_id : e.from_id;
      const next = direction === "ancestors" ? e.from_id : e.to_id;
      if (match === current && next !== id && !found.has(next)) {
        found.add(next);
        queue.push(next);
      }
    }
  }
  return found;
}

export function connection(
  from: string,
  to: string,
  people: Person[],
  edges: Relationship[],
) {
  if (from === to) return "This is your profile.";
  const visited = new Set([from]);
  const queue: { id: string; steps: string[] }[] = [{ id: from, steps: [] }];
  const names = new Map(people.map((p) => [p.id, p.name]));
  while (queue.length) {
    const current = queue.shift()!;
    for (const e of edges.filter((e) => e.status === "approved")) {
      if (e.from_id !== current.id && e.to_id !== current.id) continue;
      const next = e.from_id === current.id ? e.to_id : e.from_id;
      if (visited.has(next)) continue;
      visited.add(next);
      const label =
        e.kind === "partner"
          ? "partner"
          : e.from_id === current.id
            ? "child"
            : "parent";
      const steps = [
        ...current.steps,
        `${label}: ${names.get(next) ?? "Unknown"}${e.kind === "parent" && e.parent_type !== "unspecified" ? ` (${e.parent_type})` : ""}`,
      ];
      if (next === to) return steps.join(" → ");
      queue.push({ id: next, steps });
    }
  }
  return "No connection has been recorded yet.";
}

export function layout(people: Person[], edges: Relationship[]) {
  const approved = edges.filter(
    (e) => e.status === "approved" && e.kind === "parent",
  );
  const partners = edges.filter(
    (e) => e.status === "approved" && e.kind === "partner",
  );
  const hasParents = new Set(approved.map((e) => e.to_id));
  const level = new Map(people.map((p) => [p.id, 0]));
  // Bounded to remain safe if a restored database contains an invalid cycle.
  for (let i = 0; i < people.length; i++) {
    let changed = false;
    for (const e of approved) {
      if (!level.has(e.from_id) || !level.has(e.to_id)) continue;
      const next = Math.min(people.length, level.get(e.from_id)! + 1);
      if (next > level.get(e.to_id)!) {
        level.set(e.to_id, next);
        changed = true;
      }
    }
    // A partner with no recorded parents belongs alongside their partner,
    // not automatically in the oldest generation. Do not override known ancestry.
    for (const e of partners) {
      if (!level.has(e.from_id) || !level.has(e.to_id)) continue;
      for (const [id, partner] of [
        [e.from_id, e.to_id],
        [e.to_id, e.from_id],
      ]) {
        if (!hasParents.has(id) && level.get(id)! < level.get(partner)!) {
          level.set(id, level.get(partner)!);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  const columns = new Map<number, number>();
  return people.map((p) => {
    const row = level.get(p.id)!;
    const column = columns.get(row) ?? 0;
    columns.set(row, column + 1);
    return { ...p, x: 24 + column * 236, y: 28 + row * 144 };
  });
}
