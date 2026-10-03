import { createClient } from "npm:@supabase/supabase-js@2";

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

Deno.serve(async (request) => {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: "Cleanup is not configured" }, 500);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: expiredRequests, error: queryError } = await supabase
    .from("queue_requests")
    .select("id, photo_paths, delete_after_at")
    .in("status", ["CANCEL", "FINISH"])
    .not("delete_after_at", "is", null)
    .lte("delete_after_at", new Date().toISOString())
    .order("delete_after_at", { ascending: true })
    .limit(100);

  if (queryError) {
    console.error("cleanup-cancelled-queue query failed", queryError.message);
    return jsonResponse({ error: "Could not load expired cancelled requests" }, 500);
  }

  let deletedRequests = 0;
  let failedRequests = 0;
  for (const queueRequest of expiredRequests ?? []) {
    const paths = Array.isArray(queueRequest.photo_paths) ? queueRequest.photo_paths : [];
    if (paths.length) {
      const { error: storageError } = await supabase.storage.from("queue-photos").remove(paths);
      if (storageError) {
        failedRequests++;
        console.error("cleanup-cancelled-queue storage removal failed", queueRequest.id, storageError.message);
        continue;
      }
    }

    const { data: deleted, error: deleteError } = await supabase
      .from("queue_requests")
      .delete()
      .eq("id", queueRequest.id)
      .in("status", ["CANCEL", "FINISH"])
      .eq("delete_after_at", queueRequest.delete_after_at)
      .select("id")
      .maybeSingle();

    if (deleteError) {
      failedRequests++;
      console.error("cleanup-cancelled-queue row removal failed", queueRequest.id, deleteError.message);
      continue;
    }
    if (deleted) deletedRequests++;
  }

  return jsonResponse({
    ok: true,
    processed: expiredRequests?.length ?? 0,
    deleted: deletedRequests,
    failed: failedRequests,
  });
});
