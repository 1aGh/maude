import glob, os, re, sys
for f in sorted(glob.glob(sys.argv[1])):
    t = open(f).read()
    sw = re.search(r'used = ([\d.]+M)', t); fr = re.search(r'free percentage: (\d+%)', t); tm = t.split('\n')[0]
    print(f"{os.path.basename(f)[:-4]:34} {tm} swap_used={sw.group(1) if sw else '?'} mem_free={fr.group(1) if fr else '?'}")
