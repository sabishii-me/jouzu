import { Button } from "./components/ui/button";
import { Label } from "./components/ui/label";
import { locales, messages, type Locale } from "./i18n";

export function LanguageRows({
  locale, uiLocale, responseLanguage, busy, onChangeUiLocale, onChangeResponseLanguage,
}: {
  locale: Locale;
  uiLocale: string;
  responseLanguage: string;
  busy: boolean;
  onChangeUiLocale: (value: string) => void;
  onChangeResponseLanguage: (value: string) => void;
}) {
  const t = messages[locale];
  const responseCopy = messages[responseLanguage as Locale] ?? t;
  const row = (label: string, selected: string, onPick: (value: string) => void) => <div className="space-y-2">
    <Label>{label}</Label>
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {Object.entries(locales).map(([key, name]) => <Button key={key} lang={key} className="min-w-28" variant={selected === key ? "default" : "outline"} aria-pressed={selected === key} disabled={busy} onClick={() => onPick(key)}>{name}</Button>)}
    </div>
  </div>;
  return <>
    {row(t.interfaceLanguage, uiLocale, onChangeUiLocale)}
    <p className="text-sm leading-relaxed text-muted-foreground">{t.languageHint}</p>
    {row(t.replyLanguage, responseLanguage, onChangeResponseLanguage)}
    <p lang={responseLanguage} className="text-sm leading-relaxed text-muted-foreground">{responseCopy.replyHint}</p>
  </>;
}
