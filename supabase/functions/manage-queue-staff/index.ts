import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigin = Deno.env.get("SITE_ORIGIN") ?? "https://shidosaiga.github.io";
const corsHeaders = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin === allowedOrigin ? origin : allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
  "Vary": "Origin",
});
const jsonResponse = (body: unknown, status = 200, origin: string | null = null) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
});

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, origin);
  if (origin !== allowedOrigin) return jsonResponse({ error: "Origin not allowed" }, 403, origin);

  const authorization = request.headers.get("Authorization") ?? "";
  const accessToken = authorization.replace(/^Bearer\s+/i, "");
  if (!accessToken) return jsonResponse({ error: "Sign in required" }, 401, origin);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) return jsonResponse({ error: "Function is not configured" }, 500, origin);

    const caller = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const { data: userData, error: userError } = await caller.auth.getUser(accessToken);
    if (userError || !userData.user) return jsonResponse({ error: "Session expired" }, 401, origin);
    const { data: isOwner, error: ownerError } = await caller.rpc("is_queue_owner");
    if (ownerError || isOwner !== true) return jsonResponse({ error: "Owner permission required" }, 403, origin);

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const body = await request.json();
    const action = String(body.action ?? "list");

    if (action === "list") {
      const [usersResult, membershipsResult] = await Promise.all([
        admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
        admin.from("queue_admins").select("user_id,role,created_at"),
      ]);
      if (usersResult.error) throw usersResult.error;
      if (membershipsResult.error) throw membershipsResult.error;
      const memberships = new Map((membershipsResult.data ?? []).map((row) => [row.user_id, row]));
      const accounts = usersResult.data.users.filter((user) => user.user_metadata?.account_type === "technician" || memberships.has(user.id)).map((user) => {
        const membership = memberships.get(user.id);
        return {
          id: user.id,
          email: user.email ?? "",
          created_at: user.created_at,
          email_confirmed: Boolean(user.email_confirmed_at),
          role: membership?.role ?? "pending",
        };
      });
      return jsonResponse({ accounts }, 200, origin);
    }

    const userId = String(body.userId ?? "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
      return jsonResponse({ error: "Invalid account" }, 400, origin);
    }
    if (userId === userData.user.id) return jsonResponse({ error: "You cannot change your own owner account" }, 400, origin);

    const [{ data: targetResult, error: targetError }, { data: membership, error: membershipError }] = await Promise.all([
      admin.auth.admin.getUserById(userId),
      admin.from("queue_admins").select("role").eq("user_id", userId).maybeSingle(),
    ]);
    if (targetError || membershipError || !targetResult.user) {
      return jsonResponse({ error: "Technician account not found" }, 404, origin);
    }
    if (action === "approve") {
      if (targetResult.user.user_metadata?.account_type !== "technician") return jsonResponse({ error: "Not a technician signup" }, 403, origin);
      if (!targetResult.user.email_confirmed_at) return jsonResponse({ error: "Technician must confirm their email first" }, 409, origin);
      const { error } = await admin.from("queue_admins").upsert({ user_id: userId, role: "technician" }, { onConflict: "user_id" });
      if (error) throw error;
      return jsonResponse({ ok: true }, 200, origin);
    }
    if (action === "revoke") {
      if (membership?.role === "owner") return jsonResponse({ error: "Owner account cannot be revoked here" }, 403, origin);
      if (membership?.role !== "technician" && targetResult.user.user_metadata?.account_type !== "technician") return jsonResponse({ error: "Not a technician account" }, 403, origin);
      const { error } = await admin.from("queue_admins").delete().eq("user_id", userId);
      if (error) throw error;
      return jsonResponse({ ok: true }, 200, origin);
    }
    return jsonResponse({ error: "Unsupported action" }, 400, origin);
  } catch (error) {
    console.error("manage-queue-staff failed", error instanceof Error ? error.message : "unknown error");
    return jsonResponse({ error: "Could not manage technician accounts" }, 500, origin);
  }
});
