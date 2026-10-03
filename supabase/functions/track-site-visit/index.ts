import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigin = () => Deno.env.get("SITE_ORIGIN") ?? "https://shidosaiga.github.io";
const corsHeaders = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin === allowedOrigin() ? origin : allowedOrigin(),
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
  "Vary": "Origin",
});
const jsonResponse = (body: unknown, status = 200, origin: string | null = null) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
});
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, origin);
  if (origin !== allowedOrigin()) return jsonResponse({ error: "Origin not allowed" }, 403, origin);

  try {
    const body = await request.json();
    const eventId = String(body.eventId ?? "");
    const visitorId = String(body.visitorId ?? "");
    const sessionId = String(body.sessionId ?? "");
    const eventType = String(body.eventType ?? "");
    if (!uuidPattern.test(eventId) || !uuidPattern.test(visitorId) || !uuidPattern.test(sessionId)
      || !["page_view", "engaged"].includes(eventType)) {
      return jsonResponse({ error: "Invalid analytics event" }, 400, origin);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: "Analytics is not configured" }, 500, origin);

    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { error } = await supabase.from("site_visit_events").upsert({
      event_id: eventId,
      visitor_id: visitorId,
      session_id: sessionId,
      event_type: eventType,
    }, { onConflict: "event_id", ignoreDuplicates: true });
    if (error) {
      console.error("track-site-visit insert failed", error.message);
      return jsonResponse({ error: "Could not record analytics event" }, 500, origin);
    }
    return jsonResponse({ ok: true }, 202, origin);
  } catch (error) {
    console.error("track-site-visit request failed", error);
    return jsonResponse({ error: "Invalid request" }, 400, origin);
  }
});
