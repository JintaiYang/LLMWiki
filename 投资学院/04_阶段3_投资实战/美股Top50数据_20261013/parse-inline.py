import json
import re
import gzip
from pathlib import Path
from lxml import html

root = Path(__file__).resolve().parent
manifest = json.loads((root / 'filings/manifest.json').read_text())
results = {}
for entry in manifest:
    file = root / 'filings' / f"{entry['ticker']}.html"
    content = file.read_bytes() if file.exists() else gzip.decompress(Path(str(file) + '.gz').read_bytes())
    doc = html.fromstring(content)
    contexts = {}
    units = {}
    for node in doc.iter():
        local = node.tag.split('}')[-1].split(':')[-1].lower() if isinstance(node.tag, str) else ''
        if local == 'context':
            descendants = {x.tag.split('}')[-1].split(':')[-1].lower(): x for x in node.iter() if isinstance(x.tag, str)}
            if 'explicitmember' in descendants or 'typedmember' in descendants:
                continue
            value = {k: descendants[k].text for k in ('startdate', 'enddate', 'instant') if k in descendants}
            contexts[node.get('id')] = value
        elif local == 'unit':
            units[node.get('id')] = ''.join(node.itertext()).strip()
    facts = []
    for node in doc.iter():
        if not isinstance(node.tag, str) or node.tag.split(':')[-1].lower() != 'nonfraction':
            continue
        context = contexts.get(node.get('contextref'))
        if not context or node.get('xsi:nil') == 'true':
            continue
        text = ''.join(node.itertext()).strip().replace(',', '').replace('\xa0', '').replace(' ', '')
        if not re.fullmatch(r'[-+]?\d+(\.\d+)?', text):
            continue
        val = float(text) * 10 ** int(node.get('scale', '0'))
        if node.get('sign') == '-':
            val = -val
        facts.append({'concept': node.get('name'), 'unit': units.get(node.get('unitref')), 'val': val, **context})
    results[entry['ticker']] = {'source': entry, 'facts': facts}
    print(entry['ticker'], len(contexts), len(facts))
(root / 'inline-facts.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
