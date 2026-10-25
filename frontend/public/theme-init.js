// Runs before the application/CSS paints. Keep the key and modes aligned with theme.ts.
;(function () {
  var preference = 'light'
  try {
    var stored = localStorage.getItem('ragvault.theme')
    if (stored === 'dark' || stored === 'system') preference = stored
  } catch {
    // Storage may be blocked. The light-first default remains usable.
  }
  var dark =
    preference === 'dark' ||
    (preference === 'system' &&
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
})()
