import { jsonResponse } from "../../_shared/auth.js";
import { searchIgdbTaxonomy } from "../../_shared/igdb.js";

function toPublicItem(item) {
  return {
    id: item.id,
    name: item.name,
    slug: item.slug || null,
    abbreviation: item.abbreviation || null,
  };
}

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const type = url.searchParams.get("type") === "platforms" ? "platforms" : "genres";
    const query = String(url.searchParams.get("q") || "").trim();
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 500);
    const items = await searchIgdbTaxonomy(env, type, query, limit);

    return jsonResponse({
      type,
      items: items.map(toPublicItem).filter((item) => item.id && item.name),
    });
  } catch (error) {
    console.error("igdb taxonomy failed", error);
    return jsonResponse({
      error: error?.message || "Não foi possível carregar sugestões.",
    }, { status: 500 });
  }
}
