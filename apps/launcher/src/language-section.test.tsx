import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LanguageRows } from './language-section';

function render(locale: 'en' | 'ja' = 'en', uiLocale = 'en', responseLanguage = 'en') {
  return renderToStaticMarkup(<LanguageRows
    locale={locale}
    uiLocale={uiLocale}
    responseLanguage={responseLanguage}
    busy={false}
    onChangeUiLocale={() => {}}
    onChangeResponseLanguage={() => {}}
  />);
}

describe('launcher language rows', () => {
  it('shows both groups with every language and a one-line hint each', () => {
    const html = render();
    expect(html).toContain('aria-label="Interface language"');
    expect(html).toContain('aria-label="Response language"');
    for (const name of ['English', '日本語', '简体中文', '繁體中文']) expect(html).toContain(name);
    expect(html).toContain('The language of Jouzu');
    expect(html).toContain('writes its answers in');
  });

  it('marks exactly the selected language in each group', () => {
    const html = render('en', 'ja', 'zh-Hans');
    expect(html.match(/aria-pressed="true"/g)?.length).toBe(2);
    expect(html).toContain('lang="ja"');
    expect(html).toContain('lang="zh-Hans"');
  });

  it('writes the response hint in the selected response language', () => {
    const html = render('en', 'en', 'ja');
    expect(html).toContain('Jouzu が回答を書く言語です。');
    expect(html).not.toContain('writes its answers in');
  });

  it('renders Japanese copy', () => {
    const html = render('ja');
    expect(html).toContain('表示言語');
    expect(html).toContain('回答言語');
  });
});
