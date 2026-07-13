import { getSupabaseRestUrl, jsonResponse, requireAuthUser } from "../../_shared/auth.js";
import { getServiceHeaders } from "../../_shared/admin.js";
import { cleanProfileId } from "../../_shared/ignored-users.js";

async function upsertIgnoredUser(env, profileId, ignoredProfileId) {
  const response = await fetch(`${getSupabaseRestUrl(env)}/user_ignored_profiles?on_conflict=profile_id,ignored_profile_id`, {
    method: "POST",
    headers: getServiceHeaders(env, { prefer: "resolution=ignore-duplicates,return=minimal" }),
    body: JSON.stringify({
      profile_id: profileId,
      ignored_profile_id: ignoredProfileId,
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || "Não foi possível ignorar este usuário.");
  }
}

async function deleteIgnoredUser(env, profileId, ignoredProfileId) {
  const url = new URL(`${getSupabaseRestUrl(env)}/user_ignored_profiles`);
  url.searchParams.set("profile_id", `eq.${profileId}`);
  url.searchParams.set("ignored_profile_id", `eq.${ignoredProfileId}`);

  const response = await fetch(url.toString(), {
    method: "DELETE",
    headers: getServiceHeaders(env, { prefer: "return=minimal" }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || "Não foi possível remover este usuário da lista de ignorados.");
  }
}

async function getIgnoredProfileId(request) {
  if (request.method === "DELETE") {
    const url = new URL(request.url);
    return cleanProfileId(url.searchParams.get("profileId") || url.searchParams.get("ignoredProfileId"));
  }

  const payload = await request.json().catch(() => ({}));
  return cleanProfileId(payload.profileId || payload.ignoredProfileId);
}

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireAuthUser(request, env);
    if (auth.error) return auth.error;

    const ignoredProfileId = await getIgnoredProfileId(request);
    if (!ignoredProfileId) return jsonResponse({ error: "Usuário inválido." }, { status: 400 });
    if (ignoredProfileId === auth.user.id) return jsonResponse({ error: "Você não pode ignorar a si mesmo." }, { status: 400 });

    await upsertIgnoredUser(env, auth.user.id, ignoredProfileId);
    return jsonResponse({ ok: true, ignoredProfileId });
  } catch (error) {
    console.error("ignore user failed", error);
    return jsonResponse({ error: error?.message || "Falha ao ignorar usuário." }, { status: 500 });
  }
}

export async function onRequestDelete({ request, env }) {
  try {
    const auth = await requireAuthUser(request, env);
    if (auth.error) return auth.error;

    const ignoredProfileId = await getIgnoredProfileId(request);
    if (!ignoredProfileId) return jsonResponse({ error: "Usuário inválido." }, { status: 400 });

    await deleteIgnoredUser(env, auth.user.id, ignoredProfileId);
    return jsonResponse({ ok: true, ignoredProfileId });
  } catch (error) {
    console.error("unignore user failed", error);
    return jsonResponse({ error: error?.message || "Falha ao deixar de ignorar usuário." }, { status: 500 });
  }
}
