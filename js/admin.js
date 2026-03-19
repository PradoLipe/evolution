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
                            this.users[change.doc.id] = data;
                            if (this.currentUserId && change.doc.id === this.currentUserId) {
                                this.handleCurrentUserRemoteUpdate(data);
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
                const safeCode = esc(p.code || '------');

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
                            <span class="pending-date">PIN: ${safeCode} • ${dateTxt}</span>
                        </div>
                        <div class="pending-actions">
                            <button class="btn-tiny btn-approve" data-action="approve" data-docid="${esc(docId)}" title="Aprovar">✓</button>
                            <button class="btn-tiny btn-reject" data-action="reject" data-docid="${esc(docId)}" title="Rejeitar">✕</button>
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

            const existing = Object.values(this.users).find(u => u.code === pending.code);
            if (existing) {
                this.showToast(`PIN ${pending.code} ja em uso`, 'error');
                return;
            }

            const trialDate = new Date();
            trialDate.setDate(trialDate.getDate() + 15);

            const userData = {
                name: pending.name,
                code: pending.code,
                blocked: false,
                isAdmin: false,
                approvedAt: new Date().toISOString(),
                deviceId: pending.deviceId,
                docId: userDocId,
                trialUsed: true,
                vipTrialUntil: trialDate.toISOString(),
                vipType: 'trial'
            };

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
                this.showToast(`Usuario ${pending.name} aprovado!`, 'success');
            } catch (e) {
                console.error('Falha ao aprovar usuario no Firebase:', e);
                this.showToast('Falhou validar no Firebase. Verifique internet/permissoes e tente de novo.', 'error');
            }
        };

        EvolutionApp.prototype.rejectUser = async function(docId) {
            const pending = this.pendingUsers.find(p => (p.docId === docId) || (p.code === docId));
            if (!pending) {
                this.showToast('Pedido nao encontrado', 'error');
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
            } catch (e) {}

            // BUG FIX: Carregar e exibir mensagem do sistema (era funcionalidade sem implementacao)
            try {
                const msgDoc = await db.collection('config').doc('message').get();
                if (msgDoc.exists) {
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
                        const start = new Date(msgData.startDate);
                        const end = new Date(msgData.endDate + 'T23:59:59');
                        shouldShow = now >= start && now <= end;
                    }
                    if (shouldShow) {
                        document.getElementById('sysMsgContent').textContent = msgData.content;
                        // FIX 11: So exibe mensagem apos o mainApp estar visivel
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
                }
            } catch (e) {}
        };

        EvolutionApp.prototype.loadRates = async function() {
            if (!db) return;
            try {
                const doc = await db.collection('config').doc('rates').get();
                if (doc.exists) {
                    this.taxas = doc.data();
                    safeStorage.setItem('evo_rates_v54', JSON.stringify(this.taxas));
                }
            } catch (e) {
                try {
                    const local = safeStorage.getItem('evo_rates_v54');
                    if (local) this.taxas = JSON.parse(local);
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
        EvolutionApp.prototype.renderUserList = function() {
            const container = document.getElementById('userList');
            if (!container) return;

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
                            <span class="user-item-name">${this.escHtml(u.name)} ${u.isAdmin ? '<span style="font-size:0.65rem;color:var(--accent);border:1px solid;padding:0 4px;border-radius:4px;margin-left:4px;">ADM</span>' : ''} ${isVip ? `<span style="font-size:0.8rem;margin-left:4px;">${vipIcon}</span>` : ''}</span>
                            <span class="user-item-code">PIN: ${this.escHtml(u.code)}</span>
                            ${vipDaysText}
                        </div>
                        <div class="user-item-status">
                            <div class="status-indicator ${u.blocked ? 'blocked' : 'active'}"></div>
                            ${!u.isAdmin ? `<button class="btn-icon" onclick="app.openUserManagement('${this.escHtml(uid)}')">⚙</button>` : ''}
                        </div>
                    </div>
                `;
            }).join('');
        };

        EvolutionApp.prototype.addNewUser = async function() {
            const nameInput = document.getElementById('newUserName');
            const codeInput = document.getElementById('newUserCode');
            const name = nameInput.value.toUpperCase().trim();
            const code = codeInput.value.trim();

            if (!name || !/^\d{4,6}$/.test(code)) {
                this.showToast('Preencha nome e PIN (4 a 6 digitos)', 'error');
                return;
            }

            if (Object.values(this.users).some(u => u.code === code)) {
                this.showToast('PIN ja existe', 'error');
                return;
            }

            const docId = `${code}-${name.replace(/\s+/g, '_')}`;
            const newUser = {
                name: name,
                code: code,
                blocked: false,
                createdAt: new Date().toISOString(),
                docId: docId
            };

            this.users[docId] = newUser;
            this.saveUsersToCache();
            this.renderUserList();

            nameInput.value = '';
            codeInput.value = '';

            if (db) {
                try {
                    await db.collection('users').doc(docId).set(newUser);
                } catch (e) {}
            }

            this.showToast(`Usuario ${name} adicionado!`, 'success');
        };

        EvolutionApp.prototype.openUserManagement = function(docId) {
            const user = this.users[docId];
            if (!user) return;
            this.managingUser = docId;
            document.getElementById('manageUserName').textContent = user.name;
            document.getElementById('manageUserPin').textContent = user.code;

            // Exibir ultimo login
            const lastLoginEl = document.getElementById('manageUserLastLoginText');
            if (lastLoginEl) {
                if (user.lastLoginAt) {
                    const dt = new Date(user.lastLoginAt);
                    const dd = String(dt.getDate()).padStart(2, '0');
                    const mm = String(dt.getMonth() + 1).padStart(2, '0');
                    const yyyy = dt.getFullYear();
                    const hh = String(dt.getHours()).padStart(2, '0');
                    const min = String(dt.getMinutes()).padStart(2, '0');
                    lastLoginEl.textContent = `Ultimo acesso: ${dd}/${mm}/${yyyy} as ${hh}:${min}`;
                } else {
                    lastLoginEl.textContent = 'Ultimo acesso: sem registro';
                }
            }

            const btnBlock = document.getElementById('btnBlockUser');
            btnBlock.textContent = user.blocked ? 'Desbloquear' : 'Bloquear';
            this.openModal('userManagementModal');
        };

        EvolutionApp.prototype.applyVip = async function() {
            if (!this.managingUser) return;
            const type = document.getElementById('vipTypeSelect').value;
            const duration = document.getElementById('vipDurationSelect').value;
            const user = this.users[this.managingUser];

            const updateData = { vipType: type, trialUsed: true, vipTrialUntil: null };
            const now = new Date();
            const noticeId = `vip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

            if (duration === 'perm') {
                updateData.vip = true;
                updateData.vipUntil = null;
            } else {
                updateData.vip = false;
                let days = 0, months = 0;
                if (duration === '15d') days = 15;
                else months = parseInt(duration, 10);
                now.setDate(now.getDate() + days);
                now.setMonth(now.getMonth() + months);
                updateData.vipUntil = now.toISOString();
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
                    this.showToast('Erro ao enviar aviso VIP para o usuario', 'error');
                }
            }
        };

        EvolutionApp.prototype.toggleBlockFromModal = async function() {
            if (!this.managingUser) return;
            const user = this.users[this.managingUser];
            const newStatus = !user.blocked;
            this.users[this.managingUser].blocked = newStatus;
            this.saveUsersToCache();
            document.getElementById('btnBlockUser').textContent = newStatus ? 'Desbloquear' : 'Bloquear';
            this.renderUserList();
            if (db) {
                try {
                    await db.collection('users').doc(this.managingUser).update({ blocked: newStatus });
                } catch (e) {}
            }
        };

        EvolutionApp.prototype.resetDeviceFromModal = async function() {
            if (!this.managingUser) return;
            this.users[this.managingUser].deviceId = null;
            this.saveUsersToCache();
            this.showToast('Dispositivo resetado', 'success');
            if (db) {
                try {
                    await db.collection('users').doc(this.managingUser).update({ deviceId: null });
                } catch (e) {}
            }
        };

        EvolutionApp.prototype.deleteUser = async function(docId) {
            if (!docId || docId === this.currentUserId) {
                this.showToast('Nao pode excluir a si mesmo', 'error');
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

            this.showToast('Usuario excluido', 'success');
            this.closeModal('confirmActionModal');
        };

        EvolutionApp.prototype.renderAdminRates = function() {
            try {
                document.getElementById('rate_07x15_normal').value = this.taxas['07x15'].normal;
                document.getElementById('rate_07x15_feriado').value = this.taxas['07x15'].feriado;
                document.getElementById('rate_15x23_p1_normal').value = this.taxas['15x23'].normal.p1;
                document.getElementById('rate_15x23_p1_feriado').value = this.taxas['15x23'].feriado.p1;
                document.getElementById('rate_15x23_p2_normal').value = this.taxas['15x23'].normal.p2;
                document.getElementById('rate_15x23_p2_feriado').value = this.taxas['15x23'].feriado.p2;
                document.getElementById('rate_23x07_normal').value = this.taxas['23x07'].normal;
                document.getElementById('rate_23x07_feriado').value = this.taxas['23x07'].feriado;
            } catch (e) {}
        };

        EvolutionApp.prototype.saveRates = async function() {
            const newRates = {
                '07x15': {
                    normal: parseFloat(document.getElementById('rate_07x15_normal').value) || 5.73,
                    feriado: parseFloat(document.getElementById('rate_07x15_feriado').value) || 8.61
                },
                '15x23': {
                    normal: {
                        p1: parseFloat(document.getElementById('rate_15x23_p1_normal').value) || 5.73,
                        p2: parseFloat(document.getElementById('rate_15x23_p2_normal').value) || 6.88
                    },
                    feriado: {
                        p1: parseFloat(document.getElementById('rate_15x23_p1_feriado').value) || 8.61,
                        p2: parseFloat(document.getElementById('rate_15x23_p2_feriado').value) || 10.32
                    }
                },
                '23x07': {
                    normal: parseFloat(document.getElementById('rate_23x07_normal').value) || 6.88,
                    feriado: parseFloat(document.getElementById('rate_23x07_feriado').value) || 10.32
                }
            };

            this.taxas = newRates;
            safeStorage.setItem('evo_rates_v54', JSON.stringify(newRates));
            this.showToast('Taxas salvas!', 'success');
            this.closeModal('adminModal');

            if (db) {
                try {
                    await db.collection('config').doc('rates').set(newRates);
                } catch (e) {}
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
