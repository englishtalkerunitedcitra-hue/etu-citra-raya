"use strict";
(() => {
  const menu = document.querySelector('.etu-menu');
  const links = document.querySelector('.etu-links');
  if (!menu || !links) return;
  const closeMenu = () => {
    links.classList.remove('is-open');
    menu.setAttribute('aria-expanded', 'false');
  };
  menu.addEventListener('click', () => {
    const open = menu.getAttribute('aria-expanded') !== 'true';
    links.classList.toggle('is-open', open);
    menu.setAttribute('aria-expanded', String(open));
  });
  links.addEventListener('click', event => {
    if (event.target.closest('a')) closeMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') {
      closeMenu();
      menu.focus();
    }
  });
  document.addEventListener('click', event => {
    if (!menu.contains(event.target) && !links.contains(event.target)) closeMenu();
  });
  window.matchMedia('(min-width: 981px)').addEventListener('change', closeMenu);
  document.querySelector('#etu-page')?.classList.add('etu-menu-enabled');
  document.body.classList.add('etu-menu-enabled');
})();
