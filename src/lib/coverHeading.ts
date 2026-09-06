/**
 * AI-driven Catchy Cover Heading Generator.
 * Creates punchy, attention-grabbing, short (2-4 words, ~<=30 chars) Uzbek Latin titles
 * specifically styled for high-CTR social media covers and thumbnails ("cover darajasida").
 *
 * Falls back to heuristic pickCoverHeading if AI generation fails or times out.
 */
import { env } from "../config/env.js";
import { pickCoverHeading, COVER_HEADING_MAX_LEN } from "../config/imagePrompt.js";
import { generateText } from "./geminiText.js";

const SYSTEM_PROMPT = `Siz professional ijtimoiy tarmoqlar (LinkedIn, Telegram, Instagram, YouTube) uchun texnologik postlar muqovasi (cover/thumbnail) dizaynerisiz.
Berilgan maqola sarlavhasi va mazmunidan kelib chiqib, rasm muqovasiga (cover) yoziladigan nihoyatda qiziqarli, jozibali, o'quvchi e'tiborini bir qarashda tortadigan ("cover darajasida") qisqa sarlavha yarating.

TALABLAR:
1. Faqat 2 ta yoki ko'pi bilan 4 ta kuchli so'z bo'lsin (maksimal 28 belgi).
2. O'zbekcha lotin alifbosida (o', g' harflari to'g'ri qo'llansin).
3. Diqqatni tortuvchi kuchli so'zlar bo'lsin (Masalan: "AI Yangi Davri", "Aqlli Agentlar", "Kodni O'zi Yozadi", "Katta Model Sakrashi", "Avtomatlashtirish Kuchi").
4. Faqat sarlavhaning o'zini qaytaring. Qo'shtirnoqsiz, nuqtasiz, ortiqcha izohlarsiz va belgilarsiz.`;

function cleanCoverHeading(raw: string, maxLen = COVER_HEADING_MAX_LEN): string {
  let text = (raw || "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/["'«»“”„]/g, "")
    .replace(/[.!?…:;—–-]+$/g, "")
    .replace(/^sarlavha[:\s]+/i, "")
    .replace(/\s+/g, " ")
    .trim();

  // Words formatting (Title Case)
  const words = text.split(" ").filter(Boolean);
  if (words.length > 5) {
    text = words.slice(0, 4).join(" ");
  }

  text = text
    .split(" ")
    .map((w) => {
      if (/^[A-Z0-9+.-]{2,}$/.test(w)) return w; // e.g. AI, API, RAG
      if (w.length <= 2) return w.toLowerCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ")
    .trim();

  if (text.length > maxLen) {
    const slice = text.slice(0, maxLen);
    const lastSpace = slice.lastIndexOf(" ");
    text = lastSpace >= 6 ? slice.slice(0, lastSpace) : slice;
  }

  return text.replace(/[.,;:]+$/, "").trim();
}

/**
 * Generate a catchy cover heading via UnoRouter chat completions (free models).
 */
async function tryUnoRouterChat(
  title: string,
  summary: string,
): Promise<string | null> {
  const apiKey = env.UNOROUTER_API_KEY;
  if (!apiKey) return null;

  const models = [
    "gemini-3.5-flash-lite:free",
    "glm-5.3-flash:free",
    "nemotron-3.5-lightning:free",
  ];

  const userContent = `Maqola sarlavhasi: ${title}\nQisqacha mazmuni: ${summary.slice(0, 250)}`;

  for (const model of models) {
    try {
      const res = await fetch(`${env.UNOROUTER_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userContent },
          ],
          temperature: 0.7,
        }),
        signal: AbortSignal.timeout(8_000),
      });

      if (!res.ok) continue;

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const rawHeading = data.choices?.[0]?.message?.content?.trim();
      if (rawHeading && rawHeading.length >= 4) {
        const cleaned = cleanCoverHeading(rawHeading);
        if (cleaned.length >= 4) return cleaned;
      }
    } catch {
      // Continue to next model/fallback
    }
  }
  return null;
}

/**
 * Generate a catchy cover heading via Gemini Text.
 */
async function tryGeminiText(
  title: string,
  summary: string,
): Promise<string | null> {
  try {
    const prompt = `Maqola sarlavhasi: ${title}\nQisqacha mazmuni: ${summary.slice(0, 250)}\n\nJozibali qisqa sarlavha:`;
    const rawHeading = await generateText(prompt, SYSTEM_PROMPT);
    if (rawHeading && rawHeading.trim().length >= 4) {
      const cleaned = cleanCoverHeading(rawHeading);
      if (cleaned.length >= 4) return cleaned;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Generate a catchy, topic-relevant short Uzbek title for cover images ("cover darajasida").
 * Tries UnoRouter Chat -> Gemini Text -> Rule-based pickCoverHeading fallback.
 */
export async function generateCatchyCoverHeading(input: {
  title: string;
  summary?: string;
  rewritten?: string;
  existingHeading?: string;
}): Promise<string> {
  if (input.existingHeading?.trim()) {
    return cleanCoverHeading(input.existingHeading.trim());
  }

  const title = (input.title || "").trim();
  const summary = (input.summary || input.rewritten || "").slice(0, 300);

  // 1) UnoRouter chat completion (fast free models)
  const fromUnoRouter = await tryUnoRouterChat(title, summary);
  if (fromUnoRouter) {
    console.log(`[coverHeading] generated via UnoRouter Chat: "${fromUnoRouter}"`);
    return fromUnoRouter;
  }

  // 2) Gemini text generation
  const fromGemini = await tryGeminiText(title, summary);
  if (fromGemini) {
    console.log(`[coverHeading] generated via Gemini Text: "${fromGemini}"`);
    return fromGemini;
  }

  // 3) Rule-based heuristic fallback
  const fallback = pickCoverHeading({
    title,
    rewritten: input.rewritten,
    maxLen: COVER_HEADING_MAX_LEN,
  });
  console.log(`[coverHeading] heuristic fallback: "${fallback}"`);
  return fallback;
}
