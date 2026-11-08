// Contribution graph layout shared by the React renderer (editor and full-page
// preview) and the vanilla DOM builder that draws the published graph. Both
// build their markup from this one description of weeks, cells and levels.
export type GraphDay = { date: string; count: number };
export type GraphCell = {
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
} | null;

export const GRAPH_SOURCE_PATH = "/_/github.json";
export const GRAPH_MAX_DAYS = 366;

export function graphLevel(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((4 * count) / max))) as
    | 1
    | 2
    | 3
    | 4;
}

export function contributionLabel(count: number, date: string) {
  return `${count} ${count === 1 ? "contribution" : "contributions"} on ${date}`;
}

/** Whether `days` is a plausible, strictly ordered run of calendar days. */
export function validGraphDays(days: unknown): days is GraphDay[] {
  if (!Array.isArray(days) || days.length < 1 || days.length > GRAPH_MAX_DAYS)
    return false;
  let previous = "";
  for (const day of days) {
    if (
      !day ||
      typeof day !== "object" ||
      typeof day.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(day.date) ||
      new Date(day.date).toISOString().slice(0, 10) !== day.date ||
      day.date <= previous ||
      !Number.isSafeInteger(day.count) ||
      day.count < 0
    )
      return false;
    previous = day.date;
  }
  return true;
}

/**
 * Weeks run Sunday to Saturday. The first week is padded with empty cells so
 * every column lines up, as on GitHub. Counts are only ever the supplied ones.
 */
export function graphLayout(days: readonly GraphDay[]) {
  const first = days[0];
  const last = days[days.length - 1];
  const max = days.reduce((value, day) => Math.max(value, day.count), 0);
  const total = days.reduce((sum, day) => sum + day.count, 0);
  const cells: GraphCell[] = first
    ? Array.from({ length: new Date(first.date).getUTCDay() }, () => null)
    : [];
  for (const day of days)
    cells.push({ ...day, level: graphLevel(day.count, max) });
  const weeks: GraphCell[][] = [];
  for (let index = 0; index < cells.length; index += 7)
    weeks.push(cells.slice(index, index + 7));
  return {
    weeks,
    total,
    label:
      first && last
        ? `${total} ${total === 1 ? "contribution" : "contributions"} from ${first.date} to ${last.date}`
        : "No contribution data",
  };
}

export function graphUpdated(fetchedAt: string) {
  return `Updated ${fetchedAt.slice(0, 10)}`;
}
