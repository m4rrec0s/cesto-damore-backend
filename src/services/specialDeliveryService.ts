interface SpecialDayWindow {
  start: string;
  end: string;
}

interface SpecialDayConfig {
  day: string;
  time?: "full" | "morning" | "afternoon";
  start?: string;
  end?: string;
}

const WEEKDAY_WINDOWS: SpecialDayWindow[] = [
  { start: "09:00", end: "13:00" },
  { start: "14:00", end: "18:00" },
];

function normalizeDay(day: string): string {
  const trimmed = day.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  return trimmed;
}

function resolveWindows(config: SpecialDayConfig): SpecialDayWindow[] {
  if (config.start && config.end) {
    return [{ start: config.start, end: config.end }];
  }

  switch (config.time) {
    case "morning":
      return [{ start: "09:00", end: "13:00" }];
    case "afternoon":
      return [{ start: "14:00", end: "18:00" }];
    case "full":
    default:
      return WEEKDAY_WINDOWS;
  }
}

function parseConfig(raw?: string): SpecialDayConfig[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is SpecialDayConfig =>
        !!entry &&
        typeof entry === "object" &&
        typeof entry.day === "string",
    );
  } catch {
    return [];
  }
}

class SpecialDeliveryService {
  listSpecialDays() {
    const configs = parseConfig(process.env.SPECIAL_DELIVERY_DAYS);
    return configs.map((config) => ({
      day: normalizeDay(config.day),
      windows: resolveWindows(config),
    }));
  }

  findWindowsForDate(dateKey: string): SpecialDayWindow[] | null {
    const entries = this.listSpecialDays();
    const match = entries.find((entry) => entry.day === dateKey);
    return match ? match.windows : null;
  }
}

export default new SpecialDeliveryService();
