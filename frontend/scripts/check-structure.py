# -*- coding: utf-8 -*-
"""
Structural sanity checks for the WellSim frontend — no Node required.

This is not a replacement for `next build`; it is what you can run when
you do not have a toolchain to hand. It catches the class of mistake
that is otherwise invisible until the page is open in a browser:

  1. brackets that do not balance
  2. imports of files that no longer exist
  3. t() keys with no translation, and EN/TH key drift
  4. Tailwind tokens the v3 config no longer defines
  5. JSX tags that resolve to neither an import nor a local definition
  6. imports nothing in the file uses

Usage:  python scripts/check-structure.py .
Exits non-zero when anything is found, so it drops straight into CI.
"""
import io, os, re, sys

BS = chr(92)  # backslash

root_dir = sys.argv[1]
files = []
for root, dirs, names in os.walk(os.path.join(root_dir, 'src')):
    dirs[:] = [d for d in dirs if d != 'node_modules']
    for n in names:
        if n.endswith(('.js', '.jsx')):
            files.append(os.path.join(root, n))
files.sort()


def strip_noise(src):
    """Drop comments, strings and template literals so bracket counting
    reflects code structure only."""
    out = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c == '/' and i + 1 < n and src[i + 1] == '/':
            while i < n and src[i] != '\n':
                i += 1
        elif c == '/' and i + 1 < n and src[i + 1] == '*':
            i += 2
            while i + 1 < n and not (src[i] == '*' and src[i + 1] == '/'):
                i += 1
            i += 2
        elif c in ('"', "'"):
            q = c
            i += 1
            while i < n and src[i] != q:
                if src[i] == BS:
                    i += 1
                i += 1
            i += 1
        elif c == '`':
            i += 1
            depth = 0
            while i < n:
                if src[i] == BS:
                    i += 2
                    continue
                if src[i] == '$' and i + 1 < n and src[i + 1] == '{':
                    depth += 1
                    out.append('(')
                    i += 2
                    continue
                if depth and src[i] == '}':
                    depth -= 1
                    out.append(')')
                    i += 1
                    continue
                if depth:
                    out.append(src[i])
                    i += 1
                    continue
                if src[i] == '`':
                    break
                i += 1
            i += 1
        else:
            out.append(c)
            i += 1
    return ''.join(out)


problems = 0

# ── 1. bracket balance ───────────────────────────────────────────────
for f in files:
    code = strip_noise(io.open(f, encoding='utf-8').read())
    for a, b in (('{', '}'), ('(', ')'), ('[', ']')):
        d = code.count(a) - code.count(b)
        if d:
            print('UNBALANCED %s%s %+d  %s' % (a, b, d, f))
            problems += 1

# ── 2. references to files that no longer exist ──────────────────────
gone = ['AudioStatusCard', 'BatteryCard', 'DeviceInfoCard', 'Header',
        'RawDataCard', 'StatusIndicator', 'TemperatureCard', 'WifiSignalCard']
for f in files:
    src = io.open(f, encoding='utf-8').read()
    for g in gone:
        if re.search(r"from ['\"][^'\"]*/" + g + r"['\"]", src):
            print('IMPORTS DELETED COMPONENT %s  %s' % (g, f))
            problems += 1

# ── 3. every t('key') resolves in both locales ───────────────────────
tr = io.open(os.path.join(root_dir, 'src/i18n/translations.js'), encoding='utf-8').read()
en_start = tr.index('  en: {')
th_start = tr.index('  th: {')


def collect(block):
    """Every dotted leaf key, at any nesting depth."""
    keys, stack = set(), []
    for line in block.splitlines():
        indent = len(line) - len(line.lstrip(' '))
        if not line.strip():
            continue
        m = re.match(r"^\s*([a-zA-Z0-9_]+): \{\s*$", line)
        if m:
            stack = stack[: max(0, (indent - 4) // 2)]
            stack.append(m.group(1))
            continue
        m = re.match(r"^\s*([a-zA-Z0-9_]+):", line)
        if m:
            depth = max(0, (indent - 4) // 2)
            keys.add('.'.join(stack[:depth] + [m.group(1)]))
        if line.strip().startswith('}'):
            stack = stack[: max(0, (indent - 4) // 2)]
    return keys


en_keys = collect(tr[en_start:th_start])
th_keys = collect(tr[th_start:])

only_en = sorted(en_keys - th_keys)
only_th = sorted(th_keys - en_keys)
if only_en:
    print('MISSING IN TH:', ', '.join(only_en))
    problems += 1
if only_th:
    print('MISSING IN EN:', ', '.join(only_th))
    problems += 1

used = set()
for f in files:
    if 'translations.js' in f:
        continue
    src = io.open(f, encoding='utf-8').read()
    used |= set(re.findall(r"(?<![A-Za-z0-9_$])t\('([a-zA-Z0-9_.]+)'\s*[,)]", src))

missing = sorted(k for k in used if k not in en_keys and not k.endswith('.'))
if missing:
    print('t() KEYS WITH NO TRANSLATION:', ', '.join(missing))
    problems += 1

# ── 4. Tailwind classes that the v3 config does not define ───────────
cfg = io.open(os.path.join(root_dir, 'tailwind.config.js'), encoding='utf-8').read()
stale = ['medical-', 'vitals-', 'shadow-medical', 'animate-ping-ring', 'animate-pulse-glow']
for f in files:
    src = strip_noise(io.open(f, encoding='utf-8').read())
    for tok in stale:
        if tok in src and tok.rstrip('-') not in cfg:
            print('STALE DESIGN TOKEN %r  %s' % (tok, f))
            problems += 1


# ── 5. every JSX component tag resolves to an import or a local def ──
#    This is the check that stands in for the compiler: removing a
#    local component and forgetting one call site is otherwise silent
#    until the page blows up in the browser.
IMPORT_RE = re.compile(r"^import\s+(?:type\s+)?(.+?)\s+from\s+['\"]", re.M | re.S)


def imported_names(src):
    names = set()
    for clause in IMPORT_RE.findall(src):
        clause = clause.strip()
        m = re.match(r"^([A-Za-z_$][\w$]*)\s*,?\s*(\{.*\})?$", clause, re.S)
        if m:
            names.add(m.group(1))
            if m.group(2):
                clause = m.group(2)
            else:
                continue
        inner = re.search(r"\{(.*)\}", clause, re.S)
        if inner:
            for part in inner.group(1).split(','):
                part = part.strip()
                if not part:
                    continue
                names.add(part.split(' as ')[-1].strip())
        star = re.search(r"\*\s+as\s+([A-Za-z_$][\w$]*)", clause)
        if star:
            names.add(star.group(1))
    return names


def declared_names(src):
    """Anything the file itself defines that a JSX tag could refer to —
    including names pulled out of a destructuring, which is how the
    toast picks its icon."""
    names = set()
    names |= set(re.findall(r"(?:export\s+)?(?:default\s+)?function\s+([A-Z][\w$]*)", src))
    names |= set(re.findall(r"(?:const|let|var)\s+([A-Z][\w$]*)\s*=", src))
    for block in re.findall(r"(?:const|let|var)\s*\{([^}]*)\}\s*=", src):
        for part in block.split(','):
            part = part.split(':')[-1].strip()
            if re.match(r"^[A-Z][\w$]*$", part):
                names.add(part)
    return names


# React is in scope for JSX under the automatic runtime whether or not
# it is imported, so neither check should have an opinion about it.
ALWAYS_KNOWN = {'React', 'Fragment'}

for f in files:
    src = strip_noise(io.open(f, encoding='utf-8').read())
    raw = io.open(f, encoding='utf-8').read()
    known = imported_names(raw) | declared_names(raw) | ALWAYS_KNOWN
    tags = set(re.findall(r"<([A-Z][\w$.]*)[\s/>]", src))
    for tag in sorted(tags):
        root = tag.split('.')[0]
        if root not in known:
            print('UNRESOLVED JSX TAG <%s>  %s' % (tag, f))
            problems += 1

# ── 6. imports that nothing in the file uses ─────────────────────────
for f in files:
    raw = io.open(f, encoding='utf-8').read()
    body = raw[max((m.end() for m in IMPORT_RE.finditer(raw)), default=0):]
    for name in sorted(imported_names(raw) - ALWAYS_KNOWN):
        if not re.search(r"(?<![\w$])" + re.escape(name) + r"(?![\w$])", body):
            print('UNUSED IMPORT %s  %s' % (name, f))
            problems += 1

print('')
print('checked %d files — %s' % (len(files), 'PROBLEMS FOUND' if problems else 'all checks passed'))
sys.exit(1 if problems else 0)
