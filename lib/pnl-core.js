import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import chromium from "@sparticuz/chromium-min";
import puppeteer from "puppeteer-core";

export const IMAGE_WIDTH = 1200;
export const IMAGE_HEIGHT = 630;

const DEFAULT_PROJECT = "SOLIX";
const DEFAULT_THEME = "blue";
const SUPPORTED_THEMES = new Set(["blue", "green"]);
const TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: "UTC",
});

let browserPromise;

export async function handlePnlRequest(req, res) {
  try {
    const input = await extractInput(req);
    const model = buildPnlModel(input);
    const pngBuffer = await renderImage(model);

    sendBuffer(res, 200, pngBuffer, {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      "Content-Length": pngBuffer.length,
    });
  } catch (error) {
    if (error instanceof InputError) {
      sendJson(res, 400, {
        error: "Invalid input",
        details: error.message,
      });
      return;
    }

    console.error("Image request failed", error);
    sendJson(res, 500, {
      error: "Internal server error",
      details: "The image renderer failed unexpectedly.",
    });
  }
}

export async function handleLocalRequest(req, res, rootDir) {
  try {
    const url = new URL(req.url || "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/") {
      const html = await readFile(path.join(rootDir, "index.html"));
      sendBuffer(res, 200, html, { "Content-Type": "text/html; charset=utf-8" });
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, {
        ok: true,
        service: "solix-pnl-image-api",
        browserReady: Boolean(browserPromise),
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (
      (req.method === "GET" || req.method === "POST") &&
      (url.pathname === "/api/pnl-image" || url.pathname === "/api/pnl-image.png")
    ) {
      await handlePnlRequest(req, res);
      return;
    }

    sendJson(res, 404, {
      error: "Not found",
      details: "Route does not exist.",
    });
  } catch (error) {
    console.error("Unhandled request error", error);
    sendJson(res, 500, {
      error: "Internal server error",
      details: "The server failed unexpectedly.",
    });
  }
}

export async function closeBrowser() {
  if (!browserPromise) {
    return;
  }

  try {
    const browser = await browserPromise;
    await browser.close();
  } catch (_error) {
    return;
  } finally {
    browserPromise = undefined;
  }
}

function buildPnlModel(input) {
  input = input || {};

  const project = cleanProjectName(input.project || input.name || DEFAULT_PROJECT);
  const theme = normalizeTheme(input.theme);
  const entry = parseFlexibleNumber(input.entry, "entry");
  const startMc = parseMarketCap(input.startmc, "startmc");
  const endMc = parseMarketCap(input.endmc, "endmc");
  const gasFee = parseFlexibleNumber(input.gas ?? 0, "gas");

  if (startMc <= 0) {
    throw new InputError("`startmc` must be greater than 0.");
  }

  if (endMc <= 0) {
    throw new InputError("`endmc` must be greater than 0.");
  }

  if (entry < 0) {
    throw new InputError("`entry` cannot be negative.");
  }

  const multiplier = endMc / startMc;
  const profit = entry * (multiplier - 1);
  const netPnL = profit;
  const isPositive = netPnL >= 0;
  const timestamp = normalizeTimestamp(input.datetime || input.timestamp);
  const palette = getThemePalette(theme, isPositive);

  return {
    project,
    theme,
    timestamp,
    palette,
    multiplierText: formatMultiplier(multiplier),
    cards: [
      {
        label: "Entry",
        value: formatSignedToken(entry, { prefixPositive: false }),
        tone: "neutral",
      },
      {
        label: "Start MC",
        value: formatCompactMoney(startMc),
        tone: "neutral",
      },
      {
        label: "End MC",
        value: formatCompactMoney(endMc),
        tone: "neutral",
      },
      {
        label: "Profit",
        value: formatSignedToken(profit),
        tone: profit >= 0 ? "profit" : "loss",
      },
      {
        label: "Gas Fee",
        value: formatSignedToken(gasFee, { prefixPositive: false }),
        tone: "neutral",
      },
      {
        label: "Net PnL",
        value: formatSignedToken(netPnL),
        tone: netPnL >= 0 ? "profit" : "loss",
      },
    ],
  };
}

async function renderImage(model) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setViewport({
      width: IMAGE_WIDTH,
      height: IMAGE_HEIGHT,
      deviceScaleFactor: 1,
    });

    await page.setContent(renderCardHtml(model), { waitUntil: "load" });
    await page.evaluate(async () => {
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }
    });

    return await page.screenshot({
      type: "png",
      clip: { x: 0, y: 0, width: IMAGE_WIDTH, height: IMAGE_HEIGHT },
    });
  } finally {
    await page.close().catch(() => {});
  }
}

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = launchBrowser().catch((error) => {
      console.error("Browser launch failed", error);
      browserPromise = undefined;
      throw error;
    });
  }

  return browserPromise;
}

async function launchBrowser() {
  const inVercel = Boolean(process.env.VERCEL);
  const remoteChromiumPack =
    process.env.CHROMIUM_REMOTE_EXEC_PATH ||
    "https://github.com/Sparticuz/chromium/releases/download/v138.0.2/chromium-v138.0.2-pack.x64.tar";

  if (inVercel) {
    const executablePath = await chromium.executablePath(remoteChromiumPack);
    return puppeteer.launch({
      args: puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
      executablePath,
      headless: "shell",
    });
  }

  const localExecutablePath = process.env.CHROMIUM_LOCAL_EXEC_PATH || detectLocalChromePath();
  if (!localExecutablePath) {
    throw new Error(
      "Local Chromium was not found. Set CHROMIUM_LOCAL_EXEC_PATH or deploy to Vercel.",
    );
  }

  return puppeteer.launch({
    executablePath: localExecutablePath,
    headless: true,
    args: ["--disable-dev-shm-usage", "--disable-gpu", "--no-sandbox"],
  });
}

async function extractInput(req) {
  if ((req.method || "GET").toUpperCase() === "GET") {
    if (req.query) {
      return req.query;
    }

    const url = new URL(req.url || "/", "http://localhost");
    return Object.fromEntries(url.searchParams.entries());
  }

  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  const rawBody = await readRawBody(req);
  if (!rawBody) {
    return {};
  }

  const contentType = String(req.headers?.["content-type"] || "").toLowerCase();
  if (contentType.includes("application/json")) {
    return JSON.parse(rawBody);
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(rawBody).entries());
  }

  return {};
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
    });

    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });

    req.on("error", reject);
  });
}

function sendJson(res, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  sendBuffer(res, statusCode, body, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
  });
}

function sendBuffer(res, statusCode, body, headers = {}) {
  if (typeof res.status === "function" && typeof res.send === "function") {
    for (const [key, value] of Object.entries(headers)) {
      res.setHeader(key, value);
    }
    res.status(statusCode).send(body);
    return;
  }

  res.statusCode = statusCode;
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
  res.end(body);
}

function detectLocalChromePath() {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ];

  return candidates.find((candidate) => existsSync(candidate));
}

function parseFlexibleNumber(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    throw new InputError(`\`${fieldName}\` is required.`);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new InputError(`\`${fieldName}\` must be a valid number.`);
    }
    return value;
  }

  const raw = String(value).trim().toLowerCase();
  if (!raw) {
    throw new InputError(`\`${fieldName}\` is required.`);
  }

  const normalized = raw.replace(/\s+/g, "").replace(/\$/g, "").replace(/,/g, ".");

  if (!/^[-+]?\d*\.?\d+$/.test(normalized)) {
    throw new InputError(`\`${fieldName}\` must be a valid number.`);
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    throw new InputError(`\`${fieldName}\` must be a valid number.`);
  }

  return parsed;
}

function parseMarketCap(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    throw new InputError(`\`${fieldName}\` is required.`);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new InputError(`\`${fieldName}\` must be a valid market cap.`);
    }
    return value * 1000;
  }

  const raw = String(value).trim().toLowerCase();
  if (!raw) {
    throw new InputError(`\`${fieldName}\` is required.`);
  }

  const compact = raw.replace(/\s+/g, "").replace(/\$/g, "");
  const match = compact.match(/^([-+]?\d+(?:[.,]\d+)?)([kmb])?$/i);

  if (!match) {
    throw new InputError(
      `\`${fieldName}\` must be a number like \`2\`, \`2k\`, \`1000k\`, or \`1m\`.`,
    );
  }

  const amount = Number(match[1].replace(",", "."));
  const suffix = (match[2] || "k").toLowerCase();
  const multiplier = suffix === "m" ? 1_000_000 : suffix === "b" ? 1_000_000_000 : 1_000;
  const parsed = amount * multiplier;

  if (!Number.isFinite(parsed)) {
    throw new InputError(`\`${fieldName}\` must be a valid market cap.`);
  }

  return parsed;
}

function normalizeTheme(theme) {
  const raw = String(theme || DEFAULT_THEME).trim().toLowerCase();
  return SUPPORTED_THEMES.has(raw) ? raw : DEFAULT_THEME;
}

function normalizeTimestamp(value) {
  if (!value) {
    return TIME_FORMATTER.format(new Date());
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new InputError("`timestamp` must be a valid date string.");
  }

  return TIME_FORMATTER.format(date);
}

function cleanProjectName(value) {
  const project = String(value || DEFAULT_PROJECT).trim().slice(0, 18);
  return project || DEFAULT_PROJECT;
}

function formatCompactMoney(value) {
  const abs = Math.abs(value);

  if (abs >= 1_000_000_000) {
    return `$${trimZeros((value / 1_000_000_000).toFixed(2))}B`;
  }

  if (abs >= 1_000_000) {
    return `$${trimZeros((value / 1_000_000).toFixed(2))}M`;
  }

  if (abs >= 1_000) {
    return `$${trimZeros((value / 1_000).toFixed(2))}K`;
  }

  return `$${trimZeros(value.toFixed(2))}`;
}

function formatMultiplier(value) {
  return `${trimZeros(value.toFixed(2))}x`;
}

function formatSignedToken(value, options = {}) {
  const { prefixPositive = true } = options;
  const sign = value > 0 ? (prefixPositive ? "+" : "") : value < 0 ? "-" : "";
  const abs = Math.abs(value);
  return `${sign}${trimZeros(abs.toFixed(4))} SOL`;
}

function trimZeros(value) {
  return String(value).replace(/\.0+$|(\.\d*[1-9])0+$/g, "$1");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getThemePalette(theme, isPositive) {
  if (theme === "green") {
    return {
      accentA: "#22c55e",
      accentB: "#2dd4bf",
      accentGlow: "rgba(34, 197, 94, 0.42)",
      accentSoft: "rgba(45, 212, 191, 0.18)",
      line: "rgba(89, 255, 194, 0.11)",
      lineGlow: "rgba(41, 255, 173, 0.08)",
      profit: "#5df2a2",
      loss: "#ff6b81",
      topBar:
        "linear-gradient(90deg, rgba(34,197,94,0) 0%, rgba(34,197,94,0.88) 48%, rgba(45,212,191,0) 100%)",
      cardRing: "rgba(45, 212, 191, 0.34)",
      positiveRing: "rgba(34, 197, 94, 0.38)",
      negativeRing: "rgba(255, 107, 129, 0.35)",
      multiplierShadow: isPositive
        ? "0 0 24px rgba(34, 197, 94, 0.28), 0 0 72px rgba(45, 212, 191, 0.18)"
        : "0 0 24px rgba(255, 107, 129, 0.26), 0 0 72px rgba(45, 212, 191, 0.18)",
    };
  }

  return {
    accentA: "#38bdf8",
    accentB: "#0ea5e9",
    accentGlow: "rgba(56, 189, 248, 0.4)",
    accentSoft: "rgba(14, 165, 233, 0.15)",
    line: "rgba(125, 211, 252, 0.11)",
    lineGlow: "rgba(56, 189, 248, 0.08)",
    profit: "#4ade80",
    loss: "#fb7185",
    topBar:
      "linear-gradient(90deg, rgba(56,189,248,0) 0%, rgba(56,189,248,0.9) 48%, rgba(14,165,233,0) 100%)",
    cardRing: "rgba(56, 189, 248, 0.3)",
    positiveRing: "rgba(74, 222, 128, 0.34)",
    negativeRing: "rgba(251, 113, 133, 0.34)",
    multiplierShadow: isPositive
      ? "0 0 24px rgba(56, 189, 248, 0.3), 0 0 72px rgba(14, 165, 233, 0.16)"
      : "0 0 24px rgba(251, 113, 133, 0.26), 0 0 72px rgba(14, 165, 233, 0.16)",
  };
}

function renderCardHtml(model) {
  const cards = model.cards
    .map((card) => {
      const toneColor =
        card.tone === "profit"
          ? model.palette.profit
          : card.tone === "loss"
            ? model.palette.loss
            : "#f8fbff";
      const ringColor =
        card.tone === "profit"
          ? model.palette.positiveRing
          : card.tone === "loss"
            ? model.palette.negativeRing
            : model.palette.cardRing;

      return `
        <section class="data-card" style="--value-color:${toneColor};--ring:${ringColor};">
          <div class="data-label">${escapeHtml(card.label)}</div>
          <div class="data-value">${escapeHtml(card.value)}</div>
        </section>
      `;
    })
    .join("");

  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>${escapeHtml(model.project)} PnL</title>
      <style>
        :root {
          color-scheme: dark;
          --bg-top: #040c1d;
          --bg-mid: #06152a;
          --bg-bottom: #010307;
          --text: #f7fbff;
          --muted: rgba(224, 237, 255, 0.62);
          --accent-a: ${model.palette.accentA};
          --accent-b: ${model.palette.accentB};
          --accent-glow: ${model.palette.accentGlow};
          --line: ${model.palette.line};
        }

        * {
          box-sizing: border-box;
        }

        html, body {
          width: ${IMAGE_WIDTH}px;
          height: ${IMAGE_HEIGHT}px;
          margin: 0;
          overflow: hidden;
          background: #020611;
          font-family: Inter, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
        }

        body {
          position: relative;
          color: var(--text);
          background:
            radial-gradient(circle at 18% 16%, rgba(56, 189, 248, 0.18), transparent 30%),
            radial-gradient(circle at 82% 18%, rgba(14, 165, 233, 0.12), transparent 24%),
            radial-gradient(circle at 50% 54%, rgba(10, 30, 64, 0.24), transparent 44%),
            linear-gradient(180deg, var(--bg-top) 0%, var(--bg-mid) 54%, var(--bg-bottom) 100%);
        }

        body::before,
        body::after {
          content: "";
          position: absolute;
          inset: 0;
          pointer-events: none;
        }

        body::before {
          background-image:
            linear-gradient(to right, transparent 0, transparent 59px, var(--line) 60px),
            linear-gradient(to bottom, transparent 0, transparent 59px, var(--line) 60px);
          background-size: 60px 60px;
          mask-image: linear-gradient(180deg, rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.95));
          opacity: 0.7;
        }

        body::after {
          background:
            radial-gradient(circle at 50% 42%, var(--accent-glow), transparent 36%),
            radial-gradient(circle at 50% 68%, rgba(5, 10, 20, 0), rgba(2, 5, 12, 0.28) 70%);
          mix-blend-mode: screen;
          opacity: 0.85;
        }

        .frame {
          position: relative;
          width: 100%;
          height: 100%;
          padding: 28px;
        }

        .shell {
          position: relative;
          width: 100%;
          height: 100%;
          padding: 28px 30px 26px;
          border-radius: 30px;
          background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0.015)),
            rgba(3, 8, 18, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.06);
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.05),
            inset 0 0 0 1px rgba(255, 255, 255, 0.02),
            0 22px 80px rgba(0, 0, 0, 0.48);
          overflow: hidden;
          backdrop-filter: blur(18px);
        }

        .shell::before {
          content: "";
          position: absolute;
          top: 0;
          left: 50%;
          width: 56%;
          height: 2px;
          transform: translateX(-50%);
          background: ${model.palette.topBar};
          filter: blur(0.4px);
        }

        .shell::after {
          content: "";
          position: absolute;
          inset: 1px;
          border-radius: 29px;
          border: 1px solid rgba(255, 255, 255, 0.02);
          pointer-events: none;
        }

        .header {
          position: relative;
          z-index: 1;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .brand {
          display: flex;
          align-items: center;
          min-width: 0;
        }

        .project-block {
          min-width: 0;
        }

        .project-name {
          font-size: 28px;
          font-weight: 800;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .project-subtitle {
          margin-top: 5px;
          color: var(--muted);
          font-size: 12px;
          letter-spacing: 0.28em;
          text-transform: uppercase;
        }

        .timestamp {
          text-align: right;
          color: rgba(229, 240, 255, 0.84);
          font-size: 15px;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          padding: 10px 14px;
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(6, 12, 24, 0.64);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
        }

        .hero {
          position: relative;
          z-index: 1;
          display: grid;
          place-items: center;
          text-align: center;
          padding-top: 34px;
        }

        .hero::before {
          content: "";
          position: absolute;
          width: 540px;
          height: 220px;
          border-radius: 999px;
          background:
            radial-gradient(circle, rgba(255, 255, 255, 0.1) 0%, var(--accent-glow) 26%, transparent 72%);
          filter: blur(20px);
          opacity: 0.95;
        }

        .multiplier {
          position: relative;
          margin: 0;
          font-size: 136px;
          font-weight: 900;
          line-height: 0.9;
          letter-spacing: 0;
          background: linear-gradient(180deg, #ffffff 0%, var(--accent-a) 24%, var(--accent-b) 100%);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          text-shadow: ${model.palette.multiplierShadow};
        }

        .multiplier-label {
          position: relative;
          margin-top: 18px;
          color: rgba(224, 237, 255, 0.7);
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.42em;
          text-transform: uppercase;
        }

        .cards {
          position: absolute;
          left: 30px;
          right: 30px;
          bottom: 26px;
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 16px;
        }

        .data-card {
          position: relative;
          min-height: 118px;
          padding: 18px 20px 16px;
          border-radius: 22px;
          background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.01)),
            rgba(6, 13, 26, 0.76);
          border: 1px solid rgba(255, 255, 255, 0.06);
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.05),
            0 0 0 1px rgba(255, 255, 255, 0.018),
            0 18px 40px rgba(0, 0, 0, 0.34);
          overflow: hidden;
        }

        .data-card::before {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: 22px;
          padding: 1px;
          background: linear-gradient(135deg, rgba(255, 255, 255, 0.18), var(--ring), rgba(255, 255, 255, 0.04));
          -webkit-mask:
            linear-gradient(#fff 0 0) content-box,
            linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          pointer-events: none;
        }

        .data-card::after {
          content: "";
          position: absolute;
          inset: auto -10% -32px 18%;
          height: 64px;
          background: radial-gradient(circle, var(--ring), transparent 72%);
          opacity: 0.55;
          filter: blur(22px);
        }

        .data-label {
          position: relative;
          color: rgba(221, 235, 255, 0.62);
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.22em;
          text-transform: uppercase;
        }

        .data-value {
          position: relative;
          margin-top: 18px;
          color: var(--value-color);
          font-size: 31px;
          font-weight: 800;
          line-height: 1.05;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      </style>
    </head>
    <body>
      <div class="frame">
        <main class="shell">
          <header class="header">
            <div class="brand">
              <div class="project-block">
                <div class="project-name">${escapeHtml(model.project)}</div>
                <div class="project-subtitle">Profit &amp; Loss Snapshot</div>
              </div>
            </div>
            <div class="timestamp">${escapeHtml(model.timestamp)}</div>
          </header>

          <section class="hero">
            <h1 class="multiplier">${escapeHtml(model.multiplierText)}</h1>
            <div class="multiplier-label">Multiplier</div>
          </section>

          <section class="cards">
            ${cards}
          </section>
        </main>
      </div>
    </body>
  </html>`;
}

class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = "InputError";
  }
}
