function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers || {}),
    },
  });
}

export async function onRequestGet({ env }) {
  const rawSupabaseUrl = env.SUPABASE_URL
    || env.SUPABASE_API_URL
    || env.SUBABASE_API_URL
    || (env.SUPABASE_PROJECT_ID ? `https://${env.SUPABASE_PROJECT_ID}.supabase.co` : "");
  const supabaseAnonKey = env.SUPABASE_ANON_KEY;
  const supabaseUrl = rawSupabaseUrl?.replace(/\/rest\/v1\/?$/, "");

  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonResponse({ error: "Auth config missing" }, { status: 500 });
  }

  return jsonResponse({
    supabaseUrl,
    supabaseAnonKey,
  });
}
