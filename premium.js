'use strict';
const menu = document.querySelector('.etu-menu');
const links = document.querySelector('.etu-links');
function closeMenu() { links.classList.remove('is-open'); menu.setAttribute('aria-expanded', 'false'); }
menu.addEventListener('click', () => {
  const open = menu.getAttribute('aria-expanded') !== 'true';
  menu.setAttribute('aria-expanded', String(open));
  links.classList.toggle('is-open', open);
});
links.addEventListener('click', event => { if (event.target.closest('a')) closeMenu(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') { closeMenu(); menu.focus(); } });
const programs = ['Small Talker', 'Kid Talker', 'Junior Talker', 'Senior Talker', 'Adult Talker'];
const cards = [...document.querySelectorAll('.etu-card')];
const finder = document.querySelector('#etu-age-filter');
finder.addEventListener('change', () => {
  const index = finder.selectedIndex - 1;
  cards.forEach((card, i) => { card.hidden = index >= 0 && i !== index; card.classList.toggle('is-match', i === index); });
  document.querySelector('#etu-match').textContent = index < 0 ? 'Menampilkan semua program.' : `${programs[index]} dapat menjadi pilihan awal. Tim ETU akan membantu menyesuaikan level dan kebutuhan belajar.`;
});
const form = document.querySelector('#etu-trial-form');
form.addEventListener('submit', event => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const name = form.elements.namedItem('learner').value.trim();
  if (!name) { form.elements.namedItem('learner').setCustomValidity('Mohon isi nama Anda.'); form.reportValidity(); return; }
  const program = form.elements.namedItem('program').value;
  const goal = form.elements.namedItem('goal').value;
  const message = `Halo ETU Citra Raya, saya ${name}. Saya ingin booking Free Trial untuk program ${program}. Tujuan belajar: ${goal}. Mohon informasi jadwal yang tersedia. Terima kasih.`;
  const result = document.querySelector('#etu-trial-result');
  const anchor = document.createElement('a');
  anchor.href = `https://wa.me/6282210884318?text=${encodeURIComponent(message)}`;
  anchor.target = '_blank'; anchor.rel = 'noopener noreferrer';
  anchor.textContent = 'Lanjutkan ke WhatsApp →';
  result.replaceChildren(document.createTextNode('Pesan siap. Klik untuk membuka WhatsApp dan mengirim permintaan jadwal.'), anchor);
  anchor.focus();
});
form.elements.namedItem('learner').addEventListener('input', event => event.target.setCustomValidity(''));
form.addEventListener('input', () => document.querySelector('#etu-trial-result').replaceChildren());
document.querySelectorAll('a.etu-primary, a.etu-bookbtn').forEach(anchor => {
  anchor.href = '#etu-trial'; anchor.removeAttribute('target'); anchor.removeAttribute('rel');
});
document.querySelectorAll('img').forEach(img => {
  img.addEventListener('error', () => {
    img.classList.add('etu-image-fallback');
    img.src = 'brand-placeholder.svg';
  }, { once: true });
});
