import specialDeliveryService from "../services/specialDeliveryService";

type DeliveryWindow = { start: string; end: string };

const WEEKDAY_WINDOWS: DeliveryWindow[] = [
  { start: "09:00", end: "13:00" },
  { start: "14:00", end: "18:00" },
];
const SATURDAY_WINDOWS: DeliveryWindow[] = [{ start: "09:00", end: "13:00" }];

function dateKey(date: Date) {
  return date.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function atTime(date: Date, time: string) {
  const [hour, minute] = time.split(":").map(Number);
  const result = new Date(date);
  result.setHours(hour, minute, 0, 0);
  return result;
}

export function getDeliveryWindows(date: Date): DeliveryWindow[] {
  const special = specialDeliveryService.findWindowsForDate(dateKey(date));
  if (special) return special;
  if (date.getDay() === 0) return [];
  return date.getDay() === 6 ? SATURDAY_WINDOWS : WEEKDAY_WINDOWS;
}

function nextWindowStart(date: Date) {
  const candidate = new Date(date);
  for (let day = 0; day < 15; day += 1) {
    const windows = getDeliveryWindows(candidate);
    for (const window of windows) {
      const start = atTime(candidate, window.start);
      if (start >= date) return start;
    }
    candidate.setDate(candidate.getDate() + 1);
    candidate.setHours(0, 0, 0, 0);
  }
  return date;
}

export function getReadyAt(createdAt: Date, productionHours: number) {
  let remainingMinutes = Math.max(1, productionHours || 0) * 60;
  let current = new Date(createdAt);

  while (remainingMinutes > 0) {
    const windows = getDeliveryWindows(current);
    const window = windows.find((entry) => {
      const end = atTime(current, entry.end);
      return current < end;
    });
    if (!window) {
      current = nextWindowStart(new Date(current.getTime() + 60 * 1000));
      continue;
    }

    const start = atTime(current, window.start);
    const end = atTime(current, window.end);
    if (current < start) current = start;
    const usableMinutes = Math.max(0, (end.getTime() - current.getTime()) / 60000);
    if (usableMinutes >= remainingMinutes) {
      return new Date(current.getTime() + remainingMinutes * 60 * 1000);
    }
    remainingMinutes -= usableMinutes;
    current = nextWindowStart(new Date(end.getTime() + 60 * 1000));
  }

  return current;
}

const formatTime = (date: Date) =>
  date.toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });

export function getToBeArrangedTimeRange(
  deliveryDate: Date,
  createdAt: Date,
  productionHours: number,
) {
  const windows = getDeliveryWindows(deliveryDate);
  if (!windows.length) return "Horário sujeito à confirmação";

  const readyAt = getReadyAt(createdAt, productionHours);
  const firstStart = atTime(deliveryDate, windows[0].start);
  const lastEnd = atTime(deliveryDate, windows[windows.length - 1].end);
  const start = readyAt > firstStart ? readyAt : firstStart;
  if (start >= lastEnd) return "Horário sujeito à confirmação";

  return `Qualquer horário entre ${formatTime(start)} e ${formatTime(lastEnd)}`;
}
