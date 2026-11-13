#!/usr/bin/env python3
"""Records what real full-screen programs write to an 80x24 xterm and what a reference terminal
emulator (pyte) makes of it. TerminalEmulatorTest replays the recordings through the app's own
emulator and expects the same screen.

Usage: pip install pyte && python3 tools/gen_terminal_fixtures.py   (needs vim, nano, less, htop, top, mc)
"""
import os, pty, select, struct, fcntl, termios, time, sys, signal, tempfile
import inspect
import pyte

OUT = os.path.join(os.path.dirname(__file__), '..', 'app', 'src', 'test', 'resources', 'term')
COLS, ROWS = 80, 24

class Screen(pyte.Screen):
    """pyte passes private=True to handlers that do not take it (e.g. `CSI > 4 ; 2 m`, `CSI ? r`,
    both sent by vim) and crashes. Those private variants are unrelated commands: ignore them."""

def _tolerate_private(name):
    original = getattr(pyte.Screen, name)
    if 'private' in inspect.signature(original).parameters: return
    def handler(self, *args, private=False, **kwargs):
        if not private: return original(self, *args, **kwargs)
    setattr(Screen, name, handler)

for _name in set(pyte.Stream.csi.values()): _tolerate_private(_name)

def record(argv, keys, settle=0.8):
    pid, fd = pty.fork()
    if pid == 0:
        os.environ.update(TERM='xterm-256color', LANG='C.UTF-8', LC_ALL='C.UTF-8', HOME=tempfile.mkdtemp(), PS1='$ ')
        os.execvp(argv[0], argv)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', ROWS, COLS, 0, 0))
    data = bytearray()
    def pump(seconds):
        end = time.time() + seconds
        while time.time() < end:
            r, _, _ = select.select([fd], [], [], 0.05)
            if r:
                try: chunk = os.read(fd, 65536)
                except OSError: return
                if not chunk: return
                data.extend(chunk)
    pump(settle)
    for k in keys:
        if isinstance(k, float): pump(k)
        else:
            os.write(fd, k.encode()); pump(0.35)
    pump(settle)
    try: os.kill(pid, signal.SIGKILL)
    except OSError: pass
    try: os.waitpid(pid, 0)
    except OSError: pass
    os.close(fd)
    return bytes(data)

def main():
    os.makedirs(OUT, exist_ok=True)
    work = tempfile.mkdtemp()
    text = os.path.join(work, 'notes.txt')
    with open(text, 'w') as f:
        for i in range(1, 121): f.write(f'line {i:03d}: the quick brown fox jumps over the lazy dog\n')
    code = os.path.join(work, 'demo.py')
    with open(code, 'w') as f:
        f.write('import os\n\ndef main():\n    for i in range(3):\n        print("hello", i)\n\nmain()\n')
    bashrc = os.path.join(work, 'rc'); open(bashrc, 'w').write("PS1='$ '\n")
    scenarios = {
        'vim_edit': (['vim', '-u', 'NONE', '-N', code], [':set nu\r', 'jjj', 'dd', 'O', '    return 42', '\x1b', 'gg', ':3\r', 'A  # tail\x1b']),
        'vim_scroll': (['vim', '-u', 'NONE', '-N', text], ['\x06', '\x06', '\x02', '20G', 'zt', 'x', 'u', '/lazy\r', 'n']),
        'nano': (['nano', '--ignorercfiles', code], ['\x1bOB', '\x1bOB', 'inserted text', '\r', '\x0b', '\x17' 'print\r']),
        'less': (['less', text], [' ', ' ', 'b', '/line 07\r', 'j', 'j', 'k', 'G', 'g']),
        'htop': (['htop', '-d', '50'], [1.5, 't', 0.5]),
        'top': (['top', '-d', '5'], [1.0, '1', 0.5]),
        'mc': (['mc', '-a', '--nosubshell', work], [1.0, '\x1bOB', '\x1bOB', '\t', 1.0]),
        'mc_lines': (['mc', '--nosubshell', work], [1.0, '\x1b[21~', 0.3]),
        'bash': (['bash', '--norc', '--noprofile', '-i'], [
            "PS1='$ '\r", 'ls --color=always /\r', "printf 'a\\tb\\tc\\n'\r",
            "for i in 1 2 3; do printf '\\rstep %s' $i; sleep 0.1; done; echo\r", 0.6,
            "python3 -c \"print('x'*200)\"\r", 0.4, 'seq 1 40\r', 0.4, "printf '\\033[1;31mred\\033[0m \\033[48;5;22mgreen bg\\033[0m\\n'\r",
            'echo abc\x01xyz \x05!\x17\x17done\r', 'clear\r', 'echo after clear\r']),
        'tput': (['bash', '--norc', '--noprofile', '-c',
                  'tput clear; tput cup 5 10; echo X; tput cup 0 0; echo top; tput cup 23 0; printf bottom; tput cup 10 0; '
                  'printf "abcdefghij"; tput cub 5; tput dch 2; tput ich 3; tput cup 12 0; printf "one\\ntwo\\nthree\\n"; tput cup 12 0; tput dl1; '
                  'tput il 2; tput csr 15 20; tput cup 20 0; for i in 1 2 3 4 5 6 7 8; do echo "scroll $i"; done; tput csr 0 23; tput cup 22 0; printf "end"; sleep 2'], [0.5]),
    }
    for name, (argv, keys) in scenarios.items():
        raw = record(argv, keys)
        screen = Screen(COLS, ROWS); stream = pyte.ByteStream(screen); stream.feed(raw)
        lines = [l.rstrip() for l in screen.display]
        open(os.path.join(OUT, name + '.raw'), 'wb').write(raw)
        open(os.path.join(OUT, name + '.screen'), 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
        print(f'{name:12s} {len(raw):7d} bytes  cursor=({screen.cursor.y},{screen.cursor.x})', '| ' + next((l for l in lines if l.strip()), '')[:50])
        open(os.path.join(OUT, name + '.cursor'), 'w').write(f'{screen.cursor.y} {screen.cursor.x}\n')

if __name__ == '__main__':
    main()
