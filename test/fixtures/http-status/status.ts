export function describeStatus(code: number): string {
  if (code === 200) {
    return "ok";
  }

  if (code === 201) {
    return "created";
  }

  if (code === 204) {
    return "no content";
  }

  if (code === 301) {
    return "moved";
  }

  if (code === 400) {
    return "bad request";
  }

  if (code === 401) {
    return "unauthorized";
  }

  if (code === 403) {
    return "forbidden";
  }

  if (code === 404) {
    return "not found";
  }

  if (code === 429) {
    return "rate limited";
  }

  if (code === 503) {
    return "unavailable";
  }

  return "unknown";
}
