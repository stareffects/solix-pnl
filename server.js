import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeBrowser, handleLocalRequest } from "./lib/pnl-core.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);

const server = createServer((req, res) => {
  handleLocalRequest(req, res, __dirname);
});

server.listen(PORT, () => {
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
