        EvolutionApp.prototype.isRemoteHistoryEnabled = function() {
            return !!(this.currentUserId && (this.isAdmin || this.isVip));
        };

        EvolutionApp.prototype.getHistoryQueueKey = function() {
            return `evo_history_queue_${this.currentUserId}`;
        };

        EvolutionApp.prototype.loadHistoryQueue = function() {
            if (!this.currentUserId) {
                this.pendingHistoryQueue = {};
                return;
            }
            try {
                this.pendingHistoryQueue = JSON.parse(safeStorage.getItem(this.getHistoryQueueKey()) || '{}') || {};
            } catch (e) {
                this.pendingHistoryQueue = {};
            }
        };

        EvolutionApp.prototype.saveHistoryQueue = function() {
            if (!this.currentUserId) return;
            safeStorage.setItem(this.getHistoryQueueKey(), JSON.stringify(this.pendingHistoryQueue || {}));
        };

        // ============================================
        // TOMBSTONE - controle de entradas excluidas
        // Garante que deletados nao retornem do Firebase
        // ============================================
        EvolutionApp.prototype.getDeletedIdsKey = function() {
            return `evo_deleted_ids_${this.currentUserId}`;
        };

        EvolutionApp.prototype.getDeletedIds = function() {
            try {
                const raw = safeStorage.getItem(this.getDeletedIdsKey());
                return new Set(JSON.parse(raw || '[]').map(String));
            } catch (e) {
                return new Set();
            }
        };

        EvolutionApp.prototype.addDeletedId = function(id) {
            if (!this.currentUserId || id == null) return;
            const ids = this.getDeletedIds();
            ids.add(String(id));
            // FIX 19: Limite aumentado para 2000 IDs para suportar uso a longo prazo
            const arr = [...ids].slice(-2000);
            safeStorage.setItem(this.getDeletedIdsKey(), JSON.stringify(arr));
        };

        EvolutionApp.prototype.collectEntryMonths = function() {
            const months = new Set();
            (this.entries || []).forEach(entry => {
                if (entry && entry.data && entry.data.length >= 7) months.add(entry.data.substring(0, 7));
            });
            return Array.from(months);
        };

        EvolutionApp.prototype.markHistoryMonthsPending = function(months) {
            if (!this.currentUserId || !Array.isArray(months) || months.length === 0) return;
            if (!this.pendingHistoryQueue || typeof this.pendingHistoryQueue !== 'object') this.pendingHistoryQueue = {};
            months.forEach(month => {
                if (!month) return;
                this.pendingHistoryQueue[month] = {
                    status: 'pending',
                    updatedAt: new Date().toISOString()
                };
            });
            // FIX 20: Limita queue a 36 meses para nao crescer indefinidamente offline
            const keys = Object.keys(this.pendingHistoryQueue);
            if (keys.length > 36) {
                const toKeep = keys.sort().slice(-36);
                const trimmed = {};
                toKeep.forEach(k => { trimmed[k] = this.pendingHistoryQueue[k]; });
                this.pendingHistoryQueue = trimmed;
            }
            this.saveHistoryQueue();
        };

        EvolutionApp.prototype.scheduleHistorySync = function(reason = 'manual', delay = 1200) {
            if (!this.isRemoteHistoryEnabled()) return;
            clearTimeout(this.historySyncTimer);
            this.historySyncTimer = setTimeout(() => {
                this.flushPendingHistoryQueue(reason)
                    .then((synced) => {
                        // Mantem tentativas em background quando a fila ainda nao zerou.
                        if (!synced && this.isRemoteHistoryEnabled()) {
                            const retryDelay = (!navigator.onLine || !this.firebaseReady || !db) ? 10000 : 2500;
                            this.scheduleHistorySync(`${reason}-retry`, retryDelay);
                        }
                    })
                    .catch((error) => {
                        console.error('Falha ao sincronizar historico:', error);
                    });
            }, delay);
        };

        EvolutionApp.prototype.flushPendingHistoryQueue = async function(reason = 'manual') {
            if (!this.isRemoteHistoryEnabled() || !this.currentUserId) return false;
            if (!navigator.onLine) return false;
            if (!this.firebaseReady || !db) return false;

            this.loadHistoryQueue();
            const pendingMonths = Object.keys(this.pendingHistoryQueue || {});
            if (pendingMonths.length === 0) return true;

            const grouped = {};
            (this.entries || []).forEach(entry => {
                if (!entry || !entry.data || entry.data.length < 7) return;
                const month = entry.data.substring(0, 7);
                if (!grouped[month]) grouped[month] = [];
                grouped[month].push(entry);
            });

            let syncedAnyMonth = false;
            for (const month of pendingMonths) {
                try {
                    const localEntries = Array.isArray(grouped[month]) ? grouped[month] : [];
                    const ref = db.collection('users').doc(this.currentUserId).collection('data').doc(`history_${month}`);
                    const snap = await ref.get();
                    let remoteEntries = [];
                    if (snap.exists) {
                        const data = snap.data() || {};
                        if (typeof data.history === 'string') {
                            try { remoteEntries = JSON.parse(data.history) || []; } catch (e) { remoteEntries = []; }
                        } else if (Array.isArray(data.history)) {
                            remoteEntries = data.history;
                        }
                    }

                    // BUG FIX: Antes era [...remoteEntries, ...localEntries] com local sobrescrevendo remoto,
                    // mas entradas DELETADAS localmente ainda existiam no remoto e voltavam ao mapa.
                    // Agora: local e a fonte da verdade. Remoto so adiciona entradas que nao existem localmente.
                    // Tombstone garante que IDs deletados sejam filtrados de ambas as fontes.
                    const deletedIds = this.getDeletedIds();
                    const localById = new Map();
                    localEntries.forEach(entry => {
                        if (!entry) return;
                        const key = String(entry.id || `${entry.data || ''}_${entry.navio || ''}_${entry.turno || ''}_${entry.createdAt || ''}`);
                        if (!deletedIds.has(key)) localById.set(key, entry);
                    });
                    // Adicionar do remoto SOMENTE entradas que nao existem localmente e nao foram deletadas
                    remoteEntries.forEach(entry => {
                        if (!entry) return;
                        const key = String(entry.id || `${entry.data || ''}_${entry.navio || ''}_${entry.turno || ''}_${entry.createdAt || ''}`);
                        if (!deletedIds.has(key) && !localById.has(key)) localById.set(key, entry);
                    });
                    const mergedEntries = Array.from(localById.values()).sort((a, b) => new Date(b.data || 0) - new Date(a.data || 0));

                    await ref.set({
                        history: JSON.stringify(mergedEntries),
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                        localUpdatedAt: new Date().toISOString(),
                        count: mergedEntries.length,
                        source: 'queue-retry'
                    }, { merge: true });

                    delete this.pendingHistoryQueue[month];
                    syncedAnyMonth = true;
                } catch (error) {
                    console.error(`Falha ao sincronizar historico do mes ${month}:`, error);
                    const prev = this.pendingHistoryQueue?.[month] || {};
                    this.pendingHistoryQueue[month] = {
                        ...prev,
                        status: 'pending',
                        updatedAt: new Date().toISOString(),
                        lastError: String(error?.message || error || 'erro-desconhecido').slice(0, 200)
                    };
                }
            }

            this.saveHistoryQueue();
            if (syncedAnyMonth) {
                try {
                    await db.collection('users').doc(this.currentUserId).set({
                        lastSyncAt: new Date().toISOString(),
                        historyBackup: {
                            count: Array.isArray(this.entries) ? this.entries.length : 0,
                            updatedAt: new Date().toISOString(),
                            deviceId: this.deviceId,
                            reason
                        }
                    }, { merge: true });
                } catch (error) {
                    console.error('Falha ao atualizar metadados de sincronizacao:', error);
                }
            }
            return Object.keys(this.pendingHistoryQueue || {}).length === 0;
        };

        EvolutionApp.prototype.checkVipNotification = function(userData) {
            if (!this.currentUserId || !userData || !userData.vipNotificationPending || !userData.vipNotificationId) return;
            const seenKey = `evo_vip_notice_seen_${this.currentUserId}`;
            const lastSeen = safeStorage.getItem(seenKey);
            if (lastSeen === userData.vipNotificationId) return;

            const title = document.getElementById('vipNotifType');
            const dateEl = document.getElementById('vipNotifDate');
            const giftBox = document.getElementById('vipGiftMessageContainer');
            const until = userData.vipNotificationUntil ? new Date(userData.vipNotificationUntil) : null;
            const untilText = (until && !isNaN(until.getTime())) ? `Valido ate ${until.toLocaleDateString('pt-BR')}` : 'Acesso liberado';
            const isGift = userData.vipNotificationType === 'gift';

            if (title) title.textContent = isGift ? 'PRESENTE VIP RECEBIDO' : 'VIP CONFIRMADO';
            if (dateEl) dateEl.textContent = untilText;
            if (giftBox) {
                giftBox.textContent = isGift ? 'Seu acesso VIP foi liberado como presente. Aproveite todos os recursos premium.' : 'Seu pagamento foi confirmado e os recursos VIP ja estao disponiveis.';
                giftBox.classList.remove('hidden');
            }
            safeStorage.setItem(seenKey, userData.vipNotificationId);
            this.openModal('vipNotificationModal');

            if (db) {
                db.collection('users').doc(this.currentUserId).set({
                    vipNotificationPending: false,
                    vipNotificationSeenAt: new Date().toISOString(),
                    vipNotificationSeenDeviceId: this.deviceId
                }, { merge: true }).catch((error) => console.error('Falha ao confirmar aviso VIP:', error));
            }
        };

        EvolutionApp.prototype.handleCurrentUserRemoteUpdate = function(userData) {
            if (!userData || !this.currentUserId || userData.docId !== this.currentUserId) return;
            const previousVip = this.isVip;
            const info = this.getVipInfo(userData);
            this.isVip = info.active || !!userData.vip || this.isAdmin;
            this.users[this.currentUserId] = { ...(this.users[this.currentUserId] || {}), ...userData };
            this.saveUsersToCache();
            this.updateVipUI();
            if (!previousVip && this.isVip) {
                this.scheduleHistorySync('vip-activated', 600);
            }
            this.checkVipNotification(userData);
        };
