/* Unknown URLs get the shop's own 404 page (noindex, and it checks whether
   the product someone is looking for was only just published) with status
   404 — what the static deployment served for them. */
import type { NextApiRequest, NextApiResponse } from "next";
import { readFileSync } from "fs";
import { join } from "path";

const page = readFileSync(join(process.cwd(), "public", "404.html"));

export default function notFound(req: NextApiRequest, res: NextApiResponse) {
  res.statusCode = 404;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
  res.end(req.method === "HEAD" ? undefined : page);
}

export const config = { api: { bodyParser: false } };
