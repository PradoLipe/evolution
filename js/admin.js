        // ============================================
        // FIREBASE - SYNC
        // ============================================
        EvolutionApp.prototype.syncUsersFromFirebase = async function() {
            if (!db) return;

            if (this.unsubscribeUsers) this.unsubscribeUsers();

            // FIX 22: listener com tratamento robusto; admin precisa de todos os usuarios
            this.unsubscribeUsers = db.collection('users').onSnapshot((snapshot) => {
                try {
                    snapshot.docChanges().forEach((change) => {
                        const data = change.doc.data();
                        data.docId = change.doc.id;
                        if (change.type === 'removed') {
                            delete this.users[change.doc.id];
                        } else {
                            if (this.currentUserId && change.doc.id === this.currentUserId) {
                                this.handleCurrentUserRemoteUpdate(data);
                            } else {
                                this.users[change.doc.id] = data;
                            }
                        }
                    });
                    this.saveUsersToCache();
                    if (this.isAdmin) this.renderUserList();
                } catch(snapshotErr) {
                    console.error('Erro processando snapshot de usuarios:', snapshotErr);
                }
            }, (error) => {
                console.error('Erro sync usuarios:', error);
            });
        };

        EvolutionApp.prototype.loadPendingUsers = async function() {
            // Sempre carregar pendencias locais (fallback quando Firestore falha)
            const localPending = this.getLocalPendingUsers();
            this.pendingUsers = Array.isArray(localPending) ? [...localPending] : [];

            // Tentar carregar do Firestore e mesclar
            if (!db) {
                this.renderPendingUsers();
                return;
            }

            try {
                const snap = await db.collection('pendingUsers').get();
                const remote = [];
                snap.forEach(doc => remote.push({ ...doc.data(), docId: doc.id }));

                // Mesclar remoto + local (prioriza remoto quando docId igual)
                const byKey = new Map();
                [...this.pendingUsers, ...remote].forEach(p => {
                    const key = p.docId || p.code;
                    if (!key) return;
                    byKey.set(key, p);
                });
                this.pendingUsers = Array.from(byKey.values());

                this.renderPendingUsers();

                if (this.unsubscribePending) this.unsubscribePending();
                this.unsubscribePending = db.collection('pendingUsers').onSnapshot((snapshot) => {
                    const remote2 = [];
                    snapshot.forEach(doc => remote2.push({ ...doc.data(), docId: doc.id }));

                    const local2 = this.getLocalPendingUsers();
                    const byKey2 = new Map();
                    [...(Array.isArray(local2) ? local2 : []), ...remote2].forEach(p => {
                        const key = p.docId || p.code;
                        if (!key) return;
                        byKey2.set(key, p);
                    });
                    this.pendingUsers = Array.from(byKey2.values());
                    this.renderPendingUsers();
                });
            } catch (e) {
                // Se Firestore falhar, pelo menos mostra o local
                this.renderPendingUsers();
            }
        };

        EvolutionApp.prototype.renderPendingUsers = function() {
            const container = document.getElementById('pendingList');
            if (!container) return;

            // Delegacao de eventos (evita onclick quebrando por aspas no docId)
            if (!this._pendingDelegationBound) {
                container.addEventListener('click', (ev) => {
                    const btn = ev.target.closest('button[data-action][data-docid]');
                    if (!btn) return;
                    const action = btn.getAttribute('data-action');
                    const docId = btn.getAttribute('data-docid') || '';
                    if (!docId) return;

                    if (action === 'approve') this.approveUser(docId);
                    if (action === 'reject') this.rejectUser(docId);
                });
                this._pendingDelegationBound = true;
            }

            const list = Array.isArray(this.pendingUsers) ? this.pendingUsers.slice() : [];
            // Mostrar somente "pending" quando existir status
            const filtered = list.filter(p => !p.status || p.status === 'pending');

            // Helper simples para evitar quebrar o HTML
            const esc = (s) => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

            if (filtered.length === 0) {
                container.innerHTML = '<div style="text-align: center; color: var(--text-muted); font-size: 0.8rem; padding: 20px;">Nenhum cadastro pendente</div>';
                return;
            }

            container.innerHTML = filtered.map(p => {
                const docId = String(p.docId || p.code || '').trim();
                const safeName = esc(p.name || 'SEM NOME');
                const accessLabel = p.loginId ? ('ID: ' + esc(p.loginId)) : ('PIN: ' + esc(p.code || '------'));

                // Trata datas em varios formatos
                let dt = null;
                if (p.requestedAt) {
                    const raw = p.requestedAt;
                    if (typeof raw === 'string') dt = new Date(raw);
                    else if (raw?.toDate) dt = raw.toDate();
                    else if (raw?.seconds) dt = new Date(raw.seconds * 1000);
                    else dt = new Date(raw);
                }
                const dateTxt = (dt && !isNaN(dt.getTime())) ? dt.toLocaleDateString('pt-BR') : 'data desconhecida';

                return `
                    <div class="pending-item">
                        <div class="pending-info">
                            <span class="pending-name">${safeName}</span>
                            <span class="pending-date">${accessLabel} &bull; ${dateTxt}</span>
                        </div>
                        <div class="pending-actions">
                            <button class="btn-tiny btn-approve" data-action="approve" data-docid="${esc(docId)}" title="Aprovar">&#10003;</button>
                            <button class="btn-tiny btn-reject" data-action="reject" data-docid="${esc(docId)}" title="Rejeitar">&#10005;</button>
                        </div>
                    </div>
                `;
            }).join('');
        };

        EvolutionApp.prototype.approveUser = async function(docId) {
            const pending = this.pendingUsers.find(p => (p.docId === docId) || (p.code === docId));
            if (!pending) return;

            const pendingDocId = pending.docId || docId;
            const userDocId = pending.docId || docId;

            // SEGURANCA v7.3: cadastros novos vem com ID + senha (sem PIN).
            // Checa se o ID ja esta em uso; cadastros antigos (com PIN/code) continuam validos.
            const pendLoginId = pending.loginId ? String(pending.loginId).trim().toLowerCase() : null;
            const existing = pendLoginId
                ? Object.values(this.users).find(u => (u.loginId || '').toLowerCase() === pendLoginId)
                : Object.values(this.users).find(u => u.code && u.code === pending.code);
            if (existing) {
                this.showToast(pendLoginId ? `ID ${pending.loginId} já em uso` : 'PIN já em uso', 'error');
                return;
            }

            const trialDate = new Date();
            trialDate.setDate(trialDate.getDate() + 15);

            const notifId = 'trial_' + userDocId + '_' + Date.now();
            const userData = {
                name: pending.name,
                blocked: false,
                isAdmin: false,
                approvedAt: new Date().toISOString(),
                deviceId: pending.deviceId,
                docId: userDocId,
                trialUsed: true,
                vipTrialUntil: trialDate.toISOString(),
                vipType: 'trial',
                vipNotificationPending: true,
                vipNotificationId: notifId,
                vipNotificationType: 'trial',
                vipNotificationUntil: trialDate.toISOString()
            };
            // Preserva as credenciais do cadastro: ID + senha (novo) ou PIN/code (legado)
            if (pending.loginId) {
                userData.loginId = pending.loginId;
                userData.passwordHash = pending.passwordHash;
                userData.passwordSalt = pending.passwordSalt;
                userData.passwordAlgo = pending.passwordAlgo;
                userData.passwordIter = pending.passwordIter;
                userData.authMigrated = pending.authMigrated === true;
            } else if (pending.code) {
                userData.code = pending.code;
            }

            try {
                await this.ensureFirebaseReady();
                await db.collection('users').doc(userDocId).set(userData, { merge: true });
                await db.collection('pendingUsers').doc(pendingDocId).delete();

                // So depois de gravar no Firebase, atualiza o local
                this.users[userDocId] = userData;
                this.pendingUsers = this.pendingUsers.filter(p => (p.docId !== pendingDocId) && (p.code !== docId));
                this.removeLocalPendingByDocId(pendingDocId);
                this.saveUsersToCache();
                this.renderPendingUsers();
                this.renderUserList();
                this.showToast(`Usuário ${pending.name} aprovado!`, 'success');
            } catch (e) {
                console.error('Falha ao aprovar usuario no Firebase:', e);
                this.showToast('Falhou validar no Firebase. Verifique internet/permissoes e tente de novo.', 'error');
            }
        };

        EvolutionApp.prototype.rejectUser = async function(docId) {
            const pending = this.pendingUsers.find(p => (p.docId === docId) || (p.code === docId));
            if (!pending) {
                this.showToast('Pedido não encontrado', 'error');
                return;
            }
            const pendingDocId = pending.docId || docId;

            try {
                await this.ensureFirebaseReady();
                await db.collection('pendingUsers').doc(pendingDocId).delete();

                this.pendingUsers = this.pendingUsers.filter(p => (p.docId !== pendingDocId) && (p.code !== docId));
                this.removeLocalPendingByDocId(pendingDocId);
                this.renderPendingUsers();
                this.showToast('Cadastro rejeitado', 'info');
            } catch (e) {
                console.error('Falha ao rejeitar no Firebase:', e);
                this.showToast('Falhou validar no Firebase. Verifique internet/permissoes e tente de novo.', 'error');
            }
        };

        // Verifica se a sessao atual deve ser encerrada por comando remoto do admin
        EvolutionApp.prototype._checkForceLogout = function(forceTs) {
            if (!forceTs || this.isAdmin || this._forceLogoutPending) return;
            const sessionRaw = safeStorage.getItem('evo_session_v516');
            if (!sessionRaw) return;
            try {
                const sd = decodeSession(sessionRaw);
                if (sd && sd.ts && Number(sd.ts) < Number(forceTs)) {
                    this._forceLogoutPending = true;
                    this.showToast('Sessão encerrada. Faça login novamente.', 'warning');
                    setTimeout(() => {
                        this.logout();
                        window.location.reload(true);
                    }, 2000);
                }
            } catch (e) {}
        };

        // Publica o comando de logout forcado para todos os usuarios no Firebase
        EvolutionApp.prototype.forceLogoutAll = async function() {
            if (!this.isAdmin) { this.showToast('Acesso restrito a administradores.', 'error'); return; }
            const btn = document.getElementById('btnForceLogoutAll');
            const status = document.getElementById('forceLogoutStatus');
            if (!db) {
                if (status) { status.textContent = '✕ Firebase não disponível'; status.style.color = 'var(--danger)'; status.style.display = 'block'; }
                return;
            }
            if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }
            if (status) { status.style.display = 'none'; }
            try {
                const ts = Date.now();
                await db.collection('config').doc('settings').set({
                    forceLogoutBefore: ts
                }, { merge: true });
                const hora = new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                if (status) {
                    status.textContent = '✓ Comando enviado às ' + hora + '. Usuários serão desconectados ao abrir o app.';
                    status.style.color = 'var(--success)';
                    status.style.display = 'block';
                }
                if (btn) { btn.style.background = 'var(--success)'; btn.textContent = '✓ Comando Enviado!'; }
                this.showToast('Logout forcado enviado com sucesso!', 'success');
            } catch (e) {
                if (status) { status.textContent = '✕ Erro ao enviar. Tente novamente.'; status.style.color = 'var(--danger)'; status.style.display = 'block'; }
                if (btn) { btn.disabled = false; btn.textContent = '⚡ Forcar Logout de Todos'; }
                this.showToast('Erro ao enviar comando', 'error');
            }
        };

        EvolutionApp.prototype.fetchAdminSettings = async function() {
            if (!db) return;
            try {
                const doc = await db.collection('config').doc('settings').get();
                if (doc.exists && doc.data().adminPin) {
                    REMOTE_ADMIN_PIN = doc.data().adminPin;
                    safeStorage.setItem('evo_admin_pin_enc', btoa(REMOTE_ADMIN_PIN));
                    // Retentar restauracao de sessao se o admin ainda nao foi autenticado
                    if (this.pendingSessionData && !this.currentUserId) {
                        this.resumeSessionAfterFirebase();
                    }
                }
                if (doc.exists && doc.data().floodPercentage != null) {
                    const fp = document.getElementById('floodPercentage');
                    if (fp) fp.value = doc.data().floodPercentage;
                }
                const settings = doc.exists ? doc.data() : {};
                this.setPhotoImportSettings(settings.photoImportSettings);
                if (settings.portSettings) {
                    this.portSettings = { ...DEFAULT_PORT_SETTINGS, ...settings.portSettings };
                    safeStorage.setItem('evo_port_settings_v1', JSON.stringify(this.portSettings));
                }
                this.updatePortSelector();
                // Logout remoto forcado: se o admin publicou um forceLogoutBefore,
                // qualquer sessao criada ANTES desse timestamp e invalidada
                if (doc.exists && doc.data().forceLogoutBefore != null) {
                    const forceTs = Number(doc.data().forceLogoutBefore);
                    if (forceTs) {
                        safeStorage.setItem('evo_force_logout_before', String(forceTs));
                        this._checkForceLogout(forceTs);
                    }
                }
            } catch (e) {
                // Mantem a ultima configuracao conhecida quando o Firebase estiver offline.
                this.loadCachedPhotoImportSettings();
                this.applyPhotoImportAccess();
                try {
                    const cached = safeStorage.getItem('evo_port_settings_v1');
                    if (cached) this.portSettings = { ...DEFAULT_PORT_SETTINGS, ...JSON.parse(cached) };
                } catch (_) {}
                this.updatePortSelector();
            }

            // A mensagem do sistema e checada por usuario a cada login (ver checkSystemMessage,
            // chamada em restoreUserSession) para garantir que currentUserId ja esta definido.
        };

        // ============================================
        // MENSAGEM DO SISTEMA (publicada pelo admin)
        // BUG FIX: antes so era checada 1x no carregamento da pagina, via fetchAdminSettings,
        // ou seja ANTES do login (currentUserId ainda null) — nunca era re-checada no login
        // real do usuario. Por isso a mensagem nao aparecia de forma confiavel. Agora e chamada
        // diretamente em restoreUserSession, sempre com o currentUserId correto.
        // ============================================
        EvolutionApp.prototype.checkSystemMessage = async function() {
            if (!db || !this.currentUserId) return;
            try {
                const msgDoc = await db.collection('config').doc('message').get();
                if (!msgDoc.exists) return;
                const msgData = msgDoc.data();
                if (!msgData || !msgData.content) return;
                const now = new Date();
                let shouldShow = false;
                const seenKey = `evo_msg_seen_${this.currentUserId}`;
                if (msgData.type === 'always') {
                    shouldShow = true;
                } else if (msgData.type === 'once') {
                    shouldShow = safeStorage.getItem(seenKey) !== msgData.createdAt;
                } else if (msgData.type === 'period' && msgData.startDate && msgData.endDate) {
                    // Ambos parseados em horario local (mesmo metodo) para nao criar um
                    // desvio de fuso entre o inicio e o fim do periodo.
                    const start = new Date(msgData.startDate + 'T00:00:00');
                    const end = new Date(msgData.endDate + 'T23:59:59');
                    shouldShow = now >= start && now <= end;
                }
                if (shouldShow) {
                    document.getElementById('sysMsgContent').textContent = msgData.content;
                    // So exibe mensagem apos o mainApp estar visivel
                    const showMsg = () => {
                        const mainApp = document.getElementById('mainApp');
                        if (mainApp && !mainApp.classList.contains('hidden')) {
                            this.openModal('messageModal');
                        } else {
                            setTimeout(showMsg, 500);
                        }
                    };
                    setTimeout(showMsg, 1500);
                    if (msgData.type === 'once') safeStorage.setItem(seenKey, msgData.createdAt || '');
                }
            } catch (e) {}
        };

        EvolutionApp.prototype.loadRates = async function() {
            if (!db) return;
            try {
                const doc = await db.collection('config').doc('rates').get();
                if (doc.exists) {
                    const data = doc.data() || {};
                    // Compatibilidade com o formato antigo, que armazenava
                    // diretamente as taxas do BrMao no documento.
                    this.taxas = mergeRatesWithDefaults(DEFAULT_TAXAS, data.brmao || data);
                    this.taxasBrIta = mergeRatesWithDefaults(DEFAULT_TAXAS_BRITA, data.brita);
                    safeStorage.setItem('evo_rates_v54', JSON.stringify(this.taxas));
                    safeStorage.setItem('evo_rates_brita_v1', JSON.stringify(this.taxasBrIta));
                }
            } catch (e) {
                try {
                    const local = safeStorage.getItem('evo_rates_v54');
                    if (local) this.taxas = mergeRatesWithDefaults(DEFAULT_TAXAS, JSON.parse(local));
                    const localBrita = safeStorage.getItem('evo_rates_brita_v1');
                    if (localBrita) this.taxasBrIta = mergeRatesWithDefaults(DEFAULT_TAXAS_BRITA, JSON.parse(localBrita));
                } catch (parseErr) {
                    this.taxas = JSON.parse(JSON.stringify(DEFAULT_TAXAS));
                }
            }
        };

        EvolutionApp.prototype.setupEntriesListener = function(docId) {
            if (!db || !this.isRemoteHistoryEnabled()) return;
            if (this.unsubscribeEntries) this.unsubscribeEntries();

            this.unsubscribeEntries = db.collection('users').doc(docId).collection('data')
                .onSnapshot((snapshot) => {
                    let serverEntries = [];
                    const serverMonthCount = {};
                    const serverMonthSyncTs = {};
                    snapshot.forEach(doc => {
                        if (doc.id.startsWith('history_')) {
                            const data = doc.data();
                            let entries = [];
                            if (typeof data.history === 'string') {
                                try { entries = JSON.parse(data.history); } catch (e) { entries = []; }
                            } else if (Array.isArray(data.history)) {
                                entries = data.history;
                            }
                            const month = doc.id.replace('history_', '');
                            serverMonthCount[month] = entries.length;
                            let serverTs = 0;
                            if (data?.localUpdatedAt) {
                                const t = new Date(data.localUpdatedAt).getTime();
                                if (!isNaN(t)) serverTs = t;
                            } else if (data?.updatedAt?.toDate) {
                                const t = data.updatedAt.toDate().getTime();
                                if (!isNaN(t)) serverTs = t;
                            }
                            if (serverTs > 0) serverMonthSyncTs[month] = serverTs;
                            serverEntries.push(...entries);
                        }
                    });

                    // Evita limpar dados locais quando offline e snapshot veio so de cache vazio.
                    if (snapshot?.metadata?.fromCache && !navigator.onLine && Object.keys(serverMonthCount).length === 0) {
                        return;
                    }

                    this.loadHistoryQueue();
                    const pendingQueue = this.pendingHistoryQueue || {};
                    const pendingMonths = new Set();
                    let queueChanged = false;
                    Object.keys(pendingQueue).forEach((month) => {
                        const pendingTs = new Date(pendingQueue[month]?.updatedAt || 0).getTime();
                        const serverTs = serverMonthSyncTs[month] || 0;
                        // Se o servidor ja tem um snapshot mais novo, este pendente local ficou obsoleto.
                        if (serverTs > 0 && !isNaN(pendingTs) && pendingTs > 0 && pendingTs <= serverTs) {
                            delete this.pendingHistoryQueue[month];
                            queueChanged = true;
                            return;
                        }
                        pendingMonths.add(month);
                    });
                    if (queueChanged) this.saveHistoryQueue();

                    const toKey = (entry) => String(entry?.id || `${entry?.data || ''}_${entry?.navio || ''}_${entry?.turno || ''}_${entry?.createdAt || ''}`);
                    const deletedIds = this.getDeletedIds();
                    const byId = new Map();

                    // Base: estado remoto (fonte de verdade entre dispositivos).
                    serverEntries.forEach(entry => {
                        if (!entry) return;
                        const key = toKey(entry);
                        if (!deletedIds.has(key)) byId.set(key, entry);
                    });

                    // Sobreposicao local apenas para meses com alteracao pendente local.
                    (this.entries || []).forEach(entry => {
                        if (!entry) return;
                        const key = toKey(entry);
                        const month = (entry.data && entry.data.length >= 7) ? entry.data.substring(0, 7) : '';
                        if (!month || !pendingMonths.has(month) || deletedIds.has(key)) return;
                        byId.set(key, entry);
                    });

                    const merged = Array.from(byId.values()).sort((a, b) => new Date(b.data || 0) - new Date(a.data || 0));
                    // BUG FIX: Verificar conteudo real, nao apenas tamanho
                    const changed = merged.length !== this.entries.length ||
                        merged.some((e, i) => !this.entries[i] || e.id !== this.entries[i].id || e.pago !== this.entries[i].pago || e.navio !== this.entries[i].navio || e.data !== this.entries[i].data || Number(e.liquido) !== Number(this.entries[i].liquido));
                    this.entries = merged;
                    if (changed) {
                        this.migrateOldEntries();
                        safeStorage.setItem(`evo_data_${this.currentUserId}`, JSON.stringify(this.entries));
                        this.updateDashboard();
                        this.renderHistory();
                        this.updateMetaProgress();
                        // Atualizar calendario quando registros mudarem via Firebase
                        if (typeof this.renderCalendar === 'function') { this.syncCalendarMonthWithEntries(true); this.renderCalendar(); }
                        if (typeof this.renderPendingSummary === 'function') this.renderPendingSummary();
                    }

                    if (pendingMonths.size > 0) {
                        this.scheduleHistorySync('listener-pending', 900);
                    }
                }, (error) => {
                    console.error('Erro listener entries:', error);
                });
        };

        EvolutionApp.prototype.persistData = async function() {
            if (!this.currentUserId) return;
            const months = this.collectEntryMonths();
            this.markHistoryMonthsPending(months);

            if (!this.isRemoteHistoryEnabled()) return;

            if (!navigator.onLine) {
                console.warn('Historico pendente: sem internet no momento.');
                return;
            }

            if (!this.firebaseReady || !db) {
                this.scheduleHistorySync('firebase-wait', 1500);
                return;
            }

            try {
                const synced = await this.flushPendingHistoryQueue('persistData');
                if (!synced) this.scheduleHistorySync('persist-partial', 2500);
            } catch (e) {
                console.error('Erro ao persistir historico:', e);
                this.scheduleHistorySync('persist-error', 2500);
            }
        };

        // ============================================
        // ADMIN - USUARIOS
        // ============================================
        EvolutionApp.prototype.formatAdminDateTime = function(rawDate) {
            if (!rawDate) return null;
            let dt = null;
            if (typeof rawDate === 'string') dt = new Date(rawDate);
            else if (rawDate?.toDate) dt = rawDate.toDate();
            else if (rawDate?.seconds) dt = new Date(rawDate.seconds * 1000);
            else dt = new Date(rawDate);
            if (!dt || isNaN(dt.getTime())) return null;
            const dd = String(dt.getDate()).padStart(2, '0');
            const mm = String(dt.getMonth() + 1).padStart(2, '0');
            const yyyy = dt.getFullYear();
            const hh = String(dt.getHours()).padStart(2, '0');
            const min = String(dt.getMinutes()).padStart(2, '0');
            return `${dd}/${mm}/${yyyy} as ${hh}:${min}`;
        };

        EvolutionApp.prototype.getUserPresenceMeta = function(user) {
            const lastSeenText = this.formatAdminDateTime(user?.lastSeenAt);
            const lastSeenMs = lastSeenText ? new Date(user.lastSeenAt).getTime() : 0;
            const onlineWindow = Number(this.presenceOnlineWindowMs) || (5 * 60 * 1000);
            const isActiveNow = !!lastSeenMs && (Date.now() - lastSeenMs) <= onlineWindow;
            return {
                activeNow: isActiveNow,
                label: lastSeenText
                    ? (isActiveNow ? `Atividade: agora (${lastSeenText})` : `Atividade: ${lastSeenText}`)
                    : 'Atividade: sem registro'
            };
        };

        EvolutionApp.prototype.renderUserList = function() {
            const container = document.getElementById('userList');
            if (!container) return;

            // Delegacao de eventos (evita onclick inline com dados do usuario)
            if (!this._userListDelegationBound) {
                container.addEventListener('click', (ev) => {
                    const btn = ev.target.closest('button[data-action="manage"][data-uid]');
                    if (!btn) return;
                    const uid = btn.getAttribute('data-uid') || '';
                    if (uid) this.openUserManagement(uid);
                });
                this._userListDelegationBound = true;
            }

            const esc = (s) => this.escHtml(s);

            const userArray = Object.values(this.users).filter(u => u && u.name).sort((a, b) => {
                if (a.name === 'FELIPE PRADO') return -1;
                if (b.name === 'FELIPE PRADO') return 1;
                return (a.name || '').localeCompare(b.name || '');
            });

            if (userArray.length === 0) {
                container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px; font-size: 0.8rem;">Nenhum usuario</div>';
                return;
            }

            container.innerHTML = userArray.map(u => {
                const now = new Date();
                const isVip = u.vip || (u.vipUntil && new Date(u.vipUntil) > now) || (u.vipTrialUntil && new Date(u.vipTrialUntil) > now);
                const uid = u.docId || u.code;
                const presence = this.getUserPresenceMeta(u);
                const statusClass = u.blocked ? 'blocked' : (presence.activeNow ? 'active' : 'idle');
                let vipIcon = '', vipDaysText = '';

                if (isVip) {
                    vipIcon = u.vipType === 'gift' ? '🎁' : (u.vipType === 'trial' ? '⏳' : '💎');
                    let daysLeft = 0;
                    if (u.vipUntil) {
                        const diff = new Date(u.vipUntil) - now;
                        daysLeft = Math.ceil(diff / (1000 * 60 * 60 * 24));
                    } else if (u.vipTrialUntil) {
                        const diff = new Date(u.vipTrialUntil) - now;
                        daysLeft = Math.ceil(diff / (1000 * 60 * 60 * 24));
                    }
                    if (daysLeft > 0 && !u.vip) vipDaysText = `<span class="user-vip-days">${daysLeft} dia${daysLeft !== 1 ? 's' : ''}</span>`;
                    else if (u.vip) vipDaysText = `<span class="user-vip-days">Permanente</span>`;
                }

                return `
                    <div class="user-item">
                        <div class="user-item-info">
                            <span class="user-item-name">${esc(u.name)} ${u.isAdmin ? '<span style="font-size:0.65rem;color:var(--accent);border:1px solid;padding:0 4px;border-radius:4px;margin-left:4px;">ADM</span>' : ''} ${isVip ? `<span style="font-size:0.8rem;margin-left:4px;">${vipIcon}</span>` : ''}</span>
                            <span class="user-item-code">${esc(this.describeUserAccess(u))}</span>
                            <span class="user-last-seen">${presence.label}</span>
                            ${vipDaysText}
                        </div>
                        <div class="user-item-status">
                            <div class="status-indicator ${statusClass}"></div>
                            ${!u.isAdmin ? `<button class="btn-icon" data-action="manage" data-uid="${esc(uid)}">⚙</button>` : ''}
                        </div>
                    </div>
                `;
            }).join('');
            if (typeof this.renderBackupAdminList === 'function') this.renderBackupAdminList();
        };
        // SEGURANCA v7.2: PIN com hash nao e mais exibido; mostra o metodo de acesso da conta
        EvolutionApp.prototype.describeUserAccess = function(u, detailed = false) {
            if (!u) return '';
            const migrated = typeof this.isUserMigrated === 'function' && this.isUserMigrated(u);
            if (migrated) return detailed ? `ID de acesso: ${u.loginId} · senha protegida` : `ID: ${u.loginId}`;
            const hashed = window.PinSecurity && PinSecurity.isHashed(u.code);
            if (hashed) return detailed ? 'Acesso por PIN (ainda não criou ID/senha)' : 'PIN protegido';
            return detailed ? `Acesso por PIN: ${u.code || '------'}` : `PIN: ${u.code || '------'}`;
        };

        EvolutionApp.prototype.addNewUser = async function() {
            if (!this.isAdmin) { this.showToast('Acesso restrito a administradores.', 'error'); return; }
            const nameInput = document.getElementById('newUserName');
            const idInput = document.getElementById('newUserLoginId');
            const passInput = document.getElementById('newUserPassword');
            const name = nameInput.value.toUpperCase().trim();
            const loginId = PasswordSecurity.normalizeLoginId(idInput.value);
            const password = String(passInput.value || '');

            if (!name || name.length < 3) { this.showToast('Digite um nome válido (mínimo 3 caracteres)', 'error'); return; }
            if (!PasswordSecurity.available()) { this.showToast('Este navegador não suporta o cadastro seguro.', 'error'); return; }
            if (!PasswordSecurity.isValidLoginId(loginId)) { this.showToast('ID inválido: 4 a 20 caracteres (letras, números, ponto, traço ou _)', 'error'); return; }
            if (!PasswordSecurity.isValidPassword(password)) { this.showToast('A senha deve ter entre 6 e 64 caracteres', 'error'); return; }
            if (Object.values(this.users).some(u => (u.loginId || '').toLowerCase() === loginId)) { this.showToast('Este ID já está em uso', 'error'); return; }

            const cred = await PasswordSecurity.create(password);
            const docId = `ID-${loginId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
            const newUser = {
                name: name,
                loginId: loginId,
                passwordHash: cred.passwordHash,
                passwordSalt: cred.passwordSalt,
                passwordAlgo: cred.passwordAlgo,
                passwordIter: cred.passwordIter,
                authMigrated: true,
                blocked: false,
                createdAt: new Date().toISOString(),
                docId: docId
            };

            this.users[docId] = newUser;
            this.saveUsersToCache();
            this.renderUserList();
            nameInput.value = ''; idInput.value = ''; passInput.value = '';

            if (db) { try { await db.collection('users').doc(docId).set(newUser); } catch (e) {} }
            this.showToast(`Usuário ${name} adicionado! ID: ${loginId}`, 'success');
        };

        // ============================================
        // SEGURANCA v7.5: ADMIN RESERVA (backup do acesso administrativo)
        //
        // O admin principal e reconhecido pelo PIN remoto (config/settings.adminPin)
        // e pelo flag isAdmin no documento users/<id>. Esta secao cria uma SEGUNDA
        // conta com isAdmin: true que entra por ID + senha (auth-credentials.js), com
        // os mesmos poderes no app. A conta principal nunca e alterada aqui.
        // ============================================
        EvolutionApp.prototype.getAdminUsers = function() {
            return Object.values(this.users || {}).filter(u => u && u.isAdmin);
        };

        EvolutionApp.prototype.renderBackupAdminList = function() {
            const box = document.getElementById('backupAdminList');
            if (!box) return;
            const esc = (s) => this.escHtml(s);
            const admins = this.getAdminUsers().sort((a, b) => (a.docId === this.currentUserId ? -1 : b.docId === this.currentUserId ? 1 : 0));
            if (admins.length === 0) { box.innerHTML = ''; return; }
            box.innerHTML = '<div style="margin-bottom:4px;">Administradores atuais:</div>' + admins.map(u => {
                const you = u.docId === this.currentUserId ? ' <span style="color:var(--accent);">(você)</span>' : '';
                const kind = u.adminRole === 'backup' ? ' · reserva' : ' · principal';
                return `<div>• ${esc(u.name || u.docId)}${you} — ${esc(this.describeUserAccess(u))}${kind}</div>`;
            }).join('');
        };

        EvolutionApp.prototype.setBackupAdminStatus = function(text, ok) {
            const el = document.getElementById('backupAdminStatus');
            if (!el) return;
            if (!text) { el.style.display = 'none'; el.textContent = ''; return; }
            el.textContent = text;
            el.style.color = ok ? 'var(--success)' : 'var(--danger)';
            el.style.display = 'block';
        };

        EvolutionApp.prototype.saveBackupAdmin = async function() {
            if (!this.isAdmin) { this.showToast('Acesso restrito a administradores.', 'error'); return; }
            const nameInput = document.getElementById('backupAdminName');
            const idInput = document.getElementById('backupAdminLoginId');
            const passInput = document.getElementById('backupAdminPassword');
            const confirmInput = document.getElementById('backupAdminPasswordConfirm');
            const btn = document.getElementById('btnSaveBackupAdmin');
            const name = String(nameInput?.value || '').toUpperCase().trim();
            const loginId = PasswordSecurity.normalizeLoginId(idInput?.value);
            const password = String(passInput?.value || '');
            const confirm = String(confirmInput?.value || '');

            this.setBackupAdminStatus('');
            if (!PasswordSecurity.available()) { this.showToast('Este navegador não suporta o cadastro seguro.', 'error'); return; }
            if (!PasswordSecurity.isValidLoginId(loginId)) { this.showToast('ID inválido: 4 a 20 caracteres (letras, números, ponto, traço ou _)', 'error'); return; }
            if (!PasswordSecurity.isValidPassword(password)) { this.showToast('A senha deve ter entre 6 e 64 caracteres', 'error'); return; }
            if (password !== confirm) { this.showToast('As senhas não coincidem', 'error'); return; }
            if (password === loginId) { this.showToast('A senha não pode ser igual ao ID', 'error'); return; }
            if (this._backupAdminBusy) return;
            this._backupAdminBusy = true;
            if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }

            try {
                // Exige o servidor: um admin reserva so vale se estiver gravado no Firestore.
                await this.ensureFirebaseReady();

                // Procura o ID sempre no servidor (nunca confia so no cache local)
                const existing = await this.findUserByLoginId(loginId, true);
                if (existing) {
                    if (existing.docId === this.currentUserId) {
                        this.showToast('Esse é o seu próprio ID. Para trocar sua senha use Configurações → Alterar minha senha.', 'warning');
                        return;
                    }
                    if (!existing.isAdmin) {
                        // Nunca promove um usuario comum silenciosamente
                        this.showToast(`O ID ${loginId} já pertence a um usuário comum. Escolha outro ID.`, 'error');
                        return;
                    }
                }

                const docId = existing ? existing.docId : `ID-${loginId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
                if (!existing) {
                    // Garante que o docId gerado esta livre (ex.: conta antiga sem loginId)
                    const clash = await db.collection('users').doc(docId).get();
                    if (clash.exists) { this.showToast('Já existe uma conta com esse identificador. Escolha outro ID.', 'error'); return; }
                }

                const template = this.users[this.currentUserId] || {};
                const cred = await PasswordSecurity.create(password);
                const nowIso = new Date().toISOString();
                const payload = {
                    loginId: loginId,
                    passwordHash: cred.passwordHash,
                    passwordSalt: cred.passwordSalt,
                    passwordAlgo: cred.passwordAlgo,
                    passwordIter: cred.passwordIter,
                    authMigrated: true,
                    authMigratedAt: existing?.authMigratedAt || nowIso,
                    // Espelho das permissoes do admin atual
                    isAdmin: true,
                    vip: true,
                    blocked: false,
                    adminRole: 'backup',
                    adminMirrorOf: this.currentUserId,
                    adminUpdatedAt: nowIso,
                    adminUpdatedBy: this.currentUserId
                };
                if (template.photoImportBeta !== undefined) payload.photoImportBeta = template.photoImportBeta;
                if (!existing) {
                    payload.name = name || loginId.toUpperCase();
                    payload.docId = docId;
                    payload.createdAt = nowIso;
                    payload.createdBy = this.currentUserId;
                } else if (name) {
                    payload.name = name;
                }
                if (!existing && !name) {
                    this.showToast('Digite um nome de exibição para o admin reserva', 'error');
                    return;
                }

                // 1) grava (merge: nao apaga nada que ja exista no documento)
                await db.collection('users').doc(docId).set(payload, { merge: true });
                // 2) confirma lendo do servidor antes de avisar que deu certo
                const snap = await db.collection('users').doc(docId).get({ source: 'server' });
                const saved = snap.exists ? snap.data() : null;
                if (!saved || saved.isAdmin !== true || saved.loginId !== loginId || saved.passwordHash !== cred.passwordHash) {
                    throw new Error('verify-failed');
                }

                this.users[docId] = { ...(this.users[docId] || {}), ...saved, docId };
                this.saveUsersToCache();
                this.renderUserList();
                this.renderBackupAdminList();
                if (nameInput) nameInput.value = '';
                if (idInput) idInput.value = '';
                const msg = existing
                    ? `Senha do admin reserva "${loginId}" atualizada.`
                    : `Admin reserva "${loginId}" criado. Ele já entra por ID + senha com acesso ao painel.`;
                this.setBackupAdminStatus('✓ ' + msg, true);
                this.showToast(msg, 'success');
            } catch (e) {
                console.error('Falha ao salvar admin reserva:', e);
                this.setBackupAdminStatus('✕ Não foi possível gravar no Firebase. Nada foi alterado. Verifique a internet e tente de novo.', false);
                this.showToast('Não foi possível gravar o admin reserva. Tente novamente.', 'error');
            } finally {
                this._backupAdminBusy = false;
                if (btn) { btn.disabled = false; btn.innerHTML = '<span class="ui-icon icon-shield" aria-hidden="true"></span> Criar / atualizar admin reserva'; }
                if (passInput) passInput.value = '';
                if (confirmInput) confirmInput.value = '';
            }
        };

        EvolutionApp.prototype.openUserManagement = function(docId) {
            const user = this.users[docId];
            if (!user) return;
            this.managingUser = docId;
            document.getElementById('manageUserName').textContent = user.name;
            document.getElementById('manageUserPin').textContent = this.describeUserAccess(user, true);
            if (typeof this.updateCredentialResetButton === 'function') this.updateCredentialResetButton(user);
            this._manageUserRef = user;

            // Exibir ultimo login
            const lastLoginEl = document.getElementById('manageUserLastLoginText');
            if (lastLoginEl) {
                const loginText = this.formatAdminDateTime(user.lastLoginAt);
                lastLoginEl.textContent = loginText ? `Último acesso: ${loginText}` : 'Último acesso: sem registro';
            }

            const lastSeenEl = document.getElementById('manageUserLastSeenText');
            if (lastSeenEl) {
                const presence = this.getUserPresenceMeta(user);
                lastSeenEl.textContent = presence.label;
            }

            const btnBlock = document.getElementById('btnBlockUser');
            btnBlock.textContent = user.blocked ? 'Desbloquear' : 'Bloquear';
            this.openModal('userManagementModal');
        };

        EvolutionApp.prototype.applyVip = async function() {
            if (!this.isAdmin) { this.showToast('Acesso restrito a administradores.', 'error'); return; }
            if (!this.managingUser) return;
            const type = document.getElementById('vipTypeSelect').value;
            const duration = document.getElementById('vipDurationSelect').value;
            const user = this.users[this.managingUser];

            if (duration === 'custom') {
                const customDays = parseInt(document.getElementById('vipCustomDaysInput').value, 10);
                if (!customDays || customDays < 1) {
                    this.showToast('Informe a quantidade de dias', 'error');
                    return;
                }
            }

            const updateData = { vipType: type, trialUsed: true, vipTrialUntil: null };
            const noticeId = `vip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

            if (duration === 'perm') {
                updateData.vip = true;
                updateData.vipUntil = null;
            } else {
                updateData.vip = false;
                const vipEnd = new Date();
                let days = 0, months = 0;
                if (duration === '15d') days = 15;
                else if (duration === 'custom') days = parseInt(document.getElementById('vipCustomDaysInput').value, 10);
                else months = parseInt(duration, 10);
                if (days > 0) vipEnd.setDate(vipEnd.getDate() + days);
                if (months > 0) vipEnd.setMonth(vipEnd.getMonth() + months);
                updateData.vipUntil = vipEnd.toISOString();
            }

            updateData.vipNotificationId = noticeId;
            updateData.vipNotificationPending = true;
            updateData.vipNotificationType = type;
            updateData.vipNotificationUntil = updateData.vipUntil || null;
            updateData.vipNotificationCreatedAt = new Date().toISOString();

            this.users[this.managingUser] = { ...user, ...updateData };
            this.saveUsersToCache();
            this.renderUserList();
            this.closeModal('userManagementModal');
            this.showToast(type === 'gift' ? 'Presente VIP enviado!' : 'VIP aplicado!', 'success');

            if (db) {
                try {
                    await db.collection('users').doc(this.managingUser).set(updateData, { merge: true });
                } catch (e) {
                    console.error('Falha ao aplicar VIP:', e);
                    this.showToast('Erro ao enviar aviso VIP para o usuário', 'error');
                }
            }
        };

        EvolutionApp.prototype.removeVip = async function() {
            // FIX 24: mesma guarda das demais acoes administrativas
            if (!this.isAdmin) { this.showToast('Acesso restrito a administradores.', 'error'); return; }
            if (!this.managingUser) return;
            const user = this.users[this.managingUser];
            const userName = user.name || this.managingUser;

            const vipInfo = this.getVipInfo(user);
            if (!vipInfo.active) {
                this.showToast('Este usuário não possui VIP ativo', 'error');
                return;
            }

            this.openConfirmModal('removeVipConfirm', `Remover VIP de ${userName}?`, this.managingUser);
        };

        EvolutionApp.prototype.executeRemoveVip = async function(docId) {
            if (!this.isAdmin) { this.showToast('Acesso restrito a administradores.', 'error'); return; }
            const updateData = {
                vip: false,
                vipUntil: null,
                vipTrialUntil: null,
                vipType: null,
                vipNotificationPending: false,
                vipNotificationId: null,
                vipNotificationType: null,
                vipNotificationUntil: null,
                vipNotificationCreatedAt: null
            };

            this.users[docId] = { ...this.users[docId], ...updateData };
            this.saveUsersToCache();
            this.renderUserList();
            this.closeModal('userManagementModal');
            this.showToast('VIP removido com sucesso!', 'success');

            if (db) {
                try {
                    await db.collection('users').doc(docId).set(updateData, { merge: true });
                } catch (e) {
                    console.error('Falha ao remover VIP:', e);
                    this.showToast('Erro ao remover VIP no servidor', 'error');
                }
            }
        };

        EvolutionApp.prototype.toggleBlockFromModal = async function() {
            if (!this.isAdmin) { this.showToast('Acesso restrito a administradores.', 'error'); return; }
            if (!this.managingUser) return;
            const user = this.users[this.managingUser];
            // SEGURANCA v7.5: contas de administrador nunca sao bloqueadas pelo painel
            if (user?.isAdmin) { this.showToast('Contas de administrador não podem ser bloqueadas.', 'warning'); return; }
            const newStatus = !user.blocked;
            this.users[this.managingUser].blocked = newStatus;
            this.saveUsersToCache();
            document.getElementById('btnBlockUser').textContent = newStatus ? 'Desbloquear' : 'Bloquear';
            this.renderUserList();
            if (db) {
                try {
                    // FIX 15: set/merge em vez de update — update falha com
                    // "No document to update" se o doc do usuario ainda nao existir
                    await db.collection('users').doc(this.managingUser).set({ blocked: newStatus }, { merge: true });
                } catch (e) {}
            }
        };

        EvolutionApp.prototype.deleteUser = async function(docId) {
            if (!this.isAdmin) { this.showToast('Acesso restrito a administradores.', 'error'); return; }
            if (!docId || docId === this.currentUserId) {
                this.showToast('Nao pode excluir a si mesmo', 'error');
                return;
            }
            // SEGURANCA v7.5: nenhuma conta de administrador pode ser excluida pelo painel
            // (protege o admin principal e o admin reserva contra clique acidental)
            if (this.users[docId]?.isAdmin) {
                this.showToast('Contas de administrador não podem ser excluídas pelo painel.', 'error');
                this.closeModal('confirmActionModal');
                return;
            }

            delete this.users[docId];
            this.saveUsersToCache();
            this.renderUserList();

            if (db) {
                try {
                    await db.collection('users').doc(docId).delete();
                } catch (e) {}
            }

            this.showToast('Usuário excluído', 'success');
            this.closeModal('confirmActionModal');
        };

        EvolutionApp.prototype.renderAdminRates = function() {
            try {
                const brmao = this.taxas || DEFAULT_TAXAS;
                const brita = this.taxasBrIta || DEFAULT_TAXAS_BRITA;
                document.getElementById('rate_07x15_normal').value = brmao['07x15'].normal;
                document.getElementById('rate_07x15_feriado').value = brmao['07x15'].feriado;
                document.getElementById('rate_15x23_p1_normal').value = brmao['15x23'].normal.p1;
                document.getElementById('rate_15x23_p1_feriado').value = brmao['15x23'].feriado.p1;
                document.getElementById('rate_15x23_p2_normal').value = brmao['15x23'].normal.p2;
                document.getElementById('rate_15x23_p2_feriado').value = brmao['15x23'].feriado.p2;
                document.getElementById('rate_23x07_normal').value = brmao['23x07'].normal;
                document.getElementById('rate_23x07_feriado').value = brmao['23x07'].feriado;
                document.getElementById('rate_07x19_normal').value = brmao['07x19'].normal;
                document.getElementById('rate_07x19_feriado').value = brmao['07x19'].feriado;
                document.getElementById('rate_19x07_normal').value = brmao['19x07'].normal;
                document.getElementById('rate_19x07_feriado').value = brmao['19x07'].feriado;
                document.getElementById('rate_brita_07x15_normal').value = brita['07x15'].normal;
                document.getElementById('rate_brita_07x15_feriado').value = brita['07x15'].feriado;
                document.getElementById('rate_brita_15x23_p1_normal').value = brita['15x23'].normal.p1;
                document.getElementById('rate_brita_15x23_p1_feriado').value = brita['15x23'].feriado.p1;
                document.getElementById('rate_brita_15x23_p2_normal').value = brita['15x23'].normal.p2;
                document.getElementById('rate_brita_15x23_p2_feriado').value = brita['15x23'].feriado.p2;
                document.getElementById('rate_brita_23x07_normal').value = brita['23x07'].normal;
                document.getElementById('rate_brita_23x07_feriado').value = brita['23x07'].feriado;
                document.getElementById('rate_brita_07x19_normal').value = brita['07x19'].normal;
                document.getElementById('rate_brita_07x19_feriado').value = brita['07x19'].feriado;
                document.getElementById('rate_brita_19x07_normal').value = brita['19x07'].normal;
                document.getElementById('rate_brita_19x07_feriado').value = brita['19x07'].feriado;
                document.getElementById('britaVisible').checked = this.portSettings?.britaVisible !== false;
                document.getElementById('britaEnabled').checked = this.portSettings?.britaEnabled === true;
            } catch (e) {
                try {
                    const cached = safeStorage.getItem('evo_port_settings_v1');
                    if (cached) this.portSettings = { ...DEFAULT_PORT_SETTINGS, ...JSON.parse(cached) };
                } catch (_) {}
                this.updatePortSelector();
            }
        };

        EvolutionApp.prototype.saveRates = async function() {
            if (!this.isAdmin) { this.showToast('Acesso restrito a administradores.', 'error'); return; }
            const readRate = (id, fallback) => {
                const value = parseFloat(document.getElementById(id)?.value);
                return Number.isFinite(value) ? value : fallback;
            };
            const newRates = {
                '07x15': {
                    normal: readRate('rate_07x15_normal', DEFAULT_TAXAS['07x15'].normal),
                    feriado: readRate('rate_07x15_feriado', DEFAULT_TAXAS['07x15'].feriado)
                },
                '15x23': {
                    normal: {
                        p1: readRate('rate_15x23_p1_normal', DEFAULT_TAXAS['15x23'].normal.p1),
                        p2: readRate('rate_15x23_p2_normal', DEFAULT_TAXAS['15x23'].normal.p2)
                    },
                    feriado: {
                        p1: readRate('rate_15x23_p1_feriado', DEFAULT_TAXAS['15x23'].feriado.p1),
                        p2: readRate('rate_15x23_p2_feriado', DEFAULT_TAXAS['15x23'].feriado.p2)
                    }
                },
                '23x07': {
                    normal: readRate('rate_23x07_normal', DEFAULT_TAXAS['23x07'].normal),
                    feriado: readRate('rate_23x07_feriado', DEFAULT_TAXAS['23x07'].feriado)
                },
                '07x19': {
                    normal: readRate('rate_07x19_normal', DEFAULT_TAXAS['07x19'].normal),
                    feriado: readRate('rate_07x19_feriado', DEFAULT_TAXAS['07x19'].feriado)
                },
                '19x07': {
                    normal: readRate('rate_19x07_normal', DEFAULT_TAXAS['19x07'].normal),
                    feriado: readRate('rate_19x07_feriado', DEFAULT_TAXAS['19x07'].feriado)
                }
            };

            const britaRates = {
                '07x15': {
                    normal: readRate('rate_brita_07x15_normal', DEFAULT_TAXAS_BRITA['07x15'].normal),
                    feriado: readRate('rate_brita_07x15_feriado', DEFAULT_TAXAS_BRITA['07x15'].feriado)
                },
                '15x23': {
                    normal: {
                        p1: readRate('rate_brita_15x23_p1_normal', DEFAULT_TAXAS_BRITA['15x23'].normal.p1),
                        p2: readRate('rate_brita_15x23_p2_normal', DEFAULT_TAXAS_BRITA['15x23'].normal.p2)
                    },
                    feriado: {
                        p1: readRate('rate_brita_15x23_p1_feriado', DEFAULT_TAXAS_BRITA['15x23'].feriado.p1),
                        p2: readRate('rate_brita_15x23_p2_feriado', DEFAULT_TAXAS_BRITA['15x23'].feriado.p2)
                    }
                },
                '23x07': {
                    normal: readRate('rate_brita_23x07_normal', DEFAULT_TAXAS_BRITA['23x07'].normal),
                    feriado: readRate('rate_brita_23x07_feriado', DEFAULT_TAXAS_BRITA['23x07'].feriado)
                },
                '07x19': {
                    normal: readRate('rate_brita_07x19_normal', DEFAULT_TAXAS_BRITA['07x19'].normal),
                    feriado: readRate('rate_brita_07x19_feriado', DEFAULT_TAXAS_BRITA['07x19'].feriado)
                },
                '19x07': {
                    normal: readRate('rate_brita_19x07_normal', DEFAULT_TAXAS_BRITA['19x07'].normal),
                    feriado: readRate('rate_brita_19x07_feriado', DEFAULT_TAXAS_BRITA['19x07'].feriado)
                }
            };

            const britaRateValues = [
                britaRates['07x15'].normal,
                britaRates['07x15'].feriado,
                britaRates['15x23'].normal.p1,
                britaRates['15x23'].normal.p2,
                britaRates['15x23'].feriado.p1,
                britaRates['15x23'].feriado.p2,
                britaRates['23x07'].normal,
                britaRates['23x07'].feriado,
                britaRates['07x19'].normal,
                britaRates['07x19'].feriado,
                britaRates['19x07'].normal,
                britaRates['19x07'].feriado
            ];
            const wantsBritaEnabled = document.getElementById('britaEnabled')?.checked === true;
            if (wantsBritaEnabled && britaRateValues.some(value => !Number.isFinite(value) || value <= 0)) {
                this.showToast('Preencha todas as taxas do BrIta antes de liberar o acesso.', 'error');
                return;
            }

            this.taxas = newRates;
            this.taxasBrIta = britaRates;
            this.portSettings = {
                britaVisible: document.getElementById('britaVisible')?.checked !== false,
                britaEnabled: document.getElementById('britaEnabled')?.checked === true
            };
            safeStorage.setItem('evo_rates_v54', JSON.stringify(newRates));
            safeStorage.setItem('evo_rates_brita_v1', JSON.stringify(britaRates));
            safeStorage.setItem('evo_port_settings_v1', JSON.stringify(this.portSettings));
            this.updatePortSelector();
            this.showToast('Taxas salvas!', 'success');
            this.closeModal('adminModal');

            if (db) {
                try {
                    await db.collection('config').doc('rates').set({ brmao: newRates, brita: britaRates });
                    await db.collection('config').doc('settings').set({ portSettings: this.portSettings }, { merge: true });
                } catch (e) {}
            }
        };

        // ============================================
        // LEITURA POR FOTO (beta) - painel de ativacao
        // ============================================
        EvolutionApp.prototype.renderPhotoImportAdmin = function() {
            if (!this.isAdmin) return;
            const settings = this.getPhotoImportSettings();
            const enabledEl = document.getElementById('photoImportEnabled');
            const audienceEl = document.getElementById('photoImportAudience');
            const picker = document.getElementById('photoImportUserPicker');
            const list = document.getElementById('photoImportUserList');
            if (enabledEl) enabledEl.checked = settings.enabled;
            if (audienceEl) audienceEl.value = settings.audience;
            this.refreshPhotoImportAdminState();

            if (!list) return;
            const esc = (value) => this.escHtml(value);
            const userArray = Object.values(this.users)
                .filter(u => u && u.name && !u.isAdmin)
                .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

            if (!userArray.length) {
                list.innerHTML = '<div class="photo-beta-empty">Nenhum usuário cadastrado.</div>';
                this.updatePhotoImportCount();
                return;
            }

            list.innerHTML = userArray.map(u => {
                const uid = u.docId || u.code;
                return `
                    <label class="photo-beta-user">
                        <span class="photo-beta-user-info">
                            <strong>${esc(u.name)}</strong>
                            <span>${esc(this.describeUserAccess(u))}</span>
                        </span>
                        <span class="toggle-switch">
                            <input type="checkbox" data-photo-beta-uid="${esc(uid)}" ${u.photoImportBeta ? 'checked' : ''} onchange="app.updatePhotoImportCount()">
                            <span class="toggle-slider"></span>
                        </span>
                    </label>
                `;
            }).join('');
            this.updatePhotoImportCount();
        };

        // Chamada pelos onchange do painel: atualiza apenas o que depende da
        // escolha atual. Nao repovoa os campos, para nao desfazer o clique.
        EvolutionApp.prototype.refreshPhotoImportAdminState = function() {
            const enabled = Boolean(document.getElementById('photoImportEnabled')?.checked);
            const audience = document.getElementById('photoImportAudience')?.value || 'admins';
            const picker = document.getElementById('photoImportUserPicker');
            if (picker) picker.style.display = (enabled && audience === 'selected') ? 'block' : 'none';
            const status = document.getElementById('photoImportStatus');
            if (status) {
                status.textContent = !enabled
                    ? 'Desativado: o recurso não aparece para ninguém, nem para você.'
                    : audience === 'all'
                        ? 'Ativo para todos os usuários.'
                        : audience === 'selected'
                            ? 'Ativo para você e para os usuários marcados abaixo.'
                            : 'Ativo somente para administradores.';
            }
        };

        EvolutionApp.prototype.updatePhotoImportCount = function() {
            const counter = document.getElementById('photoImportCount');
            if (!counter) return;
            const checked = document.querySelectorAll('#photoImportUserList input[data-photo-beta-uid]:checked').length;
            counter.textContent = String(checked);
        };

        EvolutionApp.prototype.savePhotoImportSettings = async function() {
            if (!this.isAdmin) { this.showToast('Acesso restrito a administradores.', 'error'); return; }
            const enabled = Boolean(document.getElementById('photoImportEnabled')?.checked);
            const audience = document.getElementById('photoImportAudience')?.value || 'admins';
            const inputs = Array.from(document.querySelectorAll('#photoImportUserList input[data-photo-beta-uid]'));

            // Grava apenas os usuarios que mudaram, para nao escrever a colecao toda.
            const changes = inputs
                .map(input => ({ uid: input.getAttribute('data-photo-beta-uid'), allowed: input.checked }))
                .filter(item => item.uid && Boolean(this.users[item.uid]?.photoImportBeta) !== item.allowed);

            if (!db) { this.showToast('Sem conexão com o servidor. Tente novamente.', 'error'); return; }
            try {
                {
                    await db.collection('config').doc('settings').set({
                        photoImportSettings: { enabled, audience }
                    }, { merge: true });
                    for (const change of changes) {
                        await db.collection('users').doc(change.uid).set({ photoImportBeta: change.allowed }, { merge: true });
                    }
                }
                changes.forEach(change => {
                    if (this.users[change.uid]) this.users[change.uid].photoImportBeta = change.allowed;
                });
                this.setPhotoImportSettings({ enabled, audience });
                this.renderPhotoImportAdmin();
                const suffix = changes.length ? ` (${changes.length} usuário${changes.length === 1 ? '' : 's'} atualizado${changes.length === 1 ? '' : 's'})` : '';
                this.showToast(`Leitura por foto ${enabled ? 'ativada' : 'desativada'}${suffix}.`, 'success');
            } catch (error) {
                console.error('Erro ao salvar configuracao da leitura por foto:', error);
                this.showToast('Não foi possível salvar. Verifique a conexão.', 'error');
            }
        };

        EvolutionApp.prototype.toggleAdminSection = function(id) {
            const el = document.getElementById(id);
            if (!el) return;
            const isVisible = el.style.display === 'block';
            el.style.display = isVisible ? 'none' : 'block';
        };

        EvolutionApp.prototype.refreshAdminLists = function() {
            this.showToast('Atualizando...', 'info');
            this.loadPendingUsers();
            this.syncUsersFromFirebase();
        };
