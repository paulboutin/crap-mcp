const descriptions = new Map([
  [200, "ok"],
  [201, "created"],
  [204, "no content"],
  [301, "moved"],
  [400, "bad request"],
  [401, "unauthorized"],
  [403, "forbidden"],
  [404, "not found"],
  [429, "rate limited"],
  [503, "unavailable"],
]);

export function describeStatus(code: number): string {
  return descriptions.get(code) ?? "unknown";
}
