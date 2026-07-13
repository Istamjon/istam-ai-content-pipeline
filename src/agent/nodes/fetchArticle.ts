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
      // Skip permanently so we do not retry forever
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
    if (article) {
      skipArticle(article.url, article.title || "Untitled", "fetch-error");
    }
    return {
      ...articleLoopReset(),
      errors: [`fetchArticle error: ${String(error)}`],
      articleIndex: state.articleIndex + 1,
      current: null,
    };
  }
}
