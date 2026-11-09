import { useEffect, useState } from "react";

export type TabId = "home" | "tasks" | "cases" | "profile";

export interface Route {
  path: string;
  segments: string[];
  query: URLSearchParams;
}

export const TAB_PATHS: Record<TabId, string> = {
  home: "/",
  tasks: "/tasks",
  cases: "/cases",
  profile: "/profile",
};

export function parseHash(hash: string): Route {
  const cleaned = hash.replace(/^#/, "");
  const [rawPath, rawQuery = ""] = cleaned.split("?");
  const segments = (rawPath ?? "").split("/").filter(Boolean).map((part) => decodeURIComponent(part));
  return { path: `/${segments.join("/")}`, segments, query: new URLSearchParams(rawQuery) };
}

export function tabOf(route: Route): TabId | null {
  if (route.segments.length === 0) return "home";
  if (route.segments.length !== 1) return null;
  const first = route.segments[0];
  return first === "tasks" || first === "cases" || first === "profile" ? first : null;
}

export function parentOf(route: Route): string {
  const [first, second, third] = route.segments;
  if (!first) return "/";
  if (first === "admin") {
    if (second === "users" && third) return "/admin/users";
    if (second) return "/admin";
    return "/profile";
  }
  if (first === "history" || first === "rules") return route.query.get("from") === "home" ? "/" : "/profile";
  if (first === "withdraw") return route.query.get("from") === "profile" ? "/profile" : "/";
  if (first === "notifications") return "/";
  return "/";
}

export function navigate(path: string, options: { replace?: boolean } = {}): void {
  const target = `#${path}`;
  if (window.location.hash === target) return;
  if (options.replace) {
    window.history.replaceState(null, "", target);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    window.location.hash = path;
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const handler = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);
  return route;
}
