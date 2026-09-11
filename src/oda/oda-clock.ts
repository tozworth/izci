/** Locale-aware Oda top-chrome clock parts: short date plus hours/minutes. */
export interface OdaClockText {
  date: string;
  time: string;
}

export function formatOdaClockText(now: Date, locale: string): OdaClockText {
  const resolvedLocale = locale || 'en';
  return {
    date: new Intl.DateTimeFormat(resolvedLocale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short'
    }).format(now),
    time: new Intl.DateTimeFormat(resolvedLocale, {
      hour: 'numeric',
      minute: '2-digit'
    }).format(now)
  };
}
