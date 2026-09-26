import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { configured, rpc, supabase } from "./client";
import { connection, layout, relatives } from "./graph";
import type { Person, Relationship } from "./graph";
import "./style.css";

type Membership = {
  user_id: string;
  display_name: string;
  introduction: string;
  status: string;
  role: string;
};
type Claim = {
  id: string;
  user_id: string;
  person_id: string;
  reason: string;
  status: string;
};
type Sensitive = {
  person_id: string;
  cause_of_death: string;
  source_note: string;
};
type Snapshot = {
  membership: Membership | null;
  people?: Person[];
  relationships?: Relationship[];
  claims?: Claim[];
  members?: Membership[];
  sensitive?: Sensitive[];
  admin_verified?: boolean;
  audit?: { id: number; action: string; created_at: string }[];
};
type Run = (action: string, data?: Record<string, unknown>) => Promise<boolean>;
type TurnstileAPI = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
  reset: (id?: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileAPI;
  }
}
const formatDate = (value: string | null) =>
  value
    ? new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "Not recorded";
function values(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  return Object.fromEntries(new FormData(event.currentTarget));
}

function Captcha({
  onToken,
  reset,
}: {
  onToken: (token: string) => void;
  reset: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const sitekey = import.meta.env.VITE_TURNSTILE_SITE_KEY;
  useEffect(() => {
    if (!sitekey) return;
    let id: string | undefined;
    let disposed = false;
    const render = () => {
      if (!disposed && ref.current && window.turnstile)
        id = window.turnstile.render(ref.current, {
          sitekey,
          callback: onToken,
          "expired-callback": () => onToken(""),
          "error-callback": () => onToken(""),
        });
    };
    let script = document.querySelector<HTMLScriptElement>("#captcha-script");
    if (!script) {
      script = document.createElement("script");
      script.id = "captcha-script";
      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      document.head.append(script);
    }
    if (window.turnstile) render();
    else script.addEventListener("load", render);
    return () => {
      disposed = true;
      script?.removeEventListener("load", render);
      if (id) window.turnstile?.remove(id);
    };
  }, [sitekey, onToken, reset]);
  return sitekey ? <div ref={ref} /> : null;
}

function Login() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [captcha, setCaptcha] = useState("");
  const [reset, setReset] = useState(0);
  async function submit(e: FormEvent<HTMLFormElement>) {
    const fields = values(e);
    setBusy(true);
    setMessage("");
    try {
      if (sent) {
        const { error } = await supabase!.auth.verifyOtp({
          email: email.trim(),
          token: String(fields.code).trim(),
          type: "email",
        });
        if (error) throw error;
      } else {
        const { error } = await supabase!.auth.signInWithOtp({
          email: email.trim(),
          options: {
            shouldCreateUser: true,
            emailRedirectTo: `${window.location.origin}/`,
            captchaToken: captcha || undefined,
          },
        });
        if (error) throw error;
        setSent(true);
        setMessage(
          "Check your inbox and open the sign-in link. If the email includes a code, you can enter it here instead.",
        );
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Sign-in failed. Try again.",
      );
    } finally {
      setBusy(false);
      setCaptcha("");
      setReset((x) => x + 1);
    }
  }
  return (
    <main className="welcome">
      <section className="welcome-story">
        <span className="eyebrow">A place for all of us</span>
        <h1>
          Our names.
          <br />
          Our stories.
          <br />
          <em>Our family.</em>
        </h1>
        <p>
          One shared tree, built together. Find your place and help the next
          generation remember.
        </p>
        <div className="welcome-rule">Private family archive · Umuzi</div>
      </section>
      <section className="card login">
        <h2>{sent ? "Check your email" : "Welcome to Umuzi"}</h2>
        <p>
          {sent
            ? `Open the link sent to ${email}. If you received a code, enter it below.`
            : "Sign up or sign in with your email. No password to remember."}
        </p>
        <form onSubmit={submit}>
          <label>
            Email address
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              maxLength={254}
              disabled={sent || busy}
            />
          </label>
          {sent && (
            <label>
              One-time code (only if your email includes one)
              <input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6,10}"
                maxLength={10}
                required
                autoFocus
              />
            </label>
          )}
          {!sent && <Captcha onToken={setCaptcha} reset={reset} />}
          <button
            className="primary"
            disabled={
              busy ||
              (!sent && !!import.meta.env.VITE_TURNSTILE_SITE_KEY && !captcha)
            }
          >
            {busy
              ? "Please wait…"
              : sent
                ? "Verify code"
                : "Email me a sign-in link"}
          </button>
          {sent && (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setSent(false);
                setMessage("");
              }}
            >
              Use another email or resend
            </button>
          )}
        </form>
        <p role="status" className="notice">
          {message}
        </p>
        <p className="fine">
          New accounts need a family administrator’s approval before seeing
          anyone’s information. Signing up does not automatically claim a
          person’s profile.
        </p>
      </section>
    </main>
  );
}

function Security({ refresh }: { refresh: () => Promise<void> }) {
  const [factor, setFactor] = useState("");
  const [qr, setQr] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void supabase!.auth.mfa.listFactors().then(({ data, error }) => {
      if (error) setMessage(error.message);
      else setFactor(data.totp.find((f) => f.status === "verified")?.id ?? "");
    });
  }, []);
  async function enroll() {
    setBusy(true);
    setMessage("");
    // Restart only an unfinished enrollment from this app, never a verified factor.
    const existing = await supabase!.auth.mfa.listFactors();
    if (existing.error) {
      setMessage(existing.error.message);
      setBusy(false);
      return;
    }
    for (const pending of existing.data.all.filter(
      (f) =>
        f.factor_type === "totp" &&
        f.status === "unverified" &&
        f.friendly_name === "Umuzi administrator",
    )) {
      const removed = await supabase!.auth.mfa.unenroll({
        factorId: pending.id,
      });
      if (removed.error) {
        setMessage(removed.error.message);
        setBusy(false);
        return;
      }
    }
    const { data, error } = await supabase!.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Umuzi administrator",
    });
    if (error) setMessage(error.message);
    else {
      setFactor(data.id);
      setQr(data.totp.qr_code);
    }
    setBusy(false);
  }
  async function verify(e: FormEvent<HTMLFormElement>) {
    const fields = values(e);
    setBusy(true);
    const { error } = await supabase!.auth.mfa.challengeAndVerify({
      factorId: factor,
      code: String(fields.code),
    });
    if (error) setMessage(error.message);
    else {
      setQr("");
      await refresh();
    }
    setBusy(false);
  }
  return (
    <section className="card security">
      <h2>Administrator verification</h2>
      <p>
        Use an authenticator app before reviewing requests or viewing restricted
        information.
      </p>
      {!factor ? (
        <button onClick={enroll} disabled={busy}>
          Set up two-step verification
        </button>
      ) : (
        <form onSubmit={verify}>
          {qr && (
            <>
              <p>
                Scan this QR code with your authenticator app. Do not share it.
              </p>
              <img
                className="qr"
                src={
                  qr.startsWith("data:")
                    ? qr
                    : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr)}`
                }
                alt="Private authenticator setup QR code"
              />
            </>
          )}
          <label>
            Authenticator code
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              required
              maxLength={6}
            />
          </label>
          <button className="primary" disabled={busy}>
            Verify administrator session
          </button>
        </form>
      )}
      <p role="status">{message}</p>
    </section>
  );
}

function PersonForm({
  person,
  people,
  admin,
  run,
  done,
}: {
  person?: Person;
  people: Person[];
  admin: boolean;
  run: Run;
  done: () => void;
}) {
  const [name, setName] = useState(person?.name ?? "");
  const [deceased, setDeceased] = useState(person?.deceased ?? false);
  const [saving, setSaving] = useState(false);
  const matches = people.filter(
    (p) =>
      p.id !== person?.id &&
      name.trim().length > 1 &&
      (p.name.toLocaleLowerCase().includes(name.trim().toLocaleLowerCase()) ||
        name.trim().toLocaleLowerCase().includes(p.name.toLocaleLowerCase())),
  );
  async function save(e: FormEvent<HTMLFormElement>) {
    const fields = values(e);
    setSaving(true);
    const ok = await run("save_person", {
      ...fields,
      id: person?.id,
      updated_at: person?.updated_at,
      name,
      deceased,
      death_date: deceased ? fields.death_date : "",
      death_place: deceased ? fields.death_place : "",
    });
    setSaving(false);
    if (ok) done();
  }
  return (
    <section className="card form-card">
      <div className="section-heading">
        <h2>{person ? "Edit profile" : "Add a family member"}</h2>
        <button onClick={done} className="text-button">
          Cancel
        </button>
      </div>
      <p>
        Search for the person first. One person should have one profile, even if
        several relatives add information.
      </p>
      <form onSubmit={save}>
        <label>
          Full name
          <input
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={120}
            autoFocus
          />
        </label>
        {matches.length > 0 && (
          <div className="notice">
            <strong>Possible existing profiles</strong>
            <ul>
              {matches.slice(0, 8).map((p) => (
                <li key={p.id}>
                  {p.name} · {p.birth_place || "Birthplace not recorded"}
                  {p.birth_date ? ` · ${p.birth_date}` : ""}
                </li>
              ))}
            </ul>
            <p>
              Use an existing profile if this is the same person. Exact name
              matches require an administrator to confirm a distinct person.
            </p>
            {admin && (
              <label>
                Why is this a different person?
                <input name="distinct_reason" minLength={10} maxLength={300} />
              </label>
            )}
          </div>
        )}
        <div className="form-grid">
          <label>
            Date of birth <span>(optional)</span>
            <input
              type="date"
              name="birth_date"
              defaultValue={person?.birth_date ?? ""}
              max={new Date().toISOString().slice(0, 10)}
            />
          </label>
          <label>
            Place of birth
            <input
              name="birth_place"
              defaultValue={person?.birth_place}
              maxLength={160}
              placeholder="Town, region, country"
            />
          </label>
          <label>
            Tribe / community <span>(optional)</span>
            <input name="tribe" defaultValue={person?.tribe} maxLength={100} />
          </label>
          <label>
            Occupation / main work
            <input
              name="occupation"
              defaultValue={person?.occupation}
              maxLength={160}
            />
          </label>
        </div>
        <label>
          A little about this person
          <textarea
            name="biography"
            rows={4}
            maxLength={1000}
            defaultValue={person?.biography}
            placeholder="A short story, meaningful work, or something you want remembered."
          />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={deceased}
            onChange={(e) => setDeceased(e.target.checked)}
          />{" "}
          This person has passed away
        </label>
        {deceased && (
          <div className="form-grid">
            <label>
              Date of death <span>(optional)</span>
              <input
                type="date"
                name="death_date"
                defaultValue={person?.death_date ?? ""}
                max={new Date().toISOString().slice(0, 10)}
              />
            </label>
            <label>
              Place of death
              <input
                name="death_place"
                defaultValue={person?.death_place}
                maxLength={160}
              />
            </label>
          </div>
        )}
        <p className="fine">
          Only share details you have permission to share. Leave uncertain dates
          blank. Do not put medical information in this shared biography. Cause
          of death is restricted to administrators.
        </p>
        <button className="primary" disabled={saving}>
          {saving ? "Saving…" : "Save person"}
        </button>
      </form>
    </section>
  );
}

function Tree({
  people,
  edges,
  selected,
  choose,
}: {
  people: Person[];
  edges: Relationship[];
  selected: string;
  choose: (id: string) => void;
}) {
  const nodes = layout(people, edges);
  const [scale, setScale] = useState(1);
  const width = Math.max(680, ...nodes.map((p) => p.x + 226));
  const height = Math.max(430, ...nodes.map((p) => p.y + 126));
  return (
    <section className="tree-shell">
      <div className="tree-toolbar">
        <span>Our connections</span>
        <div>
          <button
            aria-label="Zoom out"
            onClick={() => setScale((s) => Math.max(0.5, s - 0.15))}
          >
            −
          </button>
          <span>{Math.round(scale * 100)}%</span>
          <button
            aria-label="Zoom in"
            onClick={() => setScale((s) => Math.min(1.6, s + 0.15))}
          >
            +
          </button>
        </div>
      </div>
      <div
        className="tree-scroll"
        tabIndex={0}
        aria-label="Family tree. Scroll to explore. A people list is also available."
      >
        <svg
          width={width * scale}
          height={height * scale}
          viewBox={`0 0 ${width} ${height}`}
          aria-label="Family relationships"
        >
          <defs>
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M0 0L10 5L0 10z" fill="#82978c" />
            </marker>
          </defs>
          {edges
            .filter((e) => e.status === "approved")
            .map((e) => {
              const a = nodes.find((p) => p.id === e.from_id),
                b = nodes.find((p) => p.id === e.to_id);
              if (!a || !b) return null;
              return e.kind === "parent" ? (
                <path
                  key={e.id}
                  d={`M${a.x + 102},${a.y + 82} C${a.x + 102},${a.y + 116} ${b.x + 102},${b.y - 34} ${b.x + 102},${b.y}`}
                  className="edge"
                  markerEnd="url(#arrow)"
                />
              ) : (
                <path
                  key={e.id}
                  d={`M${a.x + 102},${a.y} C${a.x + 102},${Math.min(a.y, b.y) - 26} ${b.x + 102},${Math.min(a.y, b.y) - 26} ${b.x + 102},${b.y}`}
                  className="edge partner"
                />
              );
            })}
          {nodes.map((p) => (
            <g
              key={p.id}
              transform={`translate(${p.x},${p.y})`}
              role="button"
              tabIndex={0}
              aria-label={`Open ${p.name}`}
              onClick={() => choose(p.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  choose(p.id);
                }
              }}
              className={`person-node ${selected === p.id ? "selected" : ""}`}
            >
              <title>{p.name}</title>
              <rect width="204" height="82" rx="14" />
              <text x="16" y="31" className="node-name">
                {p.name.length > 21 ? `${p.name.slice(0, 20)}…` : p.name}
              </text>
              <text x="16" y="56" className="node-meta">
                {p.birth_date?.slice(0, 4) ?? "Year unknown"}
                {p.deceased
                  ? ` — ${p.death_date?.slice(0, 4) ?? "Remembered"}`
                  : ""}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <p className="legend">
        <span>↘ Parent to child</span>
        <span>┄ Partner</span>
        <span>Only reviewed connections appear</span>
      </p>
    </section>
  );
}

function RelationshipForm({
  people,
  selected,
  run,
}: {
  people: Person[];
  selected: string;
  run: Run;
}) {
  const [kind, setKind] = useState("parent");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    const form = e.currentTarget;
    const fields = values(e);
    setBusy(true);
    if (await run("propose_relationship", fields)) {
      form.reset();
      setKind("parent");
    }
    setBusy(false);
  }
  return (
    <details className="details-form">
      <summary>Connect two people</summary>
      <form onSubmit={submit}>
        <label>
          Connection
          <select
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="parent">Parent → child</option>
            <option value="partner">Partners</option>
          </select>
        </label>
        <label>
          {kind === "parent" ? "Parent" : "First person"}
          <select name="from_id" defaultValue={selected} required>
            <option value="">Choose a person</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ·{" "}
                {p.birth_date?.slice(0, 4) || p.birth_place || "date unknown"}
              </option>
            ))}
          </select>
        </label>
        <label>
          {kind === "parent" ? "Child" : "Partner"}
          <select name="to_id" required>
            <option value="">Choose a person</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ·{" "}
                {p.birth_date?.slice(0, 4) || p.birth_place || "date unknown"}
              </option>
            ))}
          </select>
        </label>
        {kind === "parent" && (
          <label>
            Parent relationship
            <select name="parent_type">
              <option value="unspecified">Not specified</option>
              <option value="biological">Biological</option>
              <option value="adoptive">Adoptive</option>
              <option value="step">Step-parent</option>
            </select>
          </label>
        )}
        <p className="fine">
          An administrator will review this connection before it appears on the
          tree.
        </p>
        <button disabled={busy}>Submit connection</button>
      </form>
    </details>
  );
}

function Profile({
  person,
  snapshot,
  own,
  run,
  edit,
}: {
  person: Person;
  snapshot: Snapshot;
  own?: string;
  run: Run;
  edit: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const people = snapshot.people ?? [],
    edges = snapshot.relationships ?? [];
  const claim = snapshot.claims?.find(
    (c) =>
      c.user_id === snapshot.membership?.user_id &&
      (c.status === "pending" || c.status === "approved"),
  );
  const restricted = snapshot.sensitive?.find((p) => p.person_id === person.id);
  const ancestors = relatives(person.id, edges, "ancestors");
  const places = new Set(
    people
      .filter((p) => ancestors.has(p.id) || p.id === person.id)
      .map((p) => p.birth_place.trim())
      .filter(Boolean),
  );
  async function submitClaim(e: FormEvent<HTMLFormElement>) {
    const data = values(e);
    setBusy(true);
    await run("claim_profile", { ...data, person_id: person.id });
    setBusy(false);
  }
  async function saveSensitive(e: FormEvent<HTMLFormElement>) {
    const data = values(e);
    setBusy(true);
    await run("save_sensitive", { ...data, person_id: person.id });
    setBusy(false);
  }
  return (
    <aside className="card profile" id="person-details" tabIndex={-1}>
      <div className="avatar">
        {person.name
          .split(" ")
          .slice(0, 2)
          .map((n) => n[0])
          .join("")}
      </div>
      <span className="eyebrow">
        {own === person.id
          ? "Your profile"
          : person.deceased
            ? "In remembrance"
            : "Family profile"}
      </span>
      <h2>{person.name}</h2>
      <p>{person.occupation || "A story waiting to be told."}</p>
      {(own === person.id || snapshot.admin_verified) && (
        <button onClick={edit}>Edit profile</button>
      )}
      <dl>
        <dt>Born</dt>
        <dd>{formatDate(person.birth_date)}</dd>
        <dt>Birthplace</dt>
        <dd>{person.birth_place || "Not recorded"}</dd>
        <dt>Tribe / community</dt>
        <dd>{person.tribe || "Not recorded"}</dd>
        {person.deceased && (
          <>
            <dt>Passed away</dt>
            <dd>
              {formatDate(person.death_date)}
              {person.death_place && ` · ${person.death_place}`}
            </dd>
          </>
        )}
      </dl>
      {person.biography && <p className="biography">{person.biography}</p>}
      <h3>What we know so far</h3>
      <div className="profile-stats">
        <span>
          <strong>{ancestors.size}</strong>Recorded ancestors
        </span>
        <span>
          <strong>{relatives(person.id, edges, "descendants").size}</strong>
          Recorded descendants
        </span>
        <span>
          <strong>{places.size}</strong>Birthplaces in this line
        </span>
      </div>
      <p className="fine">
        Based only on reviewed connections and entered details, including
        adoptive and step-parent links. Not a prediction or complete ancestry
        record.
      </p>
      {own && (
        <>
          <h3>Your connection</h3>
          <p>{connection(own, person.id, people, edges)}</p>
        </>
      )}
      {!own && !claim && !person.deceased && (
        <details>
          <summary>Is this you? Claim this profile</summary>
          <form onSubmit={submitClaim}>
            <label>
              How can an administrator confirm this is you?
              <textarea
                name="reason"
                minLength={5}
                maxLength={300}
                required
                placeholder="Mention a relative who knows you. Do not share identity documents."
              />
            </label>
            <button disabled={busy}>Request profile claim</button>
          </form>
          <p className="fine">
            Claiming lets you edit this profile after approval. It does not
            grant administrator access.
          </p>
        </details>
      )}
      {claim?.status === "pending" && (
        <p className="notice">Your profile claim is waiting for review.</p>
      )}
      <RelationshipForm
        key={person.id}
        people={people}
        selected={person.id}
        run={run}
      />
      {snapshot.admin_verified && person.deceased && (
        <details>
          <summary>Restricted death information</summary>
          <form onSubmit={saveSensitive}>
            <label>
              Cause of death
              <textarea
                name="cause_of_death"
                maxLength={500}
                defaultValue={restricted?.cause_of_death}
              />
            </label>
            <label>
              Source and permission note
              <textarea
                name="source_note"
                minLength={5}
                maxLength={300}
                defaultValue={restricted?.source_note}
              />
            </label>
            <p className="fine">
              Visible only to verified administrators. Record only with a
              legitimate reason and appropriate permission. Blank cause removes
              this restricted record.
            </p>
            <button disabled={busy}>Save restricted details</button>
          </form>
        </details>
      )}
    </aside>
  );
}

function Admin({
  snapshot,
  run,
  busy,
}: {
  snapshot: Snapshot;
  run: Run;
  busy: boolean;
}) {
  const [confirm, setConfirm] = useState<{
    action: string;
    data: Record<string, unknown>;
    label: string;
  } | null>(null);
  const people = new Map(snapshot.people?.map((p) => [p.id, p.name]));
  const members = new Map(
    snapshot.members?.map((p) => [p.user_id, p.display_name]),
  );
  return (
    <section className="admin-grid">
      <div className="card">
        <h2>Account access</h2>
        <p>
          Confirm the person through a relative you already trust. An email
          address or a familiar name alone is not proof.
        </p>
        {snapshot.members?.map((m) => (
          <div className="review-item" key={m.user_id}>
            <strong>{m.display_name}</strong>
            <span>
              {m.status} · {m.role}
            </span>
            <p>{m.introduction}</p>
            <code className="fine">Account {m.user_id.slice(0, 8)}</code>
            {m.user_id !== snapshot.membership?.user_id && (
              <div className="actions">
                {m.status !== "approved" && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      setConfirm({
                        action: "update_membership",
                        data: {
                          user_id: m.user_id,
                          status: "approved",
                          role: "member",
                        },
                        label: `Approve access for ${m.display_name}?`,
                      })
                    }
                  >
                    Approve access
                  </button>
                )}
                {m.status === "pending" && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      setConfirm({
                        action: "update_membership",
                        data: {
                          user_id: m.user_id,
                          status: "rejected",
                          role: "member",
                        },
                        label: `Decline access for ${m.display_name}?`,
                      })
                    }
                  >
                    Decline
                  </button>
                )}
                {m.status === "approved" && (
                  <>
                    <button
                      disabled={busy}
                      onClick={() =>
                        setConfirm({
                          action: "update_membership",
                          data: {
                            user_id: m.user_id,
                            status: "suspended",
                            role: "member",
                          },
                          label: `Suspend ${m.display_name}? Their existing contributions will remain.`,
                        })
                      }
                    >
                      Suspend
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        setConfirm({
                          action: "update_membership",
                          data: {
                            user_id: m.user_id,
                            status: "approved",
                            role: m.role === "admin" ? "member" : "admin",
                          },
                          label: `${m.role === "admin" ? "Remove administrator privileges from" : "Give administrator privileges to"} ${m.display_name}? Administrators can approve accounts and view restricted information.`,
                        })
                      }
                    >
                      {m.role === "admin" ? "Remove admin" : "Make admin"}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="card">
        <h2>Profile claims</h2>
        <p>
          Verify that the account belongs to this person before approving. One
          account, one person.
        </p>
        {!snapshot.claims?.some((c) =>
          ["pending", "approved"].includes(c.status),
        ) && <p className="empty-small">No claims to review.</p>}
        {snapshot.claims
          ?.filter((c) => ["pending", "approved"].includes(c.status))
          .map((c) => (
            <div className="review-item" key={c.id}>
              <strong>
                {members.get(c.user_id)} → {people.get(c.person_id)}
              </strong>
              <p>{c.reason}</p>
              <span>{c.status}</span>
              <div className="actions">
                {c.status === "pending" && (
                  <>
                    <button
                      disabled={busy}
                      onClick={() =>
                        setConfirm({
                          action: "review_claim",
                          data: { id: c.id, status: "approved" },
                          label: `Link ${members.get(c.user_id)} to ${people.get(c.person_id)}? Confirm this identity outside the app first.`,
                        })
                      }
                    >
                      Approve claim
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run("review_claim", {
                          id: c.id,
                          status: "rejected",
                        })
                      }
                    >
                      Decline
                    </button>
                  </>
                )}
                {c.status === "approved" && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      setConfirm({
                        action: "review_claim",
                        data: { id: c.id, status: "revoked" },
                        label:
                          "Revoke this profile claim? The person’s record will remain.",
                      })
                    }
                  >
                    Revoke claim
                  </button>
                )}
              </div>
            </div>
          ))}
      </div>
      <div className="card">
        <h2>Connections</h2>
        {!snapshot.relationships?.length && (
          <p className="empty-small">No connections to review.</p>
        )}
        {snapshot.relationships?.map((r) => (
          <div className="review-item" key={r.id}>
            <strong>
              {people.get(r.from_id)} → {people.get(r.to_id)}
            </strong>
            <p>
              {r.kind === "parent"
                ? `${r.parent_type} parent → child`
                : "Partners"}{" "}
              · {r.status}
            </p>
            <div className="actions">
              {r.status !== "approved" && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void run("review_relationship", {
                      id: r.id,
                      status: "approved",
                    })
                  }
                >
                  Approve
                </button>
              )}
              {r.status !== "rejected" && (
                <button
                  disabled={busy}
                  onClick={() =>
                    setConfirm({
                      action: "review_relationship",
                      data: { id: r.id, status: "rejected" },
                      label:
                        "Remove this connection from the tree? The people will remain.",
                    })
                  }
                >
                  Decline / remove
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="card">
        <h2>Recent activity</h2>
        <p className="fine">
          Latest 50 changes. Full audit history stays in the database; profile
          text and medical details are not copied into this log.
        </p>
        {snapshot.audit?.map((a) => (
          <div className="audit-item" key={a.id}>
            <span>{a.action.replaceAll("_", " ")}</span>
            <time>{new Date(a.created_at).toLocaleString()}</time>
          </div>
        ))}
      </div>
      {confirm && (
        <div
          className="confirm"
          role="alertdialog"
          aria-modal="false"
          aria-labelledby="confirm-title"
        >
          <h3 id="confirm-title">{confirm.label}</h3>
          <div className="actions">
            <button
              className="primary"
              disabled={busy}
              autoFocus
              onClick={async () => {
                if (await run(confirm.action, confirm.data)) setConfirm(null);
              }}
            >
              Confirm
            </button>
            <button onClick={() => setConfirm(null)}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}

function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState("tree");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  function choosePerson(id: string) {
    setSelected(id);
    window.requestAnimationFrame(() => {
      if (window.matchMedia("(max-width: 1000px)").matches) {
        document.getElementById("person-details")?.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
          block: "start",
        });
      }
    });
  }
  const [form, setForm] = useState<"new" | "edit" | null>(null);
  const requestVersion = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const data = (await rpc("snapshot")) as Snapshot;
      if (version === requestVersion.current) {
        setSnapshot(data);
        setError("");
      }
    } catch (e) {
      if (version === requestVersion.current) {
        setSnapshot(null);
        setError(
          e instanceof Error ? e.message : "Unable to load your family.",
        );
      }
    }
  }, []);
  useEffect(() => {
    if (!supabase) {
      setSession(null);
      return;
    }
    void supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      ++requestVersion.current;
      setSession(next);
      if (!next) {
        setSnapshot(null);
        setForm(null);
        setSelected("");
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (session) void refresh();
  }, [session, refresh]);
  useEffect(() => {
    if (!session) return;
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    const interval = window.setInterval(focus, 60000);
    return () => {
      window.removeEventListener("focus", focus);
      window.clearInterval(interval);
    };
  }, [session, refresh]);
  const run: Run = async (action, data = {}) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await rpc(action, data);
      await refresh();
      setMessage("Saved.");
      return true;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Nothing was saved. Please try again.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  };
  const people = snapshot?.people ?? [],
    edges = snapshot?.relationships ?? [];
  const own = snapshot?.claims?.find(
    (c) => c.user_id === session?.user.id && c.status === "approved",
  )?.person_id;
  const person = people.find((p) => p.id === selected);
  const filtered = people.filter((p) =>
    `${p.name} ${p.birth_place} ${p.tribe} ${p.occupation}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  const approved = snapshot?.membership?.status === "approved";
  async function signOut() {
    const { error } = await supabase!.auth.signOut({ scope: "local" });
    if (error)
      setError(
        "Could not sign out. Close this browser window to end the local session.",
      );
  }
  return (
    <>
      <header className="topbar">
        <a className="brand" href="/" aria-label="Umuzi home">
          <span>U</span>umuzi
          <span className="brand-caption">Our family, connected.</span>
        </a>
        {session && (
          <div className="account">
            <span>
              {snapshot?.membership?.display_name || "Family account"}
            </span>
            <button onClick={() => void signOut()}>Sign out</button>
          </div>
        )}
      </header>
      {!configured ? (
        <main className="setup card">
          <span className="eyebrow">Umuzi is ready for setup</span>
          <h1>
            A private place
            <br />
            for your family.
          </h1>
          <p>
            The app is not connected to a database yet. No family information is
            displayed or collected.
          </p>
          <ol>
            <li>
              Create the Supabase project and apply the included database
              migration.
            </li>
            <li>
              Add the public project URL and publishable key in the deployment
              settings.
            </li>
            <li>
              Follow the deployment guide to configure email sign-in and the
              first administrator.
            </li>
          </ol>
          <p className="fine">
            Private keys never belong in the app or repository.
          </p>
        </main>
      ) : session === undefined ? (
        <main className="loading" role="status">
          Opening Umuzi…
        </main>
      ) : !session ? (
        <Login />
      ) : (
        <main className="workspace">
          {error && (
            <div className="error" role="alert">
              {error}
              <button onClick={() => void refresh()}>Retry</button>
            </div>
          )}
          {message && (
            <div className="success" role="status">
              {message}
              <button
                aria-label="Dismiss message"
                onClick={() => setMessage("")}
              >
                ×
              </button>
            </div>
          )}
          {!snapshot ? (
            <p role="status">
              {error
                ? "Family information is unavailable."
                : "Loading your account…"}
            </p>
          ) : !snapshot.membership ? (
            <section className="card access">
              <span className="eyebrow">One more step</span>
              <h1>Introduce yourself</h1>
              <p>
                A family administrator will review your request. You won’t see
                the tree until you’re approved.
              </p>
              <form
                onSubmit={async (e) => {
                  const data = values(e);
                  await run("request_access", data);
                }}
              >
                <label>
                  Your full name
                  <input name="name" required maxLength={100} />
                </label>
                <label>
                  Who connects you to this family?
                  <textarea
                    name="introduction"
                    required
                    maxLength={300}
                    placeholder="A parent, grandparent, or relative who can confirm who you are."
                  />
                </label>
                <button className="primary" disabled={busy}>
                  Request access
                </button>
              </form>
            </section>
          ) : !approved ? (
            <section className="card access">
              <span className="eyebrow">Your family stays private</span>
              <h1>
                {snapshot.membership.status === "pending"
                  ? "Your request is with the family."
                  : "Your account does not have access."}
              </h1>
              <p>
                {snapshot.membership.status === "pending"
                  ? "An administrator needs to approve you before you can view the tree or claim a profile."
                  : "Please contact a family administrator you know personally."}
              </p>
              <button onClick={() => void refresh()}>Check approval</button>
            </section>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">Our shared story</span>
                  <h1>The family tree</h1>
                  <p>
                    {people.length} {people.length === 1 ? "person" : "people"}{" "}
                    · {edges.filter((e) => e.status === "approved").length}{" "}
                    reviewed connections
                  </p>
                </div>
                <button
                  className="primary"
                  onClick={() => {
                    setForm("new");
                    setView("tree");
                  }}
                >
                  + Add a person
                </button>
              </div>
              <div className="controls">
                <nav aria-label="Family views">
                  <button
                    className={view === "tree" ? "active" : ""}
                    onClick={() => setView("tree")}
                  >
                    Tree
                  </button>
                  <button
                    className={view === "people" ? "active" : ""}
                    onClick={() => setView("people")}
                  >
                    People
                  </button>
                  {snapshot.membership.role === "admin" && (
                    <button
                      className={view === "admin" ? "active" : ""}
                      onClick={() => setView("admin")}
                    >
                      Admin
                    </button>
                  )}
                </nav>
                <label className="search">
                  <span className="sr-only">Search family members</span>
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      if (e.target.value) setView("people");
                    }}
                    placeholder="Search names, places, communities…"
                  />
                </label>
                <button
                  onClick={() => {
                    setView("people");
                    setQuery("");
                    if (own) choosePerson(own);
                    else
                      setMessage(
                        "Search for your name below. Open your profile and choose “Is this you?” If it is missing, add it once, then request a claim.",
                      );
                  }}
                >
                  {own ? "My profile" : "Find myself"}
                </button>
              </div>
              {form && (
                <PersonForm
                  key={`${form}-${person?.id || ""}`}
                  person={form === "edit" ? person : undefined}
                  people={people}
                  admin={!!snapshot.admin_verified}
                  run={run}
                  done={() => setForm(null)}
                />
              )}{" "}
              {view === "admin" ? (
                snapshot.admin_verified ? (
                  <Admin snapshot={snapshot} run={run} busy={busy} />
                ) : (
                  <Security refresh={refresh} />
                )
              ) : people.length === 0 ? (
                <section className="card empty">
                  <span className="empty-mark">U</span>
                  <h2>Every family tree starts with a name.</h2>
                  <p>
                    Add yourself or a relative. Then connect parents, children,
                    and partners.
                  </p>
                  <button onClick={() => setForm("new")}>
                    Add the first person
                  </button>
                </section>
              ) : (
                <div
                  className={`family-layout ${person ? "with-profile" : ""}`}
                >
                  <div>
                    {view === "tree" ? (
                      <Tree
                        people={people}
                        edges={edges}
                        selected={selected}
                        choose={choosePerson}
                      />
                    ) : (
                      <section className="people-grid">
                        {filtered.map((p) => (
                          <button
                            className={`person-card ${p.id === selected ? "active" : ""}`}
                            key={p.id}
                            onClick={() => choosePerson(p.id)}
                          >
                            <span className="mini-avatar">{p.name[0]}</span>
                            <strong>{p.name}</strong>
                            <span>
                              {p.birth_place || "Birthplace not recorded"}
                            </span>
                            <span className="fine">
                              {p.birth_date?.slice(0, 4) || "Year unknown"}
                              {p.deceased ? " · Remembered" : ""}
                            </span>
                          </button>
                        ))}
                        {filtered.length === 0 && (
                          <p className="card">
                            No matching profiles. Try a different spelling
                            before adding someone new.
                          </p>
                        )}
                      </section>
                    )}
                  </div>
                  {person && (
                    <Profile
                      key={person.id}
                      person={person}
                      snapshot={snapshot}
                      own={own}
                      run={run}
                      edit={() => setForm("edit")}
                    />
                  )}
                </div>
              )}
            </>
          )}
        </main>
      )}
      <footer>
        Umuzi · A shared family archive{" "}
        <span>Private to approved family members. Please share with care.</span>
      </footer>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
