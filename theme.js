// Gives the share pages the colors chosen in the app. The app sends a small
// `theme` object (light and dark colors); without one the page keeps its
// default look. Only #rrggbb values are accepted.
(() => {
  const NAMES = {
    bg: '--bg', surface: '--surface', surface2: '--surface-2', fg: '--fg', muted: '--muted',
    line: '--line', primary: '--primary', onPrimary: '--on-primary', tertiary: '--tertiary',
    reminder: '--reminder', onReminder: '--on-reminder', warnBg: '--warn-bg', warnFg: '--warn-fg',
  };
  const css = (tokens) => Object.entries(NAMES)
    .filter(([k]) => /^#[0-9a-fA-F]{6}$/.test((tokens || {})[k] || ''))
    .map(([k, v]) => `${v}:${tokens[k]}`).join(';');

  window.applyShareTheme = (theme) => {
    if (!theme || typeof theme !== 'object') return;
    const light = css(theme.light), dark = css(theme.dark);
    if (!light && !dark) return;
    let el = document.getElementById('share-theme');
    if (!el) {
      el = document.createElement('style');
      el.id = 'share-theme';
      document.head.appendChild(el);
    }
    el.textContent = `:root{${light}}@media (prefers-color-scheme: dark){:root{${dark}}}`;
  };
})();
