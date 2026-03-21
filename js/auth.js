        EvolutionApp.prototype.loadUsersFromCache = function() {
            try {
                const cached = safeStorage.getItem('evo_users_cache_v516');
                if (cached) this.users = JSON.parse(cached);
            } catch (e) {}
        };

        EvolutionApp.prototype.saveUsersToCache = function() {
            safeStorage.setItem('evo_users_cache_v516', JSON.stringify(this.users));
        };

        EvolutionApp.prototype.getInactivityLimitMs = function() {
            return Number(this.inactivityLimitMs) || (40 * 60 * 1000);
        };

        EvolutionApp.prototype.updateSessionActivityTimestamp = function(ts = Date.now()) {
            const sessionRaw = safeStorage.getItem('evo_session_v516');
            if (!sessionRaw) return;
            try {
                const sessionData = decodeSession(sessionRaw);
                if (!sessionData) return;
                sessionData.lastActivityTs = ts;
                safeStorage.setItem('evo_session_v516', encodeSession(sessionData));
            } catch (e) {}
        };

        EvolutionApp.prototype.syncCurrentUserLastSeen = function(force = false, source = 'activity') {
            if (!this.currentUserId) return;
            const nowTs = Date.now();
            const minInterval = Number(this.presenceSyncIntervalMs) || (90 * 1000);
            if (!force && nowTs - (this._lastPresenceSyncTs || 0) < minInterval) return;
            this._lastPresenceSyncTs = nowTs;
            const seenIso = new Date(nowTs).toISOString();

            if (this.users[this.currentUserId]) {
                this.users[this.currentUserId].lastSeenAt = seenIso;
                this.saveUsersToCache();
            }

            if (db) {
                db.collection('users').doc(this.currentUserId).set({
                    lastSeenAt: seenIso,
                    lastSeenSource: source
                }, { merge: true }).catch(() => {});
            }
        };

        EvolutionApp.prototype.markUserActivity = function(source = 'interaction', forcePresenceSync = false) {
            if (!this.currentUserId) return;
            const nowTs = Date.now();
            if (!forcePresenceSync && source === 'interaction' && nowTs - (this._lastActivityEventTs || 0) < 10000) return;
            this._lastActivityEventTs = nowTs;
            this._lastUserActivityTs = nowTs;
            this.updateSessionActivityTimestamp(nowTs);
            this.syncCurrentUserLastSeen(forcePresenceSync, source);
        };

        EvolutionApp.prototype.bindSessionActivityListeners = function() {
            if (this._activityListenersBound) return;
            this._activityHandler = () => this.markUserActivity('interaction');
            this._visibilityHandler = () => {
                if (document.visibilityState === 'visible') this.markUserActivity('visible', true);
            };
            this._focusHandler = () => this.markUserActivity('focus', true);

            ['pointerdown', 'keydown', 'touchstart', 'scroll'].forEach((evt) => {
                document.addEventListener(evt, this._activityHandler, { passive: true });
            });
            document.addEventListener('visibilitychange', this._visibilityHandler);
            window.addEventListener('focus', this._focusHandler);
            this._activityListenersBound = true;
        };

        EvolutionApp.prototype.stopSessionWatch = function() {
            clearInterval(this._sessionWatchTimer);
            this._sessionWatchTimer = null;
            if (!this._activityListenersBound) return;

            ['pointerdown', 'keydown', 'touchstart', 'scroll'].forEach((evt) => {
                document.removeEventListener(evt, this._activityHandler);
            });
            document.removeEventListener('visibilitychange', this._visibilityHandler);
            window.removeEventListener('focus', this._focusHandler);

            this._activityListenersBound = false;
            this._activityHandler = null;
            this._visibilityHandler = null;
            this._focusHandler = null;
        };

        EvolutionApp.prototype.startSessionWatch = function() {
            if (!this.currentUserId) return;
            this.stopSessionWatch();
            this.bindSessionActivityListeners();
            this._lastUserActivityTs = Date.now();
            this.updateSessionActivityTimestamp(this._lastUserActivityTs);
            this.syncCurrentUserLastSeen(true, 'session-start');

            this._sessionWatchTimer = setInterval(() => {
                if (!this.currentUserId) return;
                const idleMs = Date.now() - (this._lastUserActivityTs || Date.now());
                if (idleMs >= this.getInactivityLimitMs()) {
                    this.logout();
                    return;
                }
                this.syncCurrentUserLastSeen(false, 'heartbeat');
            }, 60 * 1000);
        };

        // ============================================
        // LOGIN E AUTENTICACAO
        // ============================================
        EvolutionApp.prototype.setLoginMode = function(mode) {
            this.currentMode = mode;
            document.getElementById('btnModeLogin').classList.toggle('active', mode === 'login');
            document.getElementById('btnModeRegister').classList.toggle('active', mode === 'register');
            document.getElementById('loginSection').classList.toggle('hidden', mode !== 'login');
            document.getElementById('registerSection').classList.toggle('active', mode === 'register');
            if (mode === 'login') {
                this.pinValue = '';
                this.updatePinDisplay();
            }
        };

        EvolutionApp.prototype.backToLogin = function() {
            this.setLoginMode('login');
        };

        EvolutionApp.prototype.addDigit = function(digit) {
            if (this.pinValue.length < 6 && this.currentMode === 'login') {
                this.pinValue += digit;
                this.updatePinDisplay();
                // Auto-login apenas ao completar 6 digitos (seguro para PINs de 4-6 digitos:
                // usuarios com PIN < 6 usam o botao de acao → abaixo para confirmar)
                if (this.pinValue.length === 6) {
                    setTimeout(() => this.login(), 100);
                }
            }
        };

        EvolutionApp.prototype.removeDigit = function() {
            if (this.currentMode === 'login') {
                this.pinValue = this.pinValue.slice(0, -1);
                this.updatePinDisplay();
            }
        };

        EvolutionApp.prototype.updatePinDisplay = function() {
            const dots = document.querySelectorAll('.pin-dot');
            dots.forEach((dot, i) => {
                dot.classList.toggle('active', i < this.pinValue.length);
                dot.classList.remove('error');
            });
        };

        EvolutionApp.prototype.showPinError = function(msg) {
            const dots = document.querySelectorAll('.pin-dot');
            dots.forEach(dot => {
                dot.classList.remove('active');
                dot.classList.add('error');
            });
            setTimeout(() => {
                this.pinValue = '';
                this.updatePinDisplay();
            }, 500);
            this.showToast(msg || 'PIN incorreto ou usuario nao aprovado', 'error');
        };

        EvolutionApp.prototype.login = async function() {
            if (this.isLoggingIn) return;
            this.isLoggingIn = true;

            try {
            const enteredPin = this.pinValue;

            // Verificar se e admin
            if (REMOTE_ADMIN_PIN && enteredPin === REMOTE_ADMIN_PIN) {
                const adminId = `${enteredPin}-FELIPE_PRADO`;
                const adminUser = {
                    name: 'FELIPE PRADO',
                    code: enteredPin,
                    docId: adminId,
                    blocked: false,
                    vip: true,
                    isAdmin: true
                };
                this.users[adminId] = adminUser;
                this.saveUsersToCache();
                this.restoreUserSession(adminUser, { user: adminUser.name, code: adminUser.code, docId: adminId });
                return;
            }

            // Buscar usuario pelo PIN
            let foundUser = null;

            // Verificar no cache local
            for (const [id, user] of Object.entries(this.users)) {
                if (user.code === enteredPin) {
                    foundUser = { ...user, docId: id };
                    break;
                }
            }

            // Se nao encontrou localmente, buscar no Firebase
            if (!foundUser && this.firebaseReady && db) {
                try {
                    const q = await db.collection('users').where('code', '==', enteredPin).get();
                    if (!q.empty) {
                        const doc = q.docs[0];
                        foundUser = { ...doc.data(), docId: doc.id };
                        this.users[doc.id] = foundUser;
                        this.saveUsersToCache();
                    }
                } catch (e) {}
            }

            // Verificar se esta pendente
            if (!foundUser) {
                const pending = this.pendingUsers.find(p => p.code === enteredPin);
                if (pending) {
                    this.showToast('Seu cadastro esta aguardando aprovacao', 'warning');
                } else {
                    this.showPinError('PIN nao encontrado');
                }
                return;
            }

            // Verificar se esta bloqueado
            if (foundUser.blocked && !foundUser.isAdmin) {
                this.showToast('Usuario bloqueado', 'error');
                return;
            }

            // Login bem-sucedido
            // Garantir que o flag isAdmin está correto (admin identificado pelo PIN)
            if (REMOTE_ADMIN_PIN && foundUser.code === REMOTE_ADMIN_PIN) {
                foundUser.isAdmin = true;
                foundUser.vip = true;
            }
            this.restoreUserSession(foundUser, {
                user: foundUser.name,
                code: foundUser.code,
                docId: foundUser.docId
            });

            // Registrar ultimo login
            const loginTs = new Date().toISOString();
            if (this.users[foundUser.docId]) {
                this.users[foundUser.docId].lastLoginAt = loginTs;
                this.saveUsersToCache();
            }
            if (db) {
                try {
                    await db.collection('users').doc(foundUser.docId).set({ lastLoginAt: loginTs }, { merge: true });
                } catch(e) {}
            }

            // Salvar sessao (inclui flag isAdmin para restaurar corretamente no refresh)
            safeStorage.setItem('evo_session_v516', encodeSession({
                user: this.currentUser,
                code: this.currentUserCode,
                docId: this.currentUserId,
                isAdmin: this.isAdmin || false,
                ts: Date.now(),
                lastActivityTs: Date.now()
            }));

            this.pinValue = '';

            } catch(loginErr) {
                console.error('Erro inesperado no login:', loginErr);
                this.showPinError('Erro ao autenticar. Tente novamente.');
            } finally {
                // FIX 1: isLoggingIn SEMPRE resetado, mesmo em caso de excecao
                this.isLoggingIn = false;
            }
        };

        EvolutionApp.prototype.submitRegistration = async function() {
            const name = document.getElementById('regName').value.toUpperCase().trim();
            const code = document.getElementById('regCode').value.trim();
            const codeConfirm = document.getElementById('regCodeConfirm').value.trim();

            if (!name || name.length < 3) {
                this.showToast('Digite um nome valido (minimo 3 caracteres)', 'error');
                return;
            }
            if (!code || !/^\d{4,6}$/.test(code)) {
                this.showToast('A senha deve ter de 4 a 6 digitos numericos', 'error');
                return;
            }
            if (code !== codeConfirm) {
                this.showToast('As senhas nao coincidem', 'error');
                return;
            }

            // Verificar se PIN ja existe
            const existing = Object.values(this.users).find(u => u.code === code);
            if (existing) {
                this.showToast('Este PIN ja esta em uso', 'error');
                return;
            }

            const uniqueId = `${code}-${name.replace(/\s+/g, '_')}`;
            const registration = {
                name: name,
                code: code,
                requestedAt: new Date().toISOString(),
                deviceId: this.deviceId,
                status: 'pending',
                docId: uniqueId
            };

            try {
                if (db) await db.collection('pendingUsers').doc(uniqueId).set(registration);
                this.savePendingUserLocally(registration);
                document.getElementById('registerForm').classList.add('hidden');
                document.getElementById('registerStatus').classList.remove('hidden');
                this.showToast('Cadastro enviado para aprovacao!', 'success');
            } catch (error) {
                this.savePendingUserLocally(registration);
                document.getElementById('registerForm').classList.add('hidden');
                document.getElementById('registerStatus').classList.remove('hidden');
            }
        };

        EvolutionApp.prototype.savePendingUserLocally = function(registration) {
            let pending = JSON.parse(safeStorage.getItem('evo_pending_users') || '[]');
            pending = pending.filter(p => p.code !== registration.code);
            pending.push(registration);
            safeStorage.setItem('evo_pending_users', JSON.stringify(pending));
        };


        EvolutionApp.prototype.getLocalPendingUsers = function() {
            try {
                const raw = safeStorage.getItem('evo_pending_users');
                const arr = raw ? JSON.parse(raw) : [];
                return Array.isArray(arr) ? arr : [];
            } catch (e) {
                return [];
            }
        };

        EvolutionApp.prototype.setLocalPendingUsers = function(list) {
            try {
                safeStorage.setItem('evo_pending_users', JSON.stringify(Array.isArray(list) ? list : []));
            } catch (e) {}
        };

        EvolutionApp.prototype.removeLocalPendingByDocId = function(docId) {
            const list = this.getLocalPendingUsers();
            const id = String(docId || '').trim();
            const next = (Array.isArray(list) ? list : []).filter(p => {
                const pid = String(p?.docId || '').trim();
                const pcode = String(p?.code || '').trim();
                // remove se bater pelo docId OU pelo code
                return !(pid && pid === id) && !(pcode && pcode === id);
            });
            this.setLocalPendingUsers(next);
        };

        // ============================================
        // SESSAO E RESTAURACAO
        // ============================================
        EvolutionApp.prototype.checkSession = function() {
            const s = safeStorage.getItem('evo_session_v516');
            if (!s) return;
            try {
                const d = decodeSession(s);
                if (!d?.ts || d.ts <= Date.now() - 86400000) {
                    safeStorage.removeItem('evo_session_v516');
                    // FIX 5: Avisa o usuario que a sessao expirou (evita confusao ao cair na tela de PIN)
                    setTimeout(() => {
                        const t = document.getElementById('toastContainer');
                        if (t) {
                            const d2 = document.createElement('div');
                            d2.className = 'toast';
                            d2.style.borderLeft = '3px solid var(--info)';
                            d2.innerHTML = '<span style="color:var(--primary);font-weight:800;">•</span> Sessao expirada. Faca login novamente.';
                            t.appendChild(d2);
                            setTimeout(() => { try { d2.remove(); } catch(_) {} }, 4000);
                        }
                    }, 800);
                    return;
                }
                const inactivityLimit = this.getInactivityLimitMs();
                const lastActivityTs = Number(d.lastActivityTs || d.ts || 0);
                if (!lastActivityTs || lastActivityTs <= Date.now() - inactivityLimit) {
                    safeStorage.removeItem('evo_session_v516');
                    setTimeout(() => {
                        const t = document.getElementById('toastContainer');
                        if (t) {
                            const d3 = document.createElement('div');
                            d3.className = 'toast';
                            d3.style.borderLeft = '3px solid var(--warning)';
                            d3.innerHTML = '<span style="color:var(--warning);font-weight:800;">•</span> Sessao encerrada por inatividade (40 min).';
                            t.appendChild(d3);
                            setTimeout(() => { try { d3.remove(); } catch(_) {} }, 4000);
                        }
                    }, 800);
                    return;
                }
                this.pendingSessionData = d;

                // 1. Verifica se é admin pelo PIN remoto (REMOTE_ADMIN_PIN ja foi carregado do cache local)
                if (REMOTE_ADMIN_PIN && d.code === REMOTE_ADMIN_PIN) {
                    const adminDocId = d.docId || `${d.code}-FELIPE_PRADO`;
                    const adminUser = {
                        name: d.user || 'FELIPE PRADO',
                        code: d.code,
                        docId: adminDocId,
                        blocked: false,
                        vip: true,
                        isAdmin: true
                    };
                    this.users[adminDocId] = adminUser;
                    this.saveUsersToCache();
                    this.restoreUserSession(adminUser, { ...d, docId: adminDocId });
                    return;
                }

                // 2. Verifica cache local — tambem aceita usuarios marcados como admin no cache
                const cachedUser = this.users[d.docId];
                // FIX 8: Verifica bloqueio do cache local para impedir acesso offline de usuario bloqueado
                if (cachedUser && cachedUser.blocked) {
                    safeStorage.removeItem('evo_session_v516');
                    return;
                }
                if (cachedUser && !cachedUser.blocked) {
                    this.restoreUserSession({ ...cachedUser, docId: cachedUser.docId || d.docId }, d);
                    return;
                }

                // 3. Aguarda Firebase (fetchAdminSettings vai chamar resumeSessionAfterFirebase novamente)
                if (this.firebaseReady) {
                    this.resumeSessionAfterFirebase();
                }
                // Senao, auth.onAuthStateChanged vai disparar resumeSessionAfterFirebase quando pronto
            } catch (e) {
                safeStorage.removeItem('evo_session_v516');
            }
        };

        EvolutionApp.prototype.resumeSessionAfterFirebase = async function() {
            const d = this.pendingSessionData;
            if (!d || this.currentUserId) return;

            // Verifica PIN de admin antes de ir ao Firestore
            if (REMOTE_ADMIN_PIN && d.code === REMOTE_ADMIN_PIN) {
                const adminDocId = d.docId || `${d.code}-FELIPE_PRADO`;
                const adminUser = {
                    name: d.user || 'FELIPE PRADO',
                    code: d.code,
                    docId: adminDocId,
                    blocked: false,
                    vip: true,
                    isAdmin: true
                };
                this.users[adminDocId] = adminUser;
                this.saveUsersToCache();
                this.restoreUserSession(adminUser, { ...d, docId: adminDocId });
                return;
            }

            if (!db) return;
            try {
                let foundUser = null;
                if (d.docId) {
                    const doc = await db.collection('users').doc(d.docId).get();
                    if (doc.exists) foundUser = { ...doc.data(), docId: doc.id };
                }
                if (!foundUser && d.code) {
                    const q = await db.collection('users').where('code', '==', d.code).limit(1).get();
                    if (!q.empty) {
                        const doc = q.docs[0];
                        foundUser = { ...doc.data(), docId: doc.id };
                    }
                }
                if (foundUser && !foundUser.blocked) {
                    this.users[foundUser.docId] = foundUser;
                    this.saveUsersToCache();
                    this.restoreUserSession(foundUser, { ...d, docId: foundUser.docId });
                }
            } catch (e) {
                console.error('Falha ao restaurar sessao no Firebase:', e);
            }
        };

        EvolutionApp.prototype.restoreUserSession = function(userData, sessionData) {
            this.currentUser = sessionData.user;
            this.currentUserCode = sessionData.code;
            this.currentUserId = userData.docId || sessionData.docId;
            this.isAdmin = userData.isAdmin || false;
            this.pendingSessionData = { ...sessionData, docId: this.currentUserId };

            // Verificar VIP
            const now = new Date();
            const trialActive = userData.vipTrialUntil && new Date(userData.vipTrialUntil) > now;
            const paidActive = userData.vipUntil && new Date(userData.vipUntil) > now;
            this.isVip = userData.vip || trialActive || paidActive || this.isAdmin;

            // Salvar sessao (garante que TODOS os caminhos de login persistem a sessao,
            // incluindo o caminho rapido do admin que retorna cedo antes do save no login())
            const nowTs = Date.now();
            safeStorage.setItem('evo_session_v516', encodeSession({
                user: this.currentUser,
                code: this.currentUserCode,
                docId: this.currentUserId,
                isAdmin: this.isAdmin || false,
                ts: sessionData?.ts || nowTs,
                lastActivityTs: nowTs
            }));
            this._lastUserActivityTs = nowTs;

            this.loadHistoryQueue();

            // Carregar dados locais
            this.loadFromLocalStorage();
            this.migrateOldEntries();

            // Restaurar mes do calendario do Firestore se localStorage estiver vazio
            const savedCalMonth = safeStorage.getItem('evo_calendar_month');
            if (!savedCalMonth && userData.calendarMonth) {
                safeStorage.setItem('evo_calendar_month', userData.calendarMonth);
            }

            this.syncCalendarMonthWithEntries(true);

            // Verificar se ha comando de logout remoto pendente
            try {
                const cachedForceTs = safeStorage.getItem('evo_force_logout_before');
                if (cachedForceTs) this._checkForceLogout(Number(cachedForceTs));
            } catch (_) {}

            // Mostrar app
            this.showMainApp();
            this.startSessionWatch();
            this.setDashboardMode(this.dashboardMode, false);
            this.restoreHistoryPrefs();
            this.checkVipNotification(userData);
            this.renderCalendar();

            // Setup listeners
            setTimeout(() => {
                if (this.isAdmin || this.isVip) {
                    this.setupEntriesListener(this.currentUserId);
                    this.scheduleHistorySync('session-restore', 800);
                } else if (this.unsubscribeEntries) {
                    this.unsubscribeEntries();
                    this.unsubscribeEntries = null;
                }
                if (this.isAdmin) {
                    this.loadPendingUsers();
                    this.renderUserList();
                    this.renderAdminRates();
                }
            }, 100);
        };

        // ============================================
        // FIREBASE READY (evita aprovar/rejeitar só local)
        // ============================================
        EvolutionApp.prototype.ensureFirebaseReady = async function(maxWaitMs = 9000) {
            // Garante que o app está autenticado (anonymous) antes de operações críticas
            if (!auth || !db) throw new Error('Firebase nao inicializado');

            // Se já está pronto, ok
            if (this.firebaseReady && auth.currentUser) return true;

            // Tentar iniciar anonymous (sem explodir)
            try {
                if (!auth.currentUser) {
                    await auth.signInAnonymously();
                }
            } catch (e) {
                // continua tentando aguardar abaixo
            }

            const start = Date.now();
            while (Date.now() - start < maxWaitMs) {
                if (this.firebaseReady && auth.currentUser) return true;
                await new Promise(r => setTimeout(r, 150));
            }
            throw new Error('Firebase nao ficou pronto a tempo');
        };

        // ============================================
        // VIP UI (tempo restante + origem)
        // ============================================
        EvolutionApp.prototype.getVipInfo = function(userData) {
            const now = new Date();
            const info = {
                active: false,
                kind: null, // 'paid' | 'gift' | 'trial' | null
                until: null,
                daysLeft: null,
                label: ''
            };

            if (!userData) return info;

            // Permanente
            if (userData.vip === true) {
                info.active = true;
                info.kind = userData.vipType || 'paid';
                info.label = `VIP permanente • ${info.kind === 'gift' ? 'Brinde' : (info.kind === 'trial' ? 'Teste' : 'Comprado')}`;
                return info;
            }

            // Trial tem prioridade se existir e estiver ativo
            if (userData.vipTrialUntil) {
                const until = new Date(userData.vipTrialUntil);
                if (!isNaN(until) && until > now) {
                    info.active = true;
                    info.kind = 'trial';
                    info.until = until;
                    info.daysLeft = Math.ceil((until - now) / (1000 * 60 * 60 * 24));
                    info.label = `VIP (Teste) • ${info.daysLeft} dia${info.daysLeft !== 1 ? 's' : ''} restantes`;
                    return info;
                }
            }

            // VIP por data (pago/brinde)
            if (userData.vipUntil) {
                const until = new Date(userData.vipUntil);
                if (!isNaN(until) && until > now) {
                    info.active = true;
                    info.kind = userData.vipType || 'paid';
                    info.until = until;
                    info.daysLeft = Math.ceil((until - now) / (1000 * 60 * 60 * 24));
                    const origem = info.kind === 'gift' ? 'Brinde' : 'Comprado';
                    info.label = `VIP (${origem}) • ${info.daysLeft} dia${info.daysLeft !== 1 ? 's' : ''} restantes`;
                    return info;
                }
            }

            return info;
        };

        EvolutionApp.prototype.updateVipUI = function() {
            const user = this.users[this.currentUserId] || {};
            const vipInfo = this.getVipInfo(user);

            // Badge na barra
            const vipBadge = document.getElementById('vipBadge');
            if (vipBadge && !this.isAdmin) {
                if (vipInfo.active) {
                    vipBadge.textContent = 'VIP';
                    vipBadge.className = 'vip-badge';
                    vipBadge.classList.remove('hidden');
                } else {
                    vipBadge.classList.add('hidden');
                }
            }

            // Info no modal de perfil
            const box = document.getElementById('profileVipInfo');
            if (box) {
                if (this.isAdmin) {
                    box.textContent = 'Conta Administrador';
                    box.classList.remove('hidden');
                } else if (vipInfo.active) {
                    // Mostrar vencimento quando existir
                    let extra = '';
                    if (vipInfo.until) {
                        const dd = String(vipInfo.until.getDate()).padStart(2, '0');
                        const mm = String(vipInfo.until.getMonth() + 1).padStart(2, '0');
                        const yy = vipInfo.until.getFullYear();
                        extra = ` • vence em ${dd}/${mm}/${yy}`;
                    }
                    box.textContent = vipInfo.label + extra;
                    box.classList.remove('hidden');
                } else {
                    box.classList.add('hidden');
                    box.textContent = '';
                }
            }
        };
