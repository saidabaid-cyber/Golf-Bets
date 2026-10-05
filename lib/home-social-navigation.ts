export const HOME_SOCIAL_VIEWS = ["feed", "friends", "add-friends"] as const;
export type HomeSocialView = typeof HOME_SOCIAL_VIEWS[number];
export function homeSocialViewFromSearch(search: string): HomeSocialView {
  const value = new URLSearchParams(search).get("home");
  return HOME_SOCIAL_VIEWS.find(view => view === value) ?? "feed";
}
export function homeSocialHref(view: HomeSocialView, search: string) {
  const params = new URLSearchParams(search); params.delete("screen");
  if (view === "feed") params.delete("home"); else params.set("home", view);
  return `/${params.size ? `?${params}` : ""}`;
}
