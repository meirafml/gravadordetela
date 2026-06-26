'use strict';

/*
 * iPhone Webcam para Windows (via USB-C) - servidor local
 *
 * Sem dependencias de npm. Roda so com Node.js instalado.
 *
 * O que ele faz:
 *   - Serve a pagina da CAMERA (que voce abre no Safari do iPhone) e a pagina
 *     do VISOR (que voce abre no PC com Windows).
 *   - Faz a "ponte de sinalizacao" (signaling) WebRTC entre as duas paginas
 *     usando Server-Sent Events + POST. Zero biblioteca externa.
 *   - O video em si vai direto iPhone -> PC pela conexao WebRTC, que sobe pelo
 *     cabo USB-C quando o iPhone esta em "Compartilhamento de Internet" (USB).
 *
 * Use HTTPS porque o Safari so libera a camera (getUserMedia) em paginas
 * seguras. O certificado e auto-assinado: o iPhone mostra um aviso uma vez,
 * voce toca em "Visitar mesmo assim" e pronto.
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const PORT = Number(process.env.PORT) || 8443;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const CERT_DIR = path.join(ROOT, 'certs');
const CERT_FILE = path.join(CERT_DIR, 'cert.pem');
const KEY_FILE = path.join(CERT_DIR, 'key.pem');

// ---------------------------------------------------------------------------
// Certificado auto-assinado: o app ja vem com um pronto em certs/, entao no
// caso normal nada acontece aqui. So se alguem apagar os arquivos a gente
// tenta regerar com o openssl (se estiver instalado).
// ---------------------------------------------------------------------------
function ensureCert() {
  if (fs.existsSync(CERT_FILE) && fs.existsSync(KEY_FILE)) return;

  if (!fs.existsSync(CERT_DIR)) fs.mkdirSync(CERT_DIR, { recursive: true });
  console.log('[cert] certificado nao encontrado, gerando um auto-assinado...');
  try {
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', KEY_FILE, '-out', CERT_FILE,
      '-days', '3650', '-subj', '/CN=iphone-webcam.local',
      '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
    ], { stdio: 'ignore' });
    console.log('[cert] certificado gerado em certs/.');
  } catch (err) {
    console.error('\n[cert] nao consegui gerar o certificado automaticamente.');
    console.error('Instale o OpenSSL ou rode este comando dentro da pasta iphone-webcam:\n');
    console.error('  openssl req -x509 -newkey rsa:2048 -nodes \\');
    console.error('    -keyout certs/key.pem -out certs/cert.pem -days 3650 \\');
    console.error('    -subj "/CN=iphone-webcam.local"\n');
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Descobre os IPs locais (o do cabo USB costuma ser 172.20.10.x).
// ---------------------------------------------------------------------------
function localIps() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        out.push({ iface: name, address: net.address });
      }
    }
  }
  // IPs do range de tethering do iPhone (172.20.10.x) primeiro.
  out.sort((a, b) => {
    const ua = a.address.startsWith('172.20.10.') ? 0 : 1;
    const ub = b.address.startsWith('172.20.10.') ? 0 : 1;
    return ua - ub;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Sinalizacao: um visor (PC) e uma camera (iPhone). Cada papel mantem um
// fluxo SSE aberto; mensagens de um papel sao repassadas para o outro.
// ---------------------------------------------------------------------------
const peers = { viewer: null, camera: null };

function sendEvent(res, payload) {
  if (!res) return;
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function other(role) {
  return role === 'viewer' ? 'camera' : 'viewer';
}

function notifyPairReady() {
  // Quando os dois lados estao conectados, manda a camera (quem faz a oferta)
  // iniciar a negociacao.
  if (peers.viewer && peers.camera) {
    sendEvent(peers.camera, { type: 'peer-ready' });
  }
}

// ---------------------------------------------------------------------------
// Servidor estatico + endpoints de sinalizacao.
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Nao encontrado');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

function handleSse(req, res, role) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('retry: 2000\n\n');

  // So um cliente por papel; o novo substitui o antigo.
  if (peers[role]) {
    try { peers[role].end(); } catch (_) { /* ignora */ }
  }
  peers[role] = res;
  console.log(`[sse] ${role} conectou`);
  sendEvent(res, { type: 'welcome', role });
  notifyPairReady();

  // Avisa o outro lado que esse papel saiu, para ele resetar a conexao.
  const keepAlive = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (_) { /* ignora */ }
  }, 15000);

  req.on('close', () => {
    clearInterval(keepAlive);
    if (peers[role] === res) {
      peers[role] = null;
      console.log(`[sse] ${role} desconectou`);
      sendEvent(peers[other(role)], { type: 'peer-left' });
    }
  });
}

function handleSignal(req, res, role) {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 1e6) req.destroy(); // trava de seguranca
  });
  req.on('end', () => {
    let msg;
    try {
      msg = JSON.parse(body || '{}');
    } catch (_) {
      res.writeHead(400); res.end('json invalido'); return;
    }
    sendEvent(peers[other(role)], msg);
    res.writeHead(204); res.end();
  });
}

function requestHandler(req, res) {
  const url = new URL(req.url, 'https://localhost');
  const pathname = url.pathname;

  // Sinalizacao
  if (pathname === '/events' && req.method === 'GET') {
    const role = url.searchParams.get('role') === 'camera' ? 'camera' : 'viewer';
    return handleSse(req, res, role);
  }
  if (pathname === '/signal' && req.method === 'POST') {
    const role = url.searchParams.get('role') === 'camera' ? 'camera' : 'viewer';
    return handleSignal(req, res, role);
  }
  if (pathname === '/ip' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ips: localIps(), port: PORT }));
  }

  // Estatico
  let file;
  if (pathname === '/' ) file = path.join(PUBLIC_DIR, 'viewer.html');
  else if (pathname === '/camera') file = path.join(PUBLIC_DIR, 'camera.html');
  else file = path.join(PUBLIC_DIR, path.normalize(pathname).replace(/^(\.\.[/\\])+/, ''));

  // Nao deixa sair da pasta public.
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('proibido'); return;
  }
  return serveFile(res, file);
}

// ---------------------------------------------------------------------------
// Sobe o servidor HTTPS (e um HTTP que redireciona, por conveniencia).
// ---------------------------------------------------------------------------
function start() {
  ensureCert();
  const options = {
    cert: fs.readFileSync(CERT_FILE),
    key: fs.readFileSync(KEY_FILE),
  };

  https.createServer(options, requestHandler).listen(PORT, '0.0.0.0', () => {
    const ips = localIps();
    console.log('\n==============================================');
    console.log('  iPhone Webcam para Windows - rodando!');
    console.log('==============================================\n');
    console.log('1) No PC (Windows), abra o VISOR:');
    console.log(`     https://localhost:${PORT}\n`);
    console.log('2) No iPhone (Safari), abra a CAMERA:');
    if (ips.length === 0) {
      console.log('     (nenhum IP de rede encontrado - ligue o Compartilhamento');
      console.log('      de Internet por USB no iPhone e tente de novo)');
    } else {
      for (const ip of ips) {
        const tag = ip.address.startsWith('172.20.10.') ? '  <- provavel cabo USB' : '';
        console.log(`     https://${ip.address}:${PORT}/camera${tag}`);
      }
    }
    console.log('\n(O aviso de "conexao nao segura" e normal: e um certificado');
    console.log(' local auto-assinado. Toque em "Visitar mesmo assim".)');
    console.log('\nPressione Ctrl+C para parar.\n');
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[erro] a porta ${PORT} ja esta em uso. Feche o outro programa`);
      console.error(`       ou rode com outra porta:  set PORT=9443 && node server.js`);
    } else {
      console.error('[erro]', err.message);
    }
    process.exit(1);
  });
}

start();
