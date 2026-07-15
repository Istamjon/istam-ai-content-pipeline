import { StateGraph } from "@langchain/langgraph";
import { StateAnnotation, GraphState } from "./state.js";
import * as nodes from "./nodes/index.js";

const routeAfterFetchSources = (state: GraphState): "__end__" | "fetchArticle" => {
  return state.newArticles.length > 0 ? "fetchArticle" : "__end__";
};

const routeAfterFetchArticle = (
  state: GraphState,
): "__end__" | "analyze" | "fetchArticle" => {
  if (state.current) return "analyze";
  // Empty/failed article: advance to next if any remain
  if (state.articleIndex < state.newArticles.length) return "fetchArticle";
  return "__end__";
};

/** After analyze: brand-reject clears current → try next article */
const routeAfterAnalyze = (
  state: GraphState,
): "translate" | "fetchArticle" | "__end__" => {
  if (state.current?.summary) return "translate";
  if (state.articleIndex < state.newArticles.length) return "fetchArticle";
  return "__end__";
};

const routeAfterQualityCheck = (
  state: GraphState,
): "generateImagePrompt" | "rewrite" | "fetchArticle" => {
  if (state.quality?.ok) return "generateImagePrompt";
  // retryCount is incremented in rewrite; allow one rewrite + one retry (2 total)
  if (state.retryCount < 2) return "rewrite";
  // Exhausted retries — do NOT publish this article
  console.warn(
    "[graph] quality failed after retries — skip publish, next article",
  );
  return "fetchArticle";
};

/** C: never format/publish without a local image file */
const routeAfterGenerateImage = (
  state: GraphState,
): "formatPosts" | "fetchArticle" => {
  const path = state.current?.imagePath;
  if (path) return "formatPosts";
  console.warn(
    "[graph] no image after generateImage — skip publish (image required)",
  );
  return "fetchArticle";
};

const routeAfterPublish = (state: GraphState): "__end__" | "fetchArticle" => {
  // One successful multi-platform publish is enough for this pipeline run.
  // Remaining batch articles are only used as fallbacks after quality/image skips.
  const anySuccess = (state.publishResults ?? []).some(
    (r) => r.status === "success",
  );
  if (anySuccess) {
    console.log(
      "[graph] publish succeeded — end run (no more articles this slot)",
    );
    return "__end__";
  }
  return state.articleIndex < state.newArticles.length
    ? "fetchArticle"
    : "__end__";
};

const builder = new StateGraph(StateAnnotation)
  .addNode("fetchSources", nodes.fetchSources)
  .addNode("fetchArticle", nodes.fetchArticle)
  .addNode("analyze", nodes.analyze)
  .addNode("translate", nodes.translate)
  .addNode("rewrite", nodes.rewrite)
  .addNode("qualityCheck", nodes.qualityCheck)
  .addNode("generateImagePrompt", nodes.generateImagePrompt)
  .addNode("generateImage", nodes.generateImage)
  .addNode("formatPosts", nodes.formatPosts)
  .addNode("schedule", nodes.schedule)
  .addNode("publish", nodes.publish)
  .addEdge("__start__", "fetchSources")
  .addConditionalEdges("fetchSources", routeAfterFetchSources)
  .addConditionalEdges("fetchArticle", routeAfterFetchArticle)
  .addConditionalEdges("analyze", routeAfterAnalyze)
  .addEdge("translate", "rewrite")
  .addEdge("rewrite", "qualityCheck")
  .addConditionalEdges("qualityCheck", routeAfterQualityCheck)
  .addEdge("generateImagePrompt", "generateImage")
  .addConditionalEdges("generateImage", routeAfterGenerateImage)
  .addEdge("formatPosts", "schedule")
  .addEdge("schedule", "publish")
  .addConditionalEdges("publish", routeAfterPublish);

export const graph = builder.compile();

graph.name = "Content Pipeline";

/**
 * Per-article path ≈ 11–15 steps; up to 5 articles + quality retries.
 * Default LangGraph recursionLimit (25) is too low for this pipeline.
 */
export const graphInvokeConfig = {
  recursionLimit: 150,
} as const;
