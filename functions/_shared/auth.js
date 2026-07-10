export function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers || {}),
    },
  });
}

export function getSupabaseUrl(env) {
  return (env.SUPABASE_URL || env.SUPABASE_API_URL || env.SUBABASE_API_URL || "").replace(/\/rest\/v1\/?$/, "");
}

export function getSupabaseRestUrl(env) {
  return `${getSupabaseUrl(env)}/rest/v1`;
}

export function getR2Bucket(env) {
  const knownBinding = env.GIMERR_R2_BUCKET
    || env.GIMERR
    || env.R2_BUCKET
    || env.R2
    || env.BUCKET
    || env.gimerr;

  if (knownBinding?.put && knownBinding?.get) {
    return knownBinding;
  }

  return Object.values(env).find((value) => value?.put && value?.get);
}

export function hasR2Bucket(env) {
  return Boolean(getR2Bucket(env) || getR2S3Config(env));
}

function encodePathKey(key) {
  return String(key)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function toUint8Array(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new TextEncoder().encode(String(value));
}

async function sha256(value) {
  return toHex(await crypto.subtle.digest("SHA-256", toUint8Array(value)));
}

async function hmac(key, value) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    typeof key === "string" ? new TextEncoder().encode(key) : key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(value));
}

function getR2S3Config(env) {
  const accessKeyId = env.CLOUDFLARE_R2_ACCESS_KEY_ID || env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || env.R2_SECRET_ACCESS_KEY;
  const endpoint = env.CLOUDFLARE_S3_BUCKET_ENDPOINT || env.R2_BUCKET_ENDPOINT;
  const bucketName = env.CLOUDFLARE_R2_BUCKET || env.R2_BUCKET || "gimerr";

  if (!accessKeyId || !secretAccessKey || !endpoint) {
    return null;
  }

  return {
    accessKeyId,
    secretAccessKey,
    endpoint: endpoint.replace(/\/+$/, ""),
    bucketName,
  };
}

async function getR2SigningHeaders(env, requestUrl, method, body = "", headers = {}) {
  const config = getR2S3Config(env);
  if (!config) return null;

  const url = new URL(requestUrl);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = await sha256(body);
  const canonicalHeaders = {
    ...Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)])),
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  const sortedHeaderNames = Object.keys(canonicalHeaders).sort();
  const canonicalHeaderString = sortedHeaderNames
    .map((key) => `${key}:${canonicalHeaders[key].trim()}\n`)
    .join("");
  const signedHeaders = sortedHeaderNames.join(";");
  const canonicalRequest = [
    method,
    url.pathname,
    url.searchParams.toString(),
    canonicalHeaderString,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    await sha256(canonicalRequest),
  ].join("\n");

  const dateKey = await hmac(`AWS4${config.secretAccessKey}`, dateStamp);
  const regionKey = await hmac(dateKey, "auto");
  const serviceKey = await hmac(regionKey, "s3");
  const signingKey = await hmac(serviceKey, "aws4_request");
  const signature = toHex(await hmac(signingKey, stringToSign));

  return {
    ...canonicalHeaders,
    authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

function getR2S3ObjectUrl(env, key) {
  const config = getR2S3Config(env);
  if (!config) return null;

  const endpoint = new URL(config.endpoint);
  const pathname = endpoint.pathname.replace(/\/+$/, "");
  const hasBucketInPath = pathname.split("/").filter(Boolean).includes(config.bucketName);
  endpoint.pathname = `${pathname}${hasBucketInPath ? "" : `/${config.bucketName}`}/${encodePathKey(key)}`;
  return endpoint.toString();
}

export async function putR2Object(env, key, body, options = {}) {
  const s3Url = getR2S3ObjectUrl(env, key);
  if (s3Url) {
    const requestBody = toUint8Array(body);
    const headers = {
      "content-type": options.httpMetadata?.contentType || "application/octet-stream",
      ...(options.httpMetadata?.cacheControl ? { "cache-control": options.httpMetadata.cacheControl } : {}),
      ...Object.fromEntries(Object.entries(options.customMetadata || {}).map(([name, value]) => [`x-amz-meta-${name.toLowerCase()}`, value])),
    };
    const signedHeaders = await getR2SigningHeaders(env, s3Url, "PUT", requestBody, headers);
    const response = await fetch(s3Url, {
      method: "PUT",
      headers: signedHeaders,
      body: requestBody,
    });

    if (!response.ok) {
      throw new Error(`Falha ao enviar arquivo para o R2 real (${response.status}).`);
    }

    return { key, remote: true };
  }

  const bucket = getR2Bucket(env);
  if (!bucket?.put) {
    throw new Error("R2 binding indisponível neste ambiente.");
  }

  return bucket.put(key, body, options);
}

export async function getR2Object(env, key, options = {}) {
  const rangeHeader = String(options.rangeHeader || "").trim();
  const s3Url = getR2S3ObjectUrl(env, key);
  if (s3Url) {
    const requestHeaders = rangeHeader ? { range: rangeHeader } : {};
    const signedHeaders = await getR2SigningHeaders(env, s3Url, "GET", "", requestHeaders);
    const response = await fetch(s3Url, {
      headers: signedHeaders,
    });

    if (response.status === 404) return null;
    if (!response.ok && response.status !== 206) {
      throw new Error(`Falha ao buscar arquivo no R2 real (${response.status}).`);
    }

    return {
      body: response.body,
      status: response.status,
      contentLength: response.headers.get("content-length") || "",
      contentRange: response.headers.get("content-range") || "",
      headers: response.headers,
      httpEtag: response.headers.get("etag") || "",
      httpMetadata: {
        contentType: response.headers.get("content-type") || undefined,
        cacheControl: response.headers.get("cache-control") || undefined,
      },
      writeHttpMetadata(headers) {
        if (this.httpMetadata.contentType) headers.set("content-type", this.httpMetadata.contentType);
        if (this.httpMetadata.cacheControl) headers.set("cache-control", this.httpMetadata.cacheControl);
      },
    };
  }

  const bucket = getR2Bucket(env);
  if (!bucket?.get) {
    throw new Error("R2 binding indisponível neste ambiente.");
  }

  if (rangeHeader) {
    return bucket.get(key, {
      range: new Headers({ range: rangeHeader }),
    });
  }

  return bucket.get(key);
}

export async function deleteR2Object(env, key) {
  const s3Url = getR2S3ObjectUrl(env, key);
  if (s3Url) {
    const signedHeaders = await getR2SigningHeaders(env, s3Url, "DELETE");
    const response = await fetch(s3Url, {
      method: "DELETE",
      headers: signedHeaders,
    });

    if (response.status === 404) return { key, deleted: false };
    if (!response.ok) {
      throw new Error(`Falha ao remover arquivo antigo do R2 (${response.status}).`);
    }

    return { key, deleted: true, remote: true };
  }

  const bucket = getR2Bucket(env);
  if (!bucket?.delete) {
    throw new Error("R2 binding indisponível neste ambiente.");
  }

  await bucket.delete(key);
  return { key, deleted: true };
}

async function getAuthenticatedProfileAccess(env, userId) {
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return null;

  const url = new URL(`${getSupabaseRestUrl(env)}/profiles`);
  url.searchParams.set("select", "id,status,suspended_until");
  url.searchParams.set("id", `eq.${userId}`);
  url.searchParams.set("limit", "1");
  const headers = {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    "content-type": "application/json",
  };
  const response = await fetch(url.toString(), { headers });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível validar o estado da conta.");
  const profile = rows[0] || null;

  if (profile?.status === "suspended" && profile.suspended_until && new Date(profile.suspended_until).getTime() <= Date.now()) {
    const reactivateUrl = new URL(`${getSupabaseRestUrl(env)}/profiles`);
    reactivateUrl.searchParams.set("id", `eq.${userId}`);
    await fetch(reactivateUrl.toString(), {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        status: "active",
        suspended_until: null,
        moderation_reason: null,
      }),
    });
    return { ...profile, status: "active", suspended_until: null };
  }

  return profile;
}

export async function requireAuthUser(request, env, options = {}) {
  const supabaseUrl = getSupabaseUrl(env);
  const supabaseAnonKey = env.SUPABASE_ANON_KEY;
  const authorization = request.headers.get("authorization") || "";

  if (!supabaseUrl || !supabaseAnonKey) {
    return { error: jsonResponse({ error: "Auth config missing" }, { status: 500 }) };
  }

  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return { error: jsonResponse({ error: "Sessão ausente." }, { status: 401 }) };
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: supabaseAnonKey,
      authorization,
    },
  });

  if (!response.ok) {
    return { error: jsonResponse({ error: "Sessão inválida." }, { status: 401 }) };
  }

  const user = await response.json();
  const profile = await getAuthenticatedProfileAccess(env, user.id);

  if (!options.allowRestricted && profile?.status === "banned") {
    return {
      error: jsonResponse({ error: "Esta conta foi banida permanentemente.", code: "account_banned" }, { status: 403 }),
    };
  }

  if (!options.allowRestricted && profile?.status === "suspended") {
    return {
      error: jsonResponse({
        error: "Esta conta está suspensa temporariamente.",
        code: "account_suspended",
        suspendedUntil: profile.suspended_until,
      }, { status: 403 }),
    };
  }

  if (!options.allowRestricted && profile?.status === "inactive") {
    return {
      error: jsonResponse({ error: "Esta conta está inativa.", code: "account_inactive" }, { status: 403 }),
    };
  }

  return {
    user,
    token: authorization.replace(/^bearer\s+/i, ""),
    profileAccess: profile,
  };
}
