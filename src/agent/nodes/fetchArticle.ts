import { StateAnnotation, Article, GraphUpdate, articleLoopReset } from "../state.js";
import { fetchArticleContent } from "../../lib/scraper.js";
import { markArticleSeen } from "../../db.js";

function skipArticle(url: string, title: string, reason: string): void {
  try {
    markArticleSeen(url, title, "skipped", reason.slice(0, 32));
  } catch {
    // ignore
  }
}

export async function fetchArticle(
  state: typeof StateAnnotation.State,
): Promise<GraphUpdate> {
  try {
    if (state.articleIndex >= state.newArticles.length) {
      return {
        ...articleLoopReset(),
        current: null,
      };
    }

    const article = state.newArticles[state.articleIndex];
    let title = article.title;
    let rawText = article.rawText;

    if (!rawText || rawText.length < 200) {
      const fetched = await fetchArticleContent(article.url);
      rawText = fetched.rawText;
      if (fetched.title && fetched.title !== "No Title") {
        title = fetched.title;
      }
    }

    if (!rawText || rawText.trim().length < 50) {
      // Truly empty after a successful parse — permanent skip
      skipArticle(article.url, title || "Untitled", "empty-content");
      return {
        ...articleLoopReset(),
        articleIndex: state.articleIndex + 1,
        current: null,
        errors: [`fetchArticle: empty content for ${article.url}`],
      };
    }

    const current: Article = {
      url: article.url,
      title: title || "Untitled",
      rawText: rawText.slice(0, 10000),
    };

    return {
      ...articleLoopReset(),
      current,
      articleIndex: state.articleIndex + 1,
    };
  } catch (error) {
    const article = state.newArticles[state.articleIndex];
    const msg = String(error);
    // Network / bot-block / timeout: do NOT mark seen — next cron can retry
    // (previous behavior burned OpenAI/etc. articles forever as fetch-error).
    console.warn(
      `[fetchArticle] transient fail (not marking seen): ${article?.url || "?"} — ${msg.slice(0, 180)}`,
    );
    return {
      ...articleLoopReset(),
      errors: [`fetchArticle error: ${msg}`],
      articleIndex: state.articleIndex + 1,
      current: null,
    };
  }
}
