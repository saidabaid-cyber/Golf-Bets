export type SocialFeedView = { id: string; kind: "results" | "comments" };

/** Feed destinations own these two keys; scorecard and global navigation keep theirs. */
export function socialFeedViewFromSearch(search: string): SocialFeedView | null {
  const query = new URLSearchParams(search);
  if (query.has("card") || (query.has("screen") && query.get("screen") !== "welcome") || (query.has("home") && query.get("home") !== "feed")) return null;
  const id = query.get("feedActivity"), kind = query.get("feedView");
  return id && /^[\w-]{1,80}$/.test(id) && (kind === "results" || kind === "comments") ? { id, kind } : null;
}

export function socialFeedViewHref(search: string, view: SocialFeedView | null): string {
  const query = new URLSearchParams(search);
  query.delete("feedActivity"); query.delete("feedView");
  if (view) { query.set("feedActivity", view.id); query.set("feedView", view.kind); }
  return query.size ? `/?${query}` : "/";
}
