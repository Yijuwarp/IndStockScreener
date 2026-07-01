const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function setCookie(name: string, value: string): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${ONE_YEAR_SECONDS}; path=/; samesite=lax`;
}

export function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function getJSONCookie<T>(name: string, fallback: T): T {
  const raw = getCookie(name);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function setJSONCookie(name: string, value: unknown): void {
  setCookie(name, JSON.stringify(value));
}
