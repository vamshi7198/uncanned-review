/**
 * Thin fetch wrapper for the backend.
 *
 * Same-origin requests carry the session cookie automatically. State-changing
 * requests echo the CSRF cookie in a header (double-submit pattern).
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

type Options = Omit<RequestInit, "body"> & {
  body?: unknown;
  raw?: BodyInit;
};

export async function api<T = unknown>(
  path: string,
  { body, raw, headers, method = "GET", ...rest }: Options = {},
): Promise<T> {
  const h = new Headers(headers);
  if (UNSAFE.has(method)) {
    const csrf = readCookie("ur_csrf");
    if (csrf) h.set("X-CSRF-Token", csrf);
  }
  let payload: BodyInit | undefined = raw;
  if (body !== undefined) {
    h.set("Content-Type", "application/json");
    payload = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: h,
      body: payload,
      credentials: "same-origin",
      ...rest,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(
      0,
      "network_error",
      "Could not reach the server. Check your connection and try again.",
    );
  }

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error;
    if (res.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("ur:unauthenticated"));
    }
    const { code, message, ...extra } = e ?? {};
    throw new ApiError(
      res.status,
      code ?? "http_error",
      message ?? `Request failed (${res.status}).`,
      extra,
    );
  }
  return data as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
