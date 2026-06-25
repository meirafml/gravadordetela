# iPhone Webcam para Windows (via USB-C)

Use a câmera do seu iPhone como webcam no PC com Windows, passando o vídeo
**pelo cabo USB-C** — sem instalar app na App Store, sem driver e sem depender
da internet.

A imagem vai do iPhone para o PC por uma conexão **WebRTC** ponto a ponto. Quando
o iPhone está em **Compartilhamento de Internet por USB**, esse tráfego sobe pelo
cabo USB-C: baixa latência e tudo local.

---

## O que você precisa

- iPhone com cabo **USB-C** (ou Lightning) para ligar no PC.
- Windows com **Node.js** instalado → https://nodejs.org (botão "LTS").
- Para aparecer como webcam no **Zoom / Teams / Meet**: **OBS Studio** (grátis).

> Sem o OBS, você já consegue ver e usar a câmera do iPhone na janela do PC
> (boa para gravar a tela, mostrar em apresentação etc.). O OBS é só o último
> passo, para a imagem virar uma "câmera" selecionável dentro do Zoom/Teams.

---

## Passo a passo

### 1. Ligue o iPhone no PC pelo cabo USB-C
No iPhone: **Ajustes → Compartilhamento de Internet → Permitir que outros
conectem** (ligado). Mantenha o cabo conectado. O Windows passa a enxergar o
iPhone como uma placa de rede (o IP costuma ser `172.20.10.x`).

### 2. Inicie o servidor no PC
Dê dois cliques em **`iniciar.bat`** (ou abra o terminal nesta pasta e rode
`node server.js`). Na primeira vez ele cria sozinho um certificado local.

O terminal vai mostrar os endereços, por exemplo:

```
1) No PC, abra o VISOR:
     https://localhost:8443

2) No iPhone (Safari), abra a CAMERA:
     https://172.20.10.2:8443/camera   <- provavel cabo USB
```

### 3. No PC, abra o visor
Abra **`https://localhost:8443`** no navegador. Vai aparecer "Aguardando o
iPhone..." e o endereço que você deve digitar no iPhone.

### 4. No iPhone, abra a câmera
No **Safari**, digite o endereço `https://172.20.10.x:8443/camera`.
- Vai aparecer um aviso de "conexão não é privada". Isso é **normal** (é um
  certificado local). Toque em **Mostrar detalhes → Visitar mesmo assim**.
- Toque em **Iniciar câmera** e **permita** o acesso à câmera.

Pronto: o vídeo do iPhone aparece no PC. Use **Frontal/Traseira**, a
**Lanterna** e a **Qualidade** direto na tela do iPhone.

### 5. (Opcional) Virar webcam no Zoom/Teams/Meet
1. Instale e abra o **OBS Studio**.
2. **Fontes → + → Navegador (Browser)** e em *URL* coloque
   `https://localhost:8443`. Ajuste largura/altura (ex.: 1920x1080).
3. Clique em **Iniciar Câmera Virtual** (canto inferior direito do OBS).
4. No Zoom/Teams/Meet, escolha a câmera **OBS Virtual Camera**.

---

## Dicas e solução de problemas

- **Não aparece o IP `172.20.10.x`:** confira se o Compartilhamento de Internet
  está ligado e o cabo conectado. Os endereços se atualizam sozinhos no visor a
  cada poucos segundos.
- **O vídeo trava quando o iPhone bloqueia:** deixe a aba do Safari aberta. O app
  pede o *Wake Lock* para segurar a tela, mas no iOS vale aumentar o tempo de
  bloqueio automático (**Ajustes → Tela e brilho → Bloqueio automático → Nunca**).
- **Quero usar pelo Wi-Fi também:** funciona — basta o iPhone e o PC estarem na
  mesma rede e usar o IP do Wi-Fi em vez do `172.20.10.x`. Pelo cabo a latência
  é menor e não depende de Wi-Fi.
- **Porta ocupada:** rode `set PORT=9443 && node server.js` e troque a porta nos
  endereços.
- **A lanterna não liga:** só funciona na câmera traseira e em aparelhos que
  expõem esse controle ao navegador.

---

## Como funciona (resumo técnico)

- `server.js` — servidor **HTTPS sem dependências** (só Node). Serve as duas
  páginas e faz a **sinalização** WebRTC entre elas usando *Server-Sent Events*
  (servidor → cliente) e *POST* (cliente → servidor). Não há biblioteca externa.
- `public/camera.html` + `camera.js` — página da câmera (iPhone). Captura com
  `getUserMedia` e **cria a oferta** (offer) WebRTC. Troca de câmera sem
  renegociar (`replaceTrack`), controla lanterna e qualidade.
- `public/viewer.html` + `viewer.js` — página do visor (PC). **Responde** com a
  *answer* e exibe o vídeo. Mostra os endereços de acesso e tem botão de tela
  cheia (útil como fonte de Navegador no OBS).
- O vídeo trafega direto entre os dois navegadores (P2P). Pelo cabo USB-C, os
  *host candidates* da mesma sub-rede conectam sem precisar de internet.

### Por que HTTPS e certificado auto-assinado?
O Safari só libera a câmera (`getUserMedia`) em páginas seguras. Para um
endereço de IP local não existe certificado "oficial", então geramos um
auto-assinado — daí o aviso que você aceita uma vez.

### E uma webcam "de verdade" no Windows?
Apps como Zoom/Teams só listam câmeras registradas no sistema. Registrar uma
câmera virtual exige um **driver** no Windows (caminho dos apps pagos tipo Camo).
Aqui usamos o **OBS Virtual Camera**, que já é um driver pronto, gratuito e
confiável — sem precisar escrever/instalar driver próprio.
