"""Run against the local static server; intercept WhatsApp and never send a message.

Usage: python3 tests/browser_smoke.py [http://127.0.0.1:8000]
Requires Python Playwright and Chromium (CHROMIUM_PATH can override its path).
"""
import os
import sys
from urllib.parse import parse_qs, urlsplit
from playwright.sync_api import sync_playwright, expect

BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8000').rstrip('/')
KEYS = ['small', 'kid', 'junior', 'senior', 'adult']
PAGES = ['/', '/small-talker.html', '/trial/'] + [f'/programs/{key}-talker.html' for key in KEYS]

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.getenv('CHROMIUM_PATH', '/usr/bin/chromium'), args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 390, 'height': 844})
    page = context.new_page()
    errors = []
    external_failures = set()
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('requestfailed', lambda request: external_failures.add(urlsplit(request.url).hostname) if not request.url.startswith(BASE) else None)
    for path in PAGES:
        assert page.goto(BASE + path, wait_until='domcontentloaded').status == 200
        page.locator('.etu-menu').click()
        assert page.locator('.etu-menu').get_attribute('aria-expanded') == 'true'
        assert page.locator('.etu-links').is_visible()
        page.keyboard.press('Escape')
        assert page.locator('.etu-menu').get_attribute('aria-expanded') == 'false'
        assert page.locator('.etu-menu').evaluate('(e) => e === document.activeElement')
        page.locator('.etu-menu').click()
        page.mouse.click(5, 750)
        assert page.locator('.etu-menu').get_attribute('aria-expanded') == 'false'
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'Horizontal overflow: {path}'
        logo = page.locator('nav img').first
        logo.evaluate('(e) => e.decode()')
        assert logo.evaluate('(e) => e.naturalWidth > 0')
        page.set_viewport_size({'width': 1280, 'height': 900})
        assert page.locator('.etu-links').is_visible()
        page.set_viewport_size({'width': 390, 'height': 844})
    print('PASS: 8 pages, mobile menus, Escape/focus/outside click, desktop navigation, no horizontal overflow, official local logos.')

    page.goto(BASE, wait_until='domcontentloaded')
    assert page.locator('.etu-card').count() == 5
    for key in KEYS:
        page.locator('#etu-age-filter').select_option(key)
        assert page.locator('.etu-card:visible').count() == 1
        assert page.locator(f'.etu-card:visible a[href="programs/{key}-talker.html"]').count()
    page.locator('#etu-age-filter').select_option('all')
    for key in KEYS:
        page.locator(f'[data-trial-program="{key.title()} Talker"]').click()
        assert page.locator('#etu-trial-program').input_value() == f'{key.title()} Talker'
        assert f'program={key}-talker' in page.locator('a[href^="trial/?source=homepage"]').get_attribute('href')
    page.locator('#etu-learner').fill('Dummy & Test + 日本語')
    page.locator('#etu-goal').select_option(index=1)
    page.locator('.etu-submit').click()
    href = page.locator('#etu-trial-result a').get_attribute('href')
    assert urlsplit(href).netloc == 'wa.me'
    assert 'Dummy & Test + 日本語' in parse_qs(urlsplit(href).query)['text'][0]
    for i in range(page.locator('[data-certificate-photo]').count()):
        link = page.locator('[data-certificate-photo]').nth(i)
        link.click()
        assert page.locator('.etu-certificate-dialog').evaluate('(e) => e.open')
        page.locator('.etu-certificate-full').evaluate('(e) => e.decode()')
        page.keyboard.press('Escape')
        assert link.evaluate('(e) => e === document.activeElement')
    page.locator('.etu-classroom-open').click()
    assert page.locator('.etu-photo-dialog:not(.etu-certificate-dialog)').evaluate('(e) => e.open')
    page.keyboard.press('Escape')
    print('PASS: all program filters, quick trial, full-form handoff, original award images, certificate and classroom dialogs.')

    captured = []
    def intercept_whatsapp(route):
        captured.append(route.request.url)
        route.fulfill(status=200, content_type='text/html', body='<title>Intercepted WhatsApp preview</title>')
    context.route('https://wa.me/**', intercept_whatsapp)
    for key, age in zip(KEYS, [5, 9, 14, 17, 30]):
        page.goto(BASE + f'/programs/{key}-talker.html', wait_until='domcontentloaded')
        page.locator('.hero .btn').first.click()
        expect(page.locator('#program')).to_have_value(key + '-talker')
        page.locator('#trial-form button').click()
        assert len(captured) == KEYS.index(key), 'Invalid form navigated'
        for selector, value in [('parent', 'Dummy & Parent'), ('student', 'Dummy + Student'), ('age', str(age)), ('school', 'Dummy School'), ('phone', '081234567890')]:
            page.locator('#' + selector).fill(value)
        page.locator('#schedule').select_option(index=1)
        page.locator('#goal').select_option(index=1)
        page.locator('#agree').check()
        # Whitespace-only names are rejected even when required passes native validation.
        page.locator('#parent').fill('   ')
        page.locator('#trial-form button').click()
        assert len(captured) == KEYS.index(key)
        page.locator('#parent').fill('Dummy & Parent')
        page.locator('#trial-form button').click()
        page.wait_for_url('https://wa.me/**')
        url = urlsplit(captured[-1])
        assert url.path == '/6282210884318'
        message = parse_qs(url.query)['text'][0]
        assert f'Program: {key.title()} Talker' in message
        for expected in ['Dummy & Parent', 'Dummy + Student', f'{age} tahun', 'Dummy School', '081234567890', 'Preferensi jadwal: Weekday']:
            assert expected in message, expected
    page.goto(BASE + '/trial/?program=unknown', wait_until='domcontentloaded')
    assert page.locator('#program').input_value() == ''
    assert not page.evaluate('Object.keys(localStorage).length || Object.keys(sessionStorage).length')
    assert not errors, errors
    print('PASS: five end-to-end program → trial → intercepted WhatsApp flows, query prefill, invalid/whitespace rejection, message encoding and destination, no browser storage or JavaScript errors.')
    print('External image hosts with request failures (runtime network restriction):', sorted(external_failures))
    nojs = browser.new_context(java_script_enabled=False, viewport={'width': 390, 'height': 844})
    nojs_page = nojs.new_page()
    nojs_page.goto(BASE + '/trial/', wait_until='domcontentloaded')
    assert nojs_page.locator('#parent').is_disabled()
    assert nojs_page.locator('noscript a[href="https://wa.me/6282210884318"]').is_visible()
    print('PASS: no-JavaScript fallback cannot submit personal data to the static server.')
    browser.close()
