/* Farbschema (System / Hell / Dunkel). */

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
  try {
    if (theme === 'light' || theme === 'dark') localStorage.setItem('lernkarten-theme', theme);
    else localStorage.removeItem('lernkarten-theme');
  } catch { /* Speicher nicht verfügbar */ }
  const dark = theme === 'dark' || (theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#14161a' : '#f6f6f3');
}
