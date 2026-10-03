#!/usr/bin/env python3
"""
Build the TrainMe demo video.

  1. reads scenes + narration from design/mockups/shots.js (via node)
  2. renders narration with macOS `say` (voice/rate configurable)
  3. turns each design/screens/NN_<id>.png into a clip with a slow zoom
  4. cross-fades all clips, places each narration at its scene start
  5. writes design/demo/TrainMe_Demo.mp4 (+ soft subtitles), TrainMe_Demo.srt and narration_script.md

Usage:  python3 design/tools/build_video.py [--voice Samantha] [--rate 172]
Requires: node, ffmpeg/ffprobe, macOS `say`, screens rendered by tools/render_screens.sh
"""
import argparse, json, os, re, subprocess, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DEMO = os.path.join(ROOT, "demo")
WORK = os.path.join(DEMO, "_work")
FPS, XF, LEAD, TAIL = 30, 0.6, 0.7, 1.0      # fps, crossfade seconds, silence before / after narration


def run(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if r.returncode != 0:
        sys.exit(f"FAILED: {' '.join(cmd)[:300]}\n{r.stderr[-2000:]}")
    return r.stdout


def duration(path):
    return float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]).strip())


def ts(t):
    h, rem = divmod(t, 3600); m, s = divmod(rem, 60)
    return f"{int(h):02d}:{int(m):02d}:{s:06.3f}".replace(".", ",")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", default="Samantha")
    ap.add_argument("--rate", type=int, default=172)
    a = ap.parse_args()
    os.makedirs(WORK, exist_ok=True)

    shots = json.loads(run(["node", "-e", "const s=require('./mockups/shots.js').SHOTS;console.log(JSON.stringify(s.map(x=>({id:x.id,title:(x.title||'').replace(/<[^>]+>/g,' ').replace(/\\s+/g,' ').trim(),step:x.step||x.chapter,chapter:x.chapter,narration:x.narration})))) "], cwd=ROOT))
    print(f"{len(shots)} scenes")

    scenes = []
    for i, s in enumerate(shots):
        img = os.path.join(ROOT, "screens", f"{i + 1:02d}_{s['id']}.png")
        if not os.path.exists(img):
            sys.exit(f"missing {img} – run tools/render_screens.sh first")
        aiff, wav = os.path.join(WORK, f"{i:02d}.aiff"), os.path.join(WORK, f"{i:02d}.wav")
        run(["say", "-v", a.voice, "-r", str(a.rate), "-o", aiff, s["narration"]])
        run(["ffmpeg", "-y", "-loglevel", "error", "-i", aiff, "-ar", "48000", "-ac", "2", wav])
        ad = duration(wav)
        scenes.append(dict(s, img=img, wav=wav, adur=ad, dur=LEAD + ad + TAIL))
        print(f"  {i + 1:02d} {s['id']:<14} narration {ad:5.1f}s")

    # 1) per-scene video clips with a gentle zoom (alternating in / out)
    clips = []
    for i, sc in enumerate(scenes):
        out = os.path.join(WORK, f"clip{i:02d}.mp4")
        n = int(round(sc["dur"] * FPS))
        z = f"min(1+0.035*on/{n},1.035)" if i % 2 == 0 else f"max(1.035-0.035*on/{n},1)"
        vf = (f"scale=3840:2160:flags=lanczos,zoompan=z='{z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={n}:s=1920x1080:fps={FPS},"
              f"format=yuv420p")
        run(["ffmpeg", "-y", "-loglevel", "error", "-loop", "1", "-i", sc["img"], "-vf", vf, "-frames:v", str(n),
             "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-r", str(FPS), out])
        clips.append(out)

    # 2) offsets: scene k starts (fade-in begins) at off[k]
    off = [0.0]
    for sc in scenes[:-1]:
        off.append(off[-1] + sc["dur"] - XF)
    total = off[-1] + scenes[-1]["dur"]

    # 3) video cross-fade chain
    inputs, fc = [], []
    for c in clips:
        inputs += ["-i", c]
    prev = "[0:v]"
    for k in range(1, len(clips)):
        o = off[k]
        lbl = f"[v{k}]"
        fc.append(f"{prev}[{k}:v]xfade=transition=fade:duration={XF}:offset={o:.3f}{lbl}")
        prev = lbl
    # 4) narration track: each wav delayed to its scene start + LEAD (+ half the fade)
    base = len(clips)
    for k, sc in enumerate(scenes):
        inputs += ["-i", sc["wav"]]
        d = int((off[k] + LEAD + (XF / 2 if k else 0)) * 1000)
        fc.append(f"[{base + k}:a]adelay={d}|{d}[a{k}]")
    fc.append("".join(f"[a{k}]" for k in range(len(scenes))) + f"amix=inputs={len(scenes)}:normalize=0,"
              f"apad=whole_dur={total:.3f},afade=t=out:st={total - 1.2:.3f}:d=1.2,loudnorm=I=-16:TP=-1.5:LRA=11[aout]")
    fc.append(f"{prev}fade=t=in:st=0:d=0.6,fade=t=out:st={total - 1.0:.3f}:d=1.0[vout]")

    # 5) subtitles (sentence-level, proportional timing inside each narration)
    srt, n = [], 1
    for k, sc in enumerate(scenes):
        start = off[k] + LEAD + (XF / 2 if k else 0)
        sents = [x.strip() for x in re.split(r"(?<=[.!?])\s+", sc["narration"]) if x.strip()]
        total_chars = sum(len(x) for x in sents)
        t = start
        for x in sents:
            d = sc["adur"] * len(x) / total_chars
            srt.append(f"{n}\n{ts(t)} --> {ts(t + d - 0.05)}\n{x}\n")
            n += 1; t += d
    srt_path = os.path.join(DEMO, "TrainMe_Demo.srt")
    open(srt_path, "w").write("\n".join(srt))

    out = os.path.join(DEMO, "TrainMe_Demo.mp4")
    tmp = os.path.join(WORK, "nosubs.mp4")
    run(["ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex", ";".join(fc), "-map", "[vout]", "-map", "[aout]",
         "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-r", str(FPS),
         "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", "-t", f"{total:.3f}", tmp])
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp, "-i", srt_path, "-map", "0", "-map", "1", "-c", "copy", "-c:s", "mov_text",
         "-metadata:s:s:0", "language=eng", "-movflags", "+faststart", out])

    # 6) script document
    md = ["# TrainMe – Demo Video Script\n", f"Video: `design/demo/TrainMe_Demo.mp4` · {int(total // 60)} min {int(total % 60)} s · 1920×1080 · 30 fps · "
          f"voice: macOS “{a.voice}” at {a.rate} wpm · subtitles: `TrainMe_Demo.srt` (also embedded)\n",
          "Regenerate: `./design/tools/render_screens.sh && python3 design/tools/build_video.py`\n",
          "| # | Time | Chapter | Scene | Narration |", "|---|---|---|---|---|"]
    for k, sc in enumerate(scenes):
        m, s_ = divmod(int(off[k]), 60)
        md.append(f"| {k + 1} | {m}:{s_:02d} | {sc['chapter']} | {sc['title'] or sc['id']} | {sc['narration']} |")
    open(os.path.join(DEMO, "narration_script.md"), "w").write("\n".join(md) + "\n")
    print(f"OK → {out}  ({total:.1f} s)")


if __name__ == "__main__":
    main()
