    // ============================================
    // CLASSE PRINCIPAL DO APP
    // ============================================
    class EvolutionApp {
        constructor() {
            this.entries = [];
            this.currentUser = null;
            this.currentUserId = null;
            this.currentUserCode = null;
            this.currentFilter = 'pending';
            this.dashboardMode = 'all';
            this.historyMonth = null;
            this.pinValue = '';
            this.deviceId = this.getOrCreateDeviceId();
            this.metaMensal = 0;
            this.metaStartDate = null;
            this.metaGoalReached = false;
            this.expandedHistoryId = null;
            // ID da entrada em edicao
            this.editingEntryId = null;
            // Conjunto de nomes de navio removidos das sugestoes (persistente via safeStorage)
            this.removedNavioSuggestions = new Set();
            // Lista de navios aprendidos (persistente, sobrevive exclusao de registros)
            this.learnedNavios = new Set();
            this.users = {};
            this.taxas = JSON.parse(JSON.stringify(DEFAULT_TAXAS));
            this.isAdmin = false;
            this.isVip = false;
            this.firebaseReady = false;
            this.pendingDeleteId = null;
            this.pendingAction = null;
            this.isLoggingIn = false;
            this.managingUser = null;
            this.pendingUsers = [];
            this.currentMode = 'login';
            this.currentPage = 1;
            this.itemsPerPage = 10;
            this.unsubscribeUsers = null;
            this.unsubscribeEntries = null;
            this.unsubscribePending = null;
            this.pendingHistoryQueue = {};
            this.historySyncTimer = null;
            this.inactivityLimitMs = 40 * 60 * 1000;
            this.presenceSyncIntervalMs = 90 * 1000;
            this.presenceOnlineWindowMs = 5 * 60 * 1000;
            this._lastUserActivityTs = 0;
            this._lastPresenceSyncTs = 0;
            this._lastActivityEventTs = 0;
            this._sessionWatchTimer = null;
            this._activityListenersBound = false;
            this._activityHandler = null;
            this._visibilityHandler = null;
            this._focusHandler = null;
            this._openModalCount = 0;
            this._clickOutsideNavioHandler = null;

            this.init();
        }

        getOrCreateDeviceId() {
            let id = safeStorage.getItem('evo_device_v54');
            if (!id) {
                id = 'V54-' + Math.random().toString(36).substr(2, 9).toUpperCase();
                safeStorage.setItem('evo_device_v54', id);
            }
            return id;
        }

        // Retenta o login anonimo do Firebase com backoff, em vez de desistir
        // silenciosamente na primeira falha (ex: blip de rede) e deixar o app
        // travado em modo offline ate um reload manual.
        _trySignInAnonymously(attempt) {
            if (!auth) return;
            auth.signInAnonymously().catch(() => {
                if (attempt >= 5) return;
                const delay = Math.min(30000, 1000 * Math.pow(2, attempt));
                setTimeout(() => this._trySignInAnonymously(attempt + 1), delay);
            });
        }

        async init() {
            // Inicializar Firebase
            try {
                if (!firebase.apps.length) {
                    firebase.initializeApp(firebaseConfig);
                }
                db = firebase.firestore();
                db.settings({ cacheSizeBytes: firebase.firestore.CACHE_SIZE_UNLIMITED });
                auth = firebase.auth();
                storage = firebase.storage();

                auth.onAuthStateChanged((user) => {
                    if (user) {
                        this.firebaseReady = true;
                        this.loadRates();
                        this.syncUsersFromFirebase();
                        this.loadPendingUsers();
                        this.fetchAdminSettings();
                        // So tenta restaurar sessao se ha sessao pendente E usuario ainda nao logou
                        // (evita re-restaurar sessao apos logout manual)
                        if (this.pendingSessionData && !this.currentUserId) {
                            this.resumeSessionAfterFirebase();
                        }
                    } else {
                        this._trySignInAnonymously(0);
                    }
                });
            } catch (e) {
                console.log('Firebase nao disponivel:', e);
            }

            // Carregar cache de usuarios
            this.loadUsersFromCache();

            // Restaurar REMOTE_ADMIN_PIN do cache local ANTES de checkSession
            // (fetchAdminSettings e async — sem isso o admin perderia sessao no refresh)
            try {
                const cachedPin = safeStorage.getItem('evo_admin_pin_enc');
                if (cachedPin) REMOTE_ADMIN_PIN = atob(cachedPin);
            } catch(e) {}

            // Configurar datas
            const hoje = getCurrentDateStringManaus();
            const calcData = document.getElementById('calcData');
            const relData = document.getElementById('relData');
            if (calcData) calcData.value = hoje;
            if (relData) relData.value = hoje;

            // Configurar dashboard
            const savedMonth = safeStorage.getItem('evo_dashboard_month');
            this.selectedMonth = savedMonth || getCurrentMonthStringManaus();
            const monthInput = document.getElementById('dashboardMonthInput');
            if (monthInput) monthInput.value = this.selectedMonth;

            const savedMode = safeStorage.getItem('evo_dashboard_mode');
            if (savedMode) this.dashboardMode = savedMode;

            // Verificar sessao
            this.checkSession();
            // FIX 6: Verificar expiracao de sessao a cada 5 minutos (evita sessao expirada ativa em background)
            setInterval(() => {
                if (!this.currentUserId) return;
                const _s = safeStorage.getItem('evo_session_v516');
                if (!_s) return;
                try {
                    const _d = decodeSession(_s);
                    if (!_d?.ts || _d.ts <= Date.now() - 86400000) {
                        this.logout();
                        return;
                    }
                    const _lastActivity = Number(_d?.lastActivityTs || _d?.ts || 0);
                    if (_lastActivity && _lastActivity <= Date.now() - (this.inactivityLimitMs || (40 * 60 * 1000))) {
                        this.logout();
                    }
                } catch(e) {}
            }, 5 * 60 * 1000);

            // Verificacao de inatividade ao voltar para o app e feita por
            // bindSessionActivityListeners() (chamado via startSessionWatch apos login).
            // Listener duplicado removido para evitar duplo logout().

            // Restaurar tema salvo
            try {
                const savedTheme = safeStorage.getItem('evo_theme_v516');
                if (savedTheme === 'light') document.body.classList.add('light-mode');
            } catch(e) {}

            // Carregar lista de navios removidos das sugestoes
            try {
                const removed = safeStorage.getItem('evo_removed_navio');
                this.removedNavioSuggestions = new Set(removed ? JSON.parse(removed) : []);
            } catch (err) {
                this.removedNavioSuggestions = new Set();
            }
            // Event listeners para mostrar sugestoes de navio.
            // FIX 8: registro movido para bindNavioOutsideClick() (ui.js), que tambem e
            // chamado em restoreUserSession — logout() remove o listener e ele precisava
            // ser recriado no login seguinte.
            this.bindNavioOutsideClick();
            // Inicializar calendario
            this.syncCalendarMonthWithEntries();
            this.renderCalendar();

            // Event listeners
            window.addEventListener('online', () => {
                this.scheduleHistorySync('online', 300);
            });
            window.addEventListener('offline', () => {
                // Dados locais preservados automaticamente, sem notificar o usuario
            });
            document.getElementById('importInput')?.addEventListener('change', (e) => this.importData(e));
        }
    }

    // ============================================
    // A VIAGEM DO RODAPE (v5.62)
    // A cada login um cargueiro cruza o rodape e vai "entregando" as letras de
    // EVOLUTION V5.64: cada uma acende no instante em que o casco passa por ela.
    // Terminada a travessia o navio some e o brilho vira um vaivem continuo.
    //
    // Tudo e movido por requestAnimationFrame, e nao por @keyframes, porque o
    // Safari do iPhone suspende animacoes CSS no Modo de Pouca Energia — era o
    // que travava o brilho no v5.61. O rAF continua rodando nesse modo (so cai
    // para ~30fps), entao a animacao sobrevive.
    //
    // Ponto de entrada: window.EvoFooterVoyage.play(), chamado por showMainApp().
    // ============================================
    (function footerVoyage() {
        const SAIL_MS   = 7600;   // duracao da travessia (~35px/s: passo de cargueiro)
        const SHIP_W    = 47;     // largura do navio em px (igual a do CSS; altura 22)
        const DROP_X    = 16;     // ponto do casco que "solta" a letra
        const SPARK_MS  = 950;    // tempo que a letra recem-entregue fica acesa
        const IDLE_STEP = 600;    // cadencia do brilho em repouso
        const IDLE_LIT  = 1400;   // tempo aceso no brilho em repouso
        const MAX_PT    = 70;     // teto de particulas vivas (protege celular fraco)

        // Particulas por segundo — e nao por quadro. No Modo de Pouca Energia o
        // rAF cai para ~30fps; contando por quadro a espuma sumiria pela metade.
        // Com o navio mais lento a espuma se concentra num trecho menor, entao as
        // taxas sao mais baixas que numa travessia rapida.
        const RATE_BOW   = 17;    // espuma cortada pela proa
        const RATE_STERN = 9;     // esteira da popa
        const RATE_SMOKE = 5;     // fumaca da chamine

        // Ancoras das particulas, em px, relativas ao canto superior esquerdo do
        // navio. Derivadas do viewBox 64x30 na escala 22/30, mais o top:3px do CSS.
        const BOW    = { x: 38.0, y: 20.6 };  // proa, onde a agua e cortada
        const STERN  = { x: 6.0,  y: 20.6 };  // popa, onde fica a esteira
        const FUNNEL = { x: 5.5,  y: 6.3 };   // topo da chamine

        // Cargueiro visto de lado, proa a direita. Desenhado de tras para frente:
        // conteineres, superestrutura e por fim o casco por cima.
        const SHIP_SVG =
            '<svg viewBox="0 0 64 30" xmlns="http://www.w3.org/2000/svg" fill="currentColor">' +
                '<rect x="26" y="5.5" width="6" height="3.5" opacity=".5"/>' +
                '<rect x="19" y="9" width="6" height="3.5" opacity=".72"/>' +
                '<rect x="26" y="9" width="6" height="3.5" opacity=".5"/>' +
                '<rect x="33" y="9" width="6" height="3.5" opacity=".68"/>' +
                '<rect x="12" y="12.5" width="6" height="4" opacity=".62"/>' +
                '<rect x="19" y="12.5" width="6" height="4" opacity=".85"/>' +
                '<rect x="26" y="12.5" width="6" height="4" opacity=".55"/>' +
                '<rect x="33" y="12.5" width="6" height="4" opacity=".8"/>' +
                '<rect x="40" y="12.5" width="6" height="4" opacity=".6"/>' +
                '<rect x="6" y="4.5" width="3" height="4.5" opacity=".95"/>' +
                '<rect x="3.5" y="9" width="7.5" height="7.5" opacity=".9"/>' +
                '<rect x="50" y="10" width="1.2" height="6.5" opacity=".8"/>' +
                '<path d="M2 16.5 H60 L52 24 H8 Z"/>' +
            '</svg>';

        let brand = null, layer = null, ship = null, letters = [], letterX = [];
        let particles = [], rafId = null, idleTimer = null, idleStart = null;
        let sparkTimers = [], idleTimers = [];
        let elapsed = 0, lastTs = 0, sailing = false, played = false, presenting = false;
        let startX = 0, endX = 0, watchdog = null;
        let accBow = 0, accStern = 0, accSmoke = 0;

        const rand = (a, b) => a + Math.random() * (b - a);
        const reduceMotion = () => {
            try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
            catch (e) { return false; }
        };

        // ---- montagem (uma unica vez) ----
        function ensure() {
            if (brand) return true;
            brand = document.getElementById('footerBrand');
            if (!brand) return false;
            letters = Array.prototype.slice.call(brand.querySelectorAll('.ltr'));
            if (!letters.length) { brand = null; return false; }
            layer = document.createElement('span');
            layer.className = 'brand-voyage';
            layer.setAttribute('aria-hidden', 'true');
            ship = document.createElement('span');
            ship.className = 'ship';
            ship.innerHTML = SHIP_SVG;
            layer.appendChild(ship);
            brand.insertBefore(layer, brand.firstChild);
            return true;
        }

        // ---- particulas ----
        function spawn(kind, x, y, opt) {
            if (particles.length >= MAX_PT) return;
            const el = document.createElement('span');
            el.className = 'pt ' + kind;
            layer.appendChild(el);
            particles.push({
                el, x, y,
                vx: opt.vx, vy: opt.vy,
                size: opt.size, grow: opt.grow || 0,
                alpha: opt.alpha, life: 0, max: opt.max
            });
        }

        function stepParticles(dt) {
            for (let i = particles.length - 1; i >= 0; i--) {
                const p = particles[i];
                p.life += dt;
                if (p.life >= p.max) {
                    if (p.el.parentNode) p.el.parentNode.removeChild(p.el);
                    particles.splice(i, 1);
                    continue;
                }
                p.x += p.vx * dt;
                p.y += p.vy * dt;
                const k = p.life / p.max;             // 0 -> 1 ao longo da vida
                const s = p.size + p.grow * k;
                p.el.style.width = s + 'px';
                p.el.style.height = s + 'px';
                p.el.style.opacity = String(p.alpha * (1 - k * k));
                p.el.style.transform = 'translate(' + (p.x - s / 2) + 'px,' + (p.y - s / 2) + 'px)';
            }
        }

        function clearParticles() {
            particles.forEach(p => { if (p.el.parentNode) p.el.parentNode.removeChild(p.el); });
            particles = [];
        }

        // ---- letras ----
        // O timer que apaga a faisca vai para sparkTimers, e nao para idleTimers:
        // stopIdle() limpa os do repouso, e antes cancelava por engano os das
        // ultimas letras entregues — a versao "V5.64" ficava acesa ate a varredura
        // de repouso passar por ela, muito depois das demais.
        function ignite(el) {
            el.classList.add('revealed', 'lit');
            sparkTimers.push(setTimeout(() => el.classList.remove('lit'), SPARK_MS));
        }

        function clearSparks() {
            sparkTimers.forEach(clearTimeout);
            sparkTimers = [];
        }

        // Faisquinhas que sobem da letra no momento em que ela e entregue.
        function sparkBurst(x) {
            for (let i = 0; i < 4; i++) {
                spawn('spark', x + rand(-2, 2), 15, {
                    vx: rand(-8, 8), vy: rand(-26, -12),
                    size: rand(1, 1.8), grow: -0.6, alpha: 0.95, max: rand(0.45, 0.75)
                });
            }
        }

        function stopIdle() {
            if (idleStart) { clearTimeout(idleStart); idleStart = null; }
            if (idleTimer) { clearInterval(idleTimer); idleTimer = null; }
            idleTimers.forEach(clearTimeout);
            idleTimers = [];
        }

        // Brilho de repouso: uma letra de cada vez, em vaivem continuo.
        function startIdle() {
            stopIdle();
            let i = 0;
            idleTimer = setInterval(() => {
                const el = letters[i % letters.length];
                i++;
                el.classList.add('lit');
                idleTimers.push(setTimeout(() => el.classList.remove('lit'), IDLE_LIT));
                if (idleTimers.length > 60) idleTimers = idleTimers.slice(-30);
            }, IDLE_STEP);
        }

        // ---- travessia ----
        function frame(ts) {
            if (!lastTs) lastTs = ts;
            // dt limitado a 64ms: se o app ficou em segundo plano, a viagem
            // continua de onde parou em vez de saltar direto para o fim.
            const dt = Math.min(64, ts - lastTs) / 1000;
            lastTs = ts;

            if (sailing) {
                elapsed += dt * 1000;
                const p = Math.min(1, elapsed / SAIL_MS);
                const shipX = startX + p * (endX - startX);
                ship.style.transform = 'translateX(' + shipX + 'px)';

                // Entrega das letras: a que estiver atras do ponto DROP_X acende.
                const dropX = shipX + DROP_X;
                for (let i = 0; i < letters.length; i++) {
                    if (!letters[i].classList.contains('revealed') && dropX >= letterX[i]) {
                        ignite(letters[i]);
                        sparkBurst(letterX[i]);
                    }
                }

                // Espuma da proa: agua branca sendo aberta e ficando para tras.
                accBow += dt * RATE_BOW;
                while (accBow >= 1) {
                    accBow -= 1;
                    spawn('foam', shipX + BOW.x + rand(-2, 3), BOW.y + rand(-1, 1.5), {
                        vx: rand(-22, 4), vy: rand(2, 11),
                        size: rand(1.2, 2.6), grow: 1.6, alpha: rand(0.55, 0.95), max: rand(0.45, 0.8)
                    });
                }
                // Esteira da popa: bolhas menores, mais lentas e mais duradouras.
                accStern += dt * RATE_STERN;
                while (accStern >= 1) {
                    accStern -= 1;
                    spawn('foam', shipX + STERN.x + rand(-3, 3), STERN.y + rand(-1, 1), {
                        vx: rand(-14, 2), vy: rand(1, 6),
                        size: rand(1, 2), grow: 1.2, alpha: rand(0.35, 0.7), max: rand(0.55, 0.95)
                    });
                }
                // Fumaca da chamine, subindo e ficando para tras.
                accSmoke += dt * RATE_SMOKE;
                while (accSmoke >= 1) {
                    accSmoke -= 1;
                    // Subida limitada de proposito: mais alto que isso e a fumaca
                    // ultrapassa o padding do rodape e invade o conteudo acima.
                    spawn('smoke', shipX + FUNNEL.x + rand(-1, 1), FUNNEL.y, {
                        vx: rand(-13, -3), vy: rand(-13, -5),
                        size: rand(1.4, 2.4), grow: 2.6, alpha: rand(0.25, 0.5), max: rand(0.85, 1.2)
                    });
                }

                if (p >= 1) finishSail();
            }

            stepParticles(dt);

            if (sailing || particles.length) {
                rafId = requestAnimationFrame(frame);
            } else {
                rafId = null;
            }
        }

        function finishSail() {
            if (watchdog) { clearTimeout(watchdog); watchdog = null; }
            sailing = false;
            ship.style.opacity = '0';
            // Garante que nenhuma letra ficou para tras (tela muito estreita, etc).
            letters.forEach(el => el.classList.add('revealed'));
            brand.classList.remove('voyage');
            // Espera a ultima faisca apagar antes de comecar a varredura de repouso.
            // Sem essa pausa o vaivem comeca na letra 1 enquanto o fim da palavra
            // ainda esta aceso, e o brilho parece embolado.
            if (idleStart) clearTimeout(idleStart);
            idleStart = setTimeout(startIdle, SPARK_MS + 400);
        }

        // Enquanto .voyage esta ativa as letras ficam invisiveis — se por qualquer
        // motivo o rAF nao rodar (aba nunca pintada, WebView exotica, extensao que
        // bloqueia animacoes), o rodape ficaria em branco. Este cao de guarda usa
        // setTimeout, que e independente do rAF, e encerra a viagem na marra.
        function armWatchdog() {
            if (watchdog) clearTimeout(watchdog);
            watchdog = setTimeout(() => {
                watchdog = null;
                if (!sailing) return;
                clearParticles();
                finishSail();
            }, SAIL_MS + 2000);
        }

        // Sem o navio (Reduzir Movimento ligado): as letras so aparecem em
        // sequencia, uma de cada vez, e o brilho de repouso assume em seguida.
        function revealOnly() {
            letters.forEach((el, i) => {
                sparkTimers.push(setTimeout(() => ignite(el), 200 * i));
            });
            sparkTimers.push(setTimeout(() => {
                brand.classList.remove('voyage');
                startIdle();
            }, 200 * letters.length + SPARK_MS + 400));
        }

        // ---- entrada publica ----
        function play(attempt) {
            if (!ensure()) return;

            stopIdle();
            if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
            if (watchdog) { clearTimeout(watchdog); watchdog = null; }
            clearParticles();
            sailing = false;
            ship.style.opacity = '0';
            letters.forEach(el => el.classList.remove('lit', 'revealed'));
            brand.classList.add('voyage');

            // O rodape pode ainda nao ter largura no instante do login (mainApp
            // recem-exibido). Sem largura nao da para posicionar nada — tenta de novo.
            const rect = brand.getBoundingClientRect();
            if (rect.width <= 0) {
                const n = (attempt || 0) + 1;
                if (n <= 10) setTimeout(() => play(n), 300);
                else { brand.classList.remove('voyage'); startIdle(); }
                return;
            }
            played = true;

            if (reduceMotion()) { revealOnly(); return; }

            letterX = letters.map(el => {
                const r = el.getBoundingClientRect();
                return (r.left - rect.left) + r.width / 2;
            });

            // A travessia cobre so o trecho do texto (a .footer-brand ocupa a
            // largura toda do rodape, mas o nome fica centralizado). Assim os
            // 4,4s sao gastos entregando letras, e nao cruzando espaco vazio.
            const firstR = letters[0].getBoundingClientRect();
            const lastR = letters[letters.length - 1].getBoundingClientRect();
            startX = (firstR.left - rect.left) - SHIP_W - 14;
            endX = (lastR.right - rect.left) + 22;
            ship.style.transform = 'translateX(' + startX + 'px)';

            elapsed = 0;
            lastTs = 0;
            accBow = accStern = accSmoke = 0;
            sailing = true;
            ship.style.opacity = '1';
            armWatchdog();
            rafId = requestAnimationFrame(frame);
        }

        // ---- apresentacao no login (v5.64) ----
        // O app abre normalmente, no topo. A v5.63 rolava a tela ate o rodape
        // para forcar o usuario a ver a viagem, mas so ficava bom em tela cheia;
        // essa rolagem foi removida.
        //
        // O que ficou: a viagem espera qualquer modal de abertura sair da frente.
        // O resumo de pendencias abre uma vez por periodo do dia e cobre a tela
        // inteira — animar atras dele desperdicaria a travessia.

        // Quem pode estar cobrindo a tela logo apos o login.
        const BLOCKERS = '.modal-overlay.active, #pendingSummaryOverlay:not(.hidden)';

        function blocked() {
            return !!document.querySelector(BLOCKERS);
        }

        function presentOnLogin(tries) {
            if (!ensure()) return;
            presenting = true;

            if (blocked()) {
                if ((tries || 0) < 600) setTimeout(() => presentOnLogin((tries || 0) + 1), 300);
                else presenting = false;
                return;
            }

            // Pequena folga depois que o modal sai, para a viagem nao comecar
            // junto com a animacao de fechamento dele.
            setTimeout(() => { presenting = false; play(0); }, 350);
        }

        window.EvoFooterVoyage = {
            play: () => play(0),
            presentOnLogin: () => { if (!presenting) presentOnLogin(0); }
        };

        // Rede de seguranca: se por algum caminho de restauracao de sessao o
        // showMainApp nao disparar a apresentacao, ela comeca sozinha assim que
        // o rodape ficar visivel.
        (function autoStart(tries) {
            if (played || presenting) return;
            const el = document.getElementById('footerBrand');
            if (el && el.offsetParent) { presentOnLogin(0); return; }
            if ((tries || 0) < 40) setTimeout(() => autoStart((tries || 0) + 1), 700);
        })(0);
    })();
