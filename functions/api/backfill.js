const GITHUB_API = "https://api.github.com";
const DEFAULT_GAMEGEN_API =
  "https://gamegen.lol/api/mg_cca51ec305a5494a946454fcc21cf1c3/generate/";
const DEFAULT_EXTERNAL_VAULT =
  "https://raw.githubusercontent.com/qwe213312/k25FCdfEOoEJ42S6/main";
const GAMES_ADDED_CHANNEL = "1508749560669933648";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestPost({ request, env }) {
  try {
    const payload = await request.json();

    if (payload?.type === "external-package") {
      const appId = normalizeAppId(payload.appId);
      const bytes = await fetchExternalPackage(env, appId);
      const fileName = `${appId}.zip`;
      const published = await publishToCharonDatabases(env, appId, fileName, bytes);
      await announceGameAdded(env, appId, fileName).catch(() => null);
      return json({ ok: true, type: payload.type, fileName, published });
    }

    if (payload?.type === "manifest-vault") {
      const fileName = normalizeManifestFileName(payload.fileName);
      const found = await fetchExternalManifest(env, fileName);
      const published = await publishToManifestVault(env, fileName, found.bytes);
      return json({ ok: true, type: payload.type, fileName, source: found.url, published });
    }

    return json({ ok: false, error: "Unsupported backfill type." }, 400);
  } catch (error) {
    return json({ ok: false, error: error.message || "Backfill failed." }, error.status || 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function normalizeAppId(value) {
  const appId = String(value || "").trim();
  if (!/^\d+$/.test(appId)) {
    const error = new Error("Invalid App ID.");
    error.status = 400;
    throw error;
  }
  return appId;
}

function normalizeManifestFileName(value) {
  const fileName = String(value || "").split(/[\\/]/).filter(Boolean).pop() || "";
  if (!/^\d+_\d+\.manifest$/i.test(fileName)) {
    const error = new Error("Invalid manifest filename.");
    error.status = 400;
    throw error;
  }
  return fileName;
}

function isZipBytes(bytes) {
  return bytes?.[0] === 0x50 && bytes?.[1] === 0x4b && bytes?.[2] === 0x03 && bytes?.[3] === 0x04;
}

function parseUrlList(value, fallback = "") {
  return String(value || fallback || "")
    .split(/[\n,]+/)
    .map((item) => item.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

function withQuery(url, key, value) {
  const next = new URL(url);
  next.searchParams.set(key, value);
  return next.toString();
}

function buildGenerateUrl(env, appId) {
  const configured = String(env.GAMEGEN_API_URL || DEFAULT_GAMEGEN_API).trim();
  if (configured.includes("{APP_ID}")) return configured.replace("{APP_ID}", appId);
  return `${configured.replace(/\/+$/, "")}/${appId}`;
}

async function fetchExternalPackage(env, appId) {
  const url = withQuery(buildGenerateUrl(env, appId), "format", "zip");
  const response = await fetch(url, {
    headers: {
      Accept: "application/zip, application/octet-stream, */*",
      "Cache-Control": "no-cache",
      "User-Agent": "CharonSite/1.0"
    },
    cf: { cacheTtl: 0 }
  });

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!response.ok || !isZipBytes(bytes)) {
    const error = new Error(`External API did not return a valid ZIP for ${appId}.`);
    error.status = 502;
    throw error;
  }

  return bytes;
}

async function fetchExternalManifest(env, fileName) {
  const sources = parseUrlList(env.MANIFEST_FALLBACK_URLS || env.FALLBACK_MANIFEST_REPOSITORIES, DEFAULT_EXTERNAL_VAULT);
  for (const source of sources) {
    const url = `${source}/${encodeURIComponent(fileName)}`;
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/octet-stream, text/plain, */*" },
        cf: { cacheTtl: 0 }
      });
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (response.ok && bytes.length) {
        return { url, bytes };
      }
    } catch {
      // Try the next external vault.
    }
  }

  const error = new Error(`${fileName} was not found in the external vault.`);
  error.status = 404;
  throw error;
}

function requireGithubConfig(env, overrides = {}) {
  if (!env.GITHUB_TOKEN) {
    const error = new Error("GITHUB_TOKEN is not configured on the website backend.");
    error.status = 500;
    throw error;
  }

  return {
    owner: overrides.owner || env.GITHUB_OWNER || "BlissBlender",
    repo: overrides.repo || env.GITHUB_REPO || "Charon-Database",
    branch: overrides.branch || env.GITHUB_BRANCH || "main",
    token: env.GITHUB_TOKEN
  };
}

function contentPath(config, filePath) {
  return `/repos/${config.owner}/${config.repo}/contents/${filePath.split("/").map(encodeURIComponent).join("/")}`;
}

async function githubRequest(config, path, options = {}) {
  const response = await fetch(`${GITHUB_API}${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "CharonSite/1.0",
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const error = new Error(`GitHub ${response.status}: ${text.slice(0, 260)}`);
    error.status = response.status;
    throw error;
  }

  if (response.status === 204) return null;
  return response.json();
}

async function getGithubFile(config, filePath) {
  try {
    return await githubRequest(config, `${contentPath(config, filePath)}?ref=${encodeURIComponent(config.branch)}`);
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunk));
  }
  return btoa(binary);
}

async function putGithubFile(config, filePath, bytes, message, sha = undefined) {
  return githubRequest(config, contentPath(config, filePath), {
    method: "PUT",
    body: {
      message,
      content: bytesToBase64(bytes),
      branch: config.branch,
      sha
    }
  });
}

function configuredUploadBasePath(env) {
  const paths = String(env.DATABASE_BASE_PATHS || ",manifests")
    .split(/[\n,]+/)
    .map((item) => item.trim().replace(/^\/+|\/+$/g, ""))
    .filter((item, index, list) => list.indexOf(item) === index);
  return paths.find((path) => path === "") ?? "";
}

function databaseUploadPaths(env, fileName) {
  const basePath = configuredUploadBasePath(env);
  return ["database-1", "database-2"].map((database) =>
    [database, basePath, fileName].filter(Boolean).join("/")
  );
}

async function publishToCharonDatabases(env, appId, fileName, bytes) {
  const config = requireGithubConfig(env);
  const paths = databaseUploadPaths(env, fileName);
  const uploaded = [];

  for (const path of paths) {
    const existing = await getGithubFile(config, path);
    if (existing) return { uploaded: false, reason: `${path} already exists.`, paths: [] };
  }

  for (const path of paths) {
    await putGithubFile(config, path, bytes, `Backfill external package ${fileName} for ${appId} by Charon Site`);
    uploaded.push(path);
  }

  return { uploaded: true, paths: uploaded };
}

function manifestVaultUploadPath(env, fileName) {
  const basePath = String(env.MANIFEST_VAULT_BASE_PATH || "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
  return [basePath, fileName].filter(Boolean).join("/");
}

async function publishToManifestVault(env, fileName, bytes) {
  const config = requireGithubConfig(env, {
    owner: env.MANIFEST_VAULT_OWNER || env.GITHUB_OWNER || "BlissBlender",
    repo: env.MANIFEST_VAULT_REPO || "ManifestVault",
    branch: env.MANIFEST_VAULT_BRANCH || env.GITHUB_BRANCH || "main"
  });
  const path = manifestVaultUploadPath(env, fileName);
  const existing = await getGithubFile(config, path);
  if (existing) return { uploaded: false, reason: `${path} already exists.`, path };

  await putGithubFile(config, path, bytes, `Backfill ${fileName} from External Vault by Charon Site`);
  return { uploaded: true, path };
}

async function fetchGameDetails(appId) {
  try {
    const response = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appId}&filters=basic,release_date,publishers,developers,genres`);
    const data = await response.json();
    const game = data?.[appId]?.data;
    if (!game?.name) return null;
    return {
      name: game.name,
      banner: game.header_image || `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`,
      developers: Array.isArray(game.developers) ? game.developers : [],
      publishers: Array.isArray(game.publishers) ? game.publishers : [],
      genres: Array.isArray(game.genres) ? game.genres.map((genre) => genre.description).filter(Boolean) : [],
      releaseDate: game.release_date?.date || "Unknown"
    };
  } catch {
    return null;
  }
}

function discordField(name, value, inline = true) {
  return { name, value: String(value || "Unknown").slice(0, 1024), inline };
}

async function announceGameAdded(env, appId, fileName) {
  if (!env.DISCORD_TOKEN) return;
  const game = await fetchGameDetails(appId);
  const embed = {
    color: 0x22c55e,
    title: game?.name ? "🎮 NEW GAME ADDED" : "🎮 New Manifest Added",
    description: game?.name ? "A new manifest has been published to Charon." : undefined,
    fields: game?.name ? [
      discordField("🎯 Game", game.name, true),
      discordField("🆔 App ID", `\`${appId}\``, true),
      discordField("🏢 Developer", game.developers.length ? game.developers.join(", ") : "Unknown", true),
      discordField("🚀 Publisher", game.publishers.length ? game.publishers.join(", ") : "Unknown", true),
      discordField("📅 Release Date", game.releaseDate || "Unknown", true),
      discordField("🎲 Genres", game.genres.length ? game.genres.slice(0, 6).join(", ") : "Unknown", true),
      discordField("📦 Manifest", `\`${fileName}\``, true),
      discordField("⬆ Uploaded By", "Charon Bot", true),
      discordField("☁ Published", "✅ Database 1\n✅ Database 2", false)
    ] : [
      discordField("App ID", `\`${appId}\``, true),
      discordField("File", `\`${fileName}\``, true),
      discordField("Uploader", "Charon Bot", true)
    ],
    footer: { text: "Powered by Charon" },
    timestamp: new Date().toISOString()
  };

  if (game?.banner) embed.image = { url: game.banner };

  await fetch(`https://discord.com/api/v10/channels/${env.GAMES_ADDED_CHANNEL || GAMES_ADDED_CHANNEL}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${env.DISCORD_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      content: "",
      embeds: [embed],
      allowed_mentions: { parse: [] }
    })
  });
}
