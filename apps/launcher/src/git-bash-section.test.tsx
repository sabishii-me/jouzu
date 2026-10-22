import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GitBashSection, type GitBashState } from './git-bash-section';

const own = { path: 'C:\\Jouzu\\runtime\\git\\installed\\bin\\bash.exe', git: 'git version 2.55.0.windows.5', bash: 'GNU bash' };
const state: GitBashState = {
  bundled: own, managed: null, system: null, effective: own,
  bundled_present: true, managed_present: false, system_present: false,
  archive: true, update_available: true,
};
function render(value: GitBashState, busy = false) {
  return renderToStaticMarkup(<GitBashSection locale="en" api={{ state: value, busy, error: null, run: async call => { await call(); } }} />);
}

describe('bundled Git update recovery', () => {
  it('offers repair when a failed preparation leaves a working older copy', () => {
    const html = render(state);
    expect(html).toContain('2.55.0.windows.5');
    expect(html).toContain('Update available');
    expect(html).toContain('Repair and use');
    expect(html).not.toMatch(/<button\b[^>]*\sdisabled(?:=|[ >])/);
  });

  it('disables repair after the helper confirms the pinned copy is installed', () => {
    const current = { ...own, git: 'git version 2.56.0.windows.2' };
    const html = render({ ...state, bundled: current, effective: current, update_available: false });
    expect(html).not.toContain('Update available');
    expect(html).toMatch(/<button\b[^>]*\sdisabled(?:=|[ >])/);
  });

  it('prevents a second repair while preparation is running', () => {
    expect(render(state, true)).toMatch(/<button\b[^>]*\sdisabled(?:=|[ >])/);
  });
});
