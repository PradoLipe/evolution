// js/turtle.js — Tela de bloqueio para usuários não-VIP a partir de 01/04/2026

(function () {
    'use strict';

    // ── Mensagens de falsa esperança ──────────────────────────────────────────
    var MESSAGES = [
        "Quase lá... só mais um segundo.",
        "Tô buscando seus dados, aguenta mais um pouco...",
        "O servidor respondeu! Só processando aqui...",
        "Já tá vindo, juro. Aguenta mais um pouquinho.",
        "Conexão estabelecida... carregando o restante...",
        "Tô quase chegando lá, pode deixar.",
        "Encontrei seus registros! Só trazendo até aqui...",
        "Boa notícia: tô progredindo. Má notícia: devagar.",
        "99%... travou aqui mas já já destrava.",
        "Sincronizando... quase pronto...",
        "Carregando seu histórico... já tá quase.",
        "Tô pegando seus dados do servidor, um momento...",
        "Só mais uma etapinha e abre. Promessa.",
        "Conexão um pouco lenta hoje, mas tô chegando lá.",
        "Processando... processando... quase...",
        "Hmm, demorou mais que eu esperava. Mas já tô quase.",
        "O servidor tá um pouco ocupado. Segundinho.",
        "Atualizando seus registros... só aguarda.",
        "Tô nessa última parte aqui, já libero pra você.",
        "Quaaase... mais um instante...",
        "Conectando aos seus dados... já tá vindo.",
        "Tô aqui trabalhando duro pra você. Só um momento.",
        "Encontrei tudo! Só organizando pra exibir... já já abre.",
        "Tô desfazendo uns nós aqui no cabo de rede... quase.",
        "Sistema respondendo... autenticando sua sessão...",
        "Carregando... carregando... é pouco mais de pouco.",
        "Última sincronização iniciada. Não fecha não!",
        "Tô quase lá, sério. Não vai a lugar nenhum.",
        "Verificando seus registros... encontrei tudo! Só trazendo...",
        "O painel tá quase pronto pra você. Só aguarda.",
    ];

    // ── Mensagens para quando objetos rápidos passam ─────────────────────────
    var SPEEDER_REACTIONS = {
        rabbit: [
            "Olha lá! Esse era um usuário VIP logando... 👀",
            "Viu isso?! Um VIP passou voando daqui.",
            "Esse foi rápido hein? VIP tem conexão diferente.",
            "Coelho?! Não, esse era um VIP com acesso Premium.",
            "Caramba, que velocidade! VIP não espera, né.",
            "Tá vendo a diferença? Esse aí não esperou nada.",
        ],
        rocket: [
            "🚀 É assim que VIP carrega. Observa bem.",
            "Foguete passou! Era o painel de um VIP abrindo.",
            "Isso foi o servidor liberando acesso VIP. Rápido, né?",
            "Viu o foguete? Representa a velocidade de quem pagou.",
            "Cada VIP que loga passa assim: VRUM. Você viu, né?",
        ],
        lightning: [
            "⚡ Relâmpago! Era uma sessão VIP sendo aberta.",
            "Isso foi um VIP conectando. Nem piscou.",
            "Flash de VIP! Rápido assim é só pra quem tem acesso.",
            "Aquele raio foi a conexão de alguém que pagou.",
            "Velocidade de VIP: nem dá pra ver. Diferente do seu caso aqui.",
        ],
    };

    // ── Estado da animação ────────────────────────────────────────────────────
    var posX = 10, posY = 50;
    var velX = 0.006, velY = 0.003;
    var facingRight = true;
    var animFrame = null;
    var msgTimer = null;
    var bubbleHideTimer = null;
    var usedMessages = [];
    var isTalking = false;

    function getEl(id) { return document.getElementById(id); }

    function pickMessage(pool) {
        if (!pool) {
            if (usedMessages.length >= MESSAGES.length) usedMessages = [];
            var available = MESSAGES.filter(function (m) { return usedMessages.indexOf(m) === -1; });
            var msg = available[Math.floor(Math.random() * available.length)];
            usedMessages.push(msg);
            return msg;
        }
        return pool[Math.floor(Math.random() * pool.length)];
    }

    function positionBubble() {
        var screen = getEl('turtleBlockScreen');
        var turtle = getEl('turtleChar');
        var bubble = getEl('turtleBubble');
        if (!screen || !turtle || !bubble || bubble.classList.contains('turtle-bubble-hidden')) return;

        var sw = screen.offsetWidth;
        var sh = screen.offsetHeight;
        var tw = turtle.offsetWidth || 64;
        var th = turtle.offsetHeight || 64;
        var bw = bubble.offsetWidth || 240;
        var bh = bubble.offsetHeight || 70;

        var cx = (posX / 100) * sw + tw / 2;
        var cy = (posY / 100) * sh;

        var bx = cx - bw / 2;
        var by = cy - bh - 16;

        if (by < 8) by = cy + th + 10;
        bx = Math.max(8, Math.min(sw - bw - 8, bx));

        var arrowLeft = cx - bx - 10;
        arrowLeft = Math.max(10, Math.min(bw - 26, arrowLeft));
        bubble.style.setProperty('--arrow-left', arrowLeft + 'px');

        bubble.style.left = bx + 'px';
        bubble.style.top = by + 'px';
    }

    function showMessage(text, urgent) {
        var turtle = getEl('turtleChar');
        var bubble = getEl('turtleBubble');
        if (!turtle || !bubble) return;

        if (!urgent && isTalking) return; // não interrompe mensagem normal

        if (bubbleHideTimer) clearTimeout(bubbleHideTimer);

        isTalking = true;
        bubble.textContent = text;
        bubble.classList.remove('turtle-bubble-hidden', 'turtle-bubble-out');
        bubble.classList.add('turtle-bubble-in');

        if (urgent) {
            bubble.style.borderColor = '#FFD700';
            bubble.style.boxShadow = '0 0 12px #FFD700aa';
        } else {
            bubble.style.borderColor = '';
            bubble.style.boxShadow = '';
        }

        turtle.classList.add('turtle-talking');
        positionBubble();

        var displayMs = Math.max(3200, 2800 + text.length * 45);
        bubbleHideTimer = setTimeout(function () {
            bubble.classList.remove('turtle-bubble-in');
            bubble.classList.add('turtle-bubble-out');
            turtle.classList.remove('turtle-talking');
            setTimeout(function () {
                bubble.classList.add('turtle-bubble-hidden');
                bubble.classList.remove('turtle-bubble-out');
                isTalking = false;
            }, 350);
        }, displayMs);
    }

    function scheduleNextMessage() {
        var delay = 7000 + Math.random() * 9000; // mensagem a cada 7-16s
        msgTimer = setTimeout(function () {
            showMessage(pickMessage());
            scheduleNextMessage();
        }, delay);
    }

    // ── Animação da tartaruga (MUITO lenta) ───────────────────────────────────
    function startAnimation() {
        var screen = getEl('turtleBlockScreen');
        var turtle = getEl('turtleChar');
        if (!screen || !turtle) return;

        posX = 8 + Math.random() * 35;
        posY = 20 + Math.random() * 55;

        // Velocidade extremamente baixa — tartaruga de verdade
        var spd = 0.004 + Math.random() * 0.002;
        velX = (Math.random() < 0.5 ? 1 : -1) * spd;
        velY = (Math.random() < 0.5 ? 1 : -1) * spd * 0.45;

        function loop() {
            var sw = screen.offsetWidth || window.innerWidth;
            var sh = screen.offsetHeight || window.innerHeight;
            var tw = (turtle.offsetWidth / sw) * 100 || 7;
            var th = (turtle.offsetHeight / sh) * 100 || 10;

            posX += velX;
            posY += velY;

            var minX = 1, maxX = 100 - tw - 1;
            var minY = 5, maxY = 88 - th;

            var bounced = false;
            if (posX <= minX) { posX = minX; velX = Math.abs(velX) * (0.9 + Math.random() * 0.2); velY += (Math.random() - 0.5) * 0.006; bounced = true; }
            if (posX >= maxX) { posX = maxX; velX = -Math.abs(velX) * (0.9 + Math.random() * 0.2); velY += (Math.random() - 0.5) * 0.006; bounced = true; }
            if (posY <= minY) { posY = minY; velY = Math.abs(velY) * (0.9 + Math.random() * 0.2); velX += (Math.random() - 0.5) * 0.006; bounced = true; }
            if (posY >= maxY) { posY = maxY; velY = -Math.abs(velY) * (0.9 + Math.random() * 0.2); velX += (Math.random() - 0.5) * 0.006; bounced = true; }

            // Limitar velocidade — nunca ultrapassa o máximo nem fica parada
            var maxV = 0.009;
            var minV = 0.003;
            velX = Math.max(-maxV, Math.min(maxV, velX));
            velY = Math.max(-maxV, Math.min(maxV, velY));
            if (Math.abs(velX) < minV) velX = velX < 0 ? -minV : minV;
            if (Math.abs(velY) < minV * 0.5) velY = velY < 0 ? -minV * 0.5 : minV * 0.5;

            var nowFacingRight = velX > 0;
            if (nowFacingRight !== facingRight) {
                facingRight = nowFacingRight;
                turtle.style.transform = facingRight ? 'scaleX(1)' : 'scaleX(-1)';
                // Atualiza variável CSS usada na animação turtle-talk
                turtle.style.setProperty('--turtle-sx', facingRight ? '1' : '-1');
            }

            if (bounced) {
                turtle.classList.add('turtle-bounce');
                setTimeout(function () { turtle.classList.remove('turtle-bounce'); }, 300);
            }

            turtle.style.left = posX + '%';
            turtle.style.top = posY + '%';
            positionBubble();

            animFrame = requestAnimationFrame(loop);
        }

        animFrame = requestAnimationFrame(loop);
    }

    // ── Objetos rápidos (coelho, foguete, raio) ───────────────────────────────
    var SPEEDERS = [
        { type: 'rabbit',    emoji: '🐇', label: 'coelho'  },
        { type: 'rocket',    emoji: '🚀', label: 'foguete' },
        { type: 'lightning', emoji: '⚡', label: 'raio'    },
    ];

    function launchSpeeder() {
        var screen = getEl('turtleBlockScreen');
        if (!screen) return;

        var s = SPEEDERS[Math.floor(Math.random() * SPEEDERS.length)];
        var el = document.createElement('div');
        el.className = 'turtle-speeder';
        el.textContent = s.emoji;

        // Direção: esquerda→direita ou direita→esquerda
        var goRight = Math.random() < 0.5;
        var yPct = 10 + Math.random() * 75; // posição vertical aleatória
        var duration = 600 + Math.random() * 400; // 600–1000ms

        el.style.cssText = [
            'position:absolute',
            'top:' + yPct + '%',
            goRight ? 'left:-80px' : 'right:-80px',
            'font-size:2.2rem',
            'z-index:20',
            'pointer-events:none',
            'transition:none',
            // foguete voa na diagonal
            s.type === 'rocket' ? 'transform:rotate(' + (goRight ? '-30deg' : '150deg') + ')' : (goRight ? '' : 'transform:scaleX(-1)'),
        ].join(';');

        screen.appendChild(el);

        // Força reflow e dispara animação via JS (sem CSS @keyframes extra)
        var startX = goRight ? -80 : screen.offsetWidth + 80;
        var endX   = goRight ? screen.offsetWidth + 80 : -80;
        var startTime = null;

        function animSpeeder(ts) {
            if (!startTime) startTime = ts;
            var progress = Math.min(1, (ts - startTime) / duration);
            var x = startX + (endX - startX) * progress;
            el.style.left = x + 'px';
            el.style.right = 'auto';

            if (progress < 1) {
                requestAnimationFrame(animSpeeder);
            } else {
                if (el.parentNode) el.parentNode.removeChild(el);
            }
        }
        requestAnimationFrame(animSpeeder);

        // Tartaruga reage na hora — vira para olhar e fala
        var turtle = getEl('turtleChar');
        if (turtle) {
            // Vira na direção do objeto que passou
            var lookRight = goRight; // objeto vai pra direita → tartaruga olha pra direita
            turtle.style.transform = lookRight ? 'scaleX(1)' : 'scaleX(-1)';
            facingRight = lookRight;
        }

        var reaction = pickMessage(SPEEDER_REACTIONS[s.type]);
        setTimeout(function () { showMessage(reaction, true); }, 180);

        // Agenda próximo speeder
        scheduleSpeeder();
    }

    function scheduleSpeeder() {
        var delay = 18000 + Math.random() * 25000; // a cada 18–43s
        setTimeout(launchSpeeder, delay);
    }

    // ── Barra de progresso falsa ───────────────────────────────────────────────
    var LOADING_LABELS = [
        'Conectando ao servidor',
        'Autenticando sessão',
        'Buscando seus registros',
        'Carregando histórico',
        'Sincronizando dados',
        'Verificando permissões',
        'Quase pronto',
        'Finalizando',
        'Abrindo seu painel',
        'Quase lá',
    ];

    function startFakeProgress() {
        var bar = getEl('turtleProgressBar');
        var pct = getEl('turtleProgressPct');
        var label = getEl('turtleLoadingText');
        if (!bar || !pct) return;

        var current = 0;
        var labelIdx = 0;

        function tick() {
            var remaining = 99 - current;
            var step = remaining * (0.005 + Math.random() * 0.008);
            step = Math.max(0.05, Math.min(step, 1.8));
            current = Math.min(99, current + step);

            bar.style.width = current.toFixed(1) + '%';
            pct.textContent = Math.floor(current) + '%';

            if (current > (labelIdx + 1) * (99 / LOADING_LABELS.length)) {
                labelIdx = Math.min(labelIdx + 1, LOADING_LABELS.length - 1);
                if (label) label.textContent = LOADING_LABELS[labelIdx];
            }

            if (current < 99) {
                setTimeout(tick, 600 + Math.random() * 1200);
            } else {
                bar.style.width = '99%';
                pct.textContent = '99%';
                if (label) label.textContent = 'Quase lá';
                setInterval(function () {
                    bar.style.opacity = bar.style.opacity === '0.35' ? '1' : '0.35';
                }, 1100);
            }
        }

        setTimeout(tick, 800);
    }

    // ── Inicialização ─────────────────────────────────────────────────────────
    function show() {
        var screen = getEl('turtleBlockScreen');
        if (!screen) return;

        screen.classList.remove('turtle-screen-hidden');
        document.body.style.overflow = 'hidden';

        setTimeout(function () { showMessage("Calma... tô indo..."); }, 1200);
        setTimeout(scheduleNextMessage, 12000);

        startAnimation();
        startFakeProgress();

        // Primeiro speeder aparece entre 15–25s (chama direto, sem delay duplo)
        setTimeout(launchSpeeder, 15000 + Math.random() * 10000);
    }

    function hide() {
        var screen = getEl('turtleBlockScreen');
        if (screen) screen.classList.add('turtle-screen-hidden');
        if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
        if (msgTimer)  { clearTimeout(msgTimer);  msgTimer  = null; }
        if (bubbleHideTimer) { clearTimeout(bubbleHideTimer); bubbleHideTimer = null; }
    }

    window.TurtleBlock = { show: show, hide: hide };
})();
