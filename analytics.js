/* ETU Citra Raya — Google Analytics 4. Do not send visitor names, phone numbers or form fields. */
(function () {
  'use strict';
  const measurementId = 'G-166MMQFGY0';
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', measurementId, { allow_google_signals: false, allow_ad_personalization_signals: false });
  const tag = document.createElement('script');
  tag.async = true;
  tag.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(measurementId);
  document.head.appendChild(tag);
  const safeProgram = program => /^(small|kid|junior|senior|adult)-talker$/.test(program || '') ? program : 'unspecified';
  document.addEventListener('click', function (event) {
    const link = event.target.closest && event.target.closest('a[href]');
    if (!link) return;
    const href = link.getAttribute('href') || '';
    if (/^(?:\.\.\/)?trial\//.test(href) || href.includes('#etu-trial')) {
      const param = new URL(href, location.href).searchParams.get('program');
      window.gtag('event', 'trial_cta_click', { program: safeProgram(param), link_area: location.pathname.includes('/programs/') ? 'program' : 'homepage' });
    } else if (/^https:\/\/wa\.me\/6282210884318/.test(href)) {
      window.gtag('event', 'contact_whatsapp', { link_area: 'website' });
    }
  });
  const form = document.getElementById('trial-form');
  if (form) {
    let started = false;
    form.addEventListener('focusin', function () {
      if (started) return;
      started = true;
      window.gtag('event', 'trial_form_start');
    });
  }
})();
