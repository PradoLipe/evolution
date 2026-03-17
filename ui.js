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
            this.selectedMonth = null;
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
                        auth.signInAnonymously().catch(() => {});
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
                        this.showToast('Sessao expirada. Faca login novamente.', 'warning');
                        this.logout();
                    }
                } catch(e) {}
            }, 5 * 60 * 1000);

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
            // Event listeners para mostrar sugestoes de navio
            document.addEventListener('click', (event) => {
                if (!event.target.closest('.navio-suggestions')) {
                    this.hideNavioSuggestions('calcNavio');
                    this.hideNavioSuggestions('relNavio');
                }
            });
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
