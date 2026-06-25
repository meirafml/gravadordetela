'use strict';

/*
 * Pagina da CAMERA (roda no Safari do iPhone).
 * Captura a camera e envia o video para o PC via WebRTC.
 * Esta ponta e quem cria a "oferta" (offer).
 */

const local = document.getElementById('local');
const statusEl = document.getElementById('status');
const startBtn = document.getElementById('startBtn');
const switchBtn = document.getElementById('switchBtn');
const torchBtn = document.getElementById('torchBtn');
const stopBtn = document.getElementById('stopBtn');
const qualitySel = document.getElementById('quality');

const ROLE = 'camera';
const RTC_CONFIG = {
  // STUN ajuda quando ha NAT; pelo cabo USB a conexao e direta (host candidates)
  // e funciona ate sem internet.
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

let stream = null;
let pc = null;
let events = null;
let facing = 'environment'; // comeca na traseira (melhor qualidade)
let torchOn = false;

function setStatus(text, recording) {
  statusEl.textContent = text;
  statusEl.classList.toggle('recording', !!recording);
}

// ---- Captura da camera -----------------------------------------------------
async function getStream() {
  const [w, h] = qualitySel.value.split('x').map(Number);
  const constraints = {
    audio: false,
    video: {
      facingMode: { ideal: facing },
      width: { ideal: w },
      height: { ideal: h },
      frameRate: { ideal: 30, max: 60 },
    },
  };
  return navigator.mediaDevices.getUserMedia(constraints);
}

async function startCamera() {
  try {
    setStatus('Pedindo permissao da camera...');
    stream = await getStream();
    local.srcObject = stream;

    startBtn.disabled = true;
    switchBtn.disabled = false;
    stopBtn.disabled = false;
    qualitySel.disabled = true;
    updateTorchButton();

    connectSignaling();
    setStatus('Camera ligada. Aguardando o PC...');
  } catch (err) {
    console.error(err);
    setStatus('Erro ao abrir a camera');
    alert('Nao consegui abrir a camera: ' + err.message +
      '\n\nVerifique se voce permitiu o acesso a camera para este site.');
  }
}

function stopCamera() {
  if (pc) { pc.close(); pc = null; }
  if (events) { events.close(); events = null; }
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  local.srcObject = null;
  startBtn.disabled = false;
  switchBtn.disabled = true;
  torchBtn.disabled = true;
  stopBtn.disabled = true;
  qualitySel.disabled = false;
  setStatus('Parado');
}

// ---- Trocar camera frontal/traseira ---------------------------------------
async function switchCamera() {
  facing = facing === 'environment' ? 'user' : 'environment';
  torchOn = false;
  const old = stream;
  try {
    stream = await getStream();
  } catch (err) {
    facing = facing === 'environment' ? 'user' : 'environment'; // reverte
    alert('Nao consegui trocar de camera: ' + err.message);
    return;
  }
  local.srcObject = stream;
  if (old) old.getTracks().forEach((t) => t.stop());

  // Troca a faixa de video que ja esta sendo enviada (sem renegociar).
  if (pc) {
    const newTrack = stream.getVideoTracks()[0];
    const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
    if (sender) await sender.replaceTrack(newTrack);
  }
  updateTorchButton();
}

// ---- Lanterna (so na traseira, se o aparelho suportar) ---------------------
function updateTorchButton() {
  const track = stream && stream.getVideoTracks()[0];
  const caps = track && track.getCapabilities ? track.getCapabilities() : {};
  torchBtn.disabled = !caps.torch;
  if (caps.torch) torchBtn.classList.toggle('active', torchOn);
}

async function toggleTorch() {
  const track = stream && stream.getVideoTracks()[0];
  if (!track) return;
  torchOn = !torchOn;
  try {
    await track.applyConstraints({ advanced: [{ torch: torchOn }] });
    torchBtn.classList.toggle('active', torchOn);
  } catch (err) {
    console.error(err);
    torchOn = false;
  }
}

// ---- WebRTC ----------------------------------------------------------------
function createPeer() {
  pc = new RTCPeerConnection(RTC_CONFIG);
  stream.getTracks().forEach((track) => pc.addTrack(track, stream));

  pc.onicecandidate = (e) => {
    if (e.candidate) post({ type: 'ice', candidate: e.candidate });
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') setStatus('Transmitindo para o PC', true);
    else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
      setStatus('Conexao caiu. Aguardando o PC...');
    }
  };
}

async function startOffer() {
  if (!stream) return;
  if (pc) pc.close();
  createPeer();
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  post({ type: 'offer', sdp: pc.localDescription });
}

// ---- Sinalizacao (SSE para receber, POST para enviar) ----------------------
function post(msg) {
  fetch(`/signal?role=${ROLE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(msg),
  }).catch(() => {});
}

function connectSignaling() {
  if (events) events.close();
  events = new EventSource(`/events?role=${ROLE}`);
  events.onmessage = async (e) => {
    const msg = JSON.parse(e.data);
    switch (msg.type) {
      case 'peer-ready':
        // O PC esta pronto: (re)inicia a negociacao.
        await startOffer();
        break;
      case 'answer':
        if (pc) await pc.setRemoteDescription(msg.sdp);
        break;
      case 'ice':
        if (pc && msg.candidate) {
          try { await pc.addIceCandidate(msg.candidate); } catch (_) {}
        }
        break;
      case 'peer-left':
        setStatus('PC desconectou. Aguardando...');
        break;
    }
  };
  events.onerror = () => setStatus('Reconectando ao servidor...');
}

// ---- Eventos da UI ---------------------------------------------------------
startBtn.addEventListener('click', startCamera);
stopBtn.addEventListener('click', stopCamera);
switchBtn.addEventListener('click', switchCamera);
torchBtn.addEventListener('click', toggleTorch);

// Evita que a tela apague (e a transmissao pare) enquanto a camera roda.
let wakeLock = null;
async function keepAwake() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch (_) {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && stream) keepAwake();
});
startBtn.addEventListener('click', keepAwake);
