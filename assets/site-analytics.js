(() => {
  const config = window.SUPABASE_CONFIG;
  if (!config?.url || !config?.anonKey) return;

  const params = new URLSearchParams(window.location.search);
  const hash = window.location.hash.toLowerCase();
  if (hash === "#staff" || params.has("flow") || params.has("code")
    || hash.includes("access_token") || hash.includes("error=")) return;

  const getId = (storage, key) => {
    try {
      const current = storage.getItem(key);
      if (current && /^[0-9a-f-]{36}$/i.test(current)) return current;
      const next = crypto.randomUUID();
      storage.setItem(key, next);
      return next;
    } catch {
      return crypto.randomUUID();
    }
  };

  const visitorId = getId(window.localStorage, "pk-workshop-visitor-id");
  const sessionId = getId(window.sessionStorage, "pk-workshop-session-id");
  const endpoint = `${config.url.replace(/\/$/, "")}/functions/v1/track-site-visit`;

  const record = (eventType, eventId) => {
    fetch(endpoint, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      keepalive: true,
      headers: {
        apikey: config.anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ eventId, visitorId, sessionId, eventType }),
    }).catch(() => {});
  };

  record("page_view", crypto.randomUUID());

  let engaged = false;
  const markEngaged = () => {
    if (engaged) return;
    engaged = true;
    const engagementId = getId(window.sessionStorage, "pk-workshop-engagement-event-id");
    record("engaged", engagementId);
  };

  document.addEventListener("pointerdown", markEngaged, { once: true, passive: true });
  document.addEventListener("keydown", markEngaged, { once: true });
  window.setTimeout(() => {
    if (document.visibilityState === "visible") markEngaged();
  }, 15000);
})();
