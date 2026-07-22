import { getSupabaseUrl, jsonResponse } from "../_shared/auth.js";

export async function onRequestGet({ request, env }) {
  const supabaseUrl = getSupabaseUrl(env);
  const supabaseAnonKey = env.SUPABASE_ANON_KEY;
  const authorization = request.headers.get("authorization") || "";

  if (!supabaseUrl || !supabaseAnonKey || !authorization.toLowerCase().startsWith("bearer ")) {
    return jsonResponse({ authenticated: false });
  }

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: supabaseAnonKey,
        authorization,
      },
    });

    const user = await response.json().catch(() => null);
    if (!response.ok || !user?.id) {
      return jsonResponse({ authenticated: false });
    }

    return jsonResponse({
      authenticated: true,
      user,
    });
  } catch {
    return jsonResponse({ authenticated: false });
  }
}
