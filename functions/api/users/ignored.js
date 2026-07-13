import { jsonResponse, requireAuthUser } from "../../_shared/auth.js";
import { fetchIgnoredProfileRows } from "../../_shared/ignored-users.js";

function toPublicIgnoredUser(row) {
  return {
    id: row.id,
    displayName: row.display_name || row.username || "Usuário Gimerr",
    username: row.username || "",
    avatarUrl: row.avatar_url || "",
  };
}

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireAuthUser(request, env);
    if (auth.error) return auth.error;

    const users = await fetchIgnoredProfileRows(env, auth.user.id);
    return jsonResponse({ users: users.map(toPublicIgnoredUser) });
  } catch (error) {
    console.error("ignored users list failed", error);
    return jsonResponse({ error: error?.message || "Falha ao carregar usuários ignorados." }, { status: 500 });
  }
}
