#!/usr/bin/env python3
# Runs a command under a REAL pseudo-terminal, answers its prompts, optionally completes an OAuth consent by fetching the printed URL, and reports everything the terminal displayed.
# usage: pty_drive.py '<json>'   json: {"argv":[...], "env":{...}, "cols":80, "steps":[{"expect":"text","send":"...","mode":"line|bytewise|bracketed"}], "follow_url":true, "ctrl_c_after":"text"}
import pty, os, sys, time, select, json, fcntl, termios, struct, re, urllib.request, signal
cfg = json.loads(sys.argv[1]); env = dict(os.environ); env.update(cfg.get('env', {}))
for k in cfg.get('unset', []): env.pop(k, None)
pid, fd = pty.fork()
if pid == 0:
    fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack('HHHH', 24, cfg.get('cols', 80), 0, 0))
    os.execvpe(cfg['argv'][0], cfg['argv'], env)
out = b''; step = 0; t0 = time.time(); followed = False; limit = cfg.get('timeout', 40); status = None
def send(data, mode):
    b = data.encode()
    if mode == 'bytewise':
        for ch in b: os.write(fd, bytes([ch])); time.sleep(0.008)
    elif mode == 'bracketed': os.write(fd, b'\x1b[200~' + b + b'\x1b[201~' + (b'\r' if cfg.get('enter', True) else b''))
    else: os.write(fd, b)
while time.time() - t0 < limit:
    r, _, _ = select.select([fd], [], [], 0.2)
    if r:
        try: d = os.read(fd, 8192)
        except OSError: break
        if not d: break
        out += d
    txt = out.decode('utf8', 'replace')
    steps = cfg.get('steps', [])
    if step < len(steps) and steps[step]['expect'] in txt[steps[step].get('_from', 0):]:
        s = steps[step]; send(s['send'], s.get('mode', 'line')); step += 1
        if step < len(steps): steps[step]['_from'] = len(txt)
    if cfg.get('ctrl_c_after') and cfg['ctrl_c_after'] in txt and step >= len(steps): os.write(fd, b'\x03'); cfg['ctrl_c_after'] = None
    m = re.search(r'OPEN THIS URL: (\S+)', txt)
    if cfg.get('follow_url') and m and not followed and step >= len(steps):
        followed = True
        try: urllib.request.urlopen(m.group(1), timeout=10).read()
        except Exception: pass
    try:
        p, st = os.waitpid(pid, os.WNOHANG)
        if p: status = st; break
    except ChildProcessError: break
if status is None:
    try: os.kill(pid, signal.SIGKILL)
    except Exception: pass
    try: _, status = os.waitpid(pid, 0)
    except Exception: status = -1
code = os.waitstatus_to_exitcode(status) if status not in (None, -1) else -1
print(json.dumps({'output': out.decode('utf8', 'replace'), 'exit': code}))
