/**
 * formatPosts — derives platform posts ONLY from Canonical Content.
 * Master facts live in data/canonical/*.json; this node never invents new body text.
 */
import { StateAnnotation, GraphUpdate } from "../state.js";
import { buildAndSaveCanonical } from "../../canonical/buildCanonical.js";
import { formatAllFromCanonical } from "../../canonical/formatFromCanonical.js";

export async function formatPosts(
  state: typeof StateAnnotation.State,
): Promise<GraphUpdate> {
  try {
    const current = state.current;
    if (!current || !current.rewritten) {
      return { errors: ["formatPosts: no rewritten content for canonical"] };
    }

    // 1) Save / update master Canonical Content (source of truth)
    const canonical = buildAndSaveCanonical(current, {
      summary: current.summary,
    });

    // 2) Format all platforms from that single body
    const formatted = formatAllFromCanonical(canonical);
    // Keep cache in sync on disk (already saved inside buildAndSaveCanonical with derived)
    void canonical.derived;

    const nonNull = Object.entries(formatted).filter(([, v]) => v?.text).length;
    console.log(
      `[formatPosts] from canonical id=${canonical.id} v${canonical.version} platforms=${nonNull}`,
    );
    console.log(
      "[formatPosts] footer preview:\n",
      (formatted.linkedin?.text || "")
        .split("\n")
        .slice(-12)
        .join("\n"),
    );

    return {
      formatted,
      canonical,
      current: {
        ...current,
        rewritten: canonical.body,
        imagePath: canonical.imagePath || current.imagePath,
      },
    };
  } catch (error) {
    return {
      errors: [`formatPosts/canonical error: ${String(error)}`],
    };
  }
}
