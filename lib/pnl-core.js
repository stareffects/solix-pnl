import chromium from "@sparticuz/chromium-min";
import puppeteer from "puppeteer-core";

export const IMAGE_WIDTH = 1200;
export const IMAGE_HEIGHT = 630;

const BACKGROUND =
  "https://raw.githubusercontent.com/stareffects/solix-pnl/main/assets/solaris-bg.jpg";

let browserPromise;

// ================= HANDLER =================

export async function handlePnlRequest(req, res) {
  try {
    const query = req.query || {};
    const model = buildModel(query);
    const buffer = await render(model);

    res.setHeader("Content-Type", "image/png");
    res.status(200).send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

// ================= MODEL =================

function buildModel(q) {
  const entry = parseNum(q.entry);
  const start = parseMC(q.startmc);
  const end = parseMC(q.endmc);
  const gas = parseNum(q.gas || 0);

  const multiplier = end / start;
  const profit = entry * (multiplier - 1);

  return {
    project: "SOLARIS",
    date: new Date().toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
    multiplier: multiplier.toFixed(2) + "x",
    cards: [
      ["Entry", `${entry} SOL`],
      ["Start MC", formatMC(start)],
      ["End MC", formatMC(end)],
      ["Profit", `+${profit.toFixed(2)} SOL`],
      ["Gas Fee", `${gas} SOL`],
      ["Net PnL", `+${profit.toFixed(2)} SOL`],
    ],
  };
}

// ================= RENDER =================

async function render(model) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  await page.setViewport({
    width: IMAGE_WIDTH,
    height: IMAGE_HEIGHT,
  });

  await page.setContent(html(model));

  const img = await page.screenshot({ type: "png" });
  await page.close();

  return img;
}

// ================= BROWSER =================

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.executablePath(
      "https://github.com/Sparticuz/chromium/releases/download/v138.0.2/chromium-v138.0.2-pack.x64.tar"
    ).then((executablePath) =>
      puppeteer.launch({
        args: chromium.args,
        executablePath,
        headless: chromium.headless,
      })
    );
  }

  return browserPromise;
}

// ================= HTML =================

function html(m) {
  const cards = m.cards
    .map(
      ([label, val]) => `
      <div class="card">
        <div class="label">${label}</div>
        <div class="value">${val}</div>
      </div>`
    )
    .join("");

  return `
  <html>
  <head>
  <style>
    body {
      width: 1200px;
      height: 630px;
      margin: 0;
      font-family: Inter, sans-serif;
      color: white;
      background:
        linear-gradient(rgba(0,0,0,.6), rgba(0,0,0,.8)),
        url("${BACKGROUND}") center/cover;
    }

    .container {
      padding: 40px;
    }

    .top {
      display:flex;
      justify-content:space-between;
    }

    .title {
      font-size:28px;
      font-weight:800;
    }

    .time {
      font-size:14px;
      opacity:.8;
    }

    .mult {
      text-align:center;
      font-size:120px;
      font-weight:900;
      margin-top:40px;
      background: linear-gradient(#fff,#aaa);
      -webkit-background-clip:text;
      color:transparent;
    }

    .grid {
      display:grid;
      grid-template-columns:repeat(3,1fr);
      gap:15px;
      margin-top:40px;
    }

    .card {
      background:rgba(0,0,0,.6);
      padding:15px;
      border-radius:15px;
    }

    .label {
      font-size:12px;
      opacity:.7;
    }

    .value {
      font-size:24px;
      font-weight:700;
      margin-top:10px;
    }
  </style>
  </head>

  <body>
    <div class="container">
      <div class="top">
        <div class="title">${m.project}</div>
        <div class="time">${m.date}</div>
      </div>

      <div class="mult">${m.multiplier}</div>

      <div class="grid">
        ${cards}
      </div>
    </div>
  </body>
  </html>
  `;
}

// ================= PARSERS =================

function parseNum(v) {
  return Number(String(v).replace(",", ".").replace("sol", ""));
}

function parseMC(v) {
  const s = String(v).toLowerCase();

  if (s.endsWith("m")) return Number(s.slice(0, -1)) * 1_000_000;
  if (s.endsWith("k")) return Number(s.slice(0, -1)) * 1_000;

  return Number(s) * 1000;
}

function formatMC(n) {
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1000) return "$" + (n / 1000).toFixed(1) + "K";
  return "$" + n;
}
