import { StateAnnotation, GraphUpdate } from "../state.js";
import { pollinationsText } from "../../lib/pollinations.js";
import { markArticleSeen } from "../../db.js";
import { brand } from "../../config/brand.js";
import { roles, buildQualityUserPrompt } from "../prompts.js";
import { extractFactsFromBrief, hasFactsSection } from "../../lib/factsFromBrief.js";

export async function qualityCheck(
  state: typeof StateAnnotation.State,
): Promise<GraphUpdate> {
  try {
    const current = state.current;
    if (!current || !current.rewritten) {
      return {
        quality: { ok: false, issues: ["No rewritten content available"] },
        errors: ["qualityCheck: no rewritten content"],
      };
    }

    const text = current.rewritten;
    const issues: string[] = [];

    // ── Local hard gates ──
    if (text.length < 100) {
      issues.push("Too short (<100 chars)");
    }
    if (text.length > 3500) {
      issues.push("Too long for social post (>3500 chars) — condense");
    }

    const trimmed = text.trim();
    const endsWithSource =
      /manba\s*:/i.test(trimmed.slice(-120)) ||
      /https?:\/\/\S+$/i.test(trimmed);
    if (
      !endsWithSource &&
      /[\w'`]{3,}$/i.test(trimmed) &&
      !/[.!?…)"»\]]\s*$/.test(trimmed)
    ) {
      issues.push("Looks truncated — incomplete ending");
    }
    if (/(.)\1{4,}/.test(text)) {
      issues.push("Repeated character spam detected");
    }

    const neverPatterns: Array<{ re: RegExp; label: string }> = [
      {
        re: /\b(kripto|crypto|bitcoin|btc|nft|token\s*sot|airdrop)\b/i,
        label: "Never-publish topic: cryptocurrency",
      },
      {
        re: /\b(mish-mish|rumou?r|tasdiqlanmagan|clickbait)\b/i,
        label: "Never-publish: unverified rumor / clickbait",
      },
    ];
    for (const { re, label } of neverPatterns) {
      if (re.test(text)) issues.push(label);
    }

    if (
      !/\b(AI|LLM|agent|LangGraph|LangChain|MCP|model|API|kod|dastur|engineering|automation|pipeline)\b/i.test(
        text,
      )
    ) {
      issues.push("Off-brand: not clearly AI / engineering related");
    }

    if (
      /Yangi\s+[\w\s.-]*maqolasi\s*:/i.test(text) ||
      /Skywork(\s+AI)?\s+maqolasi/i.test(text) ||
      /DeepMind\s+maqolasi/i.test(text)
    ) {
      issues.push(
        'Forbidden phrase like "Yangi … maqolasi:" / site-name intro — start with the idea',
      );
    }

    if (/©|®|all rights reserved/i.test(text)) {
      issues.push("Copyright markers should not appear in public post body");
    }

    // E: require grounded fact list when analyst produced FACTS
    const briefFacts = extractFactsFromBrief(current.summary);
    if (briefFacts.length >= 3 && !hasFactsSection(text)) {
      issues.push(
        'Missing "Asosiy faktlar:" section (3–5 bullets from source FACTS)',
      );
    }

    // ── Anti-confusion: even 1 unsupported product token = hard fail ──
    const sourcePool = `${current.rawText || ""}\n${current.translated || ""}\n${current.title || ""}\n${current.summary || ""}`;
    const productish =
      text.match(
        /\b(LangGraph|LangChain|MCP|OpenAI|Anthropic|Gemini|Claude|GPT-?[0-9]|Llama|Kubernetes|Docker|Redis|Pinecone|Weaviate|Chroma|CrewAI|AutoGen|Semantic Kernel)\b/gi,
      ) || [];
    const uniqueProducts = [
      ...new Set(productish.map((p) => p.toLowerCase())),
    ];
    const unsupported = uniqueProducts.filter(
      (p) =>
        !new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(
          sourcePool,
        ),
    );
    if (unsupported.length >= 1) {
      issues.push(
        `Unsupported tools vs source (must remove): ${unsupported.slice(0, 5).join(", ")}`,
      );
    }

    // ── LLM brand + FACT quality gate (hard) ──
    // Always run when local gates passed; fact failure is non-negotiable.
    if (issues.length === 0) {
      try {
        const sourceExcerpt = (
          current.translated ||
          current.rawText ||
          ""
        ).slice(0, 5000);
        const llmResult = await pollinationsText(
          buildQualityUserPrompt(text, current.url, sourceExcerpt),
          roles.qualityController,
        );

        const okYes = /OK:\s*yes/i.test(llmResult);
        const okNo = /OK:\s*no/i.test(llmResult);
        const factNo = /FACT_OK:\s*no/i.test(llmResult);
        const factYes = /FACT_OK:\s*yes/i.test(llmResult);
        const issuesLine = llmResult.match(/ISSUES:\s*(.+)/i)?.[1]?.trim();

        // B: FACT_OK must be explicit yes
        if (factNo || !factYes) {
          issues.push(
            issuesLine && !/^none$/i.test(issuesLine)
              ? `Fact check: ${issuesLine.slice(0, 160)}`
              : "FACT_OK not yes — claims not grounded in source",
          );
        }

        // B: OK: no is hard fail (no soft stylistic pass-through)
        if (okNo || !okYes) {
          if (issuesLine && !/^none$/i.test(issuesLine)) {
            for (const part of issuesLine
              .split(/[,;]/)
              .map((s) => s.trim())
              .filter(Boolean)
              .slice(0, 5)) {
              if (!issues.some((i) => i.includes(part.slice(0, 40)))) {
                issues.push(part.slice(0, 120));
              }
            }
          } else if (okNo) {
            issues.push("LLM quality gate failed brand standards");
          } else if (!okYes && issues.length === 0) {
            issues.push("LLM quality gate: missing OK: yes");
          }
        }
      } catch (e) {
        // B: do not silently pass when LLM gate errors
        issues.push(
          `Quality LLM gate error: ${e instanceof Error ? e.message.slice(0, 100) : String(e)}`,
        );
      }
    }

    for (const topic of brand.neverPublish) {
      void topic;
    }

    const ok = issues.length === 0;
    console.log(
      `[qualityCheck] ok=${ok} retryCount=${state.retryCount} issues=${JSON.stringify(issues)}`,
    );

    if (!ok && state.retryCount >= 2) {
      console.warn(
        "[qualityCheck] Final fail — will NOT publish. Draft preview:\n",
        text.slice(0, 800),
      );
      try {
        markArticleSeen(
          current.url,
          current.title,
          "quality-failed",
          "quality-failed",
        );
      } catch {
        // ignore
      }
    }

    return {
      quality: { ok, issues },
    };
  } catch (error) {
    return {
      quality: { ok: false, issues: [`Quality check failed: ${String(error)}`] },
      errors: [`qualityCheck error: ${String(error)}`],
    };
  }
}
