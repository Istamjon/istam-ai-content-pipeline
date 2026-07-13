/**
 * AI Horde (stablehorde) async image generation
 * @see https://aihorde.net/api/
 */
import { env } from "../config/env.js";
import {
  getProviderImageBudget,
  incrementProviderImageUsage,
} from "../db.js";

const BASE = "https://aihorde.net/api/v2";

export function isHordeConfigured(): boolean {
  return Boolean(env.AIHORDE_API_KEY);
}

export function canUseHordeToday(): {
  ok: boolean;
  used: number;
  limit: number;
  remaining: number;
} {
  const limit = env.DAILY_HORDE_LIMIT;
  const b = getProviderImageBudget("horde", limit);
  return { ok: b.remaining > 0 && isHordeConfigured(), ...b };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

function headers(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    apikey: env.AIHORDE_API_KEY,
    ClientAgent: "LangGraphPipeline:1.0:IstamObidov",
  };
}

/**
 * Submit async job, poll until done, download image (r2 URL or base64).
 */
export async function hordeImage(prompt: string): Promise<Buffer> {
  if (!isHordeConfigured()) {
    throw new Error("AIHORDE_API_KEY missing");
  }
  const budget = canUseHordeToday();
  if (!budget.ok) {
    throw new Error(`horde daily limit ${budget.used}/${budget.limit}`);
  }

  // Free anonymous/low-kudos: max ~788px and modest steps (Horde kudos gate).
  // Snap to multiples of 64; prefer 768 so social posts stay sharp enough.
  const maxSide = 768;
  const width = Math.min(env.IMAGE_WIDTH || maxSide, maxSide);
  const height = Math.min(env.IMAGE_HEIGHT || maxSide, maxSide);
  const w = Math.max(512, Math.floor(width / 64) * 64);
  const h = Math.max(512, Math.floor(height / 64) * 64);
  const steps = 20; // well under 50-step kudos threshold

  const safePrompt = prompt.trim().slice(0, 1000);
  // SD-style negative after ### — reinforce no office / room layouts
  const fullPrompt =
    safePrompt +
    " ### low quality, blurry, text, watermark, logo, cartoon, people, faces, office, room, corridor, floor tiles, walls, ceiling, desk, chair, keyboard, furniture, architecture interior";

  console.log(
    `[horde] async ${w}x${h} steps=${steps} promptLen=${safePrompt.length} budget=${budget.used}/${budget.limit}`,
  );

  const submit = await fetch(`${BASE}/generate/async`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      prompt: fullPrompt,
      params: {
        width: w,
        height: h,
        steps,
        n: 1,
        sampler_name: "k_euler",
        cfg_scale: 6,
        denoising_strength: 1.0,
      },
      nsfw: false,
      censor_nsfw: true,
      r2: true,
      trusted_workers: false,
      // Empty models = any available worker (higher chance of pickup)
      models: [],
    }),
    signal: AbortSignal.timeout(30_000),
  });

  const submitJson = (await submit.json()) as {
    id?: string;
    message?: string;
    errors?: unknown;
  };
  if (!submit.ok || !submitJson.id) {
    throw new Error(
      `horde submit failed: ${submitJson.message || JSON.stringify(submitJson).slice(0, 200)}`,
    );
  }

  const id = submitJson.id;
  console.log(`[horde] job id=${id}`);

  const maxPolls = 60; // ~3 min
  for (let i = 0; i < maxPolls; i++) {
    await sleep(3000);
    const checkRes = await fetch(`${BASE}/generate/check/${id}`, {
      headers: headers(),
      signal: AbortSignal.timeout(15_000),
    });
    const check = (await checkRes.json()) as {
      done?: boolean;
      faulted?: boolean;
      waiting?: number;
      processing?: number;
      queue_position?: number;
    };

    if (i % 5 === 0) {
      console.log(
        `[horde] poll ${i}: done=${check.done} waiting=${check.waiting} processing=${check.processing} queue=${check.queue_position}`,
      );
    }

    if (check.faulted) {
      throw new Error("horde job faulted");
    }
    if (!check.done) continue;

    const statusRes = await fetch(`${BASE}/generate/status/${id}`, {
      headers: headers(),
      signal: AbortSignal.timeout(30_000),
    });
    const status = (await statusRes.json()) as {
      generations?: Array<{ img?: string; seed?: string }>;
      faulted?: boolean;
    };
    const img = status.generations?.[0]?.img;
    if (!img) {
      throw new Error("horde: no image in status");
    }

    let buf: Buffer;
    if (/^https?:\/\//i.test(img)) {
      const dl = await fetch(img, { signal: AbortSignal.timeout(60_000) });
      if (!dl.ok) throw new Error(`horde download ${dl.status}`);
      buf = Buffer.from(await dl.arrayBuffer());
    } else {
      // base64 webp/png
      buf = Buffer.from(img, "base64");
    }

    const used = incrementProviderImageUsage("horde", 1);
    console.log(`[horde] OK bytes=${buf.length} daily=${used}/${env.DAILY_HORDE_LIMIT}`);
    return buf;
  }

  throw new Error("horde: timeout waiting for workers");
}
