import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin === (Deno.env.get("SITE_ORIGIN") ?? "https://shidosaiga.github.io")
    ? origin
    : "https://shidosaiga.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

  try {
    const input = await request.json();
    const phone = String(input.phone ?? "").trim().slice(0, 30);
    const ticketCode = String(input.ticketCode ?? "").trim().slice(0, 64);
    if (phone.replace(/\D/g, "").length < 9) return jsonResponse({ error: "กรุณากรอกเบอร์โทรที่ใช้เปิดคิว" }, 400, origin);
    if (ticketCode && !/^PK-\d{8}-[A-F0-9]{20}$/i.test(ticketCode)) return jsonResponse({ error: "รูปแบบรหัสคิวไม่ถูกต้อง" }, 400, origin);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: "ระบบคิวไม่ได้ตั้งค่า Supabase" }, 500, origin);

    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    if (!ticketCode) {
      const { data, error } = await supabase.rpc("lookup_queue_tickets", { p_phone: phone });
      if (error) throw new Error("ค้นหาคิวไม่สำเร็จ");
      return jsonResponse({ queues: Array.isArray(data) ? data : [] }, 200, origin);
    }

    const { data, error } = await supabase.rpc("lookup_queue_status", {
      p_phone: phone,
      p_ticket_code: ticketCode,
    });
    if (error) throw new Error("ค้นหาคิวไม่สำเร็จ");

    const queue = Array.isArray(data) ? data[0] : null;
    if (!queue) return jsonResponse({ error: "ไม่พบคิว กรุณาตรวจสอบเบอร์โทรและรหัสคิว" }, 404, origin);
    return jsonResponse(queue, 200, origin);
  } catch (error) {
    console.error("lookup-queue failed", error);
    return jsonResponse({ error: "ไม่สามารถค้นหาคิวได้ในขณะนี้" }, 400, origin);
  }
});
