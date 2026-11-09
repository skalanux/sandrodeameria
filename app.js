const $ = (selector, root = document) => root.querySelector(selector);

const MODE = location.pathname.startsWith("/control")
  ? "control"
  : location.pathname.startsWith("/local")
    ? "local"
    : "display";
const IS_CONTROL = MODE === "control";
const IS_DISPLAY = MODE === "display";
const IS_LOCAL = MODE === "local";

document.documentElement.dataset.mode = MODE;

//const DEFAULT_CAL = { x: 53.2, y: 38.75, w: 12.9, h: 1.95, rot: -3.6 };
//const DEFAULT_CAL = { x: 53.2, y: 38.75, w: 12.9, h: 1.95, rot: -3.6 };

const DEFAULT_CAL = { x: 50.4, y: 37.95, w: 7.5, h: 1.95, rot: -4.1 };
const CAL_KEY = "avatar-mouth-calibration-v2";
const VISUAL_KEY = "avatar-visual-mode";
const FACE_VIDEO = "assets/face.mp4";
const FACE_CANDIDATES = ["assets/face.jpg", "assets/face.png", "assets/face.webp"];

const els = {
  face: $("#face"),
  faceVideo: $("#faceVideo"),
  avatarWrap: $("#avatarWrap"),
  mouth: $("#mouth"),
  visualBtn: $("#visualBtn"),
  visualLabel: $("#visualLabel"),
  phraseGrid: $("#phraseGrid"),
  phraseCount: $("#phraseCount"),
  sayForm: $("#sayForm"),
  sayInput: $("#sayInput"),
  sayBtn: $("#sayBtn"),
  micBtn: $("#micBtn"),
  micLabel: $("#micLabel"),
  micHint: $("#micHint"),
  stopBtn: $("#stopBtn"),
  pendingBar: $("#pendingBar"),
  pendingText: $("#pendingText"),
  pendingCancel: $("#pendingCancel"),
  status: $("#status"),
  caption: $("#caption"),
  providerBadge: $("#providerBadge"),
  presenceNote: $("#presenceNote"),
  subtitle: $("#subtitle"),
  fullscreenBtn: $("#fullscreenBtn"),
  calibrateBtn: $("#calibrateBtn"),
  calPanel: $("#calPanel"),
  calX: $("#calX"),
  calY: $("#calY"),
  calW: $("#calW"),
  calH: $("#calH"),
  calRot: $("#calRot"),
  calSave: $("#calSave"),
  calReset: $("#calReset"),
  calClose: $("#calClose"),
  activateOverlay: $("#activateOverlay"),
  activateBtn: $("#activateBtn"),
};

const state = {
  phrases: [],
  cal: loadCal(),
  audioCtx: null,
  analyser: null,
  data: null,
  source: null,
  audioEl: null,
  objectUrl: null,
  raf: 0,
  open: 0,
  speaking: false,
  playingBtn: null,
  reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  ttsToken: 0,
  ttsAbort: null,
  faceMode: "face",
  hasVideo: false,
  displays: 0,
  controls: 0,
  audioArmed: false,
  remoteStatusSeen: false,
  sse: null,
  displayId: null,
  isPrimary: true,
  micState: "idle",
  micTimer: null,
  micToken: 0,
  speechRecognition: null,
  pendingTimer: null,
  pendingTextValue: "",
};

/* ---------- Calibración ---------- */

function loadCal() {
  try {
    const raw = localStorage.getItem(CAL_KEY);
    if (!raw) return { ...DEFAULT_CAL };
    const parsed = JSON.parse(raw);
    const out = { ...DEFAULT_CAL };
    for (const key of ["x", "y", "w", "h", "rot"]) {
      const value = Number(parsed[key]);
      if (Number.isFinite(value)) out[key] = value;
    }
    return out;
  } catch {
    return { ...DEFAULT_CAL };
  }
}

function saveCal() {
  try {
    localStorage.setItem(CAL_KEY, JSON.stringify(state.cal));
  } catch {
    /* localStorage puede estar bloqueado; la calibración sigue en memoria. */
  }
}

function applyCalibration({ persist = true } = {}) {
  const { x, y, w, h, rot } = state.cal;
  els.mouth.style.setProperty("--mx", x);
  els.mouth.style.setProperty("--my", y);
  els.mouth.style.setProperty("--mw", w);
  els.mouth.style.setProperty("--mh", h);
  els.mouth.style.setProperty("--rot", rot);
  syncCalInputs();
  if (persist) saveCal();
}

function syncCalInputs() {
  els.calX.value = state.cal.x;
  els.calY.value = state.cal.y;
  els.calW.value = state.cal.w;
  els.calH.value = state.cal.h;
  els.calRot.value = state.cal.rot;
}

function setCalibrating(on) {
  if (on) {
    stopPlayback();
    els.avatarWrap.style.setProperty("--bob", "0px");
    els.avatarWrap.style.setProperty("--sway", "0deg");
  }
  document.body.classList.toggle("calibrating", on);
  els.calPanel.classList.toggle("hidden", !on);
  if (on) {
    syncCalInputs();
    setStatus("Calibrá la boca: arrastrá para mover y usá la rueda para el tamaño.");
  } else {
    setStatus("Calibración guardada.");
  }
}

function bindCalibration() {
  const ranges = [
    ["x", els.calX],
    ["y", els.calY],
    ["w", els.calW],
    ["h", els.calH],
    ["rot", els.calRot],
  ];

  for (const [key, input] of ranges) {
    input.addEventListener("input", () => {
      state.cal[key] = Number(input.value);
      applyCalibration();
    });
  }

  let drag = null;

  els.mouth.addEventListener("pointerdown", (event) => {
    if (!document.body.classList.contains("calibrating")) return;
    event.preventDefault();
    els.mouth.setPointerCapture(event.pointerId);
    const rect = els.avatarWrap.getBoundingClientRect();
    drag = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      calX: state.cal.x,
      calY: state.cal.y,
      rect,
    };
  });

  els.mouth.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = ((event.clientX - drag.startX) / drag.rect.width) * 100;
    const dy = ((event.clientY - drag.startY) / drag.rect.height) * 100;
    state.cal.x = clamp(drag.calX + dx, 0, 100);
    state.cal.y = clamp(drag.calY + dy, 0, 100);
    applyCalibration();
  });

  const endDrag = (event) => {
    if (drag && event.pointerId === drag.id) drag = null;
  };
  els.mouth.addEventListener("pointerup", endDrag);
  els.mouth.addEventListener("pointercancel", endDrag);

  els.mouth.addEventListener(
    "wheel",
    (event) => {
      if (!document.body.classList.contains("calibrating")) return;
      event.preventDefault();
      const delta = -Math.sign(event.deltaY) * 0.6;
      state.cal.w = clamp(state.cal.w + delta, 2, 40);
      state.cal.h = clamp(state.cal.h + delta * 0.5, 1, 30);
      applyCalibration();
    },
    { passive: false }
  );

  els.calibrateBtn.addEventListener("click", () => {
    setCalibrating(!document.body.classList.contains("calibrating"));
  });
  els.calClose.addEventListener("click", () => setCalibrating(false));
  els.calSave.addEventListener("click", () => setCalibrating(false));
  els.calReset.addEventListener("click", () => {
    state.cal = { ...DEFAULT_CAL };
    applyCalibration();
    setStatus("Calibración restablecida. Ajustá de nuevo si hace falta.");
  });
}

/* ---------- Audio y boca ---------- */

function ensureAudio() {
  if (!window.AudioContext && !window.webkitAudioContext) {
    throw new Error("Este navegador no soporta Web Audio.");
  }
  if (!state.audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    state.audioCtx = new Ctx();
    state.analyser = state.audioCtx.createAnalyser();
    state.analyser.fftSize = 1024;
    state.analyser.smoothingTimeConstant = 0.5;
    state.data = new Uint8Array(state.analyser.fftSize);
    state.analyser.connect(state.audioCtx.destination);
  }
  if (state.audioCtx.state === "suspended") {
    state.audioCtx.resume().catch(() => {});
  }
}

function setMouthOpen(value) {
  state.open = clamp(value, 0, 1);
  els.mouth.style.setProperty("--open", state.open.toFixed(3));
}

function idleCaption() {
  if (!IS_DISPLAY) return "Listo para hablar";
  if (!state.isPrimary) return "Pantalla secundaria: no reproduce";
  if (!state.audioArmed) return "Tocá para activar el audio";
  if (state.controls === 0) return "Esperando control...";
  return "Listo para hablar";
}

function stopPlayback() {
  stopFaceVideo();
  cancelAnimationFrame(state.raf);
  state.raf = 0;

  if (state.audioEl) {
    try {
      state.audioEl.pause();
    } catch {
      /* el elemento ya puede estar detenido */
    }
    state.audioEl.removeAttribute("src");
    state.audioEl.load();
    state.audioEl = null;
  }

  if (state.source) {
    try {
      state.source.disconnect();
    } catch {
      /* ya estaba desconectado */
    }
    state.source = null;
  }

  if (state.objectUrl) {
    URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = null;
  }

  if (state.playingBtn) {
    state.playingBtn.classList.remove("playing");
    state.playingBtn = null;
  }

  state.speaking = false;
  setMouthOpen(0);
  els.avatarWrap.classList.remove("speaking");
  els.avatarWrap.style.setProperty("--bob", "0px");
  els.avatarWrap.style.setProperty("--sway", "0deg");
  document.body.classList.remove("speaking");
  els.caption.textContent = idleCaption();
}

function startMouthLoop() {
  cancelAnimationFrame(state.raf);
  const started = performance.now();

  const frame = (now) => {
    if (!state.speaking || !state.analyser) return;

    state.analyser.getByteTimeDomainData(state.data);
    let sum = 0;
    for (let i = 0; i < state.data.length; i += 1) {
      const sample = (state.data[i] - 128) / 128;
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / state.data.length);
    const target = clamp((rms - 0.025) / 0.19, 0, 1);
    const smoothing = target > state.open ? 0.55 : 0.2;
    setMouthOpen(state.open + (target - state.open) * smoothing);

    if (!state.reducedMotion) {
      const t = (now - started) / 1000;
      const bob = Math.sin(t * Math.PI * 3.2) * 1.2 + state.open * 1.4;
      const sway = Math.sin(t * Math.PI * 1.6) * 0.22;
      els.avatarWrap.style.setProperty("--bob", `${bob.toFixed(2)}px`);
      els.avatarWrap.style.setProperty("--sway", `${sway.toFixed(3)}deg`);
    }

    state.raf = requestAnimationFrame(frame);
  };

  state.raf = requestAnimationFrame(frame);
}

function updateVisualButton() {
  if (!els.visualBtn) return;

  const video = state.faceMode === "video";
  els.visualLabel.textContent = video ? "Video" : "Cara";
  els.visualBtn.dataset.mode = video ? "video" : "face";
  els.visualBtn.setAttribute("aria-pressed", video ? "true" : "false");
  els.visualBtn.disabled =
    !state.hasVideo || (IS_CONTROL && state.displays === 0);
  els.visualBtn.title = !state.hasVideo
    ? "No hay video disponible"
    : video
      ? "Cambiar a cara"
      : "Cambiar a video";
}

function playFaceVideo() {
  if (
    state.faceMode !== "video" ||
    !state.hasVideo ||
    !els.faceVideo
  ) {
    return;
  }

  try {
    els.faceVideo.currentTime = 0;
    const promise = els.faceVideo.play();
    promise?.catch(() => {});
  } catch {
    /* si el navegador lo bloquea, el audio sigue igual */
  }
}

function stopFaceVideo() {
  if (!els.faceVideo) return;

  els.faceVideo.pause();
  try {
    els.faceVideo.currentTime = 0;
  } catch {
    /* el video todavía no cargó */
  }
}

function setFaceMode(mode, { persist = true, announce = true } = {}) {
  if (mode === "video" && !state.hasVideo) mode = "face";
  state.faceMode = mode;

  const video = mode === "video";
  els.face?.classList.toggle("hidden", video);
  els.faceVideo?.classList.toggle("hidden", !video);
  document.body.classList.toggle("video-mode", video);

  if (persist) {
    try {
      localStorage.setItem(VISUAL_KEY, mode);
    } catch {
      /* localStorage puede estar bloqueado */
    }
  }

  updateVisualButton();

  if (video) {
    if (document.body.classList.contains("calibrating")) setCalibrating(false);
    if (state.speaking) playFaceVideo();
  } else {
    stopFaceVideo();
  }

  if (IS_DISPLAY && state.isPrimary && announce) {
    notifyStatus(
      state.speaking ? "speaking" : "idle",
      state.speaking ? "" : idleCaption()
    );
  }
}

async function playUrl(url, { label = "", button = null, objectUrl = null } = {}) {
  stopPlayback();
  ensureAudio();

  const audio = new Audio();
  audio.preload = "auto";
  audio.src = url;
  state.audioEl = audio;
  state.objectUrl = objectUrl;
  state.speaking = true;
  state.playingBtn = button;

  if (button) button.classList.add("playing");
  els.avatarWrap.classList.add("speaking");
  document.body.classList.add("speaking");
  els.caption.textContent = label ? `Hablando: ${shortLabel(label)}` : "Hablando...";

  const source = state.audioCtx.createMediaElementSource(audio);
  source.connect(state.analyser);
  state.source = source;

  audio.addEventListener(
    "ended",
    () => {
      stopPlayback();
      setStatus("Listo. Elegí otra frase o probá el modo libre.");
      notifyStatus("idle", "Listo");
    },
    { once: true }
  );

  audio.addEventListener(
    "error",
    () => {
      stopPlayback();
      const message = "No se pudo reproducir el audio. Revisá que el archivo exista.";
      setStatus(message, true);
      notifyStatus("idle", message, true);
    },
    { once: true }
  );

  try {
    await audio.play();
  } catch {
    stopPlayback();
    const message = "El navegador bloqueó la reproducción. Tocá de nuevo la frase.";
    notifyStatus("idle", message, true);
    throw new Error(message);
  }

  notifyStatus("speaking", label);
  playFaceVideo();
  startMouthLoop();
}

/* ---------- Frases ---------- */

async function fetchPhrases() {
  const response = await fetch("phrases.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`No se pudo cargar phrases.json (${response.status}).`);
  const phrases = await response.json();
  if (!Array.isArray(phrases)) throw new Error("phrases.json no es una lista.");

  state.phrases = phrases;
  els.phraseCount.textContent = String(phrases.length);
}

function renderPhrases(onSelect) {
  els.phraseGrid.innerHTML = "";

  state.phrases.forEach((phrase, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "phrase-btn";
    button.title = phrase.text;
    button.dataset.id = phrase.id;

    const number = document.createElement("span");
    number.className = "phrase-num";
    number.textContent = String(index + 1).padStart(2, "0");

    const label = document.createElement("span");
    label.className = "phrase-label";
    label.textContent = phrase.label;

    button.append(number, label);
    button.addEventListener("click", () => onSelect(phrase, button));
    els.phraseGrid.appendChild(button);
  });
}

function setControlsEnabled(enabled) {
  if (!IS_CONTROL) return;
  for (const button of els.phraseGrid.querySelectorAll("button")) {
    button.disabled = !enabled;
  }
  els.sayInput.disabled = !enabled;
  els.sayBtn.disabled = !enabled;
  els.stopBtn.disabled = !enabled;
  updateMicAvailability();
  updateVisualButton();
}

async function playPhrase(phrase, button) {
  state.ttsToken += 1;
  state.ttsAbort?.abort();
  state.ttsAbort = null;
  setStatus(`Cargando “${phrase.label}”...`);
  notifyStatus("generating", phrase.label);

  try {
    await playUrl(`assets/audio/${phrase.id}.mp3`, {
      label: phrase.label,
      button,
    });
    setStatus(`Sonando: ${phrase.label}`);
  } catch (error) {
    setStatus(error.message || "No se pudo reproducir la frase.", true);
  }
}

function bindSayForm() {
  if (!IS_CONTROL && !IS_LOCAL) return;

  els.sayForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (els.sayInput.disabled) return;

    const text = els.sayInput.value.trim();
    if (!text) {
      els.sayInput.focus();
      return;
    }

    if (IS_CONTROL) {
      cancelPending();
      abortListening();
    }

    els.sayInput.value = "";
    els.sayInput.focus();

    if (IS_CONTROL) {
      sendCommand({ type: "text", text }).catch(() => {});
    } else {
      playText(text);
    }
  });
}

async function playText(text) {
  state.ttsToken += 1;
  const token = state.ttsToken;
  state.ttsAbort?.abort();
  const controller = new AbortController();
  state.ttsAbort = controller;

  stopPlayback();
  setStatus("Generando voz...");
  notifyStatus("generating", text);
  if (IS_DISPLAY) els.caption.textContent = "Generando voz...";

  try {
    const response = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Error ${response.status} al generar la voz.`);
    }

    const blob = await response.blob();
    if (token !== state.ttsToken) return;
    const url = URL.createObjectURL(blob);
    await playUrl(url, {
      label: text,
      objectUrl: url,
    });
    if (token === state.ttsToken) setStatus("Sonando el modo libre.");
  } catch (error) {
    if (error.name === "AbortError") return;
    const message =
      error instanceof TypeError && /fetch/i.test(error.message)
        ? "No se pudo conectar con el servidor. Revisá que esté corriendo."
        : error.message;
    setStatus(message || "No se pudo generar la voz.", true);
    notifyStatus("idle", message || "No se pudo generar la voz.", true);
  } finally {
    if (state.ttsAbort === controller) state.ttsAbort = null;
  }
}

/* ---------- Control remoto ---------- */

async function sendCommand(payload) {
  setStatus(
    payload.type === "text"
      ? "Enviando texto..."
      : payload.type === "phrase"
        ? "Enviando frase..."
        : "Enviando comando..."
  );

  try {
    const response = await fetch("/api/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || `Error ${response.status} al enviar el comando.`);
    }

    if (!data.delivered) {
      setStatus("No hay pantalla conectada. Abrí la pantalla en la compu del servidor.", true);
    }

    return data;
  } catch (error) {
    setStatus(error.message || "No se pudo enviar el comando.", true);
    throw error;
  }
}

function connectEvents(role) {
  const source = new EventSource(`/api/events?role=${role}`);
  state.sse = source;

  source.addEventListener("hello", (event) => {
    const data = JSON.parse(event.data);
    if (role === "display") {
      if (typeof data.clientId === "number") state.displayId = data.clientId;
      if (typeof data.primary === "boolean") state.isPrimary = data.primary;
    }
    updatePresence(data);
    if (role === "control" && data.status && data.displays > 0) {
      applyRemoteStatus(data.status);
    }
    if (role === "display" && state.isPrimary) {
      if (state.speaking) {
        const label = els.caption.textContent.replace(/^Hablando:\s*/, "");
        notifyStatus("speaking", label === "Hablando..." ? "" : label);
      } else {
        notifyStatus(
          "idle",
          state.audioArmed ? "Listo" : "Tocá la pantalla para activar el audio"
        );
      }
    }
  });

  source.addEventListener("presence", (event) => {
    updatePresence(JSON.parse(event.data));
  });

  if (role === "control") {
    source.addEventListener("status", (event) => {
      applyRemoteStatus(JSON.parse(event.data));
    });
  } else {
    source.addEventListener("command", (event) => {
      handleRemoteCommand(JSON.parse(event.data));
    });
  }

  source.onerror = () => {
    if (role === "control") {
      setStatus("Reconectando con la pantalla...", true);
    } else if (!state.speaking) {
      els.caption.textContent = "Reconectando...";
    }
  };
}

function updatePresence(data) {
  state.displays = Number(data.displays) || 0;
  state.controls = Number(data.controls) || 0;

  const wasPrimary = state.isPrimary;

  if (IS_DISPLAY && state.displayId !== null) {
    const primaryId = data.primaryDisplayId;
    if (typeof primaryId === "number") {
      state.isPrimary = primaryId === state.displayId;
    } else if (primaryId === null) {
      state.isPrimary = false;
    }
  }

  if (IS_CONTROL) {
    if (els.presenceNote) {
      if (state.displays > 1) {
        els.presenceNote.textContent = `Hay ${state.displays} pantallas conectadas. Solo la principal reproduce; cerrá las demás.`;
        els.presenceNote.classList.remove("hidden");
      } else {
        els.presenceNote.classList.add("hidden");
      }
    }

    setControlsEnabled(state.displays > 0);
    if (state.displays === 0) {
      state.remoteStatusSeen = false;
      setStatus("No hay pantalla conectada. Abrí la pantalla en la compu del servidor.", true);
    } else if (!state.remoteStatusSeen) {
      setStatus("Pantalla conectada. Elegí una frase o escribí abajo.");
    }
  }

  if (IS_DISPLAY) {
    if (!state.isPrimary) {
      els.activateOverlay.classList.add("hidden");
      document.body.classList.remove("needs-activation");
    } else if (!state.audioArmed) {
      els.activateOverlay.classList.remove("hidden");
      document.body.classList.add("needs-activation");
    }

    if (!wasPrimary && state.isPrimary) {
      notifyStatus(
        "idle",
        state.audioArmed ? "Listo" : "Tocá la pantalla para activar el audio"
      );
    }

    if (!state.speaking) {
      els.caption.textContent = idleCaption();
    }
  }
}

function applyRemoteStatus(data) {
  if (!IS_CONTROL) return;
  state.remoteStatusSeen = true;

  if (data.visual === "face" || data.visual === "video") {
    state.faceMode = data.visual;
    updateVisualButton();
  }

  if (data.state === "speaking") {
    setStatus(data.label ? `Hablando: ${shortLabel(data.label)}` : "Hablando...");
  } else if (data.state === "generating") {
    const label = shortLabel(data.label);
    const suffix = /[.!?…]$/.test(label) ? "" : "...";
    setStatus(label ? `Generando: ${label}${suffix}` : "Generando voz...");
  } else {
    setStatus(data.label || "Listo.", Boolean(data.error));
  }
}

function notifyStatus(status, label = "", error = false) {
  if (!IS_DISPLAY) return;

  fetch("/api/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      state: status,
      label: shortLabel(label),
      error,
      visual: state.faceMode,
    }),
    keepalive: true,
  }).catch(() => {});
}

function handleRemoteCommand(command) {
  if (!IS_DISPLAY) return;

  if (command.type === "phrase") {
    const phrase = state.phrases.find((item) => item.id === command.id);
    if (!phrase) {
      notifyStatus("idle", "La frase no existe.", true);
      return;
    }
    playPhrase(phrase, null);
    return;
  }

  if (command.type === "text") {
    playText(command.text);
    return;
  }

  if (command.type === "visual") {
    setFaceMode(command.mode);
    return;
  }

  if (command.type === "stop") {
    state.ttsToken += 1;
    state.ttsAbort?.abort();
    state.ttsAbort = null;
    stopPlayback();
    setStatus("Detenido.");
    notifyStatus("idle", "Detenido");
  }
}

/* ---------- Micrófono ---------- */

function getSpeechRecognition() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function updateMicAvailability() {
  if (!IS_CONTROL) return;

  const secure = window.isSecureContext;
  const Recognition = getSpeechRecognition();
  const listening =
    state.micState === "recording" || state.micState === "starting";
  const busy = state.micState === "processing";
  const available =
    secure &&
    Boolean(Recognition) &&
    (state.displays > 0 || listening) &&
    !busy;

  els.micBtn.disabled = !available;
  els.stopBtn.disabled = state.displays === 0;

  if (busy || listening) return;

  if (!secure) {
    els.micHint.textContent =
      "Micrófono: abrí el control por HTTPS (o localhost). También podés escribir el texto.";
  } else if (!Recognition) {
    els.micHint.textContent =
      "Este navegador no soporta dictado por voz; escribí el texto abajo.";
  } else if (state.displays === 0) {
    els.micHint.textContent = "Micrófono: no hay pantalla conectada.";
  } else {
    els.micHint.textContent =
      "Tocá Hablar y dictá; podés cancelar antes de enviar.";
  }
}

function setMicState(next) {
  state.micState = next;
  els.micBtn.dataset.state = next;
  els.micBtn.setAttribute("aria-pressed", next === "recording" ? "true" : "false");

  if (next === "starting") {
    els.micLabel.textContent = "Pidiendo permiso…";
    els.micHint.textContent = "Aceptá el permiso del micrófono en el celular.";
    els.micBtn.disabled = true;
  } else if (next === "recording") {
    els.micLabel.textContent = "Terminar";
    els.micHint.textContent = "Escuchando… tocá Terminar cuando termines.";
    els.micBtn.disabled = false;
  } else if (next === "processing") {
    els.micLabel.textContent = "Procesando…";
    els.micHint.textContent = "Convirtiendo el dictado en texto…";
    els.micBtn.disabled = true;
  } else {
    els.micLabel.textContent = "Hablar";
    updateMicAvailability();
  }
}

function startListening() {
  if (state.micState !== "idle") return;

  if (!window.isSecureContext) {
    setStatus(
      "El micrófono necesita HTTPS (o localhost). Podés escribir el texto abajo.",
      true
    );
    return;
  }

  const Recognition = getSpeechRecognition();
  if (!Recognition) {
    setStatus("Este navegador no soporta dictado por voz. Usá el teclado.", true);
    return;
  }

  cancelPending();
  state.micToken += 1;
  const token = state.micToken;
  let finalText = "";
  let lastPreview = "";
  let failed = false;

  const recognition = new Recognition();
  state.speechRecognition = recognition;
  recognition.lang = "es-AR";
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    if (token !== state.micToken) return;
    setMicState("recording");
    state.micTimer = setTimeout(() => {
      if (state.micState === "recording") stopListening();
    }, 30_000);
  };

  recognition.onresult = (event) => {
    if (token !== state.micToken) return;

    const finalParts = [];
    const interimParts = [];
    for (let index = 0; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcript = String(result[0]?.transcript || "")
        .replace(/\s+/g, " ")
        .trim();
      if (!transcript) continue;
      if (result.isFinal) finalParts.push(transcript);
      else interimParts.push(transcript);
    }

    finalText = finalParts.join(" ");
    lastPreview = `${finalText} ${interimParts.join(" ")}`.trim();
    if (lastPreview) {
      els.micHint.textContent = `Escuchando: ${shortLabel(lastPreview)}`;
    }
  };

  recognition.onerror = (event) => {
    if (token !== state.micToken) return;
    if (event.error === "aborted") return;
    failed = true;
    if (state.micTimer) {
      clearTimeout(state.micTimer);
      state.micTimer = null;
    }
    state.speechRecognition = null;
    setMicState("idle");

    const message =
      event.error === "not-allowed" || event.error === "service-not-allowed"
        ? "Permiso de micrófono denegado. Habilitalo en el navegador o usá el teclado."
        : event.error === "audio-capture"
          ? "No encontré un micrófono en el dispositivo."
          : event.error === "network"
            ? "El dictado por voz no pudo conectarse. Revisá la conexión o usá el teclado."
            : event.error === "no-speech"
              ? "No se escuchó nada. Probá de nuevo o escribí el texto."
              : `No se pudo dictar (${event.error}). Usá el teclado.`;
    setStatus(message, true);
  };

  recognition.onend = () => {
    if (token !== state.micToken || failed) return;
    state.speechRecognition = null;
    if (state.micTimer) {
      clearTimeout(state.micTimer);
      state.micTimer = null;
    }

    const text = finalText.replace(/\s+/g, " ").trim();
    if (!text) {
      setMicState("idle");
      if (lastPreview) {
        setStatus("No se entendió el dictado. Probá de nuevo o escribí el texto.", true);
      }
      return;
    }

    if (text.length > 280) {
      els.sayInput.value = text.slice(0, 280);
      els.sayInput.focus();
      setMicState("idle");
      setStatus("El dictado superó los 280 caracteres; editalo y apretá Enter.", true);
      return;
    }

    setMicState("idle");
    queuePendingSend(text);
  };

  setMicState("starting");
  try {
    recognition.start();
  } catch (error) {
    abortListening();
    setStatus(error.message || "No se pudo iniciar el dictado. Usá el teclado.", true);
  }
}

function stopListening() {
  if (state.micState !== "recording" && state.micState !== "starting") return;

  if (state.micTimer) {
    clearTimeout(state.micTimer);
    state.micTimer = null;
  }

  const recognition = state.speechRecognition;
  if (!recognition) {
    setMicState("idle");
    return;
  }

  if (state.micState === "starting") {
    abortListening();
    return;
  }

  setMicState("processing");
  state.micTimer = setTimeout(() => {
    if (state.micState === "processing") {
      abortListening();
      setStatus("No se pudo procesar el dictado. Probá de nuevo o escribí el texto.", true);
    }
  }, 5_000);

  try {
    recognition.stop();
  } catch {
    abortListening();
  }
}

function abortListening() {
  state.micToken += 1;
  if (state.micTimer) {
    clearTimeout(state.micTimer);
    state.micTimer = null;
  }

  const recognition = state.speechRecognition;
  state.speechRecognition = null;
  if (recognition) {
    recognition.onstart = null;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    try {
      recognition.abort();
    } catch {
      /* ya estaba detenido */
    }
  }

  setMicState("idle");
}

function queuePendingSend(text) {
  cancelPending();
  state.pendingTextValue = text;
  els.pendingText.textContent = text;
  els.pendingBar.classList.remove("hidden");
  setStatus("Dictado listo. Se envía en 1,5 s; tocá Cancelar para descartarlo.");

  state.pendingTimer = setTimeout(() => {
    const pending = state.pendingTextValue;
    cancelPending();
    sendCommand({ type: "text", text: pending }).catch(() => {});
  }, 1500);
}

function cancelPending() {
  if (state.pendingTimer) clearTimeout(state.pendingTimer);
  state.pendingTimer = null;
  state.pendingTextValue = "";
  if (els.pendingBar) els.pendingBar.classList.add("hidden");
}

function bindMic() {
  if (!IS_CONTROL) return;

  els.micBtn.addEventListener("click", () => {
    if (state.micState === "recording" || state.micState === "starting") {
      stopListening();
    } else if (state.micState === "idle") {
      startListening();
    }
  });

  els.pendingCancel.addEventListener("click", () => {
    cancelPending();
    setStatus("Dictado cancelado.");
  });

  els.stopBtn.addEventListener("click", () => {
    cancelPending();
    abortListening();
    sendCommand({ type: "stop" }).catch(() => {});
  });

  window.addEventListener("beforeunload", () => {
    cancelPending();
    abortListening();
  });

  updateMicAvailability();
}

function bindVisual() {
  if (!els.visualBtn) return;

  els.visualBtn.addEventListener("click", () => {
    if (els.visualBtn.disabled) return;

    const previous = state.faceMode;
    const next = previous === "video" ? "face" : "video";

    if (IS_CONTROL) {
      state.faceMode = next;
      updateVisualButton();
      sendCommand({ type: "visual", mode: next }).catch(() => {
        state.faceMode = previous;
        updateVisualButton();
      });
    } else {
      setFaceMode(next);
    }
  });

  updateVisualButton();
}

/* ---------- Pantalla ---------- */

function setupDisplayActivation() {
  els.activateOverlay.classList.remove("hidden");
  document.body.classList.add("needs-activation");
  els.caption.textContent = "Tocá para activar el audio";
  notifyStatus("idle", "Tocá la pantalla para activar el audio");

  const arm = () => {
    if (state.audioArmed) return;
    try {
      ensureAudio();
      const buffer = state.audioCtx.createBuffer(1, 1, 22050);
      const source = state.audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(state.audioCtx.destination);
      source.start(0);
    } catch {
      /* el error se muestra al intentar reproducir */
    }
    state.audioArmed = true;
    els.activateOverlay.classList.add("hidden");
    document.body.classList.remove("needs-activation");
    els.caption.textContent = state.controls > 0 ? "Listo para hablar" : "Esperando control...";
    setStatus("Pantalla activada. Esperando al control remoto.");
    notifyStatus("idle", "Listo");
  };

  els.activateBtn.addEventListener("click", arm);
  els.activateOverlay.addEventListener("click", (event) => {
    if (event.target === els.activateOverlay) arm();
  });
  document.addEventListener(
    "pointerdown",
    () => {
      if (!state.audioArmed) arm();
    },
    { once: true }
  );
}

/* ---------- Entorno ---------- */

async function assetExists(src) {
  try {
    const response = await fetch(src, { method: "HEAD", cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

async function detectVideo() {
  state.hasVideo = await assetExists(FACE_VIDEO);
  updateVisualButton();
}

async function loadFace() {
  state.hasVideo = await assetExists(FACE_VIDEO);

  if (state.hasVideo) {
    els.faceVideo.src = FACE_VIDEO;
    els.faceVideo.load();
    els.faceVideo.addEventListener(
      "error",
      () => {
        state.hasVideo = false;
        setFaceMode("face", { persist: false, announce: true });
      },
      { once: true }
    );
  }

  for (const src of FACE_CANDIDATES) {
    if (await assetExists(src)) {
      els.face.src = src;
      break;
    }
  }

  let stored = null;
  try {
    stored = localStorage.getItem(VISUAL_KEY);
  } catch {
    /* localStorage puede estar bloqueado */
  }

  setFaceMode(stored === "video" && state.hasVideo ? "video" : "face", {
    persist: false,
    announce: false,
  });
}

async function loadProvider() {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    if (data.configured === false) {
      const name = data.provider === "fish" ? "Fish Audio" : data.provider;
      els.providerBadge.textContent = `${name} sin configurar`;
      els.providerBadge.classList.add("warn");
      return;
    }
    if (data.cloned) {
      els.providerBadge.textContent = "Voz clonada";
      els.providerBadge.classList.add("ok");
    } else {
      els.providerBadge.textContent = "Voz de prueba · no clonada";
    }
  } catch {
    /* el badge queda en el estado por defecto */
  }
}

function setStatus(text, isError = false) {
  els.status.textContent = text;
  els.status.classList.toggle("error", Boolean(isError));
  els.status.classList.toggle("busy", /Generando|Cargando|Enviando/.test(text));
}

function shortLabel(text) {
  return text.length > 34 ? `${text.slice(0, 34)}…` : text;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/* ---------- Inicio ---------- */

function bindChrome() {
  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      setStatus("El navegador no permitió pantalla completa.", true);
    }
  };

  els.fullscreenBtn?.addEventListener("click", toggleFullscreen);

  window.addEventListener("keydown", (event) => {
    const target = event.target;
    const typing =
      target instanceof HTMLElement &&
      (target.tagName === "INPUT" || target.tagName === "TEXTAREA");

    if (event.key === "Escape" && document.body.classList.contains("calibrating")) {
      setCalibrating(false);
    }

    if (
      !typing &&
      !IS_CONTROL &&
      event.key.toLowerCase() === "f" &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      toggleFullscreen();
    }
  });
}

async function init() {
  document.documentElement.dataset.mode = MODE;
  bindChrome();

  if (IS_CONTROL) {
    if (els.subtitle) {
      els.subtitle.textContent = "Control remoto · el avatar suena en la compu";
    }
    setStatus("Conectando con la pantalla...");
    bindSayForm();
    bindMic();
    bindVisual();
    detectVideo();
    loadProvider();

    try {
      await fetchPhrases();
      renderPhrases((phrase) => {
        cancelPending();
        abortListening();
        sendCommand({ type: "phrase", id: phrase.id });
      });
      setControlsEnabled(false);
    } catch (error) {
      setControlsEnabled(false);
      setStatus(error.message, true);
    }

    connectEvents("control");
    return;
  }

  applyCalibration({ persist: false });
  if (IS_LOCAL) bindCalibration();
  await loadFace();
  if (IS_LOCAL) bindVisual();
  loadProvider();

  try {
    await fetchPhrases();
    if (IS_LOCAL) {
      renderPhrases((phrase, button) => playPhrase(phrase, button));
      bindSayForm();
      setStatus("Tocá una frase para empezar.");
    }
  } catch (error) {
    setStatus(`Error: ${error.message}. Abrí la página con “npm start”.`, true);
    if (IS_DISPLAY) els.caption.textContent = "Error al cargar las frases";
  }

  const debugMouth = Number(new URLSearchParams(location.search).get("mouth"));
  if (Number.isFinite(debugMouth) && debugMouth > 0) {
    setMouthOpen(debugMouth);
  }

  if (IS_DISPLAY) {
    const debug = Number.isFinite(debugMouth) && debugMouth > 0;
    if (debug) {
      state.audioArmed = true;
      els.activateOverlay.classList.add("hidden");
    } else {
      setupDisplayActivation();
    }
    connectEvents("display");
  }
}

init();
