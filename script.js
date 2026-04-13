const preview = document.getElementById('preview');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const downloadBtn = document.getElementById('downloadBtn');
const statusIndicator = document.getElementById('status-indicator');

let mediaRecorder;
let recordedChunks = [];
let audioContext;
let finalStream; 

function getAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioContext;
}

startBtn.addEventListener('click', async () => {
    try {
        statusIndicator.textContent = "Solicitando permissões...";
        
        // 1. Capturar Tela (Vídeo e Áudio do Sistema)
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                frameRate: { ideal: 30, max: 60 },
                displaySurface: "browser" // Prioriza tab no browser (útil para vídeos)
            },
            audio: true // IMPORTANTE: Isto garante que ele possa capturar o áudio da tela/sistema
        });

        // 2. Capturar Microfone
        const micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                sampleRate: 44100
            },
            video: false
        });

        // 3. Inicializa o contexto de áudio
        const ctx = getAudioContext();
        
        // Nó final de destino onde jogaremos todos os áudios
        const dest = ctx.createMediaStreamDestination();

        // 4. Se a tela / sistema tiver áudio, manda pro 'dest'
        if (displayStream.getAudioTracks().length > 0) {
            const displayAudioSource = ctx.createMediaStreamSource(displayStream);
            displayAudioSource.connect(dest);
        }

        // 5. Se o mic tiver áudio, manda pro mesmo 'dest' (Mixagem maravilhosa acontece aqui)
        if (micStream.getAudioTracks().length > 0) {
            const micAudioSource = ctx.createMediaStreamSource(micStream);
            micAudioSource.connect(dest);
        }

        // 6. Junta a imagem da gravação de tela com o som mixado final
        finalStream = new MediaStream([
            ...displayStream.getVideoTracks(),
            ...dest.stream.getAudioTracks()
        ]);

        // Joga pra tela pro usuário ver a gravação acontecendo
        preview.srcObject = finalStream;
        preview.muted = true; // Fundamental para não causar eco na sua própria caixa de som local

        // 7. Preparando o Gravador
        const options = { mimeType: 'video/webm; codecs=vp8,opus' }; 
        // Usando vp8 que é mais massivamente suportado por padrão ao invés de vp9 
        mediaRecorder = new MediaRecorder(finalStream, options);

        recordedChunks = [];

        // Cada vez que tem dado da gravação, guarda
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };

        // Quando o usuário mandar parar...
        mediaRecorder.onstop = () => {
            statusIndicator.textContent = "Gravação finalizada! Clique em Baixar Vídeo.";
            statusIndicator.classList.remove('recording');
            
            // Desliga câmeras/microfones pra economizar bateria/privacidade
            finalStream.getTracks().forEach(track => track.stop());
            displayStream.getTracks().forEach(track => track.stop());
            micStream.getTracks().forEach(track => track.stop());

            downloadBtn.disabled = false;
        };

        // Escuta caso o usuário clique em "Interromper Compartilhamento" direto pelo aviso nativo do Chrome
        displayStream.getVideoTracks()[0].onended = () => {
            if (mediaRecorder.state === "recording") {
                mediaRecorder.stop();
                stopBtn.disabled = true;
            }
        };

        // Começa a gravar de fato salvando blocos a cada segundo
        mediaRecorder.start(1000); 
        
        // Muda estado dos botões da UI
        startBtn.disabled = true;
        stopBtn.disabled = false;
        downloadBtn.disabled = true;
        statusIndicator.textContent = "🔴 Gravando...";
        statusIndicator.classList.add('recording');

    } catch (err) {
        console.error("Erro ao tentar gravar: ", err);
        statusIndicator.textContent = "Erro: Permissão negada ou falha.";
        alert("Foi encontrado um erro: " + err.message + "\n\nAssegure-se de conceder a permissão corretamenta à aba/pantalla e ao microfone.");
    }
});

stopBtn.addEventListener('click', () => {
    // Usuário mandou parar programaticamente pelo nosso botão UI
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    }
    stopBtn.disabled = true;
    startBtn.disabled = false;
});

downloadBtn.addEventListener('click', () => {
    // Transforma tudo o que guardou em um arquivo único do tipo webm
    const blob = new Blob(recordedChunks, {
        type: 'video/webm'
    });
    
    // Simula um "Clique de botão direito -> Salvar Como" invisível usando Javascript
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    
    // Cria um nome de arquivo inteligente com data/hora dinâmicas
    const date = new Date();
    const timestamp = date.toISOString().replace(/T/, '_').replace(/[:.]/g, '-').slice(0, 19);
    a.download = `Gravacao_${timestamp}.webm`;
    
    document.body.appendChild(a);
    a.click();
    
    // Limpa a memória lixo do navegador para esse vídeo recém baixado
    setTimeout(() => {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    }, 100);
});
