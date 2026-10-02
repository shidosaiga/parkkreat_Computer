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
    const form = await request.formData();
    const rawRequest = form.get("request");
    if (typeof rawRequest !== "string") return jsonResponse({ error: "ข้อมูลคำขอไม่ถูกต้อง" }, 400, origin);

    const input = JSON.parse(rawRequest);
    const customerName = String(input.customerName ?? "").trim().slice(0, 120);
    const phone = String(input.phone ?? "").trim().slice(0, 30);
    const device = String(input.device ?? "").trim().slice(0, 120);
    const symptoms = String(input.symptoms ?? "").trim().slice(0, 1200);
    const tasks = Array.isArray(input.tasks) ? input.tasks.slice(0, 10).map((value: unknown) => String(value).slice(0, 160)) : [];
    const programs = Array.isArray(input.programs) ? input.programs.slice(0, 10).map((value: unknown) => String(value).trim().slice(0, 120)) : [];
    const phoneDigits = phone.replace(/\D/g, "");

    if (!customerName || phoneDigits.length < 9 || phoneDigits.length > 15 || !symptoms) {
      return jsonResponse({ error: "กรุณากรอกชื่อ เบอร์โทรศัพท์ และอาการให้ถูกต้อง" }, 400, origin);
    }
    if (tasks.length !== (input.tasks?.length ?? 0) || programs.length !== (input.programs?.length ?? 0) || programs.some((name: string) => !name)) {
      return jsonResponse({ error: "รายการบริการไม่ถูกต้อง" }, 400, origin);
    }

    const files = form.getAll("photos").filter((value): value is File => value instanceof File && value.size > 0);
    const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
    if (files.length > 4 || files.some((file) => file.size > 5 * 1024 * 1024 || !allowedTypes.has(file.type))) {
      return jsonResponse({ error: "แนบได้ไม่เกิน 4 รูป รูปละไม่เกิน 5 MB และต้องเป็น JPG, PNG, WEBP หรือ GIF" }, 400, origin);
    }

    const taskTotal = tasks.length * 200;
    const programTotal = programs.length ? 200 + (programs.length - 1) * 100 : 0;
    const estimatedTotal = taskTotal + programTotal || 200;
    const dateCode = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const randomCode = Array.from(crypto.getRandomValues(new Uint8Array(10)), (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
    const ticketCode = `PK-${dateCode}-${randomCode}`;

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: "ระบบคิวไม่ได้ตั้งค่า Supabase" }, 500, origin);

    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { data: savedRequest, error: insertError } = await supabase
      .from("queue_requests")
      .insert({
        ticket_code: ticketCode,
        customer_name: customerName,
        phone,
        device,
        symptoms,
        tasks,
        programs,
        estimated_total: estimatedTotal,
        status: "WAIT",
      })
      .select("id, ticket_code, status, estimated_total, created_at")
      .single();

    if (insertError || !savedRequest) throw new Error("บันทึกคำขอไม่สำเร็จ");

    const uploadedPaths: string[] = [];
    for (const file of files) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80) || "image";
      const path = `${savedRequest.id}/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from("queue-photos")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) {
        await supabase.storage.from("queue-photos").remove(uploadedPaths);
        await supabase.from("queue_requests").delete().eq("id", savedRequest.id);
        throw new Error("อัปโหลดรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
      }
      uploadedPaths.push(path);
    }

    if (uploadedPaths.length) {
      const { error: photoUpdateError } = await supabase
        .from("queue_requests")
        .update({ photo_paths: uploadedPaths })
        .eq("id", savedRequest.id);
      if (photoUpdateError) {
        await supabase.storage.from("queue-photos").remove(uploadedPaths);
        await supabase.from("queue_requests").delete().eq("id", savedRequest.id);
        throw new Error("บันทึกรูปประกอบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
      }
    }

    return jsonResponse({ ...savedRequest, photo_count: uploadedPaths.length }, 200, origin);
  } catch (error) {
    console.error("submit-queue failed", error);
    const message = error instanceof Error ? error.message : "เกิดข้อผิดพลาดในการบันทึกคิว";
    return jsonResponse({ error: message }, 400, origin);
  }
});