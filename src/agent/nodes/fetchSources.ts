import { StateAnnotation, Article, GraphUpdate } from "../state.js";
import { sources } from "../../config/brand.js";
import { discoverSources, shuffleInPlace } from "../../lib/scraper.js";
import { isArticleSeen, markArticleSeen } from "../../db.js";
import { env } from "../../config/env.js";
import { scoreBrandFit } from "../../lib/brandFit.js";

type ScoredArticle = { article: Article; score: number; reason: string };

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "unknown";
  }
}

/**
 * Pick a batch that rotates across hosts so we never stick to one blog
 * (e.g. always Chase AI just because it has the highest source boost).
 *
 * - Brand-fit still gates inclusion (primary + secondary that pass).
 * - Host order is shuffled each run.
 * - Within a host, top candidates are lightly shuffled (score still matters).
 * - Round-robin across hosts → diverse sources in the batch.
 */
function selectDiverseBatch(
  scored: ScoredArticle[],
  batchSize: number,
): ScoredArticle[] {
  if (scored.length === 0 || batchSize <= 0) return [];

  const byHost = new Map<string, ScoredArticle[]>();
  for (const row of scored) {
    const host = hostnameOf(row.article.url);
    const list = byHost.get(host) ?? [];
    list.push(row);
    byHost.set(host, list);
  }

  // Within host: prefer higher score, then shuffle among the top few
  // so the same post is not always first from that site.
  for (const [host, list] of byHost) {
    list.sort((a, b) => b.score - a.score);
    const topN = Math.min(5, list.length);
    const top = list.slice(0, topN);
    shuffleInPlace(top);
    byHost.set(host, [...top, ...list.slice(topN)]);
  }

  const hosts = shuffleInPlace([...byHost.keys()]);
  const pointers = new Map(hosts.map((h) => [h, 0]));
  const selected: ScoredArticle[] = [];

  while (selected.length < batchSize) {
    let added = false;
    for (const host of hosts) {
      if (selected.length >= batchSize) break;
      const list = byHost.get(host)!;
      const idx = pointers.get(host)!;
      if (idx < list.length) {
        selected.push(list[idx]!);
        pointers.set(host, idx + 1);
        added = true;
      }
    }
    if (!added) break;
  }

  return selected;
}

export async function fetchSources(
  _state: typeof StateAnnotation.State,
): Promise<GraphUpdate> {
  try {
    console.log(
      `[fetchSources] Discovering from ${sources.length} brand sources ` +
        `(random order; primary + secondary)…`,
    );
    const articles = await discoverSources(sources);
    const scored: ScoredArticle[] = [];
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

    // Diverse hosts (not pure score sort — that always locked onto one primary blog)
    const batchSize = Math.max(env.MAX_ARTICLES_PER_RUN, 5);
    const batchRows = selectDiverseBatch(scored, batchSize);
    const batch = batchRows.map((s) => s.article);
    const hostSet = new Set(batch.map((a) => hostnameOf(a.url)));

    console.log(
      `[fetchSources] Found ${articles.length} total, ` +
        `${scored.length} brand-fit unseen, rejected=${rejected}, ` +
        `batch=${batch.length} from ${hostSet.size} host(s): ${[...hostSet].join(", ")}`,
    );
    for (const row of batchRows) {
      console.log(
        `  - [score=${row.score}] [${hostnameOf(row.article.url)}] ` +
          `${row.article.title.slice(0, 60)} | ${row.article.url}`,
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
