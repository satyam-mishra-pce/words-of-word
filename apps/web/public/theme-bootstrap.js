try {
  var theme = localStorage.getItem('wow-theme');
  var themes = ['amber', 'sky', 'lilac', 'mint', 'rose', 'apricot'];
  document.documentElement.setAttribute('data-theme', themes.indexOf(theme) > -1 ? theme : (theme === 'light' ? 'apricot' : 'amber'));
} catch (_error) {
  document.documentElement.setAttribute('data-theme', 'amber');
}
