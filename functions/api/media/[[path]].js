import { getR2Object, hasR2Bucket, jsonResponse } from "../../_shared/auth.js";

const ALLOWED_PREFIXES = [
  "game_covers/",
  "market/",
  "posts/",
  "profile-pics/",
  "videos/",
];

function getKey(params) {
  const rawPath = Array.isArray(params.path) ? params.path.join("/") : params.path;
  return decodeURIComponent(String(rawPath || ""));
}

function getLocalContentRange(object) {
  const offset = Number(object?.range?.offset);
  const length = Number(object?.range?.length);
  const size = Number(object?.size);
  if (!Number.isFinite(offset) || !Number.isFinite(length) || !Number.isFinite(size)) return "";
  return `bytes ${offset}-${offset + length - 1}/${size}`;
}

export async function onRequestGet({ request, env, params }) {
  if (!hasR2Bucket(env)) {
    return jsonResponse({ error: "R2 binding missing" }, { status: 500 });
  }

  const key = getKey(params);
  if (!key || !ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    return jsonResponse({ error: "Arquivo não encontrado." }, { status: 404 });
  }

  const rangeHeader = request.headers.get("range") || "";
  const object = await getR2Object(env, key, { rangeHeader });
  if (!object) {
    return jsonResponse({ error: "Arquivo não encontrado." }, { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", object.httpMetadata?.cacheControl || "public, max-age=86400");
  headers.set("accept-ranges", "bytes");

  const contentRange = object.contentRange || getLocalContentRange(object);
  const contentLength = object.contentLength || object.range?.length || object.size;
  if (contentRange) headers.set("content-range", contentRange);
  if (contentLength) headers.set("content-length", String(contentLength));

  return new Response(object.body, {
    status: rangeHeader && contentRange ? 206 : (object.status || 200),
    headers,
  });
}
