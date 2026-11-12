// Header menu (phones), the scrolled header, and the practice-areas side index.
// Without this script the header shows its links in a wrapped row and every page still works.
(function () {
  var header = document.querySelector('.site-header');
  var toggle = document.querySelector('.menu-toggle');
  var menu = document.getElementById('site-menu');
  if (!header || !toggle || !menu) return;

  var root = document.documentElement;
  var label = toggle.querySelector('.visually-hidden');
  var wide = window.matchMedia('(min-width: 900px)');
  header.classList.add('js-nav');

  function isOpen() { return header.classList.contains('menu-open'); }

  function setOpen(open) {
    header.classList.toggle('menu-open', open);
    root.classList.toggle('menu-lock', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (label) label.textContent = open ? 'Close menu' : 'Menu';
    Array.prototype.forEach.call(document.querySelectorAll('main, footer'), function (el) { el.inert = open; });
    if (open) {
      var first = menu.querySelector('a');
      if (first) first.focus();
    }
  }

  toggle.addEventListener('click', function () { setOpen(!isOpen()); });
  menu.addEventListener('click', function (e) { if (e.target.closest('a')) setOpen(false); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isOpen()) { setOpen(false); toggle.focus(); }
  });
  wide.addEventListener('change', function (e) { if (e.matches && isOpen()) setOpen(false); });

  function onScroll() {
    header.classList.toggle('is-scrolled', window.scrollY > 8);
  }
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  // Practice areas: mark the area being read in the side index.
  var links = document.querySelectorAll('.side-index a[href^="#"]');
  if (links.length && 'IntersectionObserver' in window) {
    var byId = {};
    Array.prototype.forEach.call(links, function (a) { byId[a.getAttribute('href').slice(1)] = a; });
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        Array.prototype.forEach.call(links, function (a) { a.removeAttribute('aria-current'); });
        var a = byId[entry.target.id];
        if (a) a.setAttribute('aria-current', 'true');
      });
    }, { rootMargin: '-25% 0px -65% 0px' });
    Object.keys(byId).forEach(function (id) {
      var section = document.getElementById(id);
      if (section) observer.observe(section);
    });
  }
})();
