import { jsonResponse } from "../_shared/auth.js";

function cleanUrl(value) {
  const text = String(value || "").trim();
  if (!/^https?:\/\//i.test(text)) return "";
  return text;
}

function normalizeVastTag(value) {
  const text = cleanUrl(value);
  if (!text) return "";

  try {
    const url = new URL(text);
    const legacyZoneId = url.searchParams.get("idz");
    if (legacyZoneId && !url.searchParams.has("idzone")) {
      url.searchParams.set("idzone", legacyZoneId);
      url.searchParams.delete("idz");
    }
    return url.toString();
  } catch {
    return text;
  }
}

function isDisabled(value) {
  return ["0", "false", "off", "disabled"].includes(String(value || "").trim().toLowerCase());
}

function isEnabled(value) {
  return ["1", "true", "on", "enabled"].includes(String(value || "").trim().toLowerCase());
}

function getRequestHost(request) {
  try {
    return new URL(request.url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isLocalHost(host) {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export async function onRequestGet({ request, env }) {
  const vastTag = normalizeVastTag(
    env.EXOCLICK_VAST_TAG_URL
      || env.EXOCLICK_VAST_TAG
      || env.exoclick_vast_tag
      || env.EXOCLICK_VAST_URL
      || env.VIDEO_ADS_VAST_TAG_URL
      || env.VIDEO_ADS_VAST_URL,
  );
  const host = getRequestHost(request);
  const localAdsEnabled = isEnabled(env.VIDEO_ADS_ALLOW_LOCAL);
  const enabled = Boolean(vastTag)
    && !isDisabled(env.VIDEO_ADS_ENABLED)
    && (!isLocalHost(host) || localAdsEnabled);

  return jsonResponse({
    enabled,
    provider: enabled ? "exoclick" : "",
    roll: "preRoll",
    vastTag: enabled ? vastTag : "",
    reason: !vastTag
      ? "missing_vast_tag"
      : isLocalHost(host) && !localAdsEnabled
        ? "disabled_on_localhost"
        : "",
  });
}
