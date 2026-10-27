// Apply the saved theme before first paint (no flash). Kept as a tiny classic script.
(function () {
  var t = null;
  try { t = ((JSON.parse(localStorage.getItem('runlab.data') || '{}').settings) || {}).theme; } catch (e) { /* ignore */ }
  if (t !== 'light' && t !== 'dark') t = window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  var m = document.querySelector('meta[name=theme-color]'); if (m) m.content = t === 'light' ? '#f3f0e8' : '#100f0c';
})();
