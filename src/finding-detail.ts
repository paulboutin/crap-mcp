// Keep a bounded, numbered extract from the scanned revision for offline reports.
export function sourceExcerpt(lines: string[], start: number, end: number) {
  const count = end - start + 1;

  const selected =
    count > 5
      ? [0, 1, 2, -1, count - 1]
      : Array.from({ length: count }, (_, i) => i);

  return selected
    .map((offset) => {
      if (offset < 0) return "…";
      const text = lines[start + offset - 1] ?? "";

      return (
        start +
        offset +
        "  " +
        (text.length > 180 ? text.slice(0, 180) + "…" : text)
      );
    })
    .join("\n");
}

export interface Guidance {
  why: string;
  impact: string;
  action: string;
  check: string;
  scoring: string;
}

export interface FindingDetail extends Guidance {
  file: string;
  line: number;
  end?: number;
  excerpt?: string;
}
