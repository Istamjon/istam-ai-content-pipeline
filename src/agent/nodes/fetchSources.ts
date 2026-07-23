import { StateAnnotation, Article, GraphUpdate } from "../state.js";
import { sources } from "../../config/brand.js";
import { discoverSources } from "../../lib/scraper.js";
import { isArticleSeen, markArticleSeen } from "../../db.js";
import { env } from "../../config/env.js";
import { scoreBrandFit } from "../../lib/brandFit.js";

export async function fetchSources(
  _state: typeof StateAnnotation.State,
): Promise<GraphUpdate> {
  try {
    console.log(
      `[fetchSources] Discovering from ${sources.length} brand sources ` +
        `(${sources.map((s) => s.name).join(", ")})...`,
    );
    const articles = await discoverSources(sources);
    const scored: Array<{ article: Article; score: number; reason: string }> = [];
    let rejected = 0;

    for (const article of articles) {
      if (isArticleSeen(article.url)) continue;

      // Early brand-fit filter (title + url + rss snippet + preferred-host boost)
      const fit = scoreBrandFit({
        title: article.title,
        url: article.url,
        text: article.rawText || "",
      });

      if (!fit.ok) {
        rejected += 1;
        console.log(
          `[fetchSources] REJECT brand-fit: ${article.title.slice(0, 70)} — ${fit.reason}`,
        );
        try {
          markArticleSeen(
            article.url,
            article.title,
            "brand-reject",
            fit.reason.slice(0, 32),
          );
        } catch {
          /* ignore */
        }
        continue;
      }

      scored.push({ article, score: fit.score, reason: fit.reason });
    }

    // Prefer higher brand-fit (primary hosts already boosted in scoreBrandFit)
    scored.sort((a, b) => b.score - a.score);
    // Daily reliability: larger batch so quality failures can fall through to next article
    const batchSize = Math.max(env.MAX_ARTICLES_PER_RUN, 5);
    const newArticles = scored.map((s) => s.article);
    const batch = newArticles.slice(0, batchSize);

    console.log(
      `[fetchSources] Found ${articles.length} total, ` +
        `${newArticles.length} brand-fit unseen, rejected=${rejected}, batch=${batch.length}`,
    );
    for (const row of scored.slice(0, batch.length)) {
      console.log(
        `  - [score=${row.score}] ${row.article.title.slice(0, 70)} | ${row.article.url}`,
      );
    }

    return {
      newArticles: batch,
      articleIndex: 0,
      current: null,
      formatted: {
        telegram: null,
        linkedin: null,
        facebook: null,
        instagram: null,
        x: null,
        threads: null,
        blogger: null,
      },
      quality: null,
      publishResults: [],
      retryCount: 0,
    };
  } catch (error) {
    return {
      errors: [`fetchSources error: ${String(error)}`],
      newArticles: [],
    };
  }
}
