"""Writes app/css/tokens.css from design/tokens.json, the tokens of the PV Predesign design system (a copy of
project/tokens.json of the design artifact; the UI design session owns it, this repository keeps the copy the app
builds from). Light values go on :root, dark values on [data-theme="dark"] and, for the system preference, on
:root:not([data-theme="light"]) under prefers-color-scheme, as app.css did before the tokens moved here. Spacing,
radius, shadows, the gradient and the font families are theme-less; the text styles become .text-<name> classes.

    python scripts/make_tokens.py            # design/tokens.json -> app/css/tokens.css
    python scripts/make_tokens.py --check    # exit 1 when the file differs from what the tokens give (CI)

Plain Python, no dependencies."""
import json, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'design' / 'tokens.json'
OUT = ROOT / 'app' / 'css' / 'tokens.css'


def css_value(v):
    """A token value as CSS: an alias "{name}" becomes var(--name)."""
    v = str(v).strip()
    if v.startswith('{') and v.endswith('}'):
        return f'var(--{v[1:-1]})'
    return v


def theme_value(value, theme, first):
    if isinstance(value, dict):
        return value.get(theme, value.get(first))
    return value


def build(tokens):
    themes = [t['id'] for t in tokens['color']['themes']]
    first = themes[0]
    colors = tokens['color']['tokens']
    lines = [f"/* {tokens['name']} — generated from design/tokens.json by scripts/make_tokens.py: do not edit by hand */"]

    def color_block(selector, theme, scheme, indent='  '):
        out = [f'{selector} {{']
        for c in colors:
            out.append(f"{indent}--{c['name']}: {css_value(theme_value(c['value'], theme, first))};")
        out.append(f'{indent}color-scheme: {scheme};')
        out.append('}')
        return out

    lines += color_block(':root', first, first)
    for theme in themes[1:]:
        lines.append(f'@media (prefers-color-scheme: {theme}) {{')
        lines += ['  ' + l for l in color_block(f':root:not([data-theme="{first}"])', theme, theme)]
        lines.append('}')
        lines += color_block(f':root[data-theme="{theme}"]', theme, theme)

    lines.append(':root {')
    for family in ('spacing', 'radius', 'shadow'):
        for tk in tokens.get(family, {}).get('tokens', []):
            lines.append(f"  --{tk['name']}: {css_value(tk['value'])};")
    for tk in tokens.get('gradient', {}).get('tokens', []):
        lines.append(f"  --{tk['name']}: {css_value(tk['value'])};")
    families = tokens.get('type', {}).get('families', {})
    for name, stack in families.items():
        lines.append(f'  --font-{name}: {stack};')
    lines.append('}')

    for group in tokens.get('type', {}).get('groups', []):
        fam = families.get(group.get('family', 'sans'), families.get('sans', 'sans-serif'))
        for st in group.get('styles', []):
            parts = [f"font-family: {fam}", f"font-size: {st['fontSize']}", f"line-height: {st['lineHeight']}", f"font-weight: {st['fontWeight']}"]
            if st.get('letterSpacing'):
                parts.append(f"letter-spacing: {st['letterSpacing']}")
            lines.append(f".{st['name']} {{ {'; '.join(parts)}; }}")
    return '\n'.join(lines) + '\n'


def main():
    tokens = json.loads(SRC.read_text(encoding='utf-8'))
    css = build(tokens)
    if '--check' in sys.argv:
        current = OUT.read_text(encoding='utf-8') if OUT.exists() else ''
        if current != css:
            print(f'{OUT.relative_to(ROOT)} differs from design/tokens.json: run python scripts/make_tokens.py')
            sys.exit(1)
        print('tokens.css matches design/tokens.json')
        return
    OUT.write_text(css, encoding='utf-8', newline='\n')
    print(f'wrote {OUT.relative_to(ROOT)} ({len(tokens["color"]["tokens"])} colour tokens)')


if __name__ == '__main__':
    main()
