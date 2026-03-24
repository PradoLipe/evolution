        EvolutionApp.prototype.loadFromLocalStorage = function() {
            const key = `evo_data_${this.currentUserId}`;
            const saved = safeStorage.getItem(key);
            if (saved) {
                try {
                    this.entries = JSON.parse(saved).map(e => ({
                        ...e,
                        bruto: Number(e.bruto) || 0,
                        liquido: Number(e.liquido) || 0
                    }));
                } catch (e) {
                    this.entries = [];
                }
            }
            // Carregar navios aprendidos
            try {
                const learnedRaw = safeStorage.getItem(`evo_learned_navios_${this.currentUserId}`);
                this.learnedNavios = new Set(learnedRaw ? JSON.parse(learnedRaw) : []);
            } catch (e) {
                this.learnedNavios = new Set();
            }
        };

        EvolutionApp.prototype.migrateOldEntries = function() {
            let needsMigration = false;
            this.entries = this.entries.map(entry => {
                if (entry.pago && !entry.paymentDate) {
                    needsMigration = true;
                    entry.paymentDate = entry.data ? new Date(entry.data).toISOString() : new Date().toISOString();
                }
                entry.bruto = Number(entry.bruto) || 0;
                entry.liquido = Number(entry.liquido) || 0;
                return entry;
            });
            if (needsMigration) {
                safeStorage.setItem(`evo_data_${this.currentUserId}`, JSON.stringify(this.entries));
            }
        };

        // ============================================
        // INTERFACE PRINCIPAL
        // ============================================
        EvolutionApp.prototype.showMainApp = function() {
            document.getElementById('loginScreen').classList.add('hidden');
            document.getElementById('mainApp').classList.remove('hidden');

            // Atualizar nome
            const userNameEl = document.getElementById('userName');
            if (userNameEl) {
                // Safe: recria o conteudo sem depender de childNodes existentes
                const vipBadgeEl = userNameEl.querySelector('#vipBadge');
                const badgeHtml = vipBadgeEl ? vipBadgeEl.outerHTML : '<span id="vipBadge" class="vip-badge hidden">VIP</span>';
                userNameEl.innerHTML = this.escHtml(this.currentUser) + ' ' + badgeHtml;
            }

            // Avatar
            const user = this.users[this.currentUserId] || {};
            const localAvatar = safeStorage.getItem(`evo_avatar_local_${this.currentUserId}`);
            const finalAvatar = localAvatar || user.avatar;

            const avatarImg = document.getElementById('userAvatarImg');
            const avatarInitials = document.getElementById('userAvatarInitials');

            if (avatarInitials) avatarInitials.textContent = this.currentUser.substring(0, 2);

            if (finalAvatar) {
                if (avatarImg) { avatarImg.src = finalAvatar; avatarImg.classList.remove('hidden'); }
                if (avatarInitials) avatarInitials.classList.add('hidden');
            } else {
                if (avatarImg) avatarImg.classList.add('hidden');
                if (avatarInitials) avatarInitials.classList.remove('hidden');
            }

            // Avatar no modal de perfil + botão remover
            const modalImg = document.getElementById('profileAvatarImg');
            const modalInitials = document.getElementById('profileAvatarInitials');
            const btnDel = document.getElementById('btnDeleteAvatar');

            if (modalInitials) modalInitials.textContent = this.currentUser.substring(0, 2);

            if (finalAvatar) {
                if (modalImg) {
                    modalImg.src = finalAvatar;
                    modalImg.classList.remove('hidden');
                }
                if (modalInitials) modalInitials.classList.add('hidden');
                if (btnDel) btnDel.classList.remove('hidden');
            } else {
                if (modalImg) modalImg.classList.add('hidden');
                if (modalInitials) modalInitials.classList.remove('hidden');
                if (btnDel) btnDel.classList.add('hidden');
            }

            // Badge VIP/Admin
            const vipBadge = document.getElementById('vipBadge');
            if (vipBadge) {
                if (this.isAdmin) {
                    vipBadge.textContent = 'ADM';
                    vipBadge.className = 'adm-badge';
                    vipBadge.classList.remove('hidden');
                } else if (this.isVip) {
                    vipBadge.textContent = 'VIP';
                    vipBadge.className = 'vip-badge';
                    vipBadge.classList.remove('hidden');
                } else {
                    vipBadge.classList.add('hidden');
                }
            }

            // Nome no modal de perfil + VIP info (tempo restante/origem)
            const profileNameEl = document.getElementById('profileName');
            if (profileNameEl) profileNameEl.textContent = this.currentUser;

            this.updateVipUI();

            // Botao admin
            const btnAdmin = document.getElementById('btnAdmin');
            if (btnAdmin) {
                btnAdmin.classList.toggle('hidden', !this.isAdmin);
            }

            // Atualizar dashboard
            this.updateDashboard();
            this.renderHistory();
            this.renderChart();
            this.loadMeta();

            // Restaurar estado do toggle de resumo de pendências
            const toggleSummary = document.getElementById('togglePendingSummary');
            if (toggleSummary) toggleSummary.checked = safeStorage.getItem('evo_pending_summary_disabled') !== 'true';

            // Resumo de pendências ao abrir (showOnLogin=true)
            this.renderPendingSummary(true);

            // Aviso de encerramento gratuito (expira automaticamente apos 31/03/2026)
            this.showAnnouncementIfNeeded();
        };

        // ============================================
        // RESUMO DE PENDENCIAS
        // ============================================
        // showOnLogin=true apenas no login; false para atualizacoes silenciosas (ex: togglePago)
        // Retorna a chave do periodo atual do dia para o usuario logado.
        // Periodos: manha (05-11h), tarde (12-17h), noite (18-04h).
        EvolutionApp.prototype._getPendingSummaryPeriodKey = function() {
            if (!this.currentUserId) return null;
            const now = getManausDate();
            const dateStr = formatDateManaus(now);
            const hour = now.getHours();
            let period;
            if (hour >= 5 && hour < 12) period = 'manha';
            else if (hour >= 12 && hour < 18) period = 'tarde';
            else period = 'noite';
            return `evo_psum_seen_${this.currentUserId}_${dateStr}_${period}`;
        };

        // Marca o periodo atual como ja exibido (chamado ao fechar ou ver pendentes).
        EvolutionApp.prototype._markPendingSummaryPeriodSeen = function() {
            const key = this._getPendingSummaryPeriodKey();
            if (key) safeStorage.setItem(key, '1');
        };

        EvolutionApp.prototype.renderPendingSummary = function(showOnLogin) {
            const overlay = document.getElementById('pendingSummaryOverlay');
            if (!overlay) return;

            // Verificar se o usuario desabilitou o informativo
            if (safeStorage.getItem('evo_pending_summary_disabled') === 'true') return;

            // Se nao e chamada de login e o overlay ja esta fechado, apenas atualiza os dados sem reabrir
            const isVisible = !overlay.classList.contains('hidden');
            if (!showOnLogin && !isVisible) return;

            // Limite de uma exibicao por periodo do dia (manha/tarde/noite).
            // Se ja foi exibido neste periodo, nao reabre — mesmo no login.
            if (showOnLogin) {
                const periodKey = this._getPendingSummaryPeriodKey();
                if (periodKey && safeStorage.getItem(periodKey) === '1') return;
            }

            const pending = (this.entries || []).filter(e => e && !e.pago);
            const totalLiq = pending.reduce((s, e) => s + (Number(e.liquido) || 0), 0);

            // Saudação por horário (Manaus)
            const hora = getManausDate().getHours();
            let saudacao = 'Boa noite';
            if (hora >= 5 && hora < 12) saudacao = 'Bom dia';
            else if (hora >= 12 && hora < 18) saudacao = 'Boa tarde';

            const helloEl = document.getElementById('pendingSummaryHello');
            const nameEl = document.getElementById('pendingSummaryName');
            if (helloEl) helloEl.textContent = saudacao;
            if (nameEl) nameEl.textContent = this.currentUser || 'Usuário';

            const bodyEl = document.getElementById('pendingSummaryBody');
            const clearEl = document.getElementById('pendingSummaryClear');

            if (pending.length === 0) {
                // Tudo em dia
                if (bodyEl) bodyEl.classList.add('hidden');
                if (clearEl) clearEl.classList.remove('hidden');
                overlay.classList.remove('hidden');
                return;
            }

            // Tem pendências
            if (bodyEl) bodyEl.classList.remove('hidden');
            if (clearEl) clearEl.classList.add('hidden');

            // Contagem e valor
            const countEl = document.getElementById('pendingSummaryCount');
            const valueEl = document.getElementById('pendingSummaryValue');
            const labelEl = document.getElementById('pendingSummaryLabel');
            if (countEl) countEl.textContent = pending.length;
            if (valueEl) valueEl.textContent = this.formatMoney(totalLiq);
            if (labelEl) labelEl.textContent = pending.length === 1 ? 'serviço pendente' : 'serviços pendentes';

            // Datas: mais recente e mais antigo
            const sorted = pending.filter(e => e.data).sort((a, b) => String(a.data).localeCompare(String(b.data)));
            const recentEl = document.getElementById('pendingSummaryRecent');
            const oldestEl = document.getElementById('pendingSummaryOldest');

            if (sorted.length > 0) {
                const hoje = getManausDate();
                const formatAgo = (dateStr) => {
                    const [y, m, d] = dateStr.split('-').map(Number);
                    const target = new Date(y, m - 1, d);
                    const diffMs = hoje.getTime() - target.getTime();
                    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
                    if (diffDays === 0) return 'Hoje';
                    if (diffDays === 1) return 'Ontem';
                    return `${diffDays} dias atrás`;
                };
                const oldest = sorted[0];
                const recent = sorted[sorted.length - 1];
                if (oldestEl) oldestEl.textContent = formatAgo(oldest.data);
                if (recentEl) recentEl.textContent = formatAgo(recent.data);
            } else {
                if (recentEl) recentEl.textContent = '-';
                if (oldestEl) oldestEl.textContent = '-';
            }

            overlay.classList.remove('hidden');
        };

        EvolutionApp.prototype.dismissPendingSummary = function() {
            const overlay = document.getElementById('pendingSummaryOverlay');
            if (!overlay) return;
            // Marca periodo como visto para nao reabrir ate o proximo periodo
            this._markPendingSummaryPeriodSeen();
            overlay.classList.add('dismissing');
            setTimeout(() => {
                overlay.classList.add('hidden');
                overlay.classList.remove('dismissing');
            }, 350);
        };

        EvolutionApp.prototype.togglePendingSummarySetting = function(enabled) {
            safeStorage.setItem('evo_pending_summary_disabled', enabled ? 'false' : 'true');
        };

        // ============================================
        // DASHBOARD
        // ============================================
        EvolutionApp.prototype.setDashboardMode = function(mode, save = true) {
            this.dashboardMode = mode;
            if (save) safeStorage.setItem('evo_dashboard_mode', mode);

            const pill = document.getElementById('dashboardSegmentedControl');
            const btnAll = document.getElementById('btnFilterAll');
            const btnMonth = document.getElementById('btnFilterMonth');
            const monthSelector = document.getElementById('monthSelectorInline');
            const periodIndicator = document.getElementById('periodIndicator');

            if (pill) pill.setAttribute('data-state', mode);

            if (mode === 'all') {
                btnAll?.classList.add('active');
                btnMonth?.classList.remove('active');
                monthSelector?.classList.remove('visible');
                periodIndicator?.classList.remove('visible');
            } else {
                btnAll?.classList.remove('active');
                btnMonth?.classList.add('active');
                monthSelector?.classList.add('visible');
                periodIndicator?.classList.add('visible');
            }

            this.updateDashboard();
        };

        EvolutionApp.prototype.updateDashboard = function() {
            const mode = this.dashboardMode;
            const monthInput = document.getElementById('dashboardMonthInput');
            const monthVal = monthInput ? monthInput.value : '';

            if (mode === 'month' && monthVal) {
                this.selectedMonth = monthVal;
                safeStorage.setItem('evo_dashboard_month', monthVal);
            }

            let allEntries = this.entries;
            // Restricao VIP: nao-VIP ve apenas ultimos 15 dias
            if (!this.isAdmin && !this.isVip) {
                const cutoff = new Date();
                cutoff.setDate(cutoff.getDate() - 15);
                const cutoffStr = cutoff.toISOString().substring(0, 10);
                allEntries = allEntries.filter(e => e.data && e.data >= cutoffStr);
            }

            let filtered = [];
            if (mode === 'all') {
                filtered = allEntries;
            } else if (mode === 'month' && monthVal) {
                filtered = allEntries.filter(e => {
                    if (!e.data) return false;
                    const parts = e.data.split('-');
                    return parts.length === 3 && `${parts[0]}-${parts[1]}` === monthVal;
                });
            }

            let tb = 0, tl = 0, p = 0, pg = 0, cp = 0, cpg = 0;
            filtered.forEach(e => {
                const b = Number(e.bruto) || 0;
                const l = Number(e.liquido) || 0;
                tb += b;
                tl += l;
                if (e.pago) {
                    pg += l;
                    cpg++;
                } else {
                    p += l;
                    cp++;
                }
            });

            document.getElementById('dashBruto').textContent = this.formatMoney(tb);
            document.getElementById('dashLiq').textContent = this.formatMoney(tl);
            document.getElementById('dashPend').textContent = this.formatMoney(p);
            document.getElementById('dashPago').textContent = this.formatMoney(pg);
            document.getElementById('countPend').textContent = `${cp} serviço${cp !== 1 ? 's' : ''}`;
            document.getElementById('countPago').textContent = `${cpg} serviço${cpg !== 1 ? 's' : ''}`;

            this.updateMetaProgress();
        };

        // ============================================
        // HISTORICO
        // ============================================
        EvolutionApp.prototype.setFilter = function(f) {
            this.currentFilter = f;
            this.currentPage = 1;
            document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
            document.getElementById(`filter-${f}`)?.classList.add('active');

            const subs = { all: 'Todos os registros', pending: 'Aguardando pagamento', paid: 'Valores recebidos' };
            document.getElementById('histSubtitle').textContent = subs[f];

            const monthSelector = document.getElementById('monthSelector');
            const monthSelect = document.getElementById('monthSelect');
            if (f === 'all' || f === 'paid') {
                monthSelector.style.display = 'block';
                const savedMonth = safeStorage.getItem('evo_history_month');
                if (savedMonth) {
                    this.historyMonth = parseInt(savedMonth);
                    monthSelect.value = savedMonth;
                } else if (!monthSelect.value) {
                    this.historyMonth = null;
                }
            } else {
                monthSelector.style.display = 'none';
                this.historyMonth = null;
                if (monthSelect) monthSelect.value = '';
            }

            safeStorage.setItem('evo_history_filter', f);
            this.updateHistSubtitle();
            this.renderHistory();
        };

        EvolutionApp.prototype.setMonth = function(month) {
            this.historyMonth = month ? parseInt(month) : null;
            this.currentPage = 1;

            if (this.historyMonth) {
                safeStorage.setItem('evo_history_month', String(this.historyMonth));
            } else {
                safeStorage.removeItem('evo_history_month');
            }

            this.updateHistSubtitle();
            this.renderHistory();
        };

        EvolutionApp.prototype.updateHistSubtitle = function() {
            const meses = ['', 'Janeiro', 'Fevereiro', 'Marco', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
            if (this.historyMonth) {
                const prefixo = this.currentFilter === 'paid' ? 'Recebidos de ' : 'Registros de ';
                document.getElementById('histSubtitle').textContent = prefixo + meses[this.historyMonth];
            } else {
                const subs = { all: 'Todos os registros', pending: 'Aguardando pagamento', paid: 'Valores recebidos' };
                document.getElementById('histSubtitle').textContent = subs[this.currentFilter] || 'Todos os registros';
            }
        };

        EvolutionApp.prototype.restoreHistoryPrefs = function() {
            const savedFilter = safeStorage.getItem('evo_history_filter');
            const savedMonth = safeStorage.getItem('evo_history_month');

            if (savedFilter && savedFilter !== 'pending') {
                this.setFilter(savedFilter);
            }
            if (savedMonth) {
                const monthSelect = document.getElementById('monthSelect');
                if (monthSelect) monthSelect.value = savedMonth;
                this.historyMonth = parseInt(savedMonth);
                this.updateHistSubtitle();
                this.renderHistory();
            }
        };

        EvolutionApp.prototype.renderHistory = function() {
            const list = document.getElementById('histList');
            if (!list) return;

            let filtered = [...this.entries];

            // Restricao VIP: nao-VIP ve apenas ultimos 15 dias
            if (!this.isAdmin && !this.isVip) {
                const cutoff = new Date();
                cutoff.setDate(cutoff.getDate() - 15);
                const cutoffStr = cutoff.toISOString().substring(0, 10);
                filtered = filtered.filter(e => e.data && e.data >= cutoffStr);
            }

            if (this.currentFilter === 'pending') {
                filtered = filtered.filter(e => !e.pago);
                filtered.sort((a, b) => new Date(a.data) - new Date(b.data));
            } else if (this.currentFilter === 'paid') {
                filtered = filtered.filter(e => e.pago);
                if (this.historyMonth) {
                    filtered = filtered.filter(e => {
                        if (!e.data) return false;
                        const parts = e.data.split('-');
                        const month = parseInt(parts[1], 10);
                        return month === this.historyMonth;
                    });
                }
                filtered.sort((a, b) => {
                    const dateA = a.paymentDate ? new Date(a.paymentDate) : new Date(a.data);
                    const dateB = b.paymentDate ? new Date(b.paymentDate) : new Date(b.data);
                    return dateB - dateA;
                });
            } else {
                if (this.historyMonth) {
                    filtered = filtered.filter(e => {
                        if (!e.data) return false;
                        const parts = e.data.split('-');
                        const month = parseInt(parts[1], 10);
                        return month === this.historyMonth;
                    });
                }
                filtered.sort((a, b) => new Date(b.data) - new Date(a.data));
            }

            if (filtered.length === 0) {
                list.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📭</div><div style="font-size:0.85rem;font-weight:600;">Nenhum registro</div></div>';
                return;
            }

            const totalPages = Math.ceil(filtered.length / this.itemsPerPage);
            const start = (this.currentPage - 1) * this.itemsPerPage;
            const paged = filtered.slice(start, start + this.itemsPerPage);

            let html = paged.map(e => `
                <div class="history-item ${e.pago ? 'paid' : 'pending'} ${String(this.expandedHistoryId) === String(e.id) ? 'expanded' : ''}" id="history-item-${e.id}">
                    <div class="history-main-row" onclick="app.toggleHistoryDetail('${e.id}')">
                        <div class="history-main">
                            <div class="history-ship">${this.escHtml(e.navio)}</div>
                            <div class="history-meta">${this.escHtml(e.dataF)} • ${this.escHtml(e.turno)}</div>
                            <span class="status-badge ${e.pago ? 'paid' : 'pending'}">${e.pago ? '✓ PAGO' : '⏳ PENDENTE'}</span>
                        </div>
                        <div class="history-values">
                            <div class="history-liquid">${this.formatMoney(e.liquido)}</div>
                            <div class="history-bruto">B: ${this.formatMoney(e.bruto)}</div>
                        </div>
                        <div class="history-expand-icon">▼</div>
                    </div>
                    <div class="history-details">
                        <div class="details-grid">
                            <div class="detail-item"><div class="detail-label">Data</div><div class="detail-value">${this.escHtml(e.dataF)}</div></div>
                            <div class="detail-item"><div class="detail-label">Turno</div><div class="detail-value">${this.escHtml(e.turno)}</div></div>
                            <div class="detail-item"><div class="detail-label">Tipo</div><div class="detail-value">${e.tipo === 'normal' ? 'Normal' : 'Feriado'}</div></div>
                            <div class="detail-item"><div class="detail-label">Conf.</div><div class="detail-value">${this.escHtml(String(e.conferentes))}</div></div>
                        </div>
                        <div class="history-actions-row">
                            <button class="action-btn" onclick="event.stopPropagation(); app.togglePago('${e.id}');">${e.pago ? '↩ Desfazer' : '✓ Pagar'}</button>
                            <button class="action-btn" onclick="event.stopPropagation(); app.copyEntryDetails('${e.id}');">📋 Copiar</button>
                            <button class="action-btn" onclick="event.stopPropagation(); app.openEditModal('${e.id}');">✏ Editar</button>
                            <button class="action-btn delete" onclick="event.stopPropagation(); app.deleteEntry('${e.id}');">🗑 Excluir</button>
                        </div>
                    </div>
                </div>
            `).join('');

            if (totalPages > 1) {
                html += `<div class="pagination-controls">
                    <button class="page-btn" onclick="app.changePage(-1)" ${this.currentPage === 1 ? 'disabled' : ''}>←</button>
                    <span class="page-info">Pagina ${this.currentPage} de ${totalPages}</span>
                    <button class="page-btn" onclick="app.changePage(1)" ${this.currentPage === totalPages ? 'disabled' : ''}>→</button>
                </div>`;
            }

            list.innerHTML = html;
        };

        EvolutionApp.prototype.toggleHistoryDetail = function(id) {
            // Protecao defensiva: se nenhum modal esta aberto, garante que o scroll da pagina nao fica travado
            if ((this._openModalCount || 0) === 0) {
                document.body.style.overflow = '';
            }

            const sid = String(id);
            const item = document.getElementById(`history-item-${sid}`);
            if (!item) return;

            if (String(this.expandedHistoryId) === sid) {
                item.classList.remove('expanded');
                this.expandedHistoryId = null;
            } else {
                if (this.expandedHistoryId) {
                    const prev = document.getElementById(`history-item-${this.expandedHistoryId}`);
                    if (prev) prev.classList.remove('expanded');
                }
                item.classList.add('expanded');
                this.expandedHistoryId = sid;
            }
        };

        EvolutionApp.prototype.changePage = function(delta) {
            let filtered = [...this.entries];
            // Restricao VIP: nao-VIP ve apenas ultimos 15 dias
            if (!this.isAdmin && !this.isVip) {
                const cutoff = new Date();
                cutoff.setDate(cutoff.getDate() - 15);
                const cutoffStr = cutoff.toISOString().substring(0, 10);
                filtered = filtered.filter(e => e.data && e.data >= cutoffStr);
            }
            if (this.currentFilter === 'pending') {
                filtered = filtered.filter(e => !e.pago);
            } else if (this.currentFilter === 'paid') {
                filtered = filtered.filter(e => e.pago);
            }
            if (this.historyMonth && this.currentFilter !== 'pending') {
                filtered = filtered.filter(e => {
                    if (!e.data) return false;
                    const parts = e.data.split('-');
                    return parseInt(parts[1], 10) === this.historyMonth;
                });
            }
            const totalPages = Math.ceil(filtered.length / this.itemsPerPage) || 1;
            this.currentPage = Math.min(Math.max(1, this.currentPage + delta), totalPages);
            this.renderHistory();
        };

        // Vibração haptica: Android via Vibration API, iOS via AudioContext (pulso silencioso)
        EvolutionApp.prototype.triggerHaptic = function(type = 'medium') {
            // Android / Chrome: Vibration API
            if (navigator.vibrate) {
                const patterns = { light: [30], medium: [60], success: [40, 30, 80] };
                navigator.vibrate(patterns[type] || patterns.medium);
            }
            // FIX 13: iOS Safari — AudioContext fechado corretamente em todos os caminhos
            let ctx = null;
            try {
                ctx = new (window.AudioContext || window.webkitAudioContext)();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                gain.gain.setValueAtTime(0.00001, ctx.currentTime);
                osc.frequency.setValueAtTime(type === 'success' ? 200 : 150, ctx.currentTime);
                const duration = type === 'success' ? 0.12 : 0.06;
                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + duration);
                osc.onended = () => { try { ctx.close(); } catch(_) {} };
                // Garantia: fecha apos o dobro do tempo esperado
                setTimeout(() => { try { if (ctx.state !== 'closed') ctx.close(); } catch(_) {} }, (duration * 1000) + 200);
            } catch (_) {
                if (ctx) { try { ctx.close(); } catch(__) {} }
            }
        };

        EvolutionApp.prototype.togglePago = async function(id) {
            const e = this.entries.find(x => String(x.id) === String(id));
            if (!e) return;

            e.pago = !e.pago;
            if (e.pago) {
                e.paymentDate = new Date().toISOString();
                this.triggerPaymentAnimation(e.liquido);
                this.triggerHaptic('success'); // vibração ao confirmar pagamento
            } else {
                delete e.paymentDate;
                this.triggerHaptic('light'); // vibração leve ao desmarcar
            }

            safeStorage.setItem(`evo_data_${this.currentUserId}`, JSON.stringify(this.entries));
            this.updateDashboard();
            this.renderHistory();
            // allowCelebration=true: única ação que pode disparar a celebração de meta
            if (e.pago) this.updateMetaProgress(true);
            // Atualizar calendario imediatamente ao alterar status de pagamento
            if (typeof this.renderCalendar === 'function') { this.syncCalendarMonthWithEntries(true); this.renderCalendar(); }
            // Atualizar resumo de pendencias
            this.renderPendingSummary();
            this.persistData();

            this.showToast(e.pago ? '✓ Marcado como pago' : '↩ Marcado como pendente', 'success');
        };

        EvolutionApp.prototype.deleteEntry = function(id) {
            const entry = this.entries.find(e => String(e.id) === String(id));
            if (!entry) return;

            // Guarda para possivel undo
            this._undoEntry = { ...entry };
            this._undoIndex = this.entries.findIndex(e => String(e.id) === String(id));

            // Registrar no tombstone imediatamente (evita ressurreicao do Firebase)
            this.addDeletedId(id);
            this.entries = this.entries.filter(e => String(e.id) !== String(id));
            safeStorage.setItem(`evo_data_${this.currentUserId}`, JSON.stringify(this.entries));

            this.expandedHistoryId = null;
            // Recalcular currentPage para nao apontar para pagina vazia
            const remaining = this.currentFilter === 'pending'
                ? this.entries.filter(e => !e.pago)
                : this.currentFilter === 'paid'
                    ? this.entries.filter(e => e.pago)
                    : this.entries;
            const maxPage = Math.ceil(remaining.length / this.itemsPerPage) || 1;
            if (this.currentPage > maxPage) this.currentPage = maxPage;
            this.updateDashboard();
            this.renderHistory();
            this.renderChart();
            this.updateMetaProgress();
            if (typeof this.renderCalendar === 'function') { this.syncCalendarMonthWithEntries(true); this.renderCalendar(); }
            this.renderPendingSummary();
            this.hideNavioSuggestions('calcNavio');
            this.hideNavioSuggestions('relNavio');

            // Cancela timer anterior se existir
            if (this._undoTimer) clearTimeout(this._undoTimer);

            this.showUndoToast('Registro excluído', () => {
                // Restaurar registro
                if (this._undoEntry) {
                    // Remover do tombstone para nao bloquear restauracao
                    try {
                        const ids = this.getDeletedIds();
                        ids.delete(String(this._undoEntry.id));
                        const arr = [...ids].slice(-2000);
                        safeStorage.setItem(this.getDeletedIdsKey(), JSON.stringify(arr));
                    } catch(_) {}
                    // Reinserir na posicao original
                    const idx = Math.min(this._undoIndex || 0, this.entries.length);
                    this.entries.splice(idx, 0, this._undoEntry);
                    safeStorage.setItem(`evo_data_${this.currentUserId}`, JSON.stringify(this.entries));
                    this._undoEntry = null;
                    this.updateDashboard();
                    this.renderHistory();
                    this.renderChart();
                    this.updateMetaProgress();
                    if (typeof this.renderCalendar === 'function') { this.syncCalendarMonthWithEntries(true); this.renderCalendar(); }
                    this.renderPendingSummary();
                    this.showToast('Registro restaurado', 'success');
                    if (this._undoTimer) clearTimeout(this._undoTimer);
                }
            });

            // Apos 5s confirma a exclusao e sincroniza
            this._undoTimer = setTimeout(() => {
                if (this._undoEntry) {
                    const allMonths = this.collectEntryMonths();
                    const currentMonth = getCurrentMonthStringManaus();
                    const monthsToSync = new Set([...allMonths, currentMonth]);
                    this.markHistoryMonthsPending([...monthsToSync]);
                    this.persistData();
                    this._undoEntry = null;
                }
            }, 5000);
        };

        EvolutionApp.prototype.executeDelete = function() {
            // Mantido para compatibilidade com o modal de confirmacao (nao usado no fluxo principal)
            if (!this.pendingDeleteId) return;
            this.deleteEntry(this.pendingDeleteId);
            this.closeModal('confirmModal');
            this.pendingDeleteId = null;
        };

        EvolutionApp.prototype.copyEntryDetails = function(id) {
            const e = this.entries.find(x => String(x.id) === String(id));
            if (!e) return;
            const text = `${e.navio} - ${e.dataF}
Turno: ${e.turno}
Tipo: ${e.tipo}
Bruto: ${this.formatMoney(e.bruto)}
Liquido: ${this.formatMoney(e.liquido)}`;
            this.copyToClipboard(text, 'Copiado!');
        };

        // ============================================
        // CALENDÁRIO E EDIÇÃO
        // ============================================

        /**
         * Sugere automaticamente o turno mais frequente com base nos registros existentes.
         * Ao invocar este metodo, o campo calcTurno sera atualizado para o turno
         * mais usado pelo usuario. Caso nao existam registros, permanece o valor atual.
         */
        EvolutionApp.prototype.suggestDefaultTurno = function() {
            try {
                const freq = {};
                (this.entries || []).forEach(e => {
                    if (!e || !e.turno) return;
                    freq[e.turno] = (freq[e.turno] || 0) + 1;
                });
                let max = 0;
                let best = null;
                Object.keys(freq).forEach(k => {
                    if (freq[k] > max) { max = freq[k]; best = k; }
                });
                if (best) {
                    const sel = document.getElementById('calcTurno');
                    if (sel && sel.value !== best) {
                        sel.value = best;
                        this.adjustCalcFields();
                    }
                }
            } catch (err) {
                console.error('Erro ao sugerir turno', err);
            }
        };

        /**
         * Atualiza os campos de edicao conforme o turno selecionado. Similar a adjustCalcFields,
         * mas opera nos elementos de edicao (editP1, editP2, editPT). Quando o turno e 15x23,
         * exibe 2 campos de producao; nos demais, apenas o total.
         */
        EvolutionApp.prototype.adjustEditFields = function() {
            const turno = document.getElementById('editTurno')?.value;
            const container = document.getElementById('editCampos');
            if (!container) return;
            if (turno === '15x23') {
                container.innerHTML = `<div class="input-row"><div class="input-group"><label class="input-label">15h-19h</label><input type="number" id="editP1" placeholder="0"></div><div class="input-group"><label class="input-label">19h-23h</label><input type="number" id="editP2" placeholder="0"></div></div>`;
            } else {
                container.innerHTML = `<div class="input-group"><label class="input-label">Producao Total</label><input type="number" id="editPT" placeholder="0"></div>`;
            }
        };

        /**
         * Abre o modal de edicao de registro, preenchendo os campos com os dados
         * da entrada escolhida. Mantem o ID original para que a atualizacao seja feita
         * na mesma posicao do array de entradas.
         * @param {string|number} id ID da entrada a ser editada
         */
        EvolutionApp.prototype.openEditModal = function(id) {
            const entry = this.entries.find(e => String(e.id) === String(id));
            if (!entry) return;
            // Guardar o id em edicao para salvar posteriormente
            this.editingEntryId = entry.id;
            // Preencher campos
            const navioInput = document.getElementById('editNavio');
            const dataInput = document.getElementById('editData');
            const confInput = document.getElementById('editQtdConf');
            const turnoInput = document.getElementById('editTurno');
            const tipoInput = document.getElementById('editTipo');
            if (navioInput) navioInput.value = entry.navio || '';
            if (dataInput) dataInput.value = entry.data || '';
            if (confInput) confInput.value = entry.conferentes || 1;
            if (turnoInput) turnoInput.value = entry.turno || '';
            if (tipoInput) tipoInput.value = entry.tipo || 'normal';
            // Ajustar campos de producao
            this.adjustEditFields();
            // FIX 7: Verificacao de nulo antes de acessar .value nos campos de producao
            if (entry.turno === '15x23') {
                const p1 = document.getElementById('editP1');
                const p2 = document.getElementById('editP2');
                if (p1) p1.value = Array.isArray(entry.valores) ? (entry.valores[0] || '') : '';
                if (p2) p2.value = Array.isArray(entry.valores) ? (entry.valores[1] || '') : '';
            } else {
                const pt = document.getElementById('editPT');
                if (pt) pt.value = Array.isArray(entry.valores) ? (entry.valores[0] || '') : '';
            }
            // Abrir modal
            this.openModal('editModal');
        };

        /**
         * Salva as alteracoes feitas no modal de edicao. Recalcula os valores
         * brutos e liquidos com base nas novas informacoes e atualiza o objeto de entrada
         * mantendo o mesmo ID. Em seguida, atualiza a interface, salva localmente
         * e sincroniza com o Firestore.
         */
        EvolutionApp.prototype.saveEditedEntry = function() {
            if (!this.editingEntryId) return;
            const navio = document.getElementById('editNavio')?.value?.toUpperCase().trim() || '';
            const data = document.getElementById('editData')?.value || '';
            const conf = parseInt(document.getElementById('editQtdConf')?.value) || 1;
            const turno = document.getElementById('editTurno')?.value || '';
            const tipo = document.getElementById('editTipo')?.value || 'normal';
            if (!navio || !data || !turno) {
                this.showToast('Preencha todos os campos', 'error');
                return;
            }
            let valores;
            if (turno === '15x23') {
                const p1 = document.getElementById('editP1')?.value || 0;
                const p2 = document.getElementById('editP2')?.value || 0;
                valores = [p1, p2];
            } else {
                const pt = document.getElementById('editPT')?.value || 0;
                valores = [pt];
            }
            const res = this.calcularValores(tipo, turno, valores, conf);
            // Encontrar entrada para atualizar
            const idx = this.entries.findIndex(e => String(e.id) === String(this.editingEntryId));
            if (idx !== -1) {
                const [y, m, d] = data.split('-');
                this.entries[idx] = {
                    ...this.entries[idx],
                    navio,
                    data,
                    dataF: `${d}/${m}/${y}`,
                    turno,
                    tipo,
                    valores,
                    conferentes: conf,
                    bruto: res.bruto,
                    liquido: res.liquido
                };
                safeStorage.setItem(`evo_data_${this.currentUserId}`, JSON.stringify(this.entries));
                // Atualizar dashboards e listas
                this.updateDashboard();
                this.renderHistory();
                this.renderChart();
                this.updateMetaProgress();
                // Atualizar calendario e sugestoes
                if (typeof this.renderCalendar === 'function') { this.syncCalendarMonthWithEntries(true); this.renderCalendar(); }
                this.renderPendingSummary();
                // Sugerir turno mais utilizado novamente
                this.suggestDefaultTurno();
                // Atualizar caixas de sugestoes (esconder ja que o usuario nao esta digitando)
                this.hideNavioSuggestions('calcNavio');
                this.hideNavioSuggestions('relNavio');
                this.persistData();
                this.showToast('Registro atualizado!', 'success');
            }
            this.closeModal('editModal');
            this.editingEntryId = null;
        };

        /**
         * Exibe sugestões de nomes de navio baseadas no historico. A lista e filtrada
         * pelo valor digitado e exclui sugestoes previamente removidas. Itens podem ser
         * removidos por long press de 3 segundos, apos confirmacao do usuario.
         * @param {string} fieldId ID do campo de input (calcNavio ou relNavio)
         */
        EvolutionApp.prototype.learnNavioName = function(name) {
            if (!name || !this.currentUserId) return;
            if (!this.learnedNavios) this.learnedNavios = new Set();
            this.learnedNavios.add(name.toUpperCase().trim());
            // Limita a 500 entradas
            if (this.learnedNavios.size > 500) {
                const arr = Array.from(this.learnedNavios);
                this.learnedNavios = new Set(arr.slice(-500));
            }
            safeStorage.setItem(`evo_learned_navios_${this.currentUserId}`, JSON.stringify(Array.from(this.learnedNavios)));
        };

        EvolutionApp.prototype.hideNavioSuggestions = function(fieldId) {
            const container = document.getElementById(fieldId + 'Suggestions');
            const wrapper = container?.closest('.navio-suggestions');
            if (container) {
                container.style.display = 'none';
                container.innerHTML = '';
            }
            if (wrapper) wrapper.classList.remove('open');
        };

        EvolutionApp.prototype._onNavioInput = function(inputEl, fieldId) {
            // Atualiza botão limpar
            const clearBtn = document.getElementById(fieldId + 'Clear');
            if (clearBtn) clearBtn.classList.toggle('visible', inputEl.value.length > 0);
            this.showNavioSuggestions(fieldId);
        };

        EvolutionApp.prototype.clearNavioInput = function(fieldId) {
            const inputEl = document.getElementById(fieldId);
            if (inputEl) inputEl.value = '';
            const clearBtn = document.getElementById(fieldId + 'Clear');
            if (clearBtn) clearBtn.classList.remove('visible');
            this.hideNavioSuggestions(fieldId);
            inputEl?.focus();
        };

        EvolutionApp.prototype.showNavioSuggestions = function(fieldId) {
            try {
                const inputEl = document.getElementById(fieldId);
                if (!inputEl) return;
                const container = document.getElementById(fieldId + 'Suggestions');
                if (!container) return;
                const wrapper = container.closest('.navio-suggestions');
                const query = inputEl.value.toUpperCase().trim();

                // Atualizar botão limpar
                const clearBtn = document.getElementById(fieldId + 'Clear');
                if (clearBtn) clearBtn.classList.toggle('visible', inputEl.value.length > 0);

                // Só exibe sugestões após o usuário digitar pelo menos 1 caractere
                if (!query) {
                    this.hideNavioSuggestions(fieldId);
                    return;
                }

                const navioMap = new Map();
                // Navios aprendidos (persistem mesmo apos exclusao de registros)
                (this.learnedNavios || []).forEach(name => {
                    if (!name || this.removedNavioSuggestions?.has(name)) return;
                    if (!navioMap.has(name)) navioMap.set(name, { name, count: 0, lastDate: '' });
                });
                // Navios dos registros atuais (sobrescrevem com dados de uso real)
                (this.entries || []).forEach(e => {
                    if (!e?.navio || this.removedNavioSuggestions?.has(e.navio)) return;
                    const prev = navioMap.get(e.navio);
                    const dateValue = e.data || '';
                    if (!prev) {
                        navioMap.set(e.navio, { name: e.navio, count: 1, lastDate: dateValue });
                        return;
                    }
                    prev.count += 1;
                    if (dateValue > (prev.lastDate || '')) prev.lastDate = dateValue;
                });

                let filtered = Array.from(navioMap.values());
                // Filtra apenas nomes que COMEÇAM com o que foi digitado
                filtered = filtered.filter(item => item.name.startsWith(query));
                filtered.sort((a, b) => {
                    if ((b.lastDate || '') !== (a.lastDate || '')) return (b.lastDate || '').localeCompare(a.lastDate || '');
                    return a.name.localeCompare(b.name);
                });
                filtered = filtered.slice(0, 6);

                if (filtered.length === 0) {
                    this.hideNavioSuggestions(fieldId);
                    return;
                }

                container.innerHTML = '';
                filtered.forEach(itemData => {
                    const item = document.createElement('div');
                    item.className = 'navio-suggestion-item';
                    // Exibe apenas o nome do navio, sem data/contagem
                    item.innerHTML = `<span class="navio-suggestion-title">${this.escHtml(itemData.name)}</span>`;
                    item.addEventListener('click', (ev) => {
                        ev.stopPropagation();
                        inputEl.value = itemData.name;
                        const cb = document.getElementById(fieldId + 'Clear');
                        if (cb) cb.classList.add('visible');
                        this.hideNavioSuggestions(fieldId);
                    });
                    let pressTimer;
                    const start = () => { pressTimer = setTimeout(() => {
                        this._pendingRemoveNavio = { name: itemData.name, fieldId };
                        this.openConfirmModal('removeNavio', `Remover "${itemData.name}" das sugestoes?`, itemData.name);
                    }, 2000); };
                    const cancel = () => clearTimeout(pressTimer);
                    item.addEventListener('touchstart', start, { passive: true });
                    item.addEventListener('mousedown', start);
                    ['touchend', 'touchcancel', 'mouseup', 'mouseleave'].forEach(evt => item.addEventListener(evt, cancel));
                    container.appendChild(item);
                });
                container.style.display = 'block';
                if (wrapper) wrapper.classList.add('open');
            } catch (err) {
                console.error('Erro sugestoes navio:', err);
            }
        };

        EvolutionApp.prototype.executeRemoveNavio = function(navioName) {
            if (!navioName) return;
            if (!this.removedNavioSuggestions) this.removedNavioSuggestions = new Set();
            this.removedNavioSuggestions.add(navioName);
            if (this.removedNavioSuggestions.size > 500) {
                const _arr = Array.from(this.removedNavioSuggestions);
                this.removedNavioSuggestions = new Set(_arr.slice(-500));
            }
            safeStorage.setItem('evo_removed_navio', JSON.stringify(Array.from(this.removedNavioSuggestions)));
            const fieldId = this._pendingRemoveNavio?.fieldId;
            if (fieldId) this.showNavioSuggestions(fieldId);
            this._pendingRemoveNavio = null;
        };

        EvolutionApp.prototype.syncCalendarMonthWithEntries = function(forceBestMonth = false) {
            const monthInput = document.getElementById('calendarMonth');
            if (!monthInput) return;
            const savedManualMonth = safeStorage.getItem('evo_calendar_month');
            let targetMonth = savedManualMonth || monthInput.value || this.selectedMonth || getCurrentMonthStringManaus();
            const hasEntries = Array.isArray(this.entries) && this.entries.length > 0;
            if (hasEntries && (!savedManualMonth || forceBestMonth || !monthInput.value)) {
                const sorted = [...this.entries].filter(e => e?.data).sort((a, b) => String(b.data).localeCompare(String(a.data)));
                if (sorted[0]?.data) targetMonth = sorted[0].data.substring(0, 7);
            }
            monthInput.value = targetMonth;
        };

        EvolutionApp.prototype.handleCalendarMonthChange = function() {
            const monthInput = document.getElementById('calendarMonth');
            if (!monthInput) return;
            const monthVal = monthInput.value || '';

            // Restricao VIP: nao-VIP so pode ver o mes atual
            if (!this.isAdmin && !this.isVip) {
                const currentMonth = getCurrentMonthStringManaus();
                if (monthVal && monthVal !== currentMonth) {
                    monthInput.value = currentMonth;
                    this.requireVip('O calendário de meses anteriores é um recurso exclusivo para usuários VIP. Apenas o mês atual está disponível.');
                    return;
                }
            }

            safeStorage.setItem('evo_calendar_month', monthVal);
            // Sincroniza mes do calendario no Firestore para outros dispositivos
            if (db && this.currentUserId && monthVal) {
                db.collection('users').doc(this.currentUserId).set({
                    calendarMonth: monthVal
                }, { merge: true }).catch(e => console.error('Erro ao salvar mes do calendario:', e));
            }
            this.renderCalendar();
        };

        EvolutionApp.prototype.renderCalendar = function() {
            const monthInput = document.getElementById('calendarMonth');
            const grid = document.getElementById('calendarGrid');
            if (!grid) return;

            this.syncCalendarMonthWithEntries();
            let monthStr = monthInput?.value || safeStorage.getItem('evo_calendar_month') || this.selectedMonth || getCurrentMonthStringManaus();
            if (!monthStr) monthStr = getCurrentMonthStringManaus();

            // Restricao VIP: nao-VIP so pode ver o mes atual
            if (!this.isAdmin && !this.isVip) {
                monthStr = getCurrentMonthStringManaus();
            }

            if (monthInput) monthInput.value = monthStr;

            const [year, month] = monthStr.split('-');
            if (!year || !month) return;
            const yearNum = parseInt(year, 10);
            const monthNum = parseInt(month, 10);
            const daysInMonth = new Date(yearNum, monthNum, 0).getDate();
            const firstDay = new Date(yearNum, monthNum - 1, 1).getDay();
            const weekNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
            const todayStr = getCurrentDateStringManaus();
            let html = '';
            weekNames.forEach(n => { html += `<div class="calendar-day header">${n}</div>`; });
            for (let i = 0; i < firstDay; i++) html += `<div class="calendar-day empty"></div>`;

            let totalServicos = 0;
            let totalPagos = 0;
            let totalPendentes = 0;

            for (let d = 1; d <= daysInMonth; d++) {
                const dd = d.toString().padStart(2, '0');
                const mm = month.padStart(2, '0');
                const dateStr = `${year}-${mm}-${dd}`;
                const entriesForDay = (this.entries || []).filter(e => e && e.data === dateStr);
                let statusClass = '';
                let extraClass = dateStr === todayStr ? 'today' : '';
                if (entriesForDay.length > 0) {
                    totalServicos += entriesForDay.length;
                    const paidCount = entriesForDay.filter(e => e.pago).length;
                    totalPagos += paidCount;
                    totalPendentes += (entriesForDay.length - paidCount);
                    const allPaid = paidCount === entriesForDay.length;
                    statusClass = allPaid ? 'paid has-service' : 'pending has-service';
                }
                const hasService = statusClass.includes('has-service');
                const clickAttr = hasService ? `onclick="app.openDaySummary('${dateStr}')"` : '';
                const cursorStyle = hasService ? '' : 'style="cursor:default;"';
                html += `<div class="calendar-day ${statusClass} ${extraClass}" data-date="${dateStr}" ${clickAttr} ${cursorStyle}>${d}</div>`;
            }
            grid.innerHTML = html;
            document.getElementById('calendarTotalServicos').textContent = totalServicos;
            document.getElementById('calendarTotalPagos').textContent = totalPagos;
            document.getElementById('calendarTotalPendentes').textContent = totalPendentes;
        };

        /**
         * Abre o modal de resumo do dia, exibindo os registros do dia selecionado.
         * Mostra navio, data, turno, valores e um botao para edicao de cada registro.
         * @param {string} dateStr Data no formato YYYY-MM-DD
         */
        EvolutionApp.prototype.openDaySummary = function(dateStr) {
            try {
                const list = (this.entries || []).filter(e => e && e.data === dateStr);
                if (list.length === 0) return; // Só abre se houver registro

                const modalTitle = document.getElementById('daySummaryTitle');
                const content = document.getElementById('daySummaryContent');
                if (!content) return;

                if (modalTitle) {
                    const parts = dateStr.split('-');
                    modalTitle.innerHTML = parts.length === 3
                        ? `<span style="font-size:1.1rem;">📅</span> ${parts[2]}/${parts[1]}/${parts[0]}`
                        : `<span style="font-size:1.1rem;">📅</span> Resumo do Dia`;
                }

                const totalBruto = list.reduce((s,e) => s + (Number(e.bruto)||0), 0);
                const totalLiq = list.reduce((s,e) => s + (Number(e.liquido)||0), 0);
                const paidCount = list.filter(e => e.pago).length;

                const summaryBar = `
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:14px 0 16px;">
                    <div style="background:rgba(0,212,255,0.07);border:1px solid rgba(0,212,255,0.18);border-radius:10px;padding:10px;text-align:center;">
                        <div style="font-size:0.58rem;color:var(--text-secondary);text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:4px;">Servicos</div>
                        <div style="font-family:'JetBrains Mono',monospace;font-weight:800;color:var(--primary);font-size:1rem;">${list.length}</div>
                    </div>
                    <div style="background:rgba(0,217,166,0.07);border:1px solid rgba(0,217,166,0.2);border-radius:10px;padding:10px;text-align:center;">
                        <div style="font-size:0.58rem;color:var(--text-secondary);text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:4px;">Liquido</div>
                        <div style="font-family:'JetBrains Mono',monospace;font-weight:800;color:var(--success);font-size:0.85rem;">${this.formatMoney(totalLiq)}</div>
                    </div>
                    <div style="background:rgba(255,184,0,0.07);border:1px solid rgba(255,184,0,0.2);border-radius:10px;padding:10px;text-align:center;">
                        <div style="font-size:0.58rem;color:var(--text-secondary);text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:4px;">Pagos</div>
                        <div style="font-family:'JetBrains Mono',monospace;font-weight:800;color:var(--warning);font-size:1rem;">${paidCount}/${list.length}</div>
                    </div>
                </div>`;

                const cards = list.map(e => {
                    const statusColor = e.pago ? 'var(--success)' : 'var(--warning)';
                    const statusIcon = e.pago ? '✓' : '⏳';
                    const statusLabel = e.pago ? 'Pago' : 'Pendente';
                    const barColor = e.pago ? 'rgba(0,217,166,0.35)' : 'rgba(255,184,0,0.35)';
                    return `
                    <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:8px;position:relative;">
                        <div style="height:3px;background:${barColor};"></div>
                        <div style="padding:12px;">
                            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
                                <div style="font-weight:800;font-size:0.9rem;color:var(--text);">${this.escHtml(e.navio)}</div>
                                <span style="font-size:0.65rem;font-weight:700;color:${statusColor};background:rgba(${e.pago?'0,217,166':'255,184,0'},0.12);border:1px solid ${statusColor};padding:2px 8px;border-radius:20px;">${statusIcon} ${statusLabel}</span>
                            </div>
                            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:0.72rem;color:var(--text-secondary);">
                                <div>🕐 Turno: <strong style="color:var(--text);">${this.escHtml(e.turno)}</strong></div>
                                <div>📋 Tipo: <strong style="color:var(--text);">${e.tipo === 'feriado' ? 'Feriado' : 'Normal'}</strong></div>
                                <div>💰 Bruto: <strong style="color:var(--info);">${this.formatMoney(e.bruto)}</strong></div>
                                <div>💎 Liquido: <strong style="color:var(--success);">${this.formatMoney(e.liquido)}</strong></div>
                            </div>
                            <div style="margin-top:10px;text-align:right;">
                                <button style="background:var(--surface-elevated);border:1px solid var(--border);color:var(--text-secondary);padding:5px 12px;border-radius:8px;font-size:0.7rem;font-weight:700;cursor:pointer;" onclick="app.openEditModal('${e.id}'); app.closeModal('daySummaryModal');">✏ Editar</button>
                            </div>
                        </div>
                    </div>`;
                }).join('');

                content.innerHTML = summaryBar + cards;
                this.openModal('daySummaryModal');
            } catch (err) {
                console.error('Erro ao abrir resumo do dia', err);
            }
        };

        // ============================================
        // META
        // ============================================
        EvolutionApp.prototype.loadMeta = function() {
            const key = `evo_meta_${this.currentUserId}`;
            const s = safeStorage.getItem(key);
            const startDate = safeStorage.getItem(`evo_meta_start_${this.currentUserId}`);
            const goalReached = safeStorage.getItem(`evo_meta_reached_${this.currentUserId}`);

            if (s) {
                this.metaMensal = parseInt(s);
                this.metaStartDate = startDate ? new Date(startDate) : null;
                this.metaGoalReached = goalReached === 'true';
                this.renderMetaCard();
            }
            // Fallback assincrono: carrega do Firestore se localStorage esta vazio (outro navegador)
            this.loadMetaFromFirestore();
        };

        EvolutionApp.prototype.saveMeta = function() {
            const input = document.getElementById('metaInput');
            const rawValue = input.value.replace(/[.]/g, '').replace(',', '.');
            const v = parseFloat(rawValue);

            if (!v || v <= 0) {
                this.showToast('Digite um valor válido', 'error');
                return;
            }

            this.metaMensal = Math.round(v * 100);
            this.metaStartDate = new Date();
            this.metaGoalReached = false;

            safeStorage.setItem(`evo_meta_${this.currentUserId}`, this.metaMensal);
            safeStorage.setItem(`evo_meta_start_${this.currentUserId}`, this.metaStartDate.toISOString());
            safeStorage.setItem(`evo_meta_reached_${this.currentUserId}`, 'false');

            this.renderMetaCard();
            this.toggleMetaEditor();
            this.showToast('Nova meta definida!', 'success');
            // allowCelebration=false: não celebrar ao definir meta (evita falso positivo)
            this.updateMetaProgress(false);
            // Sincroniza meta no Firestore para outros dispositivos
            this.syncMetaToFirestore();
        };

        EvolutionApp.prototype.renderMetaCard = function() {
            if (this.metaMensal > 0) {
                document.getElementById('metaCard').style.display = 'block';
                document.getElementById('metaValor').textContent = this.formatMoney(this.metaMensal);
                this.updateMetaProgress();
            }
        };

        EvolutionApp.prototype.updateMetaProgress = function(allowCelebration = false) {
            if (this.metaMensal <= 0) return;

            let totalLiquido = 0;
            const startTs = this.metaStartDate ? this.metaStartDate.getTime() : 0;

            this.entries.forEach(e => {
                if (e.pago) {
                    let paymentTs = e.paymentDate ? new Date(e.paymentDate).getTime() : (e.data ? new Date(e.data).getTime() : 0);
                    if (!isNaN(paymentTs) && (!startTs || paymentTs >= startTs)) {
                        totalLiquido += Number(e.liquido) || 0;
                    }
                }
            });

            const p = Math.min((totalLiquido / this.metaMensal) * 100, 100);
            document.getElementById('metaProgress').style.width = p + '%';
            const faltam = this.metaMensal - totalLiquido;
            if (p >= 100) {
                document.getElementById('metaAtual').textContent = '✓ Meta atingida!';
            } else {
                document.getElementById('metaAtual').textContent = `${this.formatMoney(totalLiquido)} recebido • Faltam ${this.formatMoney(Math.max(0, faltam))}`;
            }
            document.getElementById('metaPercent').textContent = Math.round(p) + '%';

            if (p >= 100 && !this.metaGoalReached && allowCelebration) {
                this.metaGoalReached = true;
                safeStorage.setItem(`evo_meta_reached_${this.currentUserId}`, 'true');
                this.syncMetaToFirestore();
                this.triggerGoalCelebration();
            } else if (p >= 100 && !this.metaGoalReached) {
                // Marca como atingida sem disparar celebração (carga inicial / edição)
                this.metaGoalReached = true;
                safeStorage.setItem(`evo_meta_reached_${this.currentUserId}`, 'true');
                this.syncMetaToFirestore();
            }
        };

        EvolutionApp.prototype.toggleMetaEditor = function() {
            const e = document.getElementById('metaEditor');
            if (!e) return;
            const isHidden = e.style.display === 'none' || !e.style.display;
            e.style.display = isHidden ? 'block' : 'none';

            if (isHidden && this.metaMensal > 0) {
                document.getElementById('metaInput').value = (this.metaMensal / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
            }

            // Botao cancelar aparece dentro do metaEditor (no config), apenas quando ha meta ativa
            const cancelContainer = document.getElementById('cancelMetaContainer');
            if (cancelContainer) {
                if (isHidden && this.metaMensal > 0) {
                    cancelContainer.innerHTML = `
                        <button class="btn btn-glass" onclick="app.cancelMeta()" style="margin-top: 8px; width: 100%; border-color: var(--danger); color: var(--danger);">
                            🗑 Cancelar Meta Atual
                        </button>`;
                } else {
                    cancelContainer.innerHTML = '';
                }
            }
        };

        EvolutionApp.prototype.cancelMeta = function() {
            if (!confirm('Deseja cancelar a meta atual? O progresso sera perdido.')) return;
            this.metaMensal = 0;
            this.metaStartDate = null;
            this.metaGoalReached = false;
            safeStorage.removeItem(`evo_meta_${this.currentUserId}`);
            safeStorage.removeItem(`evo_meta_start_${this.currentUserId}`);
            safeStorage.removeItem(`evo_meta_reached_${this.currentUserId}`);
            document.getElementById('metaCard').style.display = 'none';
            document.getElementById('metaEditor').style.display = 'none';
            document.getElementById('cancelMetaContainer').innerHTML = '';
            this.showToast('Meta cancelada', 'info');
            // Limpa do Firestore tambem
            if (db && this.currentUserId) {
                db.collection('users').doc(this.currentUserId).set({
                    meta: null, metaStartDate: null, metaGoalReached: false
                }, { merge: true }).catch(e => console.error('Erro ao limpar meta no Firestore:', e));
            }
        };

        // Salva meta mensal no Firestore para sincronizar entre dispositivos
        EvolutionApp.prototype.syncMetaToFirestore = async function() {
            if (!db || !this.currentUserId) return;
            try {
                await db.collection('users').doc(this.currentUserId).set({
                    meta: this.metaMensal,
                    metaStartDate: this.metaStartDate ? this.metaStartDate.toISOString() : null,
                    metaGoalReached: this.metaGoalReached || false
                }, { merge: true });
            } catch (e) {
                console.error('Erro ao sincronizar meta no Firestore:', e);
            }
        };

        // Carrega meta do Firestore como fallback quando localStorage esta vazio (outro navegador/dispositivo)
        EvolutionApp.prototype.loadMetaFromFirestore = async function() {
            if (!db || !this.currentUserId) return;
            // So busca do Firestore se localStorage nao tem meta
            const localMeta = safeStorage.getItem(`evo_meta_${this.currentUserId}`);
            if (localMeta) return; // localStorage tem prioridade
            try {
                const doc = await db.collection('users').doc(this.currentUserId).get();
                if (!doc.exists) return;
                const data = doc.data();
                if (!data.meta || data.meta <= 0) return;
                // Popula a meta com os dados do Firestore
                this.metaMensal = parseInt(data.meta) || 0;
                this.metaStartDate = data.metaStartDate ? new Date(data.metaStartDate) : null;
                this.metaGoalReached = data.metaGoalReached || false;
                // Sincroniza no localStorage para proximas cargas
                safeStorage.setItem(`evo_meta_${this.currentUserId}`, this.metaMensal);
                if (this.metaStartDate) safeStorage.setItem(`evo_meta_start_${this.currentUserId}`, this.metaStartDate.toISOString());
                safeStorage.setItem(`evo_meta_reached_${this.currentUserId}`, this.metaGoalReached ? 'true' : 'false');
                this.renderMetaCard();
                this.updateMetaProgress(false);
            } catch (e) {
                console.error('Erro ao carregar meta do Firestore:', e);
            }
        };

        EvolutionApp.prototype.formatMetaInput = function(input) {
            let value = input.value.replace(/[^\d]/g, '');
            if (value) {
                const num = parseInt(value);
                input.value = num.toLocaleString('pt-BR');
            }
        };

        EvolutionApp.prototype.triggerGoalCelebration = function() {
            // Confetes visuais
            const container = document.getElementById('goalCelebrationContainer');
            container.innerHTML = '<div class="goal-celebration" id="celebrationOverlay"></div>';
            const overlay = document.getElementById('celebrationOverlay');
            const colors = ['#00d4ff', '#00d9a6', '#ffd700', '#ff3860', '#7000ff', '#ffb800'];

            for (let i = 0; i < 100; i++) {
                const firework = document.createElement('div');
                firework.className = 'firework';
                firework.style.background = colors[Math.floor(Math.random() * colors.length)];
                firework.style.left = Math.random() * 100 + '%';
                firework.style.top = Math.random() * 100 + '%';
                const angle = Math.random() * Math.PI * 2;
                const distance = 100 + Math.random() * 300;
                firework.style.setProperty('--fx', `${Math.cos(angle) * distance}px`);
                firework.style.setProperty('--fy', `${Math.sin(angle) * distance}px`);
                firework.style.animationDelay = Math.random() * 0.5 + 's';
                overlay.appendChild(firework);
            }
            setTimeout(() => { if (container) container.innerHTML = ''; }, 3000);

            // Modal de celebracao (persistente - requer clique do usuario)
            const msg = GOAL_MESSAGES[Math.floor(Math.random() * GOAL_MESSAGES.length)];
            const existing = document.getElementById('goalModalOverlay');
            if (existing) existing.remove();

            const modal = document.createElement('div');
            modal.id = 'goalModalOverlay';
            modal.style.cssText = `
                position: fixed; inset: 0; z-index: 200000;
                display: flex; align-items: center; justify-content: center;
                background: rgba(0,0,0,0.6); backdrop-filter: blur(6px);
                animation: goalBgIn 0.4s ease forwards;
            `;
            modal.innerHTML = `
                <div style="
                    background: var(--glass); backdrop-filter: blur(24px);
                    border: 2px solid var(--success); border-radius: 28px;
                    padding: 44px 48px; text-align: center; max-width: 340px; width: 90%;
                    box-shadow: 0 0 80px rgba(0,217,166,0.5), 0 20px 60px rgba(0,0,0,0.5);
                    animation: goalCardIn 0.5s cubic-bezier(0.34,1.56,0.64,1) forwards;
                ">
                    <div style="font-size: 4rem; margin-bottom: 16px; animation: goalIconSpin 0.6s ease 0.2s both;">🏆</div>
                    <h2 style="
                        font-size: 1.6rem; font-weight: 800; margin-bottom: 12px;
                        background: var(--gradient-success); -webkit-background-clip: text; -webkit-text-fill-color: transparent;
                        letter-spacing: 1px;
                    ">${msg.title}</h2>
                    <p style="font-size: 1rem; color: var(--text); font-weight: 500; line-height: 1.5; margin-bottom: 28px; opacity: 0.9;">${msg.message}</p>
                    <div style="background: rgba(0,217,166,0.1); border: 1px solid rgba(0,217,166,0.3); border-radius: 12px; padding: 12px 16px; margin-bottom: 24px; font-size: 0.8rem; color: var(--success); font-weight: 700; letter-spacing: 0.5px;">
                        ✅ META 100% ATINGIDA
                    </div>
                    <button onclick="document.getElementById('goalModalOverlay').remove()" style="
                        background: var(--gradient-success); color: white; border: none;
                        padding: 14px 40px; border-radius: 14px; font-size: 1rem; font-weight: 800;
                        cursor: pointer; width: 100%; font-family: inherit;
                        box-shadow: 0 4px 20px rgba(0,217,166,0.4);
                        letter-spacing: 0.5px;
                    ">🎉 Continuar</button>
                </div>
            `;
            document.body.appendChild(modal);
        };

        EvolutionApp.prototype.triggerPaymentAnimation = function(amount) {
            const emojis = ['💰', '🤑', '💵', '💲', '🪙'];
            for (let i = 0; i < 30; i++) {
                const particle = document.createElement('div');
                particle.className = 'money-particle';
                particle.textContent = emojis[Math.floor(Math.random() * emojis.length)];
                particle.style.left = (window.innerWidth / 2) + 'px';
                particle.style.top = (window.innerHeight / 2) + 'px';
                particle.style.setProperty('--tx', `${(Math.random() - 0.5) * window.innerWidth * 1.2}px`);
                particle.style.setProperty('--ty', `${(Math.random() - 1) * window.innerHeight * 0.8}px`);
                particle.style.setProperty('--rot', `${(Math.random() - 0.5) * 720}deg`);
                document.body.appendChild(particle);
                setTimeout(() => particle.remove(), 1000);
            }

            const floatEl = document.createElement('div');
            floatEl.className = 'payment-float-value';
            floatEl.textContent = `+ ${this.formatMoney(amount)}`;
            floatEl.style.left = '50%';
            floatEl.style.top = '50%';
            document.body.appendChild(floatEl);
            setTimeout(() => floatEl.remove(), 1500);
        };

        // ============================================
        // GRAFICO
        // ============================================
        EvolutionApp.prototype.renderChart = function() {
            const svg = document.getElementById('evolutionChart');
            if (!svg) return;

            const days = 7;
            const today = getManausDate();
            let cPts = [], cTot = 0, pPts = [], pTot = 0;

            for (let i = days - 1; i >= 0; i--) {
                const d = new Date(today);
                d.setDate(today.getDate() - i);
                // FIX 15: usa formatDateManaus para evitar desvio de timezone UTC
                const ds = formatDateManaus(d);
                const v = this.entries.filter(e => e.data === ds).reduce((s, e) => s + (Number(e.bruto) || 0), 0);
                cTot += v;
                cPts.push({ val: v / 100 });
            }

            for (let i = days - 1; i >= 0; i--) {
                const d = new Date(today);
                d.setDate(today.getDate() - (i + days));
                // FIX 15: usa formatDateManaus para evitar desvio de timezone UTC
                const ds = formatDateManaus(d);
                const v = this.entries.filter(e => e.data === ds).reduce((s, e) => s + (Number(e.bruto) || 0), 0);
                pTot += v;
                pPts.push({ val: v / 100 });
            }

            document.getElementById('chartTotalCurr').textContent = this.formatMoney(cTot);
            document.getElementById('chartTotalPrev').textContent = this.formatMoney(pTot);

            let g = 0;
            if (pTot > 0) g = ((cTot - pTot) / pTot) * 100;
            else if (cTot > 0) g = 100;

            const gEl = document.getElementById('chartGrowth');
            gEl.textContent = (g > 0 ? '+' : '') + Math.round(g) + '%';
            gEl.className = 'chart-growth ' + (g >= 0 ? 'positive' : 'negative');

            const w = 300, h = 160, p = 10;
            const vals = [...cPts.map(p => p.val), ...pPts.map(p => p.val)];
            const max = Math.max(...vals, 10);

            const calc = (pts) => pts.map((pt, i) => ({
                x: days <= 1 ? w / 2 : (i / (days - 1)) * (w - 2 * p) + p,
                y: h - p - ((pt.val / max) * (h - 2 * p))
            }));

            const cP = calc(cPts), pP = calc(pPts);

            const path = (pts) => {
                let d = `M ${pts[0].x} ${pts[0].y}`;
                for (let i = 0; i < pts.length - 1; i++) {
                    const p1 = pts[i], p2 = pts[i + 1];
                    d += ` C ${p1.x + (p2.x - p1.x) / 3} ${p1.y}, ${p2.x - (p2.x - p1.x) / 3} ${p2.y}, ${p2.x} ${p2.y}`;
                }
                return d;
            };

            const cL = path(cP), pL = path(pP);

            let html = `<defs><linearGradient id="gradChart" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:#00d4ff;stop-opacity:0.4"/><stop offset="100%" style="stop-color:#00d4ff;stop-opacity:0"/></linearGradient></defs>`;
            html += `<path class="chart-area-path" d="${cL} L ${cP[cP.length - 1].x} ${h - p} L ${cP[0].x} ${h - p} Z"/>`;
            html += `<path class="chart-line-prev" d="${pL}"/>`;
            html += `<path class="chart-line-path" d="${cL}"/>`;
            cP.forEach(pt => html += `<circle class="chart-point" cx="${pt.x}" cy="${pt.y}" r="4"/>`);

            svg.innerHTML = html;
        };
