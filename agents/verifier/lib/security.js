/**
 * URL gate for the verifier.
 *
 * The verifier is a browser with a wallet behind it, pointed at URLs that
 * strangers can write into an invoice. Without this file, `target_url` is an
 * SSRF primitive aimed at the VPS's own network and at cloud metadata.
 *
 * Rules, in order:
 *   1. https only
 *   2. no IP literals, no private / loopback / link-local / metadata ranges
 *   3. hostname must match the allowlist
 *   4. the hostname is resolved, and every resolved address is re-checked —
 *      a public name that resolves inward is the same attack with a wig
 */
const dns = require("node:dns").promises;
const net = require("node:net");

const DEFAULT_ALLOW = ["vercel.app", "speclock.xyz"];

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split(".").map(Number);
    if (p[0] === 10) return true;
    if (p[0] === 127) return true;
    if (p[0] === 0) return true;
    if (p[0] === 169 && p[1] === 254) return true; // link-local + cloud metadata
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
    if (p[0] >= 224) return true; // multicast / reserved
    return false;
  }
  const low = ip.toLowerCase();
  if (low === "::1" || low === "::") return true;
  if (low.startsWith("fe80")) return true; // link-local
  if (/^f[cd][0-9a-f]{2}/.test(low)) return true; // unique local fc00::/7
  if (low.startsWith("::ffff:")) return isPrivateIp(low.slice(7));
  return false;
}

function hostAllowed(host, allowlist) {
  const h = host.toLowerCase();
  return allowlist.some((entry) => {
    const e = entry.toLowerCase().trim();
    if (!e) return false;
    return h === e || h.endsWith(`.${e}`);
  });
}

/**
 * @returns {Promise<{ok: true, url: string, host: string} | {ok: false, reason: string}>}
 */
async function vetUrl(raw, { allowlist = DEFAULT_ALLOW, resolve = true } = {}) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: "not a valid URL" };
  }

  if (u.protocol !== "https:") return { ok: false, reason: `protocol ${u.protocol} not allowed` };
  if (u.username || u.password) return { ok: false, reason: "credentials in URL are not allowed" };
  if (u.port && u.port !== "443") return { ok: false, reason: `port ${u.port} not allowed` };

  const host = u.hostname.toLowerCase();
  if (net.isIP(host)) return { ok: false, reason: "IP literals are not allowed" };
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    return { ok: false, reason: "internal hostnames are not allowed" };
  }
  if (!hostAllowed(host, allowlist)) {
    return { ok: false, reason: `host ${host} is not on the allowlist` };
  }

  if (resolve) {
    let addrs;
    try {
      addrs = await dns.lookup(host, { all: true });
    } catch {
      return { ok: false, reason: `DNS lookup failed for ${host}` };
    }
    for (const a of addrs) {
      if (isPrivateIp(a.address)) {
        return { ok: false, reason: `${host} resolves to a private address (${a.address})` };
      }
    }
  }

  return { ok: true, url: u.toString(), host };
}

module.exports = { vetUrl, isPrivateIp, hostAllowed, DEFAULT_ALLOW };
