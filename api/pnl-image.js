import { handlePnlRequest } from "../lib/pnl-core.js";

export const config = {
  maxDuration: 10,
};

export default async function handler(req, res) {
  return handlePnlRequest(req, res);
}
