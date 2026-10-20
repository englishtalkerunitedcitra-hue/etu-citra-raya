"""Check every internal HTML link, fragment, asset and conflict marker without dependencies."""
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit
import re

ROOT = Path(__file__).resolve().parents[1]


class Document(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.ids = []
        self.references = []
        self.assets = []
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if 'id' in attrs:
            self.ids.append(attrs['id'])
        for attr in ('href', 'src'):
            if attrs.get(attr):
                self.references.append(attrs[attr])
        if tag == 'script' and attrs.get('src'):
            self.assets.append(attrs['src'])
        if tag == 'link' and attrs.get('rel') == 'stylesheet':
            self.assets.append(attrs['href'])
        if tag == 'img':
            assert 'alt' in attrs, 'Image is missing alt text'


def check_site():
    documents = {}
    for path in ROOT.rglob('*.html'):
        text = path.read_text()
        assert not re.search(r'^(?:<{7}|={7}|>{7})', text, re.M), path
        doc = Document(text)
        assert len(doc.ids) == len(set(doc.ids)), f'Duplicate IDs: {path}'
        assert len(doc.assets) == len(set(doc.assets)), f'Duplicate assets: {path}'
        documents[path] = doc
    count = 0
    for path, doc in documents.items():
        for ref in doc.references:
            url = urlsplit(ref)
            if url.scheme or url.netloc:
                continue
            target = ((ROOT if url.path.startswith('/') else path.parent) / unquote(url.path).lstrip('/')).resolve() if url.path else path
            if target.is_dir():
                target /= 'index.html'
            assert target.is_relative_to(ROOT) and target.is_file(), f'{path.relative_to(ROOT)}: missing {ref}'
            if url.fragment and target in documents:
                assert unquote(url.fragment) in documents[target].ids, f'{path.relative_to(ROOT)}: missing fragment {ref}'
            assert target.stat().st_size, f'Empty asset: {target}'
            count += 1
    for path in ROOT.glob('*.js'):
        assert not re.search(r'^(?:<{7}|={7}|>{7})', path.read_text(), re.M), path
    print(f'PASS: {len(documents)} HTML pages; {count} internal references; unique IDs and asset imports; no conflict markers.')


if __name__ == '__main__':
    check_site()
