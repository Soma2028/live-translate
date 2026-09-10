// call.html からの翻訳リクエストを中継し、Azure Translatorを呼び出すだけのWorker。
// Azureのキーをブラウザ側に置かないためだけに存在する。

const ALLOWED_ORIGINS = new Set([
  "https://soma2028.github.io",
  "http://localhost:8000"
]);

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;
const MAX_TEXT_LENGTH = 2000;

// Worker上のシンプルなメモリ内カウンタ。同一アイソレートが使い回される限り効くが、
// Cloudflareの複数拠点・複数アイソレートをまたいだ厳密なレート制限ではない
// （2人だけの私用アプリなので、これで十分という判断）。
const rateLimitMap = new Map(); // ip -> { count, windowStart }

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    return false;
  }
  entry.count += 1;
  return true;
}

function corsHeaders(origin) {
  if (!ALLOWED_ORIGINS.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
}

function json(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors }
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    // CORSヘッダーはブラウザにしか効かないので、許可オリジン以外は
    // サーバー側でも明示的に拒否する（curl等での直接叩き対策）。
    if (!ALLOWED_ORIGINS.has(origin)) {
      return json({ error: "許可されていないオリジンです" }, 403, cors);
    }

    if (request.method !== "POST") {
      return json({ error: "POSTのみ対応しています" }, 405, cors);
    }

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (!checkRateLimit(ip)) {
      return json({ error: "リクエストが多すぎます。しばらく待ってください。" }, 429, cors);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "不正なJSONです" }, 400, cors);
    }

    const { text, from, to } = payload || {};

    if (typeof text !== "string" || text.length === 0 || text.length > MAX_TEXT_LENGTH) {
      return json({ error: `textは1〜${MAX_TEXT_LENGTH}文字で指定してください` }, 400, cors);
    }
    if (typeof from !== "string" || !from || typeof to !== "string" || !to) {
      return json({ error: "fromとtoを指定してください" }, 400, cors);
    }

    try {
      const azureUrl =
        `https://api.cognitive.microsofttranslator.com/translate?api-version=3.0` +
        `&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

      const azureRes = await fetch(azureUrl, {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": env.AZURE_TRANSLATOR_KEY,
          "Ocp-Apim-Subscription-Region": env.AZURE_TRANSLATOR_REGION,
          "Content-Type": "application/json"
        },
        body: JSON.stringify([{ Text: text }])
      });

      if (!azureRes.ok) {
        return json({ error: `Azure Translator error: HTTP ${azureRes.status}` }, 502, cors);
      }

      const data = await azureRes.json();
      const translated = data?.[0]?.translations?.[0]?.text;
      if (!translated) {
        return json({ error: "空の応答です" }, 502, cors);
      }

      return json({ text: translated }, 200, cors);
    } catch {
      return json({ error: "翻訳サービスへの接続に失敗しました" }, 502, cors);
    }
  }
};
