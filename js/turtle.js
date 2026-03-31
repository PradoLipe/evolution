// js/turtle.js — Tela de bloqueio para usuários não-VIP

(function () {
    'use strict';

    // ── Mensagens de incentivo VIP ────────────────────────────────────────────
    var MESSAGES = [
        "O Felipe construiu esse app do zero pra te ajudar. R$25 por mês mantém ele de pé.",
        "Praticidade na palma da mão, a qualquer hora. Por menos de R$1 por dia.",
        "Atualizações, melhorias e novidades estão chegando. Faz parte disso com R$25 por mês.",
        "R$25 por mês. Menos que um café por semana e você acessa tudo sem limite.",
        "Manter o app online tem custo. Cada VIP ajuda a garantir que ele continue no ar.",
        "Novas funcionalidades estão chegando. Seu apoio de R$25 faz isso acontecer.",
        "Um app feito por todos nós, pra resolver os problemas que enfrentamos juntos no dia a dia. R$25 por mês.",
        "Servidor, atualizações, banco de dados — tudo tem custo. Ajuda a gente com R$25/mês.",
        "O app cresce com o apoio de todos. R$25 por mês garante que ele continue evoluindo.",
        "No celular, no computador, onde você estiver — tudo na palma da mão por R$25 por mês.",
        "Cada VIP ajuda a pagar os custos do servidor e trazer novas atualizações pra você.",
        "R$25 por mês. Divide por 30 e dá menos de um café. O app fica disponível o dia todo.",
        "Todo mundo que usa o app faz parte disso. R$25 por mês mantém tudo funcionando pra todos.",
    ];

    // ── Mensagens douradas (trainee) ──────────────────────────────────────────
    var GOLDEN_MESSAGES = [
        "Essa tartaruga aqui? É trainee. Primeiro dia. Por isso tá um pouco lento... tudo bem, eu estou aprendendo.",
        "Quem faz a mágica acontecer de verdade é o Felipe Prado. Mas ele só atende VIP. Eu sou a estagiária.",
        "A diferença entre VIP e não-VIP? O VIP tem o Felipe cuidando. Você tá com a trainee. Percebeu né?",
        "O Felipe montou tudo isso do zero. Servidor, banco de dados, o app inteiro. Ele só deixa a trainee cuidar de quem não é VIP.",
        "VIP abre na hora. Sem trainee, sem espera, sem desculpa de cabo de rede. Só o Felipe cuidando da conexão.",
    ];

    // ── Estado ────────────────────────────────────────────────────────────────
    var msgTimer = null;
    var bubbleHideTimer = null;
    var usedMessages = [];
    var usedGolden = [];
    var isTalking = false;
    var bubbleSide = 'right'; // alterna entre 'right' e 'left'

    function getEl(id) { return document.getElementById(id); }

    function pickMessage() {
        // A cada 3 mensagens normais, intercala 1 dourada (30% de chance)
        var useGolden = Math.random() < 0.30 && GOLDEN_MESSAGES.length > 0;
        if (useGolden) {
            if (usedGolden.length >= GOLDEN_MESSAGES.length) usedGolden = [];
            var availG = GOLDEN_MESSAGES.filter(function (m) { return usedGolden.indexOf(m) === -1; });
            var gold = availG[Math.floor(Math.random() * availG.length)];
            usedGolden.push(gold);
            return { text: gold, golden: true };
        }
        if (usedMessages.length >= MESSAGES.length) usedMessages = [];
        var available = MESSAGES.filter(function (m) { return usedMessages.indexOf(m) === -1; });
        var msg = available[Math.floor(Math.random() * available.length)];
        usedMessages.push(msg);
        return { text: msg, golden: false };
    }

    function positionBubble() {
        var screen = getEl('turtleBlockScreen');
        var bubble = getEl('turtleBubble');
        if (!screen || !bubble || bubble.classList.contains('turtle-bubble-hidden')) return;

        var sw = screen.offsetWidth;
        var sh = screen.offsetHeight;
        var bw = bubble.offsetWidth  || 220;
        var bh = bubble.offsetHeight || 70;

        // Cabeça da tartaruga: centro horizontal, ~28% do topo da tela
        var headX = sw * 0.50;
        var headY = sh * 0.28;

        // Bolha acima da cabeça, seta aponta para baixo (para a cabeça)
        var by = headY - bh - 12;
        by = Math.max(8, Math.min(sh - bh - 8, by));

        var bx;
        if (bubbleSide === 'right') {
            bx = headX + 12;
        } else {
            bx = headX - bw - 12;
        }
        bx = Math.max(8, Math.min(sw - bw - 8, bx));

        // Seta aponta para a cabeça
        var arrowLeft = headX - bx - 9;
        arrowLeft = Math.max(10, Math.min(bw - 26, arrowLeft));
        bubble.style.setProperty('--arrow-left', arrowLeft + 'px');
        bubble.removeAttribute('data-side'); // usa seta padrão (para baixo)

        bubble.style.left = bx + 'px';
        bubble.style.top  = by + 'px';
    }

    function showMessage(text, golden) {
        var bubble = getEl('turtleBubble');
        if (!bubble || isTalking) return;

        // Alterna lado
        bubbleSide = bubbleSide === 'right' ? 'left' : 'right';

        if (bubbleHideTimer) clearTimeout(bubbleHideTimer);

        isTalking = true;
        bubble.textContent = text;
        bubble.classList.remove('turtle-bubble-hidden', 'turtle-bubble-out');
        bubble.classList.add('turtle-bubble-in');

        if (golden) {
            bubble.style.borderColor = '#FFD700';
            bubble.style.boxShadow   = '0 0 16px rgba(255, 215, 0, 0.6)';
            bubble.style.color       = '#FFE066';
        } else {
            bubble.style.borderColor = '';
            bubble.style.boxShadow   = '';
            bubble.style.color       = '';
        }

        positionBubble();

        var displayMs = Math.max(3200, 2800 + text.length * 45);
        bubbleHideTimer = setTimeout(function () {
            bubble.classList.remove('turtle-bubble-in');
            bubble.classList.add('turtle-bubble-out');
            setTimeout(function () {
                bubble.classList.add('turtle-bubble-hidden');
                bubble.classList.remove('turtle-bubble-out');
                bubble.style.borderColor = '';
                bubble.style.boxShadow   = '';
                bubble.style.color       = '';
                isTalking = false;
            }, 350);
        }, displayMs);
    }

    function scheduleNextMessage() {
        var delay = 7000 + Math.random() * 9000; // 7–16s
        msgTimer = setTimeout(function () {
            var picked = pickMessage();
            showMessage(picked.text, picked.golden);
            scheduleNextMessage();
        }, delay);
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
        var bar   = getEl('turtleProgressBar');
        var pct   = getEl('turtleProgressPct');
        var label = getEl('turtleLoadingText');
        if (!bar || !pct) return;

        var current  = 0;
        var labelIdx = 0;

        function tick() {
            var remaining = 99 - current;
            var step = remaining * (0.005 + Math.random() * 0.008);
            step = Math.max(0.05, Math.min(step, 1.8));
            current = Math.min(99, current + step);

            bar.style.width  = current.toFixed(1) + '%';
            pct.textContent  = Math.floor(current) + '%';

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

        setTimeout(function () { showMessage("Calma... tô carregando...", false); }, 1200);
        setTimeout(scheduleNextMessage, 12000);

        startFakeProgress();

        // Garantir autoplay no iOS — tenta iniciar, se falhar aguarda toque
        var vid = getEl('turtleChar');
        if (vid) {
            var playPromise = vid.play();
            if (playPromise !== undefined) {
                playPromise.catch(function () {
                    document.addEventListener('touchstart', function tryPlay() {
                        vid.play();
                        document.removeEventListener('touchstart', tryPlay);
                    }, { once: true });
                });
            }
        }
    }

    function hide() {
        var screen = getEl('turtleBlockScreen');
        if (screen) screen.classList.add('turtle-screen-hidden');
        if (msgTimer)        { clearTimeout(msgTimer);        msgTimer        = null; }
        if (bubbleHideTimer) { clearTimeout(bubbleHideTimer); bubbleHideTimer = null; }
        document.body.style.overflow = '';
    }

    window.TurtleBlock = { show: show, hide: hide };
})();
