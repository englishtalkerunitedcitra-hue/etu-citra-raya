'use strict';
const programs = ['Small Talker', 'Kid Talker', 'Junior Talker', 'Senior Talker', 'Adult Talker'];
const programKeys = ['small', 'kid', 'junior', 'senior', 'adult'];
const cards = [...document.querySelectorAll('.etu-card')];
const finder = document.querySelector('#etu-age-filter');
const ageLinks = [...document.querySelectorAll('[data-program-filter]')];
finder.addEventListener('change', () => {
  const index = programKeys.indexOf(finder.value);
  cards.forEach((card, i) => { card.hidden = index >= 0 && i !== index; card.classList.toggle('is-match', i === index); });
  ageLinks.forEach(link => {
    if (link.dataset.programFilter === finder.value) link.setAttribute('aria-current', 'true');
    else link.removeAttribute('aria-current');
  });
  document.querySelector('#etu-match').textContent = index < 0 ? 'Menampilkan semua program.' : `${programs[index]} dapat menjadi pilihan awal. Tim ETU akan membantu menyesuaikan level dan kebutuhan belajar.`;
});
ageLinks.forEach(link => link.addEventListener('click', event => {
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  finder.value = link.dataset.programFilter;
  finder.dispatchEvent(new Event('change'));
}));
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
document.querySelectorAll('[data-trial-program]').forEach(link => link.addEventListener('click', event => {
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  form.elements.namedItem('program').value = link.dataset.trialProgram;
  document.querySelector('#etu-trial-result').replaceChildren();
  form.elements.namedItem('learner').focus({ preventScroll: true });
}));
document.querySelectorAll('a.etu-primary:not(.etu-classroom-visit), a.etu-bookbtn').forEach(anchor => {
  anchor.href = '#etu-trial'; anchor.removeAttribute('target'); anchor.removeAttribute('rel');
});
const photoLink = document.querySelector('.etu-classroom-open');
const photoDialog = document.querySelector('.etu-photo-dialog:not(.etu-certificate-dialog)');
if (photoLink && photoDialog && typeof photoDialog.showModal === 'function') {
  photoLink.setAttribute('aria-haspopup', 'dialog');
  photoLink.addEventListener('click', event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    photoDialog.showModal();
  });
  photoDialog.querySelector('.etu-photo-close').addEventListener('click', () => photoDialog.close());
  photoDialog.addEventListener('click', event => {
    if (event.target !== photoDialog) return;
    const rect = photoDialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) photoDialog.close();
  });
  photoDialog.addEventListener('close', () => photoLink.focus());
}
const classroomImage = photoLink?.querySelector('img');
function reportClassroomImageError() {
  document.querySelector('.etu-classroom-error').hidden = false;
}
if (classroomImage) {
  classroomImage.addEventListener('error', reportClassroomImageError, { once: true });
  if (classroomImage.complete && classroomImage.naturalWidth === 0) reportClassroomImageError();
}
const certificateDialog = document.querySelector('.etu-certificate-dialog');
const certificateLinks = [...document.querySelectorAll('[data-certificate-photo]')];
let certificateReturnFocus = null;
if (certificateDialog && typeof certificateDialog.showModal === 'function') {
  certificateLinks.forEach(link => {
    link.setAttribute('aria-haspopup', 'dialog');
    link.addEventListener('click', event => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      certificateReturnFocus = link;
      const fullImage = certificateDialog.querySelector('.etu-certificate-full');
      fullImage.src = link.href;
      fullImage.alt = link.querySelector('img').alt;
      certificateDialog.querySelector('.etu-certificate-caption').textContent = link.dataset.caption;
      certificateDialog.showModal();
    });
  });
  certificateDialog.querySelector('.etu-certificate-close').addEventListener('click', () => certificateDialog.close());
  certificateDialog.addEventListener('click', event => {
    if (event.target !== certificateDialog) return;
    const rect = certificateDialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) certificateDialog.close();
  });
  certificateDialog.addEventListener('close', () => certificateReturnFocus?.focus());
}
document.querySelectorAll('img').forEach(img => {
  img.addEventListener('error', () => {
    if (img.hasAttribute('data-brand-logo')) {
      img.hidden = true;
      const fallback = img.parentElement.querySelector('.etu-brand-fallback');
      if (fallback) fallback.hidden = false;
      return;
    }
    img.classList.add('etu-image-fallback');
    img.src = 'brand-placeholder.svg';
  }, { once: true });
});

const fullTrialLink = document.querySelector('a[href="trial/?source=homepage"]');
function syncFullTrialLink() {
  const selected = form.elements.namedItem('program').value;
  const index = programs.indexOf(selected);
  const query = new URLSearchParams({ source: 'homepage' });
  if (index >= 0) query.set('program', `${programKeys[index]}-talker`);
  fullTrialLink.href = `trial/?${query}`;
}
form.elements.namedItem('program').addEventListener('change', syncFullTrialLink);
document.querySelectorAll('[data-trial-program]').forEach(link => link.addEventListener('click', syncFullTrialLink));
