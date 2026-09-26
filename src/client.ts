import { createClient } from "@supabase/supabase-js";
const url = import.meta.env.VITE_SUPABASE_URL ?? "";
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
export const configured =
  /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) &&
  key.startsWith("sb_publishable_") &&
  !key.includes("REPLACE_ME");
// Deliberately rejects secret/service-role keys. No private backend credential is needed.
export const supabase = configured
  ? createClient(url, key, {
      auth: {
        storage: window.sessionStorage,
        persistSession: true,
        autoRefreshToken: true,
        // The default Supabase emails link back to this browser-only app.
        detectSessionInUrl: true,
        flowType: "implicit",
      },
    })
  : null;
export async function rpc(
  action: string,
  payload: Record<string, unknown> = {},
) {
  if (!supabase) throw new Error("Umuzi is not connected to its database yet.");
  const { data, error } = await supabase.rpc("umuzi", {
    p_action: action,
    p_payload: payload,
  });
  if (error) {
    const friendly: Record<string, string> = {
      "23514": "Check the dates and field lengths, then try again.",
      "23503":
        "That person or account no longer exists. Refresh and try again.",
      "23502": "Please complete the required fields.",
    };
    throw new Error(friendly[error.code] ?? error.message);
  }
  return data;
}
