'use strict';

/*
 * Pagina do VISOR (roda no PC com Windows).
 * Recebe o video do iPhone via WebRTC e mostra na tela.
 * Esta ponta responde a "oferta" da camera com uma "resposta" (answer).
 */

const remote = document.getElementById('remote');
const statusEl = document.getElementById('status');
const urlsEl = document.getElementById('urls');
const connectBox = document.getElementById('connectBox');
const stage = document.getElementById('stage');
const fsBtn = document.getElementById('fsBtn');

const ROLE = 'viewer';
const RTC_CONFIG = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

let pc = null;
let events = null;

function setStatus(text, live) {
  statusEl.textContent = text;
  statusEl.classList.toggle('recording', !!live);
}

// ---- Mostra os enderecos para abrir no iPhone ------------------------------
async function loadIps() {
  try {
    const res = await fetch('/ip');
    const { ips, port } = await res.json();
    if (!ips.length) {
      urlsEl.innerHTML = '<span class="muted">Nenhum endereco de rede ainda. Ligue o Compartilhamento de Internet por USB no iPhone.</span>';
      return;
    }
    urlsEl.innerHTML = ips.map((ip) => {
      const usb = ip.address.startsWith('172.20.10.');
      const url = `https://${ip.address}:${port}/camera`;
      return `<div class="url-row${usb ? ' usb' : ''}">` +
        `<code>${url}</code>` +
        (usb ? '<span class="badge">cabo USB</span>' : '') +
        `</div>`;
    }).join('');
  } catch (_) {
    urlsEl.textContent = 'Nao consegui ler os enderecos do servidor.';
  }
}

// ---- WebRTC ----------------------------------------------------------------
function createPeer() {
  pc = new RTCPeerConnection(RTC_CONFIG);

  pc.ontrack = (e) => {
    remote.srcObject = e.streams[0];
    connectBox.classList.add('hidden');
    setStatus('Ao vivo', true);
  };
  pc.onicecandidate = (e) => {
    if (e.candidate) post({ type: 'ice', candidate: e.candidate });
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
      setStatus('Conexao caiu. Aguardando o iPhone...');
      connectBox.classList.remove('hidden');
    }
  };
}

async function handleOffer(sdp) {
  if (pc) pc.close();
  createPeer();
  await pc.setRemoteDescription(sdp);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  post({ type: 'answer', sdp: pc.localDescription });
}

// ---- Sinalizacao -----------------------------------------------------------
function post(msg) {
  fetch(`/signal?role=${ROLE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(msg),
  }).catch(() => {});
}

function connectSignaling() {
  events = new EventSource(`/events?role=${ROLE}`);
  events.onmessage = async (e) => {
    const msg = JSON.parse(e.data);
    switch (msg.type) {
      case 'offer':
        await handleOffer(msg.sdp);
        break;
      case 'ice':
        if (pc && msg.candidate) {
          try { await pc.addIceCandidate(msg.candidate); } catch (_) {}
        }
        break;
      case 'peer-left':
        setStatus('iPhone desconectou. Aguardando...');
        connectBox.classList.remove('hidden');
        if (pc) { pc.close(); pc = null; }
        break;
    }
  };
  events.onerror = () => setStatus('Reconectando ao servidor...');
}

// ---- Tela cheia ------------------------------------------------------------
fsBtn.addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else stage.requestFullscreen().catch(() => {});
});

// ---- Inicio ----------------------------------------------------------------
loadIps();
setInterval(loadIps, 5000); // o IP do cabo pode aparecer depois
connectSignaling();
