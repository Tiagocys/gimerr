import { createHmac, createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const WORK_DIR = join(ROOT, ".video-worker");

async function loadDotEnv() {
  const envPath = join(ROOT, ".env");
  const content = await readFile(envPath, "utf8").catch(() => "");
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) return;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  });
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} ausente no .env`);
  return value;
}

function encodePathKey(key) {
  return String(key).split("/").map(encodeURIComponent).join("/");
}

function toHex(buffer) {
  return Buffer.from(buffer).toString("hex");
}

function hmac(key, value, encoding) {
  return createHmac("sha256", key).update(value).digest(encoding);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function getR2Config() {
  return {
    accessKeyId: requiredEnv("CLOUDFLARE_R2_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnv("CLOUDFLARE_R2_SECRET_ACCESS_KEY"),
    endpoint: requiredEnv("CLOUDFLARE_S3_BUCKET_ENDPOINT").replace(/\/+$/, ""),
    bucketName: process.env.CLOUDFLARE_R2_BUCKET || "gimerr",
  };
}

function getR2ObjectUrl(key) {
  const config = getR2Config();
  const endpoint = new URL(config.endpoint);
  const pathname = endpoint.pathname.replace(/\/+$/, "");
  const hasBucketInPath = pathname.split("/").filter(Boolean).includes(config.bucketName);
  endpoint.pathname = `${pathname}${hasBucketInPath ? "" : `/${config.bucketName}`}/${encodePathKey(key)}`;
  return endpoint.toString();
}

function getR2SigningHeaders(requestUrl, method, body = Buffer.alloc(0), headers = {}) {
  const config = getR2Config();
  const url = new URL(requestUrl);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
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
    sha256(canonicalRequest),
  ].join("\n");

  const dateKey = hmac(`AWS4${config.secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, "auto");
  const serviceKey = hmac(regionKey, "s3");
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = toHex(hmac(signingKey, stringToSign));

  return {
    ...canonicalHeaders,
    authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

async function api(apiBase, workerSecret, path, options = {}) {
  const url = `${apiBase}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-video-worker-secret": workerSecret,
      ...(options.headers || {}),
    },
  });
  const responseText = await response.text();
  let payload = {};
  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    throw new Error(payload.error || `HTTP ${response.status} em ${options.method || "GET"} ${url}: ${responseText.slice(0, 240)}`);
  }
  return payload;
}

async function downloadR2Object(key, destination) {
  const url = getR2ObjectUrl(key);
  const response = await fetch(url, {
    headers: getR2SigningHeaders(url, "GET"),
  });
  if (!response.ok) throw new Error(`Falha ao baixar original do R2 (${response.status}).`);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

async function uploadR2Object(key, source, contentType = "video/mp4") {
  const body = await readFile(source);
  const url = getR2ObjectUrl(key);
  const headers = {
    "content-type": contentType,
    "cache-control": "public, max-age=31536000, immutable",
  };
  const response = await fetch(url, {
    method: "PUT",
    headers: getR2SigningHeaders(url, "PUT", body, headers),
    body,
  });
  if (!response.ok) throw new Error(`Falha ao subir vídeo comprimido para o R2 (${response.status}).`);
  return `/api/media/${key}`;
}

function runFfmpeg(input, output) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-y",
      "-i", input,
      "-vf", "scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos",
      "-c:v", "libx264",
      "-preset", "slow",
      "-b:v", "850k",
      "-maxrate", "950k",
      "-bufsize", "1900k",
      "-c:a", "aac",
      "-b:a", "64k",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      output,
    ], { stdio: ["ignore", "pipe", "pipe"] });

    ffmpeg.stderr.on("data", (chunk) => {
      process.stdout.write(`[ffmpeg] ${chunk}`);
    });
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg saiu com código ${code}.`));
    });
  });
}

function createVideoThumbnail(input, output) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-y",
      "-i", input,
      "-vf", "select=eq(n\\,0),scale=w='min(640,iw)':h=-2",
      "-frames:v", "1",
      "-q:v", "8",
      output,
    ], { stdio: ["ignore", "ignore", "pipe"] });

    ffmpeg.stderr.on("data", () => {});
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg não conseguiu gerar a capa (código ${code}).`));
    });
  });
}

async function processJob(apiBase, workerSecret, job) {
  const input = join(WORK_DIR, `${job.id}-original`);
  const output = join(WORK_DIR, `${job.id}-ready.mp4`);
  const thumbnail = join(WORK_DIR, `${job.id}-thumbnail.jpg`);
  const readyKey = `videos/ready/${job.profileId}/${job.id}.mp4`;
  const thumbnailKey = `videos/thumbnails/${job.profileId}/${job.id}.jpg`;

  console.log(`[video-worker] baixando ${job.sourceKey}`);
  await downloadR2Object(job.sourceKey, input);
  console.log(`[video-worker] gerando capa ${job.id}`);
  await createVideoThumbnail(input, thumbnail);
  const thumbnailUrl = await uploadR2Object(thumbnailKey, thumbnail, "image/jpeg");
  const thumbnailResult = await api(apiBase, workerSecret, "/api/video-worker/complete", {
    method: "POST",
    body: JSON.stringify({
      postId: job.id,
      status: "thumbnail",
      thumbnailKey,
      thumbnailUrl,
    }),
  });
  if (thumbnailResult.cancelled) {
    await rm(input, { force: true }).catch(() => {});
    await rm(thumbnail, { force: true }).catch(() => {});
    console.log(`[video-worker] cancelado ${job.id}: o post foi removido`);
    return;
  }
  console.log(`[video-worker] comprimindo ${job.id}`);
  await runFfmpeg(input, output);
  console.log(`[video-worker] subindo ${readyKey}`);
  const readyUrl = await uploadR2Object(readyKey, output, "video/mp4");

  await api(apiBase, workerSecret, "/api/video-worker/complete", {
    method: "POST",
    body: JSON.stringify({
      postId: job.id,
      status: "ready",
      readyKey,
      readyUrl,
      mediaType: "video/mp4",
      originalKey: job.sourceKey,
      thumbnailKey,
      thumbnailUrl,
    }),
  });

  await rm(input, { force: true }).catch(() => {});
  await rm(output, { force: true }).catch(() => {});
  await rm(thumbnail, { force: true }).catch(() => {});
  console.log(`[video-worker] pronto ${job.id}`);
}

async function main() {
  await loadDotEnv();
  const API_BASE = process.env.VIDEO_WORKER_API_BASE || "http://localhost:8788";
  const WORKER_SECRET = process.env.VIDEO_WORKER_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const POLL_INTERVAL_MS = Number(process.env.VIDEO_WORKER_POLL_MS || 10000);
  if (!WORKER_SECRET) throw new Error("VIDEO_WORKER_SECRET ou SUPABASE_SERVICE_ROLE_KEY ausente.");
  await mkdir(WORK_DIR, { recursive: true });
  console.log(`[video-worker] iniciado em ${API_BASE}`);

  while (true) {
    try {
      const { job } = await api(API_BASE, WORKER_SECRET, "/api/video-worker/next", { method: "POST", body: "{}" });
      if (!job) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        continue;
      }
      await processJob(API_BASE, WORKER_SECRET, job);
    } catch (error) {
      console.error("[video-worker] erro", error);
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
}

main().catch((error) => {
  console.error("[video-worker] falha fatal", error);
  process.exit(1);
});
