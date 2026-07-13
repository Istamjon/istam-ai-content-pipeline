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
    console.log("[fetchSources] Discovering articles from brand sources...");
    const articles = await discoverSources(sources);
    const newArticles: Article[] = [];
    let rejected = 0;

    for (const article of articles) {
      if (isArticleSeen(article.url)) continue;

      // Early brand-fit filter (title + url + rss snippet)
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

      newArticles.push(article);
    }

    // Prefer higher fit scores first
    newArticles.sort((a, b) => {
      const sa = scoreBrandFit({
        title: a.title,
        url: a.url,
        text: a.rawText || "",
      }).score;
      const sb = scoreBrandFit({
        title: b.title,
        url: b.url,
        text: b.rawText || "",
      }).score;
      return sb - sa;
    });

    const batch = newArticles.slice(0, env.MAX_ARTICLES_PER_RUN);
    console.log(
      `[fetchSources] Found ${articles.length} total, ` +
        `${newArticles.length} brand-fit unseen, rejected=${rejected}, batch=${batch.length}`,
    );
    for (const a of batch) {
      const f = scoreBrandFit({
        title: a.title,
        url: a.url,
        text: a.rawText || "",
      });
      console.log(`  - [score=${f.score}] ${a.title.slice(0, 70)} | ${a.url}`);
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
