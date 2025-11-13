import JSZip from "jszip";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // seconds on Vercel serverless

const BodySchema = z.object({
  url: z.string().url().refine((u) => u.includes("pinterest.com"), "URL must be a pinterest.com link"),
  limit: z.number().int().min(1).max(400).default(50),
  cookie: z.string().optional()
});

function parseCookieHeader(header: string): Array<{ name: string; value: string }> {
  return header
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((nv) => {
      const idx = nv.indexOf("=");
      const name = idx === -1 ? nv : nv.slice(0, idx);
      const value = idx === -1 ? "" : nv.slice(idx + 1);
      return { name, value };
    })
    .filter((c) => c.name && typeof c.value === "string");
}

function extractNumeric(text: string | null | undefined): number {
  if (!text) return 0;
  const normalized = text.toLowerCase().replace(/[,\s]/g, "");
  const m = normalized.match(/(\d+(?:\.\d+)?)([km])?/);
  if (!m) return 0;
  const value = parseFloat(m[1]);
  const suffix = m[2];
  if (suffix === "k") return Math.round(value * 1_000);
  if (suffix === "m") return Math.round(value * 1_000_000);
  return Math.round(value);
}

async function autoScroll(page: puppeteer.Page, targetCount: number, maxMs = 60_000) {
  const start = Date.now();
  let prevHeight = 0;
  while (Date.now() - start < maxMs) {
    const { height, count } = await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight * 1.2);
      return { height: document.body.scrollHeight, count: Array.from(document.images).filter(img => img.src.includes("pinimg.com")).length };
    });
    if (count >= targetCount) break;
    if (height === prevHeight) {
      await page.waitForTimeout(800);
    } else {
      prevHeight = height;
      await page.waitForTimeout(500);
    }
  }
}

async function scrapePins(page: puppeteer.Page) {
  type Pin = { imageUrl: string; saves: number; href?: string };
  const pins: Pin[] = await page.evaluate(() => {
    function bestSrcFromImg(img: HTMLImageElement): string | null {
      const srcset = img.getAttribute("srcset");
      const src = img.getAttribute("src");
      const cands: string[] = [];
      if (src && src.includes("pinimg.com")) cands.push(src);
      if (srcset) {
        for (const part of srcset.split(",")) {
          const url = part.trim().split(" ")[0];
          if (url && url.includes("pinimg.com")) cands.push(url);
        }
      }
      if (cands.length === 0) return null;
      // Prefer the last candidate (usually highest resolution)
      return cands[cands.length - 1];
    }

    function extractSaves(el: Element): number {
      // Look for text like "1,2k saves" near the image or social proof elements
      const root = el.closest("a")?.parentElement || el.parentElement || el;
      if (!root) return 0;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let best = 0;
      while (walker.nextNode()) {
        const t = walker.currentNode.textContent || "";
        if (/save|saves|like|likes/i.test(t)) {
          const num = (t.match(/\d+[,.]?\d*\s*[kKmM]?/) || [""])[0];
          const normalized = num.toLowerCase().replace(/[,\s]/g, "");
          const m = normalized.match(/(\d+(?:\.\d+)?)([km])?/);
          if (m) {
            const value = parseFloat(m[1]);
            const suffix = m[2];
            const n = suffix === 'k' ? value * 1000 : suffix === 'm' ? value * 1_000_000 : value;
            if (n > best) best = n;
          }
        }
      }
      return Math.round(best);
    }

    const results: Pin[] = [];
    const imgs = Array.from(document.images).filter((img) => img.src.includes("pinimg.com"));
    for (const img of imgs) {
      const best = bestSrcFromImg(img as HTMLImageElement);
      if (!best) continue;
      const anchor = (img.closest("a") as HTMLAnchorElement | null);
      const href = anchor?.href;
      const saves = extractSaves(img);
      results.push({ imageUrl: best, saves, href });
    }
    // Deduplicate by URL
    const seen = new Set<string>();
    const unique: Pin[] = [];
    for (const p of results) {
      if (seen.has(p.imageUrl)) continue;
      seen.add(p.imageUrl);
      unique.push(p);
    }
    return unique;
  });
  return pins
    .sort((a, b) => b.saves - a.saves)
    .filter((p) => p.imageUrl && p.imageUrl.includes("pinimg.com"));
}

export async function POST(req: Request) {
  try {
    const json = await req.json();
    const { url, limit, cookie } = BodySchema.parse(json);

    const executablePath = await chromium.executablePath();
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 1200, height: 900 },
      executablePath,
      headless: chromium.headless,
    });
    const page = await browser.newPage();

    if (cookie) {
      const parsed = parseCookieHeader(cookie);
      if (parsed.length) {
        await page.setCookie(
          ...parsed.map((c) => ({
            name: c.name,
            value: c.value,
            domain: ".pinterest.com",
            path: "/",
            httpOnly: false,
            secure: true
          }))
        );
      }
    }

    await page.setUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
    );

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(1200);

    // Dismiss possible login walls/overlays if present
    try {
      await page.evaluate(() => {
        const selectors = [
          'div[role="dialog"] button',
          'button[aria-label*="close"]',
          'button[aria-label*="dismiss"]',
          'button:has(svg)'
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel) as HTMLButtonElement | null;
          if (el && /close|dismiss|later/i.test(el.textContent || el.getAttribute('aria-label') || '')) {
            el.click();
          }
        }
      });
    } catch {}

    await autoScroll(page, Math.max(limit * 3, 120));

    const pins = await scrapePins(page);
    const selected = pins.slice(0, limit);

    // Download images and zip
    const zip = new JSZip();
    const folder = zip.folder("pinterest-top")!;

    let index = 1;
    for (const pin of selected) {
      try {
        const res = await fetch(pin.imageUrl, {
          // Some CDNs require a referer header
          headers: { Referer: "https://www.pinterest.com/" }
        });
        if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        const ext = pin.imageUrl.split("?")[0].split(".").pop() || "jpg";
        const rank = String(index).padStart(3, "0");
        const name = `${rank}_likes-${pin.saves}.${ext}`;
        folder.file(name, buf);
        index += 1;
      } catch {
        // Skip failed downloads silently
      }
    }

    const out = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

    await browser.close();

    return new Response(out, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": "attachment; filename=\"pinterest-top-images.zip\""
      }
    });
  } catch (err: any) {
    const message = err?.message || "Unexpected error";
    return new Response(message, { status: 400 });
  }
}
