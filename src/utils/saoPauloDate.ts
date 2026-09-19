export const SAO_PAULO_TIME_ZONE = "America/Sao_Paulo";

type SaoPauloCalendarDate = {
  readonly year: number;
  readonly month: number;
  readonly day: number;
};

type SaoPauloDateTime = SaoPauloCalendarDate & {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
};

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const CALENDAR_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: SAO_PAULO_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: SAO_PAULO_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function numericPart(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): number {
  return Number(parts.find((part) => part.type === type)?.value);
}

function getSaoPauloCalendarDate(date: Date): SaoPauloCalendarDate {
  const parts = CALENDAR_DATE_FORMATTER.formatToParts(date);

  return {
    year: numericPart(parts, "year"),
    month: numericPart(parts, "month"),
    day: numericPart(parts, "day"),
  };
}

function getSaoPauloDateTime(date: Date): SaoPauloDateTime {
  const parts = DATE_TIME_FORMATTER.formatToParts(date);

  return {
    ...getSaoPauloCalendarDate(date),
    hour: numericPart(parts, "hour"),
    minute: numericPart(parts, "minute"),
    second: numericPart(parts, "second"),
  };
}

function getSaoPauloOffsetMilliseconds(date: Date): number {
  const dateTime = getSaoPauloDateTime(date);

  return (
    Date.UTC(
      dateTime.year,
      dateTime.month - 1,
      dateTime.day,
      dateTime.hour,
      dateTime.minute,
      dateTime.second,
    ) - date.getTime()
  );
}

function atSaoPauloTime(
  calendarDate: SaoPauloCalendarDate,
  hour: number,
  minute: number,
): Date {
  const localTime = Date.UTC(
    calendarDate.year,
    calendarDate.month - 1,
    calendarDate.day,
    hour,
    minute,
  );
  let instant = new Date(localTime);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const nextInstant = localTime - getSaoPauloOffsetMilliseconds(instant);
    if (nextInstant === instant.getTime()) {
      return instant;
    }
    instant = new Date(nextInstant);
  }

  return instant;
}

function parseTime(time: string): { readonly hour: number; readonly minute: number } {
  const [hour, minute] = time.split(":").map(Number);

  return { hour, minute };
}

function isValidCalendarDate(calendarDate: SaoPauloCalendarDate): boolean {
  const utcDate = new Date(
    Date.UTC(calendarDate.year, calendarDate.month - 1, calendarDate.day),
  );

  return (
    utcDate.getUTCFullYear() === calendarDate.year &&
    utcDate.getUTCMonth() === calendarDate.month - 1 &&
    utcDate.getUTCDate() === calendarDate.day
  );
}

export function getSaoPauloDateKey(date: Date): string {
  const calendarDate = getSaoPauloCalendarDate(date);
  const month = String(calendarDate.month).padStart(2, "0");
  const day = String(calendarDate.day).padStart(2, "0");

  return `${calendarDate.year}-${month}-${day}`;
}

export function getSaoPauloWeekday(date: Date): number {
  const calendarDate = getSaoPauloCalendarDate(date);

  return new Date(
    Date.UTC(calendarDate.year, calendarDate.month - 1, calendarDate.day),
  ).getUTCDay();
}

export function atSaoPauloCalendarTime(date: Date, time: string): Date {
  const clockTime = parseTime(time);

  return atSaoPauloTime(getSaoPauloCalendarDate(date), clockTime.hour, clockTime.minute);
}

export function addSaoPauloCalendarDays(date: Date, days: number): Date {
  const calendarDate = getSaoPauloCalendarDate(date);
  const shiftedDate = new Date(
    Date.UTC(calendarDate.year, calendarDate.month - 1, calendarDate.day + days),
  );

  return atSaoPauloTime(
    {
      year: shiftedDate.getUTCFullYear(),
      month: shiftedDate.getUTCMonth() + 1,
      day: shiftedDate.getUTCDate(),
    },
    0,
    0,
  );
}

export function parseSaoPauloDeliveryDate(value: Date | string): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }

  const dateOnly = DATE_ONLY_PATTERN.exec(value.trim());
  if (dateOnly) {
    const calendarDate = {
      year: Number(dateOnly[1]),
      month: Number(dateOnly[2]),
      day: Number(dateOnly[3]),
    };

    return isValidCalendarDate(calendarDate)
      ? atSaoPauloTime(calendarDate, 0, 0)
      : null;
  }

  const parsedDate = new Date(value);

  return Number.isFinite(parsedDate.getTime()) ? parsedDate : null;
}
