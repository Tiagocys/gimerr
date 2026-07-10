import { jsonResponse } from "../_shared/auth.js";

function cleanUrl(value) {
  const text = String(value || "").trim();
  if (!/^https?:\/\//i.test(text)) return "";
  return text;
}

function isDisabled(value) {
  return ["0", "false", "off", "disabled"].includes(String(value || "").trim().toLowerCase());
}

export async function onRequestGet({ env }) {
  const vastTag = cleanUrl(
    env.EXOCLICK_VAST_TAG_URL
      || env.EXOCLICK_VAST_TAG
      || env.exoclick_vast_tag
      || env.EXOCLICK_VAST_URL
      || env.VIDEO_ADS_VAST_TAG_URL
      || env.VIDEO_ADS_VAST_URL,
  );
  const enabled = Boolean(vastTag) && !isDisabled(env.VIDEO_ADS_ENABLED);

  return jsonResponse({
    enabled,
    provider: enabled ? "exoclick" : "",
    roll: "preRoll",
    vastTag: enabled ? vastTag : "",
  });
}
