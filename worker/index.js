import NAMES from "./names.json";

// call.html からの翻訳リクエストを中継するWorker。
// 原文が短ければ速度優先でAzure、長ければ品質優先でWorkers AIを主経路にする。
// 相槌や短い返事は多少硬くても気にならないが、速さは効いてくるため。
// どちらを使っても、失敗（Workers AIはタイムアウトも含む）したときは
// 逆側に自動でフォールバックする。
const SHORT_TEXT_THRESHOLD = 8; // この文字数以下ならAzure優先
const WORKERS_AI_TIMEOUT_MS = 5000;

const ALLOWED_ORIGINS = new Set([
  "https://soma2028.github.io",
  "http://localhost:8000"
]);

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;
const MAX_TEXT_LENGTH = 2000;

// Qwenは日本語・韓国語の口語表現に比較的強いので採用。
// qwen3.8-27bがタイムアウトしがちだったため、MoE構造で1トークンあたりの
// 実計算量が少なく速いqwen3-30b-a3b-fp8（総パラメータ30B・実働3B）に変更。
// 変えたいときはここだけ書き換えればよい。
const WORKERS_AI_MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";

const LANG_NAMES_JA = { ja: "日本語", ko: "韓国語" };

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

// names.jsonは「日本語 => 韓国語表記」の対応表。原文にどちらか片方が
// 実際に含まれているときだけプロンプトに載せる（毎回全件載せてトークンを
// 無駄にしないため）。to==="ko"なら日本語名→韓国語表記、to==="ja"なら
// その逆で使う。
function buildNameNote(text, to) {
  const pairs = [];
  for (const [ja, ko] of Object.entries(NAMES)) {
    if (to === "ko" && text.includes(ja)) pairs.push(`${ja}→${ko}`);
    else if (to === "ja" && text.includes(ko)) pairs.push(`${ko}→${ja}`);
  }
  if (pairs.length === 0) return "";
  return `固有名詞は次の表記を使う: ${pairs.join("、")}。`;
}

// prompt_tokens（≒neuron消費）を削るため、口調の指定（20代の友人・반말/タメ口）
// だけ残して、それ以外の説明は削ってある。
// 直近の会話（原文/訳文のペア）を短くまとめる。「高い」が身長か値段かの
// ような曖昧さを、会話の流れから判断できるようにするため。
function buildContextNote(context) {
  if (!context || context.length === 0) return "";
  const lines = context.map(pair => `${pair.src}→${pair.dst}`).join(" / ");
  return `直近の会話: ${lines}。`;
}

function buildSystemPrompt(from, to, text, context) {
  const fromName = LANG_NAMES_JA[from] || from;
  const toName = LANG_NAMES_JA[to] || to;
  const tone = to === "ko" ? "반말" : to === "ja" ? "タメ口" : "くだけた話し言葉";
  const nameNote = buildNameNote(text, to);
  const contextNote = buildContextNote(context);

  return `20代の友人同士の電話の通訳。${fromName}→${toName}へ${tone}で自然に訳す。訳文のみ出力（説明・引用符・原文・思考過程なし）。${nameNote}${contextNote}`;
}

// Workers AI（LLM）で翻訳する。失敗（タイムアウト含む）したら例外を投げ、
// 呼び出し側でフォールバックする。
async function translateWithWorkersAI(env, text, from, to, context) {
  // クライアントから届いた値をそのまま信用しない。配列以外や不正な要素は捨て、
  // 念のためサーバー側でも直近6件に切り詰める。
  const safeContext = Array.isArray(context)
    ? context.slice(-6).filter(pair => pair && typeof pair.src === "string" && typeof pair.dst === "string")
    : [];

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), WORKERS_AI_TIMEOUT_MS);

  const runPromise = env.AI.run(WORKERS_AI_MODEL, {
    messages: [
      { role: "system", content: buildSystemPrompt(from, to, text, safeContext) },
      { role: "user", content: text }
    ],
    max_tokens: 300,
    temperature: 0.3,
    // Qwen3系共通の「思考モード」停止パラメータ。qwen3-30b-a3b-fp8も
    // 同じQwen3チャットテンプレートを使うため、これがないと訳文の前に
    // 長いreasoningが生成され、トークン（neurons）を無駄に消費する。
    // モデル変更後は、下のusageログのcompletion_tokensが極端に大きく
    // ないか確認すること（大きいままなら効いていない = 別の指定方法を探す）。
    chat_template_kwargs: { enable_thinking: false }
  }, { signal: controller.signal });

  // タイムアウト後にこのPromiseが裏で拒否されても、未処理のrejectionとして
  // ログを汚さないようにしておく（結果はもう使わない）。
  runPromise.catch(() => {});

  const timeoutPromise = new Promise((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(new Error("workers-ai timeout")));
  });

  let result;
  try {
    result = await Promise.race([runPromise, timeoutPromise]);
  } catch (err) {
    if (err.message === "workers-ai timeout") {
      console.warn("workers-ai timeout");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  // qwen3-30b-a3b-fp8はcontentがnullで、訳文がreasoning_content/reasoning側に
  // 入ってくることがあるため、順番に見ていって最初に値があるものを使う。
  const message = result?.choices?.[0]?.message;
  const translated = (
    message?.content ??
    message?.reasoning_content ??
    message?.reasoning ??
    result?.response ??
    ""
  ).trim();
  if (!translated) throw new Error("Workers AIから空の応答");

  console.log(`translate engine=workers-ai neurons=${result?.usage?.neurons} completion_tokens=${result?.usage?.completion_tokens}`);

  return translated;
}

// 専用の翻訳API。口調の指定はできないが、速くて安定している。
// contextは受け取れないので、引数にはあるが使わない。
async function translateWithAzure(env, text, from, to, context) {
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

  if (!azureRes.ok) throw new Error(`Azure Translator error: HTTP ${azureRes.status}`);

  const data = await azureRes.json();
  const translated = data?.[0]?.translations?.[0]?.text;
  if (!translated) throw new Error("Azureから空の応答");

  console.log(`translate engine=azure len=${text.length}`);

  return translated;
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

    const { text, from, to, context } = payload || {};

    if (typeof text !== "string" || text.length === 0 || text.length > MAX_TEXT_LENGTH) {
      return json({ error: `textは1〜${MAX_TEXT_LENGTH}文字で指定してください` }, 400, cors);
    }
    if (typeof from !== "string" || !from || typeof to !== "string" || !to) {
      return json({ error: "fromとtoを指定してください" }, 400, cors);
    }

    // 短い発話は速度優先でAzure、長い発話は品質優先でWorkers AIを主経路にする。
    const primaryName = text.length <= SHORT_TEXT_THRESHOLD ? "azure" : "workers-ai";
    const fallbackName = primaryName === "azure" ? "workers-ai" : "azure";
    const primary = primaryName === "azure" ? translateWithAzure : translateWithWorkersAI;
    const fallback = fallbackName === "azure" ? translateWithAzure : translateWithWorkersAI;

    try {
      const translated = await primary(env, text, from, to, context);
      return json({ text: translated, engine: primaryName }, 200, cors);
    } catch (err) {
      console.warn(`${primaryName} translation failed, falling back to ${fallbackName}:`, err.message);
    }

    try {
      const translated = await fallback(env, text, from, to, context);
      console.log(`${fallbackName} fallback succeeded`);
      return json({ text: translated, engine: fallbackName }, 200, cors);
    } catch (err) {
      console.error(`${fallbackName} fallback also failed:`, err.message);
      return json({ error: "翻訳サービスへの接続に失敗しました" }, 502, cors);
    }
  }
};
