'use strict';
(() => {
  const form = document.querySelector('#trial-form');
  if (!form) return;
  const programs = {
    'small-talker': 'Small Talker',
    'kid-talker': 'Kid Talker',
    'junior-talker': 'Junior Talker',
    'senior-talker': 'Senior Talker',
    'adult-talker': 'Adult Talker'
  };
  const field = id => form.elements.namedItem(id);
  const value = id => field(id).value.trim();
  const status = document.querySelector('#form-status');
  const param = new URLSearchParams(location.search).get('program');
  if (Object.hasOwn(programs, param)) field('program').value = param;
  form.querySelector('fieldset').disabled = false;
  form.noValidate = true;
  form.addEventListener('input', event => {
    event.target.setCustomValidity?.('');
    status.textContent = '* Wajib diisi. Jadwal trial belum terkonfirmasi sampai tim ETU menghubungi Anda.';
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    for (const id of ['parent', 'student']) {
      field(id).setCustomValidity(value(id) ? '' : 'Mohon isi nama lengkap.');
    }
    const phone = value('phone').replace(/\D/g, '');
    field('phone').setCustomValidity(phone.length >= 9 && phone.length <= 15 ? '' : 'Mohon masukkan nomor WhatsApp yang valid.');
    if (!form.reportValidity()) {
      status.textContent = 'Mohon lengkapi kolom wajib dengan benar sebelum melanjutkan.';
      return;
    }
    const age = Number(value('age'));
    const selected = value('program');
    if (!Number.isInteger(age) || age < 4 || age > 100 || !Object.hasOwn(programs, selected)) {
      status.textContent = 'Periksa kembali usia dan program yang dipilih.';
      return;
    }
    const details = [
      ['Nama orang tua / pendaftar', value('parent')],
      ['Nama calon siswa', value('student')],
      ['Usia', `${age} tahun`],
      ['Asal sekolah', value('school')],
      ['Program', programs[selected]],
      ['Nomor WhatsApp', value('phone')],
      ['Tujuan belajar', value('goal')],
      ['Preferensi jadwal', value('schedule')]
    ].filter(([, text]) => text).map(([label, text]) => `${label}: ${text}`).join('\n');
    const message = `Halo ETU Citra Raya.\n\nSaya ingin mengajukan Free Trial Class.\n\n${details}\n\nSumber: Website ETU Citra Raya — ${programs[selected]}\n\nMohon informasi jadwal trial yang tersedia. Terima kasih.`;
    status.textContent = 'WhatsApp akan dibuka. Silakan periksa pesan lalu tekan Kirim untuk menghubungi ETU.';
    const destination = `https://wa.me/6282210884318?text=${encodeURIComponent(message)}`;
    // Only send non-identifying conversion metadata. Never include names, school, age, or phone in GA4.
    let navigated = false;
    const go = () => { if (!navigated) { navigated = true; window.location.assign(destination); } };
    if (typeof window.gtag === 'function') {
      window.gtag('event', 'trial_form_submit', {
        program: selected,
        event_callback: go,
        event_timeout: 1100
      });
      window.setTimeout(go, 1200);
    } else {
      go();
    }
  });
})();
