import glob, json, statistics, sys, os
S = os.path.dirname(os.path.abspath(__file__))
kind = sys.argv[1]
if kind == 'sync':
    tag = sys.argv[2] if len(sys.argv) > 2 else 'cold'
    for v in ('203', '204'):
        rows = []
        for f in sorted(glob.glob(f'{S}/sync/{tag}-v{v}-r*/result.json')):
            d = json.load(open(f))
            rows.append(d)
            print(v, os.path.basename(os.path.dirname(f)), d['files'], d['fileMB'], 'wall', d['wallS'], 'first', d['firstFileS'], 'peak', d['peakRssMB'], d['cell'])
        w = [r['wallS'] for r in rows if r['wallS']]
        p = [r['peakRssMB'] for r in rows]
        if w:
            print(f'  v{v}: wall median {statistics.median(w)} min {min(w)} max {max(w)} | peakRSS median {statistics.median(p)} ({min(p)}-{max(p)})')
elif kind == 'rss':
    tag = sys.argv[2] if len(sys.argv) > 2 else 'rss'
    keys = ['opened', 'failed', 'openS', 'bootMB', 'peakDuringOpenMB', 'afterOpenMB', 'settleS', 'afterSettleMB', 'idleMedianMB', 'idleEndMB', 'peakFootprintDuringOpenMB', 'afterSettleFootprintMB', 'idleFootprintMedianMB', 'idleFootprintEndMB', 'idleTreeMedianMB', 'idleCpuMedian', 'idleCpuMean', 'idleCpuMax', 'idleTreeCpuMean']
    for v in ('203', '204'):
        rows = [json.load(open(f)) for f in sorted(glob.glob(f'{S}/rss/{tag}-v{v}-r*/result.json'))]
        for r in rows:
            print(v, {k: r.get(k) for k in keys})
        for k in ('idleMedianMB', 'idleFootprintMedianMB', 'peakDuringOpenMB', 'peakFootprintDuringOpenMB', 'idleTreeMedianMB', 'idleCpuMean'):
            xs = [r[k] for r in rows if r.get(k) is not None]
            if xs:
                print(f'  v{v} {k}: median {statistics.median(xs)} range {min(xs)}-{max(xs)} n={len(xs)}')
elif kind == 'app':
    tag = sys.argv[2] if len(sys.argv) > 2 else 'app'
    keys = ['openStatuses', 'bootS', 'afterBoot', 'afterSwitch', 'idleWebContentMedianMB', 'idleWebContentFootprintMedianMB', 'idleWebkitAllMedianMB', 'idleWebContentCpuMean', 'idleWebkitCpuMean', 'idleAppTreeMedianMB', 'idleAppTreeCpuMean', 'idleMaudeServerMB', 'maudeServers', 'webContentProcs']
    for v in ('203', '204'):
        rows = [json.load(open(f)) for f in sorted(glob.glob(f'{S}/appruns/{tag}-v{v}-r*/result.json'))]
        for r in rows:
            print(v, {k: r.get(k) for k in keys})
        for k in ('idleWebContentMedianMB', 'idleWebContentFootprintMedianMB', 'idleWebContentCpuMean', 'idleAppTreeMedianMB', 'idleAppTreeCpuMean'):
            xs = [r[k] for r in rows if r.get(k) is not None]
            if xs:
                print(f'  v{v} {k}: median {statistics.median(xs)} range {min(xs)}-{max(xs)} n={len(xs)}')
