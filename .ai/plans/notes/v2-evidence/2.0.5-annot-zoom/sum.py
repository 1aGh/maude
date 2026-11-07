import json, sys, glob, os
# usage: sum.py <glob>...  — one line per run: kept passes (warm-up discarded) as median [min–max]
def rng(xs):
    xs = [x for x in xs if x is not None]
    if not xs: return '—'
    s = sorted(xs); m = s[len(s)//2] if len(s) % 2 else (s[len(s)//2-1]+s[len(s)//2])/2
    return f"{m:g} [{min(xs):g}–{max(xs):g}]"
print(f"{'run':28} {'p50':16} {'p95':18} {'pan p95':16} {'zoom p95':18} {'long fr':12} rend(ab/an) scale")
for pat in sys.argv[1:]:
    for f in sorted(glob.glob(pat)):
        try: d = json.load(open(f))['current']
        except Exception as e: print(os.path.basename(f), 'ERR', e); continue
        k = d.get('kept') or []
        print(f"{os.path.basename(f)[:-5]:28} {rng([p['p50'] for p in k]):16} {rng([p['p95'] for p in k]):18} {rng([p['panP95'] for p in k]):16} {rng([p['zoomP95'] for p in k]):18} {rng([p['longFrames'] for p in k]):12} {d.get('artboardRenders')}/{d.get('annotationRenders')} {d.get('worldScale','')}")
