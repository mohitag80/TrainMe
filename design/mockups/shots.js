/* TrainMe demo – scenes (mockups + captions + narration). Works in the browser (window.SHOTS) and in Node (module.exports). */
(function () {
  // ------------------------------------------------------------------ helpers
  const mk = (n, cls = "") => `<span class="mk ${cls}">${n}</span>`;
  const ICON = {
    home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    check: '<path d="M5 12l5 5L20 7"/>',
    cloud: '<path d="M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 9.5 4.5 4.5 0 0 0 7 18z"/>',
    cloudoff: '<path d="M3 3l18 18M7 18h10c.7 0 1.3-.1 1.9-.4M20.6 15A4 4 0 0 0 17.5 10 6 6 0 0 0 8.2 6.2M6 9.5A4.5 4.5 0 0 0 7 18"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    layers: '<path d="M12 2l10 6-10 6L2 8z"/><path d="M2 14l10 6 10-6"/>',
    users: '<circle cx="9" cy="8" r="4"/><path d="M2 21c1-4 4-6 7-6s6 2 7 6M16 4a4 4 0 0 1 0 8M22 21c-.5-2.5-2-4.3-4-5.2"/>',
    flag: '<path d="M4 22V4M4 4h13l-2 4 2 4H4"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21.2l8.8-8.8a5.5 5.5 0 0 0 0-7.8z"/>',
    compare: '<path d="M8 3v18M16 3v18M3 8h5M16 16h5M3 16h5M16 8h5"/>',
    face: '<path d="M7 3H5a2 2 0 0 0-2 2v2M17 3h2a2 2 0 0 1 2 2v2M7 21H5a2 2 0 0 1-2-2v-2M17 21h2a2 2 0 0 0 2-2v-2M9 9v1M15 9v1M12 9v4h-1M9 16c1.7 1.3 4.3 1.3 6 0"/>',
    shield: '<path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z"/>',
    trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3a3 3 0 0 1-3 4M7 5H4a3 3 0 0 0 3 4"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>', back: '<path d="M15 6l-6 6 6 6"/>',
    timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/>',
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  };
  const ic = (n, s = 20, c = "currentColor", w = 2) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${ICON[n]}</svg>`;
  const google = `<svg width="20" height="20" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;
  const apple = `<svg width="18" height="20" viewBox="0 0 384 512" fill="currentColor"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/></svg>`;
  const logoSvg = (s = 44) => `<svg width="${s}" height="${s}" viewBox="0 0 64 64"><defs><linearGradient id="lg${s}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5B5BF7"/><stop offset="1" stop-color="#22D3EE"/></linearGradient></defs><rect x="2" y="2" width="60" height="60" rx="18" fill="url(#lg${s})"/><path d="M14 40l10-10 8 7 16-17" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><path d="M40 20h8v8" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="14" cy="40" r="4" fill="#fff"/></svg>`;
  const logo = (s = 44, fs = 26, color = "inherit") => `<span class="logo">${logoSvg(s)}<span class="wordmark" style="font-size:${fs}px;color:${color}">Train<b>Me</b></span></span>`;

  const status = (dark) => `<div class="statusbar"><span>9:41</span><span class="ic"><svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5" width="3" height="7" rx="1"/><rect x="10" y="2.5" width="3" height="9.5" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg><svg width="26" height="12" viewBox="0 0 26 12"><rect x=".5" y=".5" width="22" height="11" rx="3.5" fill="none" stroke="currentColor" opacity=".5"/><rect x="2" y="2" width="17" height="8" rx="2" fill="currentColor"/></svg></span></div>`;
  const tabbar = (on) => `<div class="tabbar">${[["home", "Home"], ["clock", "History"], ["plus", ""], ["chart", "Progress"], ["user", "Profile"]].map(([i, l], k) =>
    k === 2 ? `<div><span class="plus">${ic("plus", 26, "#fff", 2.6)}</span></div>` : `<div class="${l === on ? "on" : ""}">${ic(i, 23)}<span>${l}</span></div>`).join("")}</div>`;
  const phone = (inner, o = {}) => `<div class="phone"><div class="screen ${o.dark ? "dark" : ""}" style="${o.bg ? "background:" + o.bg : ""}"><div class="island"></div>${status(o.dark)}${inner}</div></div>`;
  const browser = (url, inner, o = {}) => `<div class="browser ${o.admin ? "admin" : ""}" style="${o.w ? "width:" + o.w + "px;" : ""}${o.h ? "height:" + o.h + "px;" : ""}"><div class="chrome"><div class="lights"><i style="background:#FF5F57"></i><i style="background:#FEBC2E"></i><i style="background:#28C840"></i></div><div class="url">${ic("lock", 13, "#16A34A")}<span>${url}</span></div><div style="width:60px"></div></div><div class="body">${inner}</div></div>`;
  const side = (items, on, o = {}) => `<div class="side"><div style="padding:4px 10px 18px">${logo(32, 20, o.admin ? "#fff" : "")}${o.admin ? '<span class="badge pink" style="margin-left:6px">ADMIN</span>' : ""}</div>${items.map(([i, l]) => i === "-" ? `<div class="sec">${l}</div>` : `<div class="nav ${l === on ? "on" : ""}">${ic(i, 18)}<span>${l}</span></div>`).join("")}</div>`;
  const ring = (pct, size = 120, sw = 12, color = "url(#rg)", inner = "") => { const r = (size - sw) / 2, c = 2 * Math.PI * r; return `<div class="ring" style="width:${size}px;height:${size}px"><svg width="${size}" height="${size}"><defs><linearGradient id="rg" x1="0" x2="1"><stop offset="0" stop-color="#5B5BF7"/><stop offset="1" stop-color="#22D3EE"/></linearGradient></defs><circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="#EEF0F6" stroke-width="${sw}" fill="none"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="${color}" stroke-width="${sw}" fill="none" stroke-linecap="round" stroke-dasharray="${c * pct} ${c}"/></svg><div class="v">${inner}</div></div>`; };

  // line / area chart
  function lineChart({ w = 600, h = 220, series, labels, min = 0, max = 100, ticks = [0, 25, 50, 75, 100], unit = "", hi = -1, tip = "", bars = null }) {
    const pl = 42, pr = 14, pt = 14, pb = 30, iw = w - pl - pr, ih = h - pt - pb, n = labels.length;
    const X = i => pl + (n === 1 ? iw / 2 : i * iw / (n - 1)), Y = v => pt + ih - (v - min) / (max - min) * ih;
    let s = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block">`;
    s += `<defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5B5BF7" stop-opacity=".28"/><stop offset="1" stop-color="#5B5BF7" stop-opacity="0"/></linearGradient></defs>`;
    ticks.forEach(t => { s += `<line x1="${pl}" x2="${w - pr}" y1="${Y(t)}" y2="${Y(t)}" stroke="#EEF0F6"/><text x="${pl - 8}" y="${Y(t) + 4}" font-size="11" fill="#94A3B8" text-anchor="end">${t}${unit}</text>`; });
    labels.forEach((l, i) => { if (n <= 12 || i % 2 === 0) s += `<text x="${X(i)}" y="${h - 8}" font-size="11" fill="#94A3B8" text-anchor="middle">${l}</text>`; });
    if (bars) { const bw = Math.min(26, iw / n * .5); bars.data.forEach((v, i) => { s += `<rect x="${X(i) - bw / 2}" y="${Y(v)}" width="${bw}" height="${pt + ih - Y(v)}" rx="6" fill="${i === hi ? "url(#bg)" : "#E0E3FF"}"/>`; }); s += `<defs><linearGradient id="bg" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#5B5BF7"/><stop offset="1" stop-color="#22D3EE"/></linearGradient></defs>`; }
    series.forEach(se => {
      const pts = se.data.map((v, i) => v == null ? null : [X(i), Y(v)]).filter(Boolean);
      const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
      if (se.area) s += `<path d="${d} L${pts[pts.length - 1][0]} ${pt + ih} L${pts[0][0]} ${pt + ih} Z" fill="url(#ag)"/>`;
      s += `<path d="${d}" fill="none" stroke="${se.color}" stroke-width="${se.w || 3}" stroke-linecap="round" stroke-linejoin="round" ${se.dash ? 'stroke-dasharray="6 6"' : ""}/>`;
      if (se.dots !== false) pts.forEach((p, i) => { s += `<circle cx="${p[0]}" cy="${p[1]}" r="${i === hi ? 6 : 3.5}" fill="#fff" stroke="${se.color}" stroke-width="${i === hi ? 3.5 : 2.5}"/>`; });
    });
    if (hi >= 0 && tip) { const x = X(hi), y = Y(series[0].data[hi]); const tw = 190; const tx = Math.min(Math.max(x - tw / 2, pl), w - pr - tw); s += `<line x1="${x}" x2="${x}" y1="${pt}" y2="${pt + ih}" stroke="#5B5BF7" stroke-dasharray="4 4" opacity=".5"/><g transform="translate(${tx},${Math.max(y - 70, 2)})"><rect width="${tw}" height="54" rx="10" fill="#0F172A"/>${tip}</g>`; }
    return s + "</svg>";
  }
  function groupBars({ w = 600, h = 240, groups, series, colors, max = 100, unit = "%" }) {
    const pl = 38, pr = 10, pt = 12, pb = 34, iw = w - pl - pr, ih = h - pt - pb, gw = iw / groups.length, bw = Math.min(28, gw / (series.length + 1.2));
    let s = `<svg width="${w}" height="${h}" style="display:block">`;
    [0, 25, 50, 75, 100].forEach(t => { const y = pt + ih - t / max * ih; s += `<line x1="${pl}" x2="${w - pr}" y1="${y}" y2="${y}" stroke="#EEF0F6"/><text x="${pl - 6}" y="${y + 4}" font-size="11" fill="#94A3B8" text-anchor="end">${t}${unit}</text>`; });
    groups.forEach((g, gi) => { const gx = pl + gi * gw + gw / 2 - (series.length * bw + (series.length - 1) * 5) / 2;
      series.forEach((se, si) => { const v = se[gi], bh = v / max * ih; s += `<rect x="${gx + si * (bw + 5)}" y="${pt + ih - bh}" width="${bw}" height="${bh}" rx="6" fill="${colors[si]}"/><text x="${gx + si * (bw + 5) + bw / 2}" y="${pt + ih - bh - 5}" font-size="10.5" font-weight="700" fill="#475569" text-anchor="middle">${v}</text>`; });
      s += `<text x="${pl + gi * gw + gw / 2}" y="${h - 10}" font-size="12" font-weight="600" fill="#475569" text-anchor="middle">${g}</text>`; });
    return s + "</svg>";
  }
  const tipTxt = (a, b, c) => `<text x="12" y="20" font-size="11" fill="#94A3B8">${a}</text><text x="12" y="40" font-size="15" font-weight="800" fill="#fff">${b}</text><text x="178" y="40" font-size="12" fill="#A5F3FC" text-anchor="end">${c}</text>`;
  const ratioRow = (label, num, den, color = "") => { const p = Math.round(num / den * 1000) / 10; return `<div><div class="row between"><span class="t-s t-b">${label}</span><span class="t-s"><b>${p}%</b> <span class="t-m">· ${num}/${den}</span></span></div><div class="pbar" style="margin-top:6px"><i style="width:${p}%;${color ? "background:" + color : ""}"></i></div></div>`; };
  const ballDot = (t) => ({ Y: `<i style="background:#5B5BF7">Y</i>`, y: `<i style="background:#A5B4FC">Y</i>`, S: `<i style="background:#10B981">S</i>`, B: `<i style="background:#F59E0B">B</i>`, N: `<i style="background:#EF4444">N</i>`, o: `<i style="background:#CBD5E1;color:#334155">•</i>` }[t]);

  // stage wrapper
  const stage = (s, inner) => `<div class="stage"><div class="brandmark">${logoSvg(34)}<span>Train<span style="background:var(--grad);-webkit-background-clip:text;color:transparent">Me</span></span></div>
    <div class="caption"><span class="tag ${s.who === "Admin" ? "admin" : ""}"><span class="dot"></span>${s.who} · ${s.step}</span><h1>${s.title}</h1>${s.lead ? `<p class="lead">${s.lead}</p>` : ""}
    <ul>${s.bullets.map((b, i) => `<li><span class="n">${i + 1}</span><span>${b}</span></li>`).join("")}</ul>${s.reqs ? `<div class="reqs">${s.reqs.map(r => `<span>${r}</span>`).join("")}</div>` : ""}</div>
    <div class="area">${inner}</div><div class="stepbar"><span>${s.idx}/${s.total}</span><div class="bar"><i style="width:${s.idx / s.total * 100}%"></i></div><span>${s.chapter}</span></div></div>`;

  // ------------------------------------------------------------------ screens
  const S = [];

  // 1 Title
  S.push({ id: "title", chapter: "Intro", full: true,
    narration: "Welcome to TrainMe, the training tracker for athletes and gym-goers. In the next few minutes we will walk through the member experience on mobile and web, from sign-up to logging every ball of a bowling session, charts, history and comparisons, and then the admin console that runs the platform.",
    html: () => `<div class="stage"><div class="title">${logoSvg(150)}<div class="big">Train<span style="background:var(--grad);-webkit-background-clip:text;color:transparent">Me</span></div><div class="tl">Track every ball, every rep, every goal.</div>
      <div class="sports"><span>🏏</span><span>🎾</span><span>🏋️</span><span>⚽</span><span>🏸</span><span>🏃</span></div><div class="meta">Product demo · Members & Admin</div></div></div>` });

  // 2 Overview
  S.push({ id: "overview", chapter: "Intro", who: "Platform", step: "Overview", title: "One platform,<br><em>three apps</em>",
    lead: "Same account, same data, everywhere.",
    bullets: ["<b>Mobile app</b> for iOS and Android – log sessions live, even offline", "<b>Web app</b> for deep progress charts, history and comparisons", "<b>Admin console</b> for the catalog, users, plans and releases"],
    reqs: ["TR-4 mobile day 1", "TR-5 mobile + laptop"],
    narration: "TrainMe is one platform with three apps. The mobile app is where athletes log sessions live, even without signal. The web app gives a big-screen view of progress, history and comparisons. And the admin console is where the team curates the activity catalog, supports users and manages releases.",
    html: (s) => stage(s, `<div style="position:relative;width:1180px;height:820px">
      <div style="position:absolute;left:250px;top:40px;transform:scale(.62);transform-origin:top left">${browser("app.trainme.app/progress", webProgressBody(false), { w: 1160, h: 760 })}</div>
      <div style="position:absolute;left:470px;top:400px;transform:scale(.52);transform-origin:top left">${browser("admin.trainme.app/catalog", adminCatalogBody(false), { admin: true, w: 1160, h: 760 })}</div>
      <div style="position:absolute;left:20px;top:60px;transform:scale(.82);transform-origin:top left">${phone(homeScreen(false))}</div></div>`) });

  // 3 Registration
  S.push({ id: "register", chapter: "Member onboarding", who: "Member", step: "Sign up", title: "Create an account<br>in <em>30 seconds</em>",
    bullets: ["One-tap <b>Apple</b> or <b>Google</b> sign-up", "Live <b>password strength</b> and inline validation", "Clear consent to terms and privacy"],
    reqs: ["FR-IAM-01", "FR-IAM-02", "NFR-USE-05"],
    narration: "Getting started is quick. A new member can sign up with one tap using Apple or Google. Or they enter their name, email and a password, and a live strength meter guides them as they type. Consent to the terms and privacy policy is explicit, and the create account button stays clear and prominent.",
    html: (s) => stage(s, phone(`<div class="scr" style="gap:13px;padding-top:10px">
      <div style="text-align:center;margin-top:4px">${logoSvg(58)}</div>
      <div style="text-align:center"><div class="h1">Create your account</div><div class="t-m t-s" style="margin-top:6px">Start tracking your training today</div></div>
      <div class="col rel" style="gap:10px">${mk(1)}<div class="btn dark">${apple}<span>Continue with Apple</span></div><div class="btn">${google}<span>Continue with Google</span></div></div>
      <div class="divider">or sign up with email</div>
      <div><div class="label">Full name</div><div class="input">${ic("user", 18, "#94A3B8")}Arjun Mehta</div></div>
      <div><div class="label">Email</div><div class="input">${ic("mail", 18, "#94A3B8")}arjun.m@example.com <span style="margin-left:auto;color:var(--ok)">${ic("check", 18, "#10B981", 2.5)}</span></div></div>
      <div class="rel">${mk(2)}<div class="label">Password</div><div class="input focus">${ic("lock", 18, "#94A3B8")}<span style="letter-spacing:3px">••••••••••••</span><span style="margin-left:auto">${ic("eye", 18, "#94A3B8")}</span></div>
        <div class="row" style="gap:5px;margin-top:8px"><i style="flex:1;height:5px;border-radius:5px;background:#10B981"></i><i style="flex:1;height:5px;border-radius:5px;background:#10B981"></i><i style="flex:1;height:5px;border-radius:5px;background:#10B981"></i><i style="flex:1;height:5px;border-radius:5px;background:#E2E8F0"></i><span class="t-xs t-b" style="color:#047857;margin-left:6px">Strong</span></div></div>
      <div class="row rel t-s" style="gap:10px;color:var(--ink-2)">${mk(3)}<span class="cb on">✓</span><span>I agree to the <b style="color:var(--brand)">Terms</b> and <b style="color:var(--brand)">Privacy Policy</b></span></div>
      <div class="btn primary">Create account ${ic("chevron", 18, "#fff", 2.5)}</div>
      <div class="t-s t-m" style="text-align:center">Already have an account? <b style="color:var(--brand)">Log in</b></div></div>`)) });

  // 4 Onboarding interests
  S.push({ id: "onboard", chapter: "Member onboarding", who: "Member", step: "Personalise", title: "Tell us how<br>you <em>train</em>",
    bullets: ["Pick interests – <b>sports, gym, diet</b>", "Choose your <b>role</b>, e.g. Fast bowler", "Set units – metric or imperial"],
    reqs: ["FR-PRF-01", "FR-PRF-02", "FR-CAT-01"],
    narration: "Next, onboarding personalises the app. The member picks what they train, here cricket and gym, then their role in cricket, a fast bowler. Roles only appear for sports that have them. Tennis and badminton, for example, have none. Finally they choose metric or imperial units, and TrainMe recommends the right templates.",
    html: (s) => stage(s, phone(`<div class="scr" style="gap:16px">
      <div class="row between"><span>${ic("back", 22)}</span><span class="t-s t-m t-b">Step 2 of 3</span><span style="width:22px"></span></div>
      <div class="pbar"><i style="width:66%"></i></div>
      <div><div class="h1">What do you train?</div><div class="t-m t-s" style="margin-top:6px">We'll suggest templates that fit you</div></div>
      <div class="grid3 rel">${mk(1)}${[["🏏", "Cricket", 1], ["🏋️", "Gym", 1], ["🎾", "Tennis"], ["⚽", "Football"], ["🏸", "Badminton"], ["🏃", "Running"]].map(([e, l, on]) => `<div class="card" style="padding:12px 6px;text-align:center;${on ? "border:2px solid var(--brand);background:var(--brand-soft)" : ""}"><div style="font-size:30px">${e}</div><div class="t-s t-b" style="margin-top:4px">${l}</div>${on ? `<div style="margin-top:4px;color:var(--brand)">${ic("check", 16, "#5B5BF7", 3)}</div>` : ""}</div>`).join("")}</div>
      <div class="rel">${mk(2)}<div class="h3" style="margin-bottom:10px">Your role in cricket</div><div class="row" style="flex-wrap:wrap;gap:8px">${["Batter", "Fast bowler", "Spin bowler", "Wicket-keeper", "Fielder", "All-rounder"].map(r => `<span class="chip ${r === "Fast bowler" ? "on" : ""}">${r === "Fast bowler" ? ic("check", 14, "#3F3FD9", 3) : ""}${r}</span>`).join("")}</div></div>
      <div class="rel">${mk(3)}<div class="h3" style="margin-bottom:10px">Units</div><div class="seg"><div class="on">Metric (kg, km/h)</div><div>Imperial</div></div></div>
      <div style="flex:1"></div><div class="btn primary">Continue</div></div>`)) });

  // 5 Login mobile
  S.push({ id: "login", chapter: "Member onboarding", who: "Member", step: "Log in", title: "Log in with<br><em>Face ID</em> or a tap",
    bullets: ["<b>Passkey / Face ID</b> – no password typing", "Email + password with <b>Forgot password</b>", "Secure sign-in (OIDC + PKCE) behind the scenes"],
    reqs: ["FR-IAM-03", "FR-IAM-04", "FR-IAM-05", "NFR-SEC-10"],
    narration: "Returning members log in in a second with Face ID or a passkey. Email and password, and Apple or Google, are always available, with a forgot-password link right where you expect it. Behind the scenes, TrainMe uses the industry-standard OpenID Connect flow with PKCE, and short-lived tokens are stored securely on the device.",
    html: (s) => stage(s, phone(`<div class="scr" style="gap:14px;padding-top:24px;background:linear-gradient(180deg,#EEF0FF 0%,#F6F7FB 40%)">
      <div style="text-align:center">${logo(64, 34)}</div>
      <div style="text-align:center;margin-top:8px"><div class="h1">Welcome back 👋</div><div class="t-m t-s" style="margin-top:6px">Log in to continue your streak</div></div>
      <div class="card rel" style="text-align:center;padding:20px">${mk(1)}<div style="width:74px;height:74px;margin:0 auto;border-radius:22px;background:var(--grad);display:grid;place-items:center">${ic("face", 40, "#fff", 2)}</div><div class="h3" style="margin-top:12px">Log in with Face ID</div><div class="t-xs t-m" style="margin-top:4px">arjun.m@example.com</div></div>
      <div class="divider">or</div>
      <div class="col rel" style="gap:10px">${mk(2)}<div class="input">${ic("mail", 18, "#94A3B8")}arjun.m@example.com</div><div class="input">${ic("lock", 18, "#94A3B8")}<span style="letter-spacing:3px">••••••••</span></div>
      <div class="t-s t-b" style="text-align:right;color:var(--brand)">Forgot password?</div></div>
      <div class="btn primary">Log in</div>
      <div class="grid2"><div class="btn">${apple}Apple</div><div class="btn">${google}Google</div></div>
      <div class="row t-xs t-m rel" style="justify-content:center;gap:6px;margin-top:2px">${mk(3, "l")}${ic("shield", 14, "#10B981")}Protected sign-in · MFA available</div></div>`)) });

  // 6 Login web
  S.push({ id: "login-web", chapter: "Member onboarding", who: "Member", step: "Web log in", title: "Same account<br>on the <em>web</em>",
    bullets: ["Split-screen sign-in with your <b>progress at a glance</b>", "Passkey, Google or Apple, or email", "Stay signed in on trusted devices"],
    reqs: ["FR-IAM-02", "FR-IAM-08", "NFR-USE-01"],
    narration: "On a laptop, the same account opens the web app. The sign-in page is designed to be inviting, with a preview of what you will see inside. Members can use a passkey, Google, Apple or email, and choose to stay signed in on trusted devices, which they can review and revoke at any time.",
    html: (s) => stage(s, browser("app.trainme.app/login", `<div style="display:grid;grid-template-columns:1fr 1fr;width:100%">
      <div style="background:linear-gradient(150deg,#1E1B4B 0%,#3730A3 45%,#0891B2 100%);color:#fff;padding:44px;display:flex;flex-direction:column;justify-content:space-between;position:relative;overflow:hidden">
        <div style="position:absolute;right:-80px;top:-80px;width:320px;height:320px;border-radius:50%;background:rgba(255,255,255,.08)"></div>
        <div>${logo(46, 28, "#fff")}</div>
        <div class="rel">${mk(1)}<div style="font-size:40px;font-weight:800;line-height:1.1;letter-spacing:-.02em">Every ball.<br>Every rep.<br>Every win.</div><div style="margin-top:14px;color:#C7D2FE;font-size:16px">Your training, organised and visualised.</div>
          <div style="margin-top:26px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18);border-radius:18px;padding:16px;backdrop-filter:blur(6px)"><div class="row between"><span class="t-s" style="color:#C7D2FE">Yorker accuracy · 6 weeks</span><span class="badge ok">▲ 8.4 pts</span></div>
          ${lineChart({ w: 470, h: 120, series: [{ data: [52, 55, 58, 57, 62, 66.7], color: "#A5F3FC", area: false }], labels: ["W1", "W2", "W3", "W4", "W5", "W6"], min: 40, max: 80, ticks: [40, 60, 80], unit: "%" }).replace(/#94A3B8/g, "#C7D2FE").replace(/#EEF0F6/g, "rgba(255,255,255,.12)")}</div></div>
        <div class="t-s" style="color:#C7D2FE">“I finally know which balls work.” — club fast bowler</div></div>
      <div style="padding:60px 70px;display:flex;flex-direction:column;justify-content:center;gap:16px;background:#fff">
        <div class="h1" style="font-size:34px">Log in to TrainMe</div><div class="t-m" style="margin-top:-8px">Welcome back! Choose how to sign in.</div>
        <div class="col rel" style="gap:10px">${mk(2)}<div class="btn primary">${ic("face", 20, "#fff")}Sign in with a passkey</div><div class="grid2"><div class="btn">${google}Google</div><div class="btn">${apple}Apple</div></div></div>
        <div class="divider">or with email</div>
        <div class="input focus">${ic("mail", 18, "#94A3B8")}arjun.m@example.com</div><div class="input">${ic("lock", 18, "#94A3B8")}<span style="letter-spacing:3px">••••••••</span></div>
        <div class="row between t-s rel"><span class="row" style="gap:8px">${mk(3, "l")}<span class="cb on">✓</span>Keep me signed in</span><b style="color:var(--brand)">Forgot password?</b></div>
        <div class="btn dark">Log in</div><div class="t-s t-m" style="text-align:center">New here? <b style="color:var(--brand)">Create an account</b></div></div></div>`)) });

  // 7 Home dashboard
  function homeScreen(withMk = true) {
    const m = (n) => withMk ? mk(n) : "";
    return `<div class="scr" style="gap:14px">
      <div class="row between"><div><div class="t-s t-m">Good morning</div><div class="h2">Arjun 👋</div></div><div class="row" style="gap:10px"><span class="chip warn rel">${m(1)}🔥 12-day streak</span><div class="avatar">AM</div></div></div>
      <div class="card row rel" style="gap:16px;background:linear-gradient(135deg,#1E1B4B,#4338CA);color:#fff;border:0">${m(2)}${ring(.83, 104, 11, "#22D3EE", `<div style="color:#fff"><div style="font-size:24px;font-weight:800">5/6</div><div style="font-size:10px;opacity:.8">sessions</div></div>`).replace("#EEF0F6", "rgba(255,255,255,.15)")}
        <div class="col" style="gap:6px"><div class="t-s" style="opacity:.8">This week</div><div class="h3">One more to hit your goal</div><div class="row t-xs" style="gap:12px;opacity:.9"><span>⏱ 4h 10m</span><span>🏏 214 balls</span><span>🏋️ 2 gym</span></div></div></div>
      <div class="row between"><span class="h3">Start a session</span><span class="t-s t-b" style="color:var(--brand)">All trackers</span></div>
      <div class="card row rel" style="gap:12px">${m(3)}<div style="width:52px;height:52px;border-radius:16px;background:#EEF0FF;display:grid;place-items:center;font-size:28px">🏏</div><div class="col" style="flex:1"><span class="h3">My Fast Bowling</span><span class="t-xs t-m">Last: yesterday · Yorker 66.7%</span></div><span class="btn primary sm">${ic("bolt", 16, "#fff")}Start</span></div>
      <div class="card row" style="gap:12px"><div style="width:52px;height:52px;border-radius:16px;background:#ECFEFF;display:grid;place-items:center;font-size:28px">🏋️</div><div class="col" style="flex:1"><span class="h3">Push Day</span><span class="t-xs t-m">Last: Mon · Volume 6.2 t</span></div><span class="btn sm">Start</span></div>
      <div class="card row" style="gap:12px;background:var(--ok-soft);border-color:transparent">${ic("trophy", 26, "#059669")}<div class="col"><span class="t-s t-b" style="color:#065F46">New personal best!</span><span class="t-xs" style="color:#047857">Top speed 138.2 km/h · 3 Oct</span></div></div>
      <div class="row between"><span class="h3">Recent sessions</span><span class="t-s t-b" style="color:var(--brand)">History</span></div>
      <div class="card" style="padding:6px 14px">${[["Fri 3 Oct", "Nets · 50 balls", "Yorker 66.7%", "ok"], ["Wed 1 Oct", "Club T20 · 42 balls", "Yorker 71.4%", "ok"], ["Mon 29 Sep", "Push Day · 18 sets", "Vol 6.2 t", "gray"]].map(([d, t, m, b]) => `<div class="row between" style="padding:9px 0;border-bottom:1px solid #F1F3F8"><div class="col"><span class="t-s t-b">${d}</span><span class="t-xs t-m">${t}</span></div><span class="badge ${b}">${m}</span></div>`).join("")}</div></div>${tabbar("Home")}`;
  }
  S.push({ id: "home", chapter: "Track a session", who: "Member", step: "Home", title: "Your training<br><em>at a glance</em>",
    bullets: ["<b>Streaks</b> keep motivation high", "Weekly <b>goal ring</b> and totals", "<b>One-tap start</b> for each tracker"],
    reqs: ["FR-ANL-03", "FR-ANL-04", "NFR-USE-02"],
    narration: "The home screen shows training at a glance. A streak counter keeps motivation high, the weekly ring shows progress towards the goal, and every personal tracker has a one-tap start button. New personal bests, like a top speed of 138 kilometres per hour, are celebrated right here.",
    html: (s) => stage(s, phone(homeScreen(true))) });

  // 8 Catalog explore
  S.push({ id: "catalog", chapter: "Track a session", who: "Member", step: "Explore", title: "Find any drill<br>or <em>exercise</em>",
    bullets: ["<b>Smart search</b> tolerates typos and synonyms", "Browse <b>Sports › Cricket › Bowling › Fast Bowler</b>", "<b>Filters</b> by sport, role, equipment, muscle"],
    reqs: ["FR-CAT-01", "FR-CAT-12", "NFR-PERF-09"],
    narration: "To add something new, members explore the catalog. Search is forgiving of typos and synonyms, so searching yorker finds the right bowling drills instantly. You can also browse the tree, from sports to cricket, bowling and fast bowler, and filter by sport, role, equipment or muscle group.",
    html: (s) => stage(s, phone(`<div class="scr" style="gap:13px">
      <div class="h1">Explore</div>
      <div class="input focus rel">${mk(1)}${ic("search", 18, "#5B5BF7")}<span>yorker</span><span class="badge gray" style="margin-left:auto">42 ms</span></div>
      <div class="row t-s rel" style="gap:6px;color:var(--muted);flex-wrap:wrap">${mk(2)}<span>Sports</span>${ic("chevron", 14)}<span>Cricket</span>${ic("chevron", 14)}<span>Bowling</span>${ic("chevron", 14)}<b style="color:var(--ink)">Fast Bowler</b></div>
      <div class="row rel" style="gap:8px;flex-wrap:wrap">${mk(3)}<span class="chip on">🏏 Cricket</span><span class="chip on">Fast bowler</span><span class="chip">Drills</span><span class="chip">Tests</span></div>
      <div class="card" style="background:linear-gradient(135deg,#EEF0FF,#ECFEFF);border-color:#C7D2FE"><div class="row between"><span class="badge">TEMPLATE</span><span class="t-xs t-m">⭐ Popular</span></div><div class="h3" style="margin-top:8px">Fast Bowler</div><div class="t-xs t-m" style="margin-top:2px">11 activities · ball-by-ball, targets, workload</div></div>
      ${[["Fast Bowling – Delivery", "DRILL · per ball · 17 fields", "🎯"], ["Target / Cone Bowling Drill", "DRILL · per block", "🟡"], ["Bowling Spell / Match Figures", "MATCH · per session", "📋"], ["Yo-Yo Intermittent Recovery Test", "TEST · fitness", "🏃"]].map(([t, d, e]) => `<div class="row" style="gap:12px;padding:6px 2px"><div style="width:44px;height:44px;border-radius:14px;background:#fff;border:1px solid var(--line);display:grid;place-items:center;font-size:22px">${e}</div><div class="col" style="flex:1"><span class="t-s t-b">${t}</span><span class="t-xs t-m">${d}</span></div>${ic("chevron", 18, "#94A3B8")}</div>`).join("")}
      </div>${tabbar("")}`)) });

  // 9 Template preview
  S.push({ id: "template", chapter: "Track a session", who: "Member", step: "Add tracker", title: "Pick a template,<br>make it <em>yours</em>",
    bullets: ["See <b>what you'll track</b> before you start", "<b>Attempted → accurate</b> pairs for each skill", "Name it and <b>add to my trackers</b>"],
    reqs: ["FR-TRK-01", "FR-CAT-02", "FR-CAT-09"],
    narration: "The Fast Bowler template shows exactly what will be tracked: speed, line and length, and an attempted and accurate pair for every skill, yorker, seam, bouncer, swing and slower ball. One tap adds it as a personal tracker. Here it is named My Fast Bowling.",
    html: (s) => stage(s, phone(`<div class="scr" style="gap:13px;padding-top:0">
      <div style="margin:0 -20px;padding:16px 20px 18px;background:linear-gradient(135deg,#1E1B4B,#4338CA);color:#fff"><div class="row between">${ic("back", 22, "#fff")}<span class="badge" style="background:rgba(255,255,255,.15);color:#fff">v2 · Sports › Cricket</span></div>
        <div style="font-size:44px;margin-top:10px">🏏</div><div class="h1" style="color:#fff">Fast Bowler</div><div class="t-s" style="opacity:.85;margin-top:4px">Ball-by-ball logging for pace bowlers</div></div>
      <div class="rel">${mk(1)}<div class="h3" style="margin-bottom:8px">What you'll track</div><div class="row" style="gap:7px;flex-wrap:wrap">${["Speed", "Line", "Length", "No-ball", "Target hit"].map(c => `<span class="chip">${c}</span>`).join("")}</div></div>
      <div class="card rel" style="padding:14px">${mk(2)}<div class="t-s t-b" style="margin-bottom:8px">Skills · attempted → accurate</div>${["Yorker", "Seam", "Bouncer", "Swing", "Slower ball"].map(k => `<div class="row between" style="padding:6px 0;border-bottom:1px solid #F1F3F8"><span class="t-s">${k}</span><span class="row t-xs t-m" style="gap:6px"><span class="badge gray">attempted</span>→<span class="badge ok">accurate</span></span></div>`).join("")}</div>
      <div class="t-xs t-m">Also: target drills · spell figures · workload · fitness tests</div>
      <div class="rel">${mk(3)}<div class="label">Tracker name</div><div class="input focus">My Fast Bowling</div></div>
      <div class="btn primary">${ic("plus", 18, "#fff", 2.6)}Add to my trackers</div></div>`)) });

  // 10 Customise
  S.push({ id: "customise", chapter: "Track a session", who: "Member", step: "Customise", title: "Add your own<br><em>parameters</em>",
    bullets: ["Add a <b>custom field</b> – e.g. Slower ball", "Make it <b>conditional</b> if needed", "Auto-create a <b>ratio metric</b> for charts"],
    reqs: ["FR-TRK-02", "FR-TRK-03", "FR-CAT-10", "TR-9"],
    narration: "Every athlete trains differently, so trackers are fully customisable. Here the bowler adds a new yes or no field called slower ball. Fields can be conditional, appearing only when another answer is yes. And TrainMe can automatically create a ratio metric, slower-ball rate, so it shows up in the charts. The shared template never changes.",
    html: (s) => stage(s, phone(`<div class="scr" style="gap:10px"><div class="row between"><span>${ic("back", 22)}</span><span class="h3">My Fast Bowling</span><span class="t-s t-b" style="color:var(--brand)">Done</span></div>
      ${["Speed (km/h)", "Line", "Yorker attempted → accurate", "Seam attempted → accurate", "Bouncer attempted → accurate", "No-ball"].map(f => `<div class="card row between" style="padding:12px 14px"><span class="t-s">${f}</span>${ic("chevron", 16, "#94A3B8")}</div>`).join("")}</div>
      <div class="scrim"></div><div class="sheet"><div class="grab"></div><div class="h2">Add parameter</div>
      <div class="rel">${mk(1)}<div class="label">Name</div><div class="input focus">Slower ball</div></div>
      <div><div class="label">Type</div><div class="seg"><div class="on">Yes / No</div><div>Number</div><div>Choice</div><div>Text</div></div></div>
      <div class="card row between rel" style="padding:12px 14px">${mk(2)}<div class="col"><span class="t-s t-b">Show only when…</span><span class="t-xs t-m">e.g. when “Pace off” = yes</span></div><span class="toggle"></span></div>
      <div class="card row between rel" style="padding:12px 14px;background:var(--brand-soft);border-color:#C7D2FE">${mk(3)}<div class="col"><span class="t-s t-b">Also create metric</span><span class="t-xs" style="color:var(--brand-d)">Slower-ball rate = yes ÷ all balls (%)</span></div><span class="toggle on"></span></div>
      <div class="btn primary">Save parameter</div></div>`)) });

  // 11 Live session
  S.push({ id: "live", chapter: "Track a session", who: "Member", step: "Live session", title: "Start a live<br><em>session</em>",
    bullets: ["Session <b>timer</b> with over and ball counter", "<b>Live stats</b> update after every ball", "<b>Auto-sync</b> status always visible"],
    reqs: ["FR-REC-09", "FR-REC-14", "FR-CAT-11"],
    narration: "Now the session begins. The live screen shows a timer and an over and ball counter, because deliveries are grouped into overs of six. Live stats, like balls bowled, yorker accuracy so far and average speed, update instantly after every ball. The sync indicator shows the session is safely backed up.",
    html: (s) => stage(s, phone(`<div style="background:linear-gradient(160deg,#0F172A,#312E81);margin-top:-54px;padding:60px 20px 22px;color:#fff">
        <div class="row between"><span class="badge" style="background:rgba(239,68,68,.2);color:#FCA5A5">● LIVE</span><span class="badge rel" style="background:rgba(16,185,129,.2);color:#6EE7B7">${mk(3)}${ic("cloud", 13, "#6EE7B7")} Synced · 2 min ago</span></div>
        <div class="t-s" style="opacity:.75;margin-top:16px">My Fast Bowling · Nets</div>
        <div class="row between rel" style="margin-top:6px">${mk(1)}<div><div style="font-size:52px;font-weight:800;letter-spacing:-.03em;font-variant-numeric:tabular-nums">00:12:41</div></div><div style="text-align:right"><div class="t-xs" style="opacity:.7">OVER · BALL</div><div style="font-size:34px;font-weight:800">3.2</div></div></div></div>
      <div class="scr" style="gap:12px;margin-top:-4px">
        <div class="grid3 rel" style="margin-top:12px">${mk(2)}${[["Balls", "14"], ["Yorker", "4/6"], ["Avg km/h", "132.1"]].map(([l, v]) => `<div class="card" style="padding:12px;text-align:center"><div class="t-xs t-m">${l}</div><div class="h2" style="margin-top:2px">${v}</div></div>`).join("")}</div>
        <div class="card"><div class="row between"><span class="t-s t-b">This over</span><span class="t-xs t-m">Y yorker · S seam · B bouncer · N no-ball</span></div><div class="balldots" style="margin-top:10px">${ballDot("Y")}${ballDot("S")}</div>
          <div class="t-s t-b" style="margin-top:12px">Previous overs</div><div class="balldots" style="margin-top:8px">${"YSoBYo SoNYSy oYSBoS".split("").filter(c => c !== " ").map(ballDot).join("")}</div></div>
        <div class="card row" style="gap:10px;padding:12px">${ic("trophy", 20, "#F59E0B")}<span class="t-s">On track for a <b>new yorker best</b> (≥ 70%)</span></div>
        <div style="flex:1"></div><div class="btn primary" style="height:60px;font-size:18px">${ic("plus", 22, "#fff", 2.6)}Log ball 15</div><div class="btn" style="color:var(--bad)">End session</div></div>`)) });

  // 12 Log a ball
  S.push({ id: "logball", chapter: "Track a session", who: "Member", step: "Log a ball", title: "Log every ball<br>in <em>seconds</em>",
    bullets: ["<b>Speed stepper</b> and tap-to-pick line on the pitch", "Toggle <b>Yorker attempted</b>…", "…and only then <b>“Accurate?”</b> appears"],
    reqs: ["FR-REC-01", "FR-REC-02", "FR-REC-03", "FR-CAT-09", "NFR-PERF-08"],
    narration: "Logging a ball takes seconds. Nudge the speed with the stepper, tap the line on the pitch and pick the length. Toggle yorker attempted, and only then does the accurate question appear. That is a conditional field, so the form stays short and the data stays clean. The ball is saved on the phone instantly, even with no signal.",
    html: (s) => stage(s, phone(`<div class="scr" style="gap:11px"><div class="row between"><span class="t-s t-b" style="color:var(--brand)">Cancel</span><span class="h3">Ball 15 · Over 3.3</span><span class="badge ok">auto-saves</span></div>
      <div class="card rel" style="padding:10px 14px">${mk(1)}<div class="row between"><span class="t-s t-b">Speed</span><span class="t-xs t-m">km/h</span></div><div class="row between" style="margin-top:4px"><span class="btn sm" style="width:46px;font-size:22px">−</span><span style="font-size:38px;font-weight:800;letter-spacing:-.02em">133.1</span><span class="btn sm" style="width:46px;font-size:22px">+</span></div></div>
      <div class="card" style="padding:12px 14px"><div class="row between"><span class="t-s t-b">Line</span><span class="t-xs t-m">tap the pitch</span></div><div class="pitch" style="height:78px;margin-top:8px"><div class="stumps"><i></i><i></i><i></i></div><div class="zones">${["O/off", "Off", "Mid", "Leg", "D/leg", "Wide"].map((z, i) => `<div class="${i === 1 ? "on" : ""}">${z}</div>`).join("")}</div></div>
        <div class="row" style="gap:5px;margin-top:9px">${["Yorker", "Full", "Good", "Short", "Bouncer"].map(l => `<span class="chip ${l === "Yorker" ? "on" : ""}" style="height:28px;font-size:12px;padding:0 9px">${l}</span>`).join("")}</div></div>
      <div class="card" style="padding:4px 14px">
        <div class="row between rel" style="padding:10px 0">${mk(2, "l")}<span class="t-s t-b">Yorker attempted</span><span class="toggle on"></span></div>
        <div class="row between rel hl" style="padding:10px 12px;margin:0 -6px 8px;border-radius:12px;background:var(--brand-soft)">${mk(3)}<span class="t-s t-b" style="color:var(--brand-d)">↳ Accurate?</span><div class="seg" style="width:150px;background:#fff"><div class="on" style="background:var(--ok);color:#fff">Yes</div><div>No</div></div></div>
        ${["Seam attempted", "Bouncer attempted", "Swing attempted", "Slower ball", "No-ball"].map(t => `<div class="row between" style="padding:7px 0;border-top:1px solid #F1F3F8"><span class="t-s">${t}</span><span class="toggle"></span></div>`).join("")}</div>
      <div class="btn primary">${ic("check", 20, "#fff", 2.8)}Save ball 15</div></div>`)) });

  // 13 Offline & sync
  S.push({ id: "offline", chapter: "Track a session", who: "Member", step: "Offline & sync", title: "No signal?<br><em>No problem.</em>",
    bullets: ["Balls are <b>saved on the device</b> first", "<b>Checkpoint sync</b> every 3–5 minutes", "<b>Back online</b> → synced exactly once"],
    reqs: ["FR-REC-04", "FR-REC-10", "FR-REC-11", "NFR-REL-07"],
    narration: "Cricket grounds and gyms often have poor signal. TrainMe saves every ball on the device first, so nothing is lost if the network drops or the app is closed. Every three to five minutes, and whenever the connection returns, a checkpoint syncs the new balls. Each ball has its own ID, so even if a sync is retried, nothing is duplicated.",
    html: (s) => stage(s, `${phone(`<div class="scr" style="gap:12px"><div class="toast rel" style="position:relative;left:0;right:0;background:var(--warn-soft);color:#92400E">${mk(1)}${ic("cloudoff", 22, "#D97706")}<div class="col"><span>You're offline</span><span class="t-xs" style="font-weight:500">9 balls saved on this phone · will sync automatically</span></div></div>
        <div class="h3">Over 4</div>${[19, 20, 21, 22, 23, 24].map((b, i) => `<div class="card row" style="gap:12px;padding:11px 14px">${ballDot("YSBoYN"[i])}<div class="col" style="flex:1"><span class="t-s t-b">Ball ${b} · ${[133.1, 135.6, 131.0, 129.4, 134.2, 128.0][i]} km/h</span><span class="t-xs t-m">${["Yorker ✓", "Seam ✓", "Bouncer ✗", "Good length", "Yorker ✓", "No-ball"][i]}</span></div>${ic("cloudoff", 18, "#F59E0B")}</div>`).join("")}</div>`)}
      <div style="color:#fff;display:flex;flex-direction:column;align-items:center;gap:10px"><div style="width:60px;height:60px;border-radius:50%;background:rgba(34,211,238,.15);display:grid;place-items:center">${ic("chevron", 34, "#22D3EE", 3)}</div><span style="font-size:14px;color:#A5F3FC;font-weight:700">back online</span></div>
      ${phone(`<div class="scr" style="gap:12px"><div class="toast rel" style="position:relative;left:0;right:0;background:var(--ok-soft);color:#065F46">${mk(3)}${ic("check", 22, "#059669", 3)}<div class="col"><span>All caught up</span><span class="t-xs" style="font-weight:500">9 balls synced · checkpoint #6 · 0 duplicates</span></div></div>
        <div class="card rel" style="padding:14px">${mk(2)}<div class="row between"><span class="t-s t-b">Sync</span><span class="badge">every 3–5 min</span></div><div class="t-xs t-m" style="margin-top:6px">Also on app background, network regain, or 25 unsynced balls</div><div class="row" style="gap:6px;margin-top:12px">${[1, 2, 3, 4, 5, 6].map(i => `<div style="flex:1;height:8px;border-radius:5px;background:${i < 7 ? "var(--ok)" : "#E2E8F0"}"></div>`).join("")}</div><div class="row between t-xs t-m" style="margin-top:6px"><span>06:10 start</span><span>06:34 now</span></div></div>
        <div class="h3">Over 4</div>${[19, 20, 21, 22].map((b, i) => `<div class="card row" style="gap:12px;padding:11px 14px">${ballDot("YSBo"[i])}<div class="col" style="flex:1"><span class="t-s t-b">Ball ${b}</span><span class="t-xs t-m">synced</span></div>${ic("cloud", 18, "#10B981")}</div>`).join("")}</div>`)}`) });

  // 14 Session summary
  S.push({ id: "summary", chapter: "Track a session", who: "Member", step: "End & submit", title: "Session complete –<br>see the <em>numbers</em>",
    bullets: ["<b>Submit on End</b> – server confirms all 50 balls", "<b>Ratio metrics</b> with counts, e.g. 12 / 18", "Add <b>notes</b>; celebrate <b>personal bests</b>"],
    reqs: ["FR-REC-12", "FR-ANL-02", "FR-ANL-08", "FR-ANL-04"],
    narration: "When the bowler taps end session, the app sends any remaining balls, and the server confirms that all fifty arrived before marking the session complete. The summary shows each skill as a ratio with its counts: yorkers twelve out of eighteen, seam twenty-three out of thirty, bouncers five out of eight, and just three no-balls. Notes can be added, and new personal bests are highlighted.",
    html: (s) => stage(s, phone(`<div class="scr" style="gap:12px"><div style="text-align:center;margin-top:4px"><div style="font-size:40px">🎉</div><div class="h1">Session complete</div><div class="t-s t-m rel" style="display:inline-block;margin-top:4px">${mk(1)}40 min · 50 balls · <span style="color:var(--ok);font-weight:700">all synced ✓</span></div></div>
      <div class="grid3">${[["Avg", "131.8", "km/h"], ["Top", "138.2", "km/h"], ["Overs", "8.2", ""]].map(([l, v, u]) => `<div class="card" style="padding:10px;text-align:center"><div class="t-xs t-m">${l}</div><div class="h2">${v}</div><div class="t-xs t-m">${u}</div></div>`).join("")}</div>
      <div class="card col rel" style="gap:13px">${mk(2)}${ratioRow("Yorker accuracy", 12, 18)}${ratioRow("Seam accuracy", 23, 30)}${ratioRow("Bouncer accuracy", 5, 8)}${ratioRow("No-ball rate", 3, 50, "#EF4444")}</div>
      <div class="card row rel" style="gap:10px;background:var(--ok-soft);border-color:transparent">${mk(3)}${ic("trophy", 24, "#059669")}<div class="col"><span class="t-s t-b" style="color:#065F46">Personal best · Top speed 138.2 km/h</span><span class="t-xs" style="color:#047857">+1.6 km/h vs previous best</span></div></div>
      <div class="input" style="height:46px"><span class="ph">Add a note…</span>&nbsp;New run-up felt smoother</div>
      <div class="grid2"><div class="btn">Share</div><div class="btn primary">Done</div></div></div>`)) });

  // 15 Web progress charts
  function webProgressBody(withMk = true) {
    const m = (n) => withMk ? mk(n) : "";
    return `${side([["home", "Dashboard"], ["layers", "Trackers"], ["clock", "Sessions"], ["chart", "Progress"], ["compare", "Compare"], ["-", "Account"], ["user", "Profile"], ["gear", "Settings"]], "Progress")}
    <div class="main"><div class="topline"><div><h2>Progress · My Fast Bowling</h2><div class="sub">Last 12 weeks · 41 sessions · 2,018 balls</div></div><div class="seg rel" style="width:250px">${m(1)}<div>Day</div><div class="on">Week</div><div>Month</div></div></div>
      <div class="grid4">${[["Sessions", "14", "▲ 3 vs last month"], ["Balls bowled", "612", "▲ 12%"], ["Yorker accuracy", "63.9%", "▲ 4.1 pts"], ["Top speed", "138.2", "km/h · PB"]].map(([l, v, d]) => `<div class="card kpi"><div class="t-s t-m">${l}</div><div class="v">${v}</div><div class="d">${d}</div></div>`).join("")}</div>
      <div class="card rel" style="padding:16px 18px">${m(2)}<div class="row between"><div><div class="h3">Yorker accuracy</div><div class="t-xs t-m">Σ accurate ÷ Σ attempted per week</div></div><div class="row" style="gap:8px"><span class="chip on">Yorker</span><span class="chip">Seam</span><span class="chip">Bouncer</span><span class="chip">No-ball rate</span></div></div>
        ${lineChart({ w: 850, h: 225, series: [{ data: [48, 50, 47.6, 53, 55, 52.4, 58, 57.1, 60, 62.5, 61.1, 66.7], color: "#5B5BF7", area: true }], labels: ["13 Jul", "20 Jul", "27 Jul", "3 Aug", "10 Aug", "17 Aug", "24 Aug", "31 Aug", "7 Sep", "14 Sep", "21 Sep", "28 Sep"], min: 30, max: 80, ticks: [30, 40, 50, 60, 70, 80], unit: "%", hi: 11, tip: tipTxt("Week of 28 Sep", "66.7%", "12 of 18") })}</div>
      <div class="grid2"><div class="card rel" style="padding:14px 16px">${m(3)}<div class="h3">Average speed</div>${lineChart({ w: 400, h: 112, series: [{ data: [128.1, 128.9, 129.3, 129, 130.2, 130.8, 131.1, 130.6, 131.5, 131.9, 131.4, 131.8], color: "#22D3EE" }], labels: ["J", "", "", "A", "", "", "", "S", "", "", "", "O"], min: 126, max: 134, ticks: [126, 130, 134], unit: "" })}</div>
        <div class="card" style="padding:14px 16px"><div class="h3">No-ball rate</div>${lineChart({ w: 400, h: 112, series: [{ data: [11, 10, 9.5, 9, 8.2, 8.8, 7.5, 7, 6.8, 6.2, 6.5, 6], color: "#EF4444" }], labels: ["J", "", "", "A", "", "", "", "S", "", "", "", "O"], min: 0, max: 15, ticks: [0, 5, 10, 15], unit: "%" })}</div></div></div>`;
  }
  S.push({ id: "progress", chapter: "Insights", who: "Member", step: "Progress charts", title: "Charts by day,<br>week or <em>month</em>",
    bullets: ["Switch <b>Day · Week · Month</b> instantly", "<b>Ratio charts</b> show value and counts", "Trends for speed, no-balls and more"],
    reqs: ["FR-ANL-01", "FR-ANL-02", "FR-ANL-06", "FR-ANL-08", "NFR-PERF-01"],
    narration: "On the web app, the progress page turns sessions into insight. Switch between day, week and month instantly. Ratio charts are calculated correctly across sessions, by adding up the accurate and attempted counts, and the tooltip shows both: sixty-six point seven percent, twelve of eighteen. Smaller charts track average speed trending up and the no-ball rate trending down.",
    html: (s) => stage(s, browser("app.trainme.app/progress/my-fast-bowling", webProgressBody(true))) });

  // 16 History
  S.push({ id: "history", chapter: "Insights", who: "Member", step: "History & search", title: "Every session,<br><em>searchable</em>",
    bullets: ["Filter by <b>date</b>, search <b>notes</b>", "Find sessions by <b>metric</b> – e.g. yorker ≥ 70%", "Select sessions to <b>compare</b>"],
    reqs: ["FR-REC-16", "NFR-PERF-09", "NFR-PERF-11"],
    narration: "The sessions page keeps the full history. Filter by date range, search your notes, for example new run-up, or find sessions by a metric, such as yorker accuracy of seventy percent or more. Results come back in milliseconds, even with thousands of users logging every day. Tick a few sessions, and compare them side by side.",
    html: (s) => stage(s, browser("app.trainme.app/sessions", `${side([["home", "Dashboard"], ["layers", "Trackers"], ["clock", "Sessions"], ["chart", "Progress"], ["compare", "Compare"], ["-", "Account"], ["user", "Profile"], ["gear", "Settings"]], "Sessions")}
      <div class="main"><div class="topline"><div><h2>Sessions</h2><div class="sub">My Fast Bowling · 41 sessions</div></div><div class="btn primary sm rel">${mk(3)}${ic("compare", 16, "#fff")}Compare 3</div></div>
        <div class="row rel" style="gap:10px">${mk(1, "l")}<span class="chip">📅 Last 90 days</span><div class="input" style="height:40px;width:250px;font-size:14px">${ic("search", 16, "#94A3B8")}new run-up</div><span class="chip on rel">${mk(2)}Yorker accuracy ≥ 70%</span><span class="chip">Tracker: My Fast Bowling</span><span class="badge ok" style="margin-left:auto">${ic("bolt", 12, "#047857")} 84 ms</span></div>
        <div class="card" style="padding:4px 8px"><table class="tbl"><thead><tr><th></th><th>Date</th><th>Type</th><th>Duration</th><th>Balls</th><th>Yorker</th><th>Seam</th><th>Avg km/h</th><th>Notes</th></tr></thead><tbody>
        ${[[1, "Fri 3 Oct", "Nets", "40 m", 50, "66.7% <span class='t-m'>12/18</span>", "76.7%", "131.8", "New run-up felt smoother"], [0, "Wed 1 Oct", "Match", "52 m", 42, "71.4% <span class='t-m'>10/14</span>", "72.0%", "130.9", "Club T20 vs Strikers"], [1, "Fri 26 Sep", "Nets", "38 m", 48, "61.1% <span class='t-m'>11/18</span>", "70.4%", "131.4", "Working on wrist position"], [0, "Tue 23 Sep", "Nets", "35 m", 36, "72.7% <span class='t-m'>8/11</span>", "68.0%", "130.2", "Short spell, felt sharp"], [1, "Fri 19 Sep", "Nets", "41 m", 50, "50.0% <span class='t-m'>8/16</span>", "66.7%", "128.4", "Old run-up"], [0, "Tue 16 Sep", "Fitness", "30 m", "–", "–", "–", "–", "Yo-Yo test L17.4"]].map(r => `<tr class="${r[0] ? "sel" : ""}"><td><span class="cb ${r[0] ? "on" : ""}">${r[0] ? "✓" : ""}</span></td><td class="t-b" style="color:var(--ink)">${r[1]}</td><td><span class="badge ${r[2] === "Match" ? "pink" : r[2] === "Fitness" ? "gray" : ""}">${r[2]}</span></td><td>${r[3]}</td><td>${r[4]}</td><td>${r[5]}</td><td>${r[6]}</td><td>${r[7]}</td><td class="t-m">${r[8]}</td></tr>`).join("")}</tbody></table></div>
        <div class="card row between" style="padding:12px 16px"><span class="t-s"><b>Session detail</b> shows ball-by-ball data and per-over breakdowns</span><div class="balldots">${"YSoBYNoSYy".split("").map(ballDot).join("")}</div></div></div>`)) });

  // 17 Compare
  S.push({ id: "compare", chapter: "Insights", who: "Member", step: "Compare sessions", title: "Compare sessions<br><em>side by side</em>",
    bullets: ["Up to <b>4 sessions</b> in one view", "<b>Grouped bars</b> for every skill metric", "<b>Speed by over</b> and clear deltas"],
    reqs: ["FR-ANL-05", "FR-ANL-09", "FR-ANL-02"],
    narration: "The compare view puts sessions side by side. Grouped bars show every skill metric for the nineteenth of September, the twenty-sixth, and the third of October. The speed-by-over chart shows the bowler is now faster and more consistent through the spell. And the delta panel spells it out: yorker accuracy up sixteen points, average speed up three point four, and two fewer no-balls since the new run-up.",
    html: (s) => stage(s, browser("app.trainme.app/compare?s=19sep,26sep,3oct", `${side([["home", "Dashboard"], ["layers", "Trackers"], ["clock", "Sessions"], ["chart", "Progress"], ["compare", "Compare"], ["-", "Account"], ["user", "Profile"], ["gear", "Settings"]], "Compare")}
      <div class="main"><div class="topline"><div><h2>Compare sessions</h2><div class="sub">My Fast Bowling · 3 sessions selected</div></div>
        <div class="row rel" style="gap:8px">${mk(1)}${[["#5B5BF7", "A · 19 Sep"], ["#22D3EE", "B · 26 Sep"], ["#F472B6", "C · 3 Oct"]].map(([c, l]) => `<span class="chip"><i style="width:10px;height:10px;border-radius:3px;background:${c};display:inline-block"></i>${l}</span>`).join("")}<span class="chip">+ Add</span></div></div>
        <div class="card rel" style="padding:14px 18px">${mk(2)}<div class="h3">Skill accuracy</div>${groupBars({ w: 880, h: 230, groups: ["Yorker", "Seam", "Bouncer", "Swing", "Target hit"], series: [[50, 66.7, 50, 40, 58], [61.1, 70.4, 57.1, 45, 62], [66.7, 76.7, 62.5, 50, 70]], colors: ["#5B5BF7", "#22D3EE", "#F472B6"] })}</div>
        <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:14px"><div class="card rel" style="padding:14px 16px">${mk(3)}<div class="h3">Speed by over (km/h)</div>${lineChart({ w: 500, h: 255, series: [{ data: [127, 128.5, 129.1, 128.8, 128.2, 127.6, 127.9, 127.1], color: "#5B5BF7", w: 2.5 }, { data: [130.2, 131.5, 131.9, 131.6, 131.0, 130.8, 131.2, 130.9], color: "#22D3EE", w: 2.5 }, { data: [131.4, 132.6, 133.0, 132.4, 131.9, 131.6, 131.8, 131.5], color: "#F472B6", w: 3 }], labels: ["1", "2", "3", "4", "5", "6", "7", "8"], min: 124, max: 136, ticks: [124, 128, 132, 136], unit: "" })}</div>
          <div class="card col" style="gap:10px;padding:16px"><div class="h3">C vs A</div>${[["Yorker accuracy", "+16.7 pts", "ok"], ["Seam accuracy", "+10.0 pts", "ok"], ["Average speed", "+3.4 km/h", "ok"], ["No-balls", "−2", "ok"], ["Wides", "+1", "warn"]].map(([k, v, t]) => `<div class="row between" style="padding:6px 0;border-bottom:1px solid #F1F3F8"><span class="t-s">${k}</span><span class="badge ${t}">${v}</span></div>`).join("")}<div class="t-xs t-m">Insight: the new run-up (from 26 Sep) lifted pace and yorker accuracy.</div></div></div></div>`)) });

  // 18 Gym example
  S.push({ id: "gym", chapter: "Insights", who: "Member", step: "Gym too", title: "Same app for<br>the <em>gym</em>",
    bullets: ["Log <b>sets</b>: reps, weight, RPE", "To failure? → <b>assisted reps</b> appears", "Auto <b>volume</b> and <b>estimated 1RM</b>"],
    reqs: ["FR-CAT-14", "FR-CAT-08", "NFR-MNT-01"],
    narration: "The same engine works for every sport and for the gym. Here is a push day: each set records reps, weight and effort. Mark a set as taken to failure, and an assisted reps field appears. TrainMe calculates training volume and an estimated one-rep max automatically, and the exercises come from a shared library organised by muscle group: chest, back, shoulders, arms, legs and core.",
    html: (s) => stage(s, phone(`<div class="scr" style="gap:12px"><div class="row between"><span>${ic("back", 22)}</span><span class="h3">Push Day</span><span class="badge">🏋️ Chest</span></div>
      <div class="card" style="padding:14px"><div class="row between"><div><div class="h2">Barbell Bench Press</div><div class="t-xs t-m">Chest · triceps · front delts</div></div><span class="badge gray">target 4 × 5–8</span></div>
        <table class="tbl rel" style="margin-top:10px">${mk(1)}<thead><tr><th>Set</th><th>kg</th><th>Reps</th><th>RPE</th><th></th></tr></thead><tbody>
        ${[[1, 60, 10, 6, 0], [2, 70, 8, 7, 0], [3, 80, 6, 8, 0], [4, 85, 4, 10, 1]].map(r => `<tr><td class="t-b">${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td><td><span class="badge ${r[4] ? "warn" : "ok"}">${r[4] ? "failure" : "✓"}</span></td></tr>`).join("")}</tbody></table>
        <div class="row between rel hl" style="margin-top:10px;padding:10px 12px;border-radius:12px;background:var(--warn-soft)">${mk(2)}<span class="t-s t-b" style="color:#92400E">↳ Assisted reps</span><div class="row" style="gap:10px"><span class="btn sm" style="width:36px">−</span><b>1</b><span class="btn sm" style="width:36px">+</span></div></div></div>
      <div class="grid2 rel">${mk(3)}<div class="card" style="padding:12px"><div class="t-xs t-m">Volume</div><div class="h2">1,800 kg</div></div><div class="card" style="padding:12px"><div class="t-xs t-m">Est. 1RM</div><div class="h2">96.3 kg</div></div></div>
      <div class="card row between" style="padding:12px 14px"><div class="row" style="gap:10px">${ic("timer", 22, "#5B5BF7")}<span class="t-s t-b">Rest</span></div><span class="h2" style="color:var(--brand)">01:30</span></div>
      <div class="card row between" style="padding:12px 14px"><span class="t-s">Next · Incline Dumbbell Press</span>${ic("chevron", 18, "#94A3B8")}</div>
      <div style="flex:1"></div><div class="btn primary">${ic("plus", 18, "#fff", 2.6)}Add set</div></div>`)) });

  // 19 Subscription
  S.push({ id: "plans", chapter: "Insights", who: "Member", step: "Plans", title: "Free to start,<br><em>Pro</em> to go further",
    bullets: ["Clear <b>plan comparison</b>", "<b>14-day free trial</b> of Pro", "Secure checkout – card never stored"],
    reqs: ["FR-SUB-01", "FR-SUB-02", "FR-SUB-03", "FR-SUB-05"],
    narration: "TrainMe is free to start. The plans page compares Free, Pro and Elite clearly. Pro unlocks unlimited trackers, custom parameters and full history, with a fourteen-day free trial. Checkout is handled by the payment provider or the app store, so card details are never stored by TrainMe.",
    html: (s) => stage(s, phone(`<div class="scr" style="gap:12px"><div class="row between"><span>${ic("back", 22)}</span><span class="h3">Choose your plan</span><span style="width:22px"></span></div>
      <div class="seg rel">${mk(1)}<div>Monthly</div><div class="on">Yearly · save 30%</div></div>
      ${[["Free", "₹0", ["2 trackers", "90-day history", "Basic charts"], 0], ["Pro", "₹199/mo", ["Unlimited trackers", "Custom parameters & metrics", "Full history · compare", "Export data"], 1], ["Elite", "₹399/mo", ["Everything in Pro", "Coach sharing (soon)", "Priority support"], 0]].map(([n, p, f, hot]) => `<div class="card ${hot ? "rel" : ""}" style="${hot ? "border:2px solid var(--brand);box-shadow:0 14px 30px -10px rgba(91,91,247,.4)" : ""}">${hot ? mk(2) : ""}<div class="row between"><span class="h2">${n}</span>${hot ? '<span class="badge">MOST POPULAR</span>' : ""}<span class="h3">${p}</span></div><div class="col" style="gap:5px;margin-top:8px">${f.map(x => `<span class="row t-s" style="gap:8px">${ic("check", 15, hot ? "#5B5BF7" : "#94A3B8", 3)}${x}</span>`).join("")}</div></div>`).join("")}
      <div class="btn primary">Start 14-day free trial</div>
      <div class="row t-xs t-m rel" style="justify-content:center;gap:6px">${mk(3, "l")}${ic("lock", 13, "#10B981")}Secure checkout · cancel anytime</div></div>`)) });

  // 20 Admin login
  S.push({ id: "admin-login", chapter: "Admin console", who: "Admin", step: "Secure access", title: "Admin access with<br><em>mandatory MFA</em>",
    bullets: ["Separate <b>admin console</b> and role", "<b>MFA code</b> required for every admin", "All admin actions are <b>audited</b>"],
    reqs: ["FR-IAM-04", "FR-IAM-06", "FR-ADM-01", "NFR-SEC-08"],
    narration: "Now the team side. The admin console is a separate app with its own role-based access. Every admin must complete multi-factor authentication, here with a six-digit code, and every admin action is written to a tamper-evident audit log.",
    html: (s) => stage(s, browser("admin.trainme.app/login", `<div style="width:100%;display:grid;place-items:center;background:radial-gradient(600px 400px at 70% 20%,rgba(244,114,182,.18),transparent 60%),#0B1220">
      <div style="width:470px;background:#0F172A;border:1px solid #1E293B;border-radius:24px;padding:36px;color:#fff;box-shadow:0 30px 60px rgba(0,0,0,.5)">
        <div class="row between">${logo(40, 24, "#fff")}<span class="badge pink rel">${mk(1)}ADMIN</span></div>
        <div style="font-size:26px;font-weight:800;margin-top:26px">Two-step verification</div><div style="color:#94A3B8;margin-top:6px;font-size:14.5px">Enter the 6-digit code from your authenticator app for <b style="color:#E2E8F0">priya@trainme.app</b></div>
        <div class="row rel" style="gap:10px;margin-top:24px">${mk(2)}${["4", "8", "1", "9", "0", ""].map((d, i) => `<div class="codebox ${i === 5 ? "f" : ""}">${d}</div>`).join("")}</div>
        <div class="btn" style="margin-top:24px;background:linear-gradient(135deg,#EC4899,#8B5CF6);color:#fff;border:0">Verify & continue</div>
        <div class="row rel" style="gap:8px;margin-top:18px;color:#94A3B8;font-size:13px">${mk(3, "l")}${ic("shield", 16, "#F472B6")}MFA required for all admin roles · sign-ins are audited</div></div></div>`, { admin: true })) });

  // 21 Admin dashboard
  S.push({ id: "admin-dash", chapter: "Admin console", who: "Admin", step: "Overview", title: "Platform health<br>in <em>one view</em>",
    bullets: ["<b>Users, sessions, conversion</b> at a glance", "<b>Live sessions</b> and activity by hour", "<b>System health</b> vs targets – latency, sync, errors"],
    reqs: ["FR-ADM-04", "NFR-OBS-04", "NFR-OBS-05", "NFR-PERF-09"],
    narration: "The overview shows the platform at a glance: over ten thousand registered users, nearly seven thousand active today, twenty-one thousand sessions, and the Pro conversion rate. A live chart shows sessions by hour, peaking after evening training. The system health panel compares key numbers with their targets: API latency, search response time, sync lag and error rate, all in the green.",
    html: (s) => stage(s, browser("admin.trainme.app/overview", `${side([["home", "Overview"], ["layers", "Catalog"], ["users", "Users"], ["heart", "Subscriptions"], ["flag", "Feature flags"], ["list", "Audit log"], ["activity", "System health"]], "Overview", { admin: true })}
      <div class="main"><div class="topline"><div><h2>Overview</h2><div class="sub">Production · updated 10 s ago</div></div><span class="badge ok">● All systems operational</span></div>
        <div class="grid4 rel">${mk(1)}${[["Registered users", "10,284", "▲ 6.2% this week"], ["Active today", "6,912", "67% of users"], ["Sessions today", "21,430", "1,284 live now"], ["Pro conversion", "8.4%", "▲ 0.6 pts"]].map(([l, v, d]) => `<div class="card kpi"><div class="t-s t-m">${l}</div><div class="v">${v}</div><div class="d">${d}</div></div>`).join("")}</div>
        <div style="display:grid;grid-template-columns:1.5fr 1fr;gap:14px"><div class="card rel" style="padding:14px 18px">${mk(2)}<div class="row between"><div class="h3">Sessions by hour</div><span class="badge pink">● 1,284 live</span></div>
          ${lineChart({ w: 560, h: 250, series: [{ data: [120, 80, 60, 90, 420, 1350, 1900, 1500, 900, 700, 650, 600, 640, 580, 620, 760, 1300, 2100, 2350, 1900, 1200, 700, 400, 220], color: "#EC4899", area: true, dots: false }], labels: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23"], min: 0, max: 2500, ticks: [0, 500, 1000, 1500, 2000, 2500], unit: "" }).replace('stop-color="#5B5BF7" stop-opacity=".28"', 'stop-color="#EC4899" stop-opacity=".25"').replace('stop-color="#5B5BF7" stop-opacity="0"', 'stop-color="#EC4899" stop-opacity="0"')}</div>
          <div class="card col rel" style="gap:12px;padding:16px">${mk(3)}<div class="h3">System health · SLOs</div>${[["API p95 latency", "142 ms", "target 200 ms", 71], ["Search p99", "0.9 s", "ceiling 5 s", 18], ["Checkpoint p95", "210 ms", "target 500 ms", 42], ["Sync lag (analytics)", "3 s", "target 60 s", 5], ["Error rate (5xx)", "0.08%", "target < 0.5%", 16]].map(([k, v, t, p]) => `<div><div class="row between"><span class="t-s">${k}</span><span class="t-s"><b>${v}</b> <span class="t-m t-xs">${t}</span></span></div><div class="pbar" style="margin-top:5px;height:6px"><i style="width:${p}%;background:#10B981"></i></div></div>`).join("")}</div></div></div>`, { admin: true })) });

  // 22 Catalog manager
  function adminCatalogBody(withMk = true) {
    const m = (n) => withMk ? mk(n) : "";
    return `${side([["home", "Overview"], ["layers", "Catalog"], ["users", "Users"], ["heart", "Subscriptions"], ["flag", "Feature flags"], ["list", "Audit log"], ["activity", "System health"]], "Catalog", { admin: true })}
    <div class="main" style="flex-direction:row;gap:14px;padding:18px">
      <div class="card rel" style="width:190px;padding:12px;flex:none">${m(1)}<div class="input" style="height:36px;font-size:13px">${ic("search", 14, "#94A3B8")}Search catalog</div>
        <div class="col t-s" style="gap:4px;margin-top:10px">${[["▾ Sports", 0], ["▾ Cricket", 1], ["▸ Batting", 2], ["▾ Bowling", 2], ["▾ Bowler", 3], ["● Fast Bowler", 4, 1], ["○ Spin Bowler", 4], ["▸ Fielding", 2], ["▸ Lawn Tennis", 1], ["▸ Football", 1], ["▾ Fitness", 0], ["▸ Gym · Chest", 1], ["▸ Gym · Back", 1], ["▸ Gym · Legs", 1]].map(([t, d, on]) => `<div style="padding:5px 8px;padding-left:${8 + d * 12}px;border-radius:8px;${on ? "background:#FCE7F3;color:#BE185D;font-weight:700" : "color:#334155"}">${t}</div>`).join("")}</div></div>
      <div class="col" style="flex:1;gap:12px;min-width:0"><div class="row between"><div><div class="h2">Fast Bowling – Delivery</div><div class="t-xs t-m">DRILL · per ball · overs of 6 · 4 templates · 3,914 trackers</div></div><span class="badge warn" style="white-space:nowrap">DRAFT v3</span></div>
        <div class="card rel" style="padding:6px 10px">${m(2)}<table class="tbl"><thead><tr><th>Key</th><th>Type</th><th>Shown when</th></tr></thead><tbody>
          ${[["speed_kmph", "DECIMAL · km/h", "always"], ["yorker_attempted", "BOOL", "always"], ["yorker_accurate", "BOOL", "<span class='badge'>yorker_attempted</span>"], ["bouncer_accurate", "BOOL", "<span class='badge'>bouncer_attempted</span>"], ["wide_reason", "ENUM · 3 options", "<span class='badge'>wide</span>"], ["no_ball", "BOOL", "always"]].map((r, i) => `<tr ${i === 4 ? 'style="background:#F0FDF4"' : ""}><td class="mono t-b" style="color:#0F172A;white-space:nowrap">${r[0]}${i === 4 ? ' <span class="badge ok">new</span>' : ""}</td><td style="white-space:nowrap">${r[1]}</td><td>${r[2] === "always" ? '<span class="t-m">always</span>' : r[2] + ' <span class="t-m t-xs">= true</span>'}</td></tr>`).join("")}</tbody></table></div>
        <div class="card" style="padding:12px 14px"><div class="row between"><span class="h3">Metric builder</span><span class="badge ok">✓ valid</span></div><div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap"><span class="chip" style="font-family:ui-monospace,Menlo">yorker_accuracy</span>=<span class="chip on">COUNT_TRUE(yorker_accurate)</span>÷<span class="chip on">COUNT_TRUE(yorker_attempted)</span><span class="badge gray">PERCENT</span></div></div></div>
      <div class="card col rel" style="width:215px;flex:none;gap:10px;padding:14px">${m(3)}<div class="h3">Publish v3</div><div class="t-xs t-m">Changes vs v2</div>
        <div class="t-s" style="color:#047857">+ wide_reason (ENUM)</div><div class="t-s" style="color:#B45309">~ speed_kmph max 165 → 170</div><div class="t-s" style="color:#B45309">~ label “Seam-up”</div>
        <div style="height:1px;background:var(--line)"></div><div class="col t-xs" style="gap:6px">${["Conditions reference valid fields", "Metrics reference valid fields", "No type changes on existing keys"].map(t => `<span class="row" style="gap:6px">${ic("check", 14, "#10B981", 3)}${t}</span>`).join("")}</div>
        <div class="t-xs t-m">Existing trackers stay on v2 until users upgrade.</div><div style="flex:1"></div><div class="btn sm" style="background:linear-gradient(135deg,#EC4899,#8B5CF6);color:#fff;border:0">Publish v3</div></div></div>`;
  }
  S.push({ id: "admin-catalog", chapter: "Admin console", who: "Admin", step: "Catalog manager", title: "Manage the catalog<br><em>without code</em>",
    bullets: ["Browse the <b>sports & gym tree</b>", "Edit <b>fields, conditions and metrics</b>", "<b>Validate & publish</b> a new version safely"],
    reqs: ["FR-CAT-04", "FR-CAT-06", "FR-CAT-09", "FR-CAT-10", "NFR-MNT-01"],
    narration: "The catalog manager is where curators add sports, drills and exercises without writing code. They browse the tree, then edit an activity's fields, conditions and metrics. Here a new field, wide reason, appears only when a ball is a wide. The metric builder defines yorker accuracy as a ratio. Before publishing version three, TrainMe validates everything and shows the changes. Existing trackers stay on version two until each user chooses to upgrade.",
    html: (s) => stage(s, browser("admin.trainme.app/catalog/cricket.fast.delivery", adminCatalogBody(true), { admin: true })) });

  // 23 Users & support
  S.push({ id: "admin-users", chapter: "Admin console", who: "Admin", step: "Users & support", title: "Support users,<br><em>respect privacy</em>",
    bullets: ["Find a user; <b>personal data masked</b>", "See <b>plan, devices and sync status</b>", "Safe actions – <b>revoke sessions</b>, resend email"],
    reqs: ["FR-ADM-02", "FR-IAM-08", "NFR-PRIV-02", "NFR-PRIV-03"],
    narration: "For support, admins can find a user and see what they need to help, while personal data stays masked. The profile shows the plan and renewal date, signed-in devices, and sync status, including the last checkpoint. Health and training data is hidden unless the user gives consent. Safe actions like revoking sessions or resending a verification email are one click away, and each is audited.",
    html: (s) => stage(s, browser("admin.trainme.app/users/usr-42", `${side([["home", "Overview"], ["layers", "Catalog"], ["users", "Users"], ["heart", "Subscriptions"], ["flag", "Feature flags"], ["list", "Audit log"], ["activity", "System health"]], "Users", { admin: true })}
      <div class="main"><div class="row" style="gap:12px"><div class="input rel" style="height:42px;flex:1">${mk(1, "l")}${ic("search", 16, "#94A3B8")}arjun</div><span class="chip">Plan: any</span><span class="chip">Status: active</span></div>
        <div style="display:grid;grid-template-columns:1.25fr 1fr;gap:14px">
          <div class="col" style="gap:14px"><div class="card row" style="gap:14px"><div class="avatar" style="width:56px;height:56px;font-size:20px">AM</div><div class="col" style="flex:1"><span class="h2">Arjun M.</span><span class="t-s t-m mono">a•••••@example.com · usr-42</span></div><span class="badge">PRO</span></div>
            <div class="card rel" style="padding:14px 16px">${mk(2)}<div class="grid2" style="gap:14px">${[["Plan", "Pro · renews 12 Nov"], ["Member since", "Jul 2026"], ["Trackers", "3 active"], ["Sessions (30 d)", "38"]].map(([k, v]) => `<div><div class="t-xs t-m">${k}</div><div class="t-s t-b" style="margin-top:2px">${v}</div></div>`).join("")}</div>
              <div style="height:1px;background:var(--line);margin:14px 0"></div><div class="h3">Devices & sync</div>
              ${[["📱 iPhone 15 · iOS 19", "Last checkpoint 2 min ago · batch #6 · OK", "ok"], ["💻 Chrome · macOS", "Last seen yesterday", "gray"]].map(([d, t, b]) => `<div class="row between" style="padding:9px 0;border-bottom:1px solid #F1F3F8"><div class="col"><span class="t-s t-b">${d}</span><span class="t-xs t-m">${t}</span></div><span class="badge ${b}">${b === "ok" ? "healthy" : "idle"}</span></div>`).join("")}</div>
            <div class="card row" style="gap:10px;padding:12px 14px;background:#F8FAFC">${ic("lock", 18, "#64748B")}<span class="t-s t-m">Training & health data hidden – user consent required to view.</span></div></div>
          <div class="col" style="gap:14px"><div class="card col rel" style="gap:10px;padding:16px">${mk(3)}<div class="h3">Actions</div><div class="btn sm">Resend verification email</div><div class="btn sm">Revoke all sessions</div><div class="btn sm">Trigger data export</div><div class="btn sm" style="color:var(--bad)">Start erasure request</div></div>
            <div class="card" style="padding:14px 16px"><div class="h3">Audit trail</div>${[["10:42", "priya@ viewed profile usr-42"], ["10:43", "priya@ resent verification"], ["Yesterday", "system: plan renewed (Pro)"]].map(([t, e]) => `<div class="row" style="gap:10px;padding:7px 0;border-bottom:1px solid #F1F3F8"><span class="t-xs t-m" style="width:64px">${t}</span><span class="t-s">${e}</span></div>`).join("")}</div></div></div></div>`, { admin: true })) });

  // 24 Feature flags & releases
  S.push({ id: "admin-flags", chapter: "Admin console", who: "Admin", step: "Releases", title: "Roll out features<br><em>gradually</em>",
    bullets: ["<b>Feature flags</b> with % rollout", "<b>Canary releases</b> with automatic rollback", "Every change in the <b>audit log</b>"],
    reqs: ["NFR-MNT-05", "NFR-REL-06", "FR-ADM-03"],
    narration: "New features are rolled out safely. Feature flags turn them on for a percentage of users, for example the new chart design for ten percent of members. Releases go out as canaries: a small share of traffic first, with automatic rollback if errors or latency rise. And every change is recorded in the audit log.",
    html: (s) => stage(s, browser("admin.trainme.app/flags", `${side([["home", "Overview"], ["layers", "Catalog"], ["users", "Users"], ["heart", "Subscriptions"], ["flag", "Feature flags"], ["list", "Audit log"], ["activity", "System health"]], "Feature flags", { admin: true })}
      <div class="main"><div class="topline"><div><h2>Feature flags & releases</h2><div class="sub">Production</div></div><div class="btn sm" style="background:linear-gradient(135deg,#EC4899,#8B5CF6);color:#fff;border:0">+ New flag</div></div>
        <div class="card rel" style="padding:6px 12px">${mk(1)}<table class="tbl"><thead><tr><th>Flag</th><th>Description</th><th>Rollout</th><th>Status</th></tr></thead><tbody>
          ${[["new-chart-ui", "Redesigned progress charts", 10, 1], ["csv-import", "Import sessions from CSV", 25, 1], ["derived-params", "Formula parameters (volume, 1RM)", 100, 1], ["coach-sharing", "Share dashboards with a coach", 0, 0]].map(([k, d, p, on]) => `<tr><td class="mono t-b" style="color:#0F172A">${k}</td><td>${d}</td><td style="width:220px"><div class="row" style="gap:10px"><div class="pbar" style="flex:1"><i style="width:${p}%;background:linear-gradient(90deg,#EC4899,#8B5CF6)"></i></div><b>${p}%</b></div></td><td><span class="toggle ${on ? "on" : ""}" style="${on ? "background:#EC4899" : ""}"></span></td></tr>`).join("")}</tbody></table></div>
        <div style="display:grid;grid-template-columns:1.3fr 1fr;gap:14px"><div class="card rel" style="padding:16px">${mk(2)}<div class="row between"><span class="h3">Release · records-svc 1.8.0</span><span class="badge warn">CANARY 50%</span></div>
          <div class="row" style="gap:6px;margin-top:14px">${[["10%", 1], ["50%", 1], ["100%", 0]].map(([l, d]) => `<div style="flex:1"><div style="height:10px;border-radius:6px;background:${d ? "#EC4899" : "#E2E8F0"}"></div><div class="t-xs t-m" style="margin-top:6px">${l}</div></div>`).join("")}</div>
          <div class="grid3" style="margin-top:14px">${[["Error rate", "0.06%", "ok"], ["p95 latency", "188 ms", "ok"], ["Analysis", "passing", "ok"]].map(([k, v, b]) => `<div><div class="t-xs t-m">${k}</div><div class="row" style="gap:6px;margin-top:3px"><b>${v}</b><span class="badge ${b}">✓</span></div></div>`).join("")}</div>
          <div class="t-xs t-m" style="margin-top:12px">Automatic rollback if error rate &gt; 1% or p95 &gt; 400 ms</div></div>
          <div class="card rel" style="padding:14px 16px">${mk(3)}<div class="h3">Audit log</div>${[["11:05", "priya@ set new-chart-ui → 10%"], ["10:58", "ci-bot promoted records-svc 1.8.0"], ["10:20", "rahul@ published Fast Bowler v3"], ["09:47", "priya@ viewed usr-42"]].map(([t, e]) => `<div class="row" style="gap:10px;padding:7px 0;border-bottom:1px solid #F1F3F8"><span class="t-xs t-m" style="width:44px">${t}</span><span class="t-s">${e}</span></div>`).join("")}</div></div></div>`, { admin: true })) });

  // 25 Outro
  S.push({ id: "outro", chapter: "Wrap-up", full: true,
    narration: "That's TrainMe: intuitive sign-up and login, live ball-by-ball logging that works offline, clear charts, searchable history and side-by-side comparisons, plus an admin console that manages the catalog, users and releases without code. Thank you for watching.",
    html: () => `<div class="stage"><div class="title">${logoSvg(120)}<div class="big" style="font-size:96px">Train<span style="background:var(--grad);-webkit-background-clip:text;color:transparent">Me</span></div><div class="tl">Train smarter. See progress. Never lose a ball.</div>
      <div class="row" style="gap:16px;margin-top:44px">${[["face", "Easy sign-in"], ["bolt", "Live logging"], ["cloudoff", "Works offline"], ["chart", "Ratio charts"], ["compare", "Compare"], ["layers", "No-code catalog"]].map(([i, l]) => `<div style="width:170px;padding:18px 10px;border-radius:20px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);display:flex;flex-direction:column;align-items:center;gap:10px;color:#E2E8F0;font-size:16px;font-weight:700">${ic(i, 30, "#22D3EE")}${l}</div>`).join("")}</div>
      <div class="meta" style="margin-top:46px">Demo · dummy brand & data</div></div></div>` });

  // indexes
  const content = S.filter(s => !s.full);
  S.forEach(s => { if (!s.full) { s.idx = content.indexOf(s) + 1; s.total = content.length; } });

  const api = { SHOTS: S };
  if (typeof module !== "undefined") module.exports = api; else window.TRAINME = api;
})();
