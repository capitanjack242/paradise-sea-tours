"""Two more originals, in directions the bell and the horn didn't go.

Both still obey the same two constraints — energy in the 800 Hz–3 kHz band a
phone speaker can actually shift, and a pattern with silence in it so an engine
can't mask it — but they come at the problem differently.
"""
import numpy as np
import wave

SR = 44100
SECONDS = 25.0


def write_wav(path, x, drive=1.7):
    x = x / max(np.abs(x).max(), 1e-9)
    x = np.tanh(x * drive) / np.tanh(drive)
    x = x / max(np.abs(x).max(), 1e-9) * 0.97
    with wave.open(path, "w") as f:
        f.setnchannels(1); f.setsampwidth(2); f.setframerate(SR)
        f.writeframes((x * 32767).astype("<i2").tobytes())
    print(f"  {path}  {len(x)/SR:.1f}s")


def place(track, x, at):
    start = int(at * SR)
    end = min(start + len(x), len(track))
    if end > start:
        track[start:end] += x[: end - start]


# ── candidate 3: bosun's call ───────────────────────────────────────────────
# The whistle a boatswain uses on deck. It exists for exactly this problem:
# it was designed to be heard over wind, sea and men working, which is the
# closest thing in the world to an outboard at full throttle. Very high, very
# narrow, and it trills — a warbling tone is much harder to ignore than a
# steady one, because the ear keeps re-noticing it.
def pipe(freq_curve, dur, breath=0.06):
    t = np.linspace(0, dur, int(SR * dur), endpoint=False)
    f = freq_curve(t)
    phase = 2 * np.pi * np.cumsum(f) / SR
    # A pipe is nearly a pure tone with a little second harmonic on top.
    tone = np.sin(phase) + 0.18 * np.sin(2 * phase)
    # A breath of noise, band-limited around the note, stops it sounding synthetic.
    noise = np.random.default_rng(7).normal(0, 1, len(t))
    noise = np.convolve(noise, np.hanning(24), mode="same")
    env = np.minimum(t / 0.02, 1.0) * np.clip((dur - t) / 0.05, 0, 1)
    return (tone + breath * noise) * env


LOW, HIGH = 1500.0, 2500.0
call = np.zeros(int(SR * SECONDS))
CYCLE = 3.4
pos = 0.0
while pos < SECONDS - 2.2:
    # Plain low note, a slide up, then the warble that makes it a bosun's call.
    place(call, pipe(lambda t: np.full_like(t, LOW), 0.45), pos)
    place(call, pipe(lambda t: LOW + (HIGH - LOW) * (t / 0.22), 0.22), pos + 0.50)
    place(call, pipe(lambda t: HIGH + 110 * np.sin(2 * np.pi * 13 * t), 0.75), pos + 0.72)
    pos += CYCLE

write_wav("run_alert_pipe.wav", call)


# ── candidate 4: Junkanoo ───────────────────────────────────────────────────
# Cowbell, goatskin drum and whistle, in the rhythm they're actually played in
# on Bay Street. It is Bahamian rather than generically nautical, it is
# percussive so it survives engine noise, and nobody in Nassau will mistake it
# for another app's notification.
rng = np.random.default_rng(11)


def cowbell(f1, f2, dur=0.38):
    """Two detuned square waves through a decay — inharmonic, and all the level
    sits where a phone speaker is loudest."""
    t = np.linspace(0, dur, int(SR * dur), endpoint=False)
    sq = lambda f: np.sign(np.sin(2 * np.pi * f * t))
    out = 0.6 * sq(f1) + 0.4 * sq(f2)
    # Round the square edges off, or it is a buzzer rather than a bell.
    out = np.convolve(out, np.hanning(9) / np.hanning(9).sum(), mode="same")
    return out * np.exp(-t * 6.5) * np.minimum(t / 0.001, 1.0)


def drum(dur=0.30):
    """Goatskin: a short pitch drop with skin noise over it."""
    t = np.linspace(0, dur, int(SR * dur), endpoint=False)
    f = 180 * np.exp(-t * 14) + 90
    body = np.sin(2 * np.pi * np.cumsum(f) / SR)
    skin = np.convolve(rng.normal(0, 1, len(t)), np.hanning(16), mode="same")
    return (body + 0.5 * skin) * np.exp(-t * 13)


def whistle(dur=0.22):
    t = np.linspace(0, dur, int(SR * dur), endpoint=False)
    f = 2650 + 180 * np.sin(2 * np.pi * 22 * t)
    env = np.minimum(t / 0.01, 1.0) * np.clip((dur - t) / 0.04, 0, 1)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env


junk = np.zeros(int(SR * SECONDS))
BAR = 2.0
# Beats are where a Junkanoo bell actually lands: on the offbeats, driving.
BELL = [0.00, 0.25, 0.50, 0.75, 1.00, 1.375, 1.625]
DRUM = [0.00, 0.75, 1.25]
pos = 0.0
bar = 0
while pos < SECONDS - BAR:
    for i, b in enumerate(BELL):
        gain = 1.0 if b in (0.0, 1.0) else 0.62
        place(junk, cowbell(830, 1235) * gain, pos + b)
    for b in DRUM:
        place(junk, drum() * 0.85, pos + b)
    # A whistle every other bar, so the pattern doesn't flatten out.
    if bar % 2 == 1:
        place(junk, whistle() * 0.75, pos + 1.5)
    pos += BAR
    bar += 1

write_wav("run_alert_junkanoo.wav", junk, drive=5.0)
