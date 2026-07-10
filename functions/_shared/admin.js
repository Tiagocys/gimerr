import { getSupabaseRestUrl, jsonResponse, requireAuthUser } from "./auth.js";

export function getServiceHeaders(env, extra = {}) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY ausente.");
  }

  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
    accept: "application/json",
    ...extra,
  };
}

export async function requireAdminUser(request, env) {
  const auth = await requireAuthUser(request, env);
  if (auth.error) return auth;

  const url = new URL(`${getSupabaseRestUrl(env)}/profiles`);
  url.searchParams.set("select", "id,display_name,username,is_admin");
  url.searchParams.set("id", `eq.${auth.user.id}`);
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    headers: getServiceHeaders(env),
  });
  const rows = await response.json().catch(() => []);

  if (!response.ok) {
    return {
      error: jsonResponse({ error: "Não foi possível validar o administrador." }, { status: 500 }),
    };
  }

  const profile = rows[0];
  if (Number(profile?.is_admin || 0) !== 1) {
    return {
      error: jsonResponse({ error: "Acesso restrito a administradores." }, { status: 403 }),
    };
  }

  return {
    ...auth,
    profile,
  };
}
