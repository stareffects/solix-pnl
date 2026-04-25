import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeBrowser, createApp } from "./lib/pnl-core.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);

const app = createApp(__dirname);
const server = app.listen(PORT, () => {
  console.log(`PnL image API listening on http://localhost:${PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    console.log(`Received ${signal}, shutting down.`);

    server.close(async () => {
      await closeBrowser();
      process.exit(0);
    });
  });
}
