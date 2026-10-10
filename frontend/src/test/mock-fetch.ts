import { vi } from "vitest";

type Handler = (req: { url: string; method: string; body: unknown }) => {
  status?: number;
  body?: unknown;
};

/**
 * Route table for fetch: { "GET /api/projects": handler }.
 * A plain object is returned as a 200 JSON body; use a function to set a status.
 * Matches on method + path (a trailing * matches a prefix); first match wins.
 */
export function mockFetch(routes: Record<string, Handler | object>) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    const path = url.split("?")[0]!;
    const key = Object.keys(routes).find((k) => {
      const [m, p] = k.split(" ");
      return m === method && (p === path || (p!.endsWith("*") && path.startsWith(p!.slice(0, -1))));
    });
    if (!key) return new Response(JSON.stringify({ error: { code: "no_route", message: `No mock for ${method} ${path}` } }), { status: 404 });
    const h = routes[key]!;
    const res = typeof h === "function" ? (h as Handler)({ url, method, body }) : { body: h };
    const status = res.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(res.body ?? {}), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls };
}
