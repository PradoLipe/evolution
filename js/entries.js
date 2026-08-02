        EvolutionApp.prototype.updateSimFields = function() {
            const turnoEl = document.getElementById('simTurno');
            const container = document.getElementById('simCampos');
            if (!turnoEl || !container) return;
            const turno = turnoEl.value;
            if (turno === '15x23') {
                container.innerHTML = `<div class="input-row"><div class="input-group"><label class="input-label">15h-19h</label><input type="number" id="simP1" placeholder="0" oninput="app.calcularSimulacao()" inputmode="numeric"></div><div class="input-group"><label class="input-label">19h-23h</label><input type="number" id="simP2" placeholder="0" oninput="app.calcularSimulacao()" inputmode="numeric"></div></div>`;
            } else {
                container.innerHTML = `<div class="input-group"><label class="input-label">Producao Total</label><input type="number" id="simPT" placeholder="0" oninput="app.calcularSimulacao()" inputmode="numeric"></div>`;
            }
            this.calcularSimulacao();
        };

        EvolutionApp.prototype.calcularSimulacao = function() {
            const turnoEl = document.getElementById('simTurno');
            const tipoEl = document.getElementById('simTipo');
            const confEl = document.getElementById('simConf');
            if (!turnoEl || !tipoEl || !confEl) return;
            const turno = turnoEl.value;
            const tipo = tipoEl.value;
            const conf = confEl.value;
            let valores = turno === '15x23'
                ? [document.getElementById('simP1')?.value || 0, document.getElementById('simP2')?.value || 0]
                : [document.getElementById('simPT')?.value || 0];

            const res = this.calcularValores(tipo, turno, valores, conf);
            document.getElementById('simResult').textContent = this.formatMoney(res.liquido);
            document.getElementById('simDetalhe').textContent = `Bruto: ${this.formatMoney(res.bruto)} | Liquido: ${this.formatMoney(res.liquido)}`;
        };

        EvolutionApp.prototype.calcularValores = function(tipo, turno, valores, qtdConf) {
            // Protecao: se a taxa do turno nao estiver disponivel, usa os defaults para evitar NaN/crash
            const taxa = (this.taxas && this.taxas[turno]) ? this.taxas[turno] : DEFAULT_TAXAS[turno];
            if (!taxa) return { bruto: 0, liquido: 0 };
            const numConf = parseInt(qtdConf) || 1;
            let bruto = 0;

            if (turno === '15x23') {
                const t = tipo === 'feriado' ? taxa.feriado : taxa.normal;
                bruto = (parseInt(valores[0]) || 0) * t.p1 + (parseInt(valores[1]) || 0) * t.p2;
            } else {
                bruto = (parseInt(valores[0]) || 0) * taxa[tipo === 'feriado' ? 'feriado' : 'normal'];
            }

            const porPessoa = bruto / numConf;
            return { bruto: Math.round(porPessoa * 100), liquido: Math.round(porPessoa * 82) };
        };

        EvolutionApp.prototype.adjustCalcFields = function() {
            const turnoEl = document.getElementById('calcTurno');
            const container = document.getElementById('calcCampos');
            if (!turnoEl || !container) return;
            const turno = turnoEl.value;
            if (turno === '15x23') {
                container.innerHTML = `<div class="input-row"><div class="input-group"><label class="input-label">15h-19h</label><div class="input-with-calc"><input type="number" id="calcP1" placeholder="0" inputmode="numeric"><button type="button" class="calc-helper-btn" onclick="app.openCalcHelper('calcP1')" title="Somar produtividade" aria-label="Somar produtividade">🧮</button></div></div><div class="input-group"><label class="input-label">19h-23h</label><div class="input-with-calc"><input type="number" id="calcP2" placeholder="0" inputmode="numeric"><button type="button" class="calc-helper-btn" onclick="app.openCalcHelper('calcP2')" title="Somar produtividade" aria-label="Somar produtividade">🧮</button></div></div></div>`;
            } else {
                container.innerHTML = `<div class="input-group"><label class="input-label">Producao Total</label><div class="input-with-calc"><input type="number" id="calcPT" placeholder="0" inputmode="numeric"><button type="button" class="calc-helper-btn" onclick="app.openCalcHelper('calcPT')" title="Somar produtividade" aria-label="Somar produtividade">🧮</button></div></div>`;
            }
        };

        EvolutionApp.prototype.toggleRelatorioCampos = function() {
            const turnoEl = document.getElementById('relTurno');
            const container = document.getElementById('relCamposProducao');
            if (!turnoEl || !container) return;
            const turno = turnoEl.value;
            if (turno === '15x23') {
                container.innerHTML = `<div class="input-row"><div class="input-group"><label class="input-label">15h-19h</label><div class="input-with-calc"><input type="number" id="relP1" placeholder="0" inputmode="numeric"><button type="button" class="calc-helper-btn" onclick="app.openCalcHelper('relP1')" title="Somar produtividade" aria-label="Somar produtividade">🧮</button></div></div><div class="input-group"><label class="input-label">19h-23h</label><div class="input-with-calc"><input type="number" id="relP2" placeholder="0" inputmode="numeric"><button type="button" class="calc-helper-btn" onclick="app.openCalcHelper('relP2')" title="Somar produtividade" aria-label="Somar produtividade">🧮</button></div></div></div>`;
            } else {
                container.innerHTML = `<div class="input-group"><label class="input-label">Producao Total</label><div class="input-with-calc"><input type="number" id="relPT" placeholder="0" inputmode="numeric"><button type="button" class="calc-helper-btn" onclick="app.openCalcHelper('relPT')" title="Somar produtividade" aria-label="Somar produtividade">🧮</button></div></div>`;
            }
        };

        // ============================================
        // SOMAR PRODUTIVIDADE (calculadora auxiliar)
        // ============================================
        EvolutionApp.prototype.openCalcHelper = function(targetId) {
            this._calcHelperTarget = targetId;
            this._calcHelperParcels = [];
            const input = document.getElementById('calcHelperInput');
            if (input) input.value = '';
            this._renderCalcHelper();
            this.openModal('calcHelperModal');
            setTimeout(() => { const el = document.getElementById('calcHelperInput'); if (el) el.focus(); }, 300);
        };

        EvolutionApp.prototype.addCalcHelperParcel = function() {
            const input = document.getElementById('calcHelperInput');
            if (!input) return;
            const val = parseInt(input.value, 10);
            if (!val || val <= 0) return;
            if (!this._calcHelperParcels) this._calcHelperParcels = [];
            this._calcHelperParcels.push(val);
            input.value = '';
            this._renderCalcHelper();
            input.focus();
        };

        EvolutionApp.prototype.removeCalcHelperParcel = function(idx) {
            if (!this._calcHelperParcels) return;
            this._calcHelperParcels.splice(idx, 1);
            this._renderCalcHelper();
        };

        EvolutionApp.prototype.updateCalcHelperParcel = function(idx, val) {
            if (!this._calcHelperParcels) return;
            const n = parseInt(val, 10);
            this._calcHelperParcels[idx] = isNaN(n) ? 0 : n;
            this._updateCalcHelperTotal();
        };

        EvolutionApp.prototype._updateCalcHelperTotal = function() {
            const totalEl = document.getElementById('calcHelperTotal');
            const parcels = this._calcHelperParcels || [];
            if (totalEl) totalEl.textContent = String(parcels.reduce((s, v) => s + v, 0));
        };

        EvolutionApp.prototype._renderCalcHelper = function() {
            const list = document.getElementById('calcHelperList');
            const parcels = this._calcHelperParcels || [];
            if (list) {
                list.innerHTML = parcels.length
                    ? parcels.map((v, i) => `<div class="calc-helper-parcel"><input type="number" class="calc-helper-parcel-input" value="${v}" inputmode="numeric" onclick="event.stopPropagation()" oninput="app.updateCalcHelperParcel(${i}, this.value)"><button type="button" class="calc-helper-parcel-remove" onclick="app.removeCalcHelperParcel(${i})" title="Remover" aria-label="Remover">&times;</button></div>`).join('')
                    : `<div class="calc-helper-empty">Nenhuma parcela adicionada</div>`;
            }
            this._updateCalcHelperTotal();
        };

        EvolutionApp.prototype.applyCalcHelper = function() {
            const targetId = this._calcHelperTarget;
            const target = targetId ? document.getElementById(targetId) : null;
            const total = (this._calcHelperParcels || []).reduce((s, v) => s + v, 0);
            if (target) target.value = total;
            this.closeModal('calcHelperModal');
        };

        // ============================================
        // SALVAR REGISTRO
        // ============================================
        // ETAPA 1: valida os dados e abre a pre-visualizacao (confirmar / editar).
        // NAO grava nada ainda — a gravacao so acontece em confirmSaveEntry().
        EvolutionApp.prototype.saveEntry = function() {
            const navio = document.getElementById('calcNavio').value.toUpperCase().trim();
            const dataInput = document.getElementById('calcData').value;

            if (!navio || !dataInput) {
                this.showToast('Preencha todos os campos', 'error');
                return;
            }

            const turno = document.getElementById('calcTurno').value;
            const tipo = document.getElementById('calcTipoDia').value;
            const conf = document.getElementById('calcQtdConf').value;
            let valores = turno === '15x23'
                ? [document.getElementById('calcP1')?.value, document.getElementById('calcP2')?.value]
                : [document.getElementById('calcPT')?.value];

            // FIX 4: Validar producao zerada
            const totalProducao = valores.reduce((s, v) => s + (parseInt(v) || 0), 0);
            if (totalProducao <= 0) {
                this.showToast('Informe a produção antes de salvar', 'error');
                return;
            }

            const res = this.calcularValores(tipo, turno, valores, conf);
            const [y, m, d] = dataInput.split('-');

            // FIX 23: ID unico com sufixo aleatorio para evitar colisao por Date.now()
            const uniqueId = String(Date.now()) + '_' + Math.random().toString(36).substr(2, 6);

            const entry = {
                id: uniqueId,
                navio,
                data: dataInput,
                dataF: `${d}/${m}/${y}`,
                turno,
                tipo,
                valores,
                conferentes: parseInt(conf) || 1,
                bruto: res.bruto,
                liquido: res.liquido,
                pago: false,
                timestamp: new Date().toISOString()
            };

            // Guarda como pendente e mostra a pre-visualizacao para o usuario
            // confirmar ou voltar a editar.
            this._pendingEntry = entry;
            this.renderEntryPreview(entry);
            this.openModal('entryPreviewModal');
        };

        // Monta o cartao de pre-visualizacao com os dados do registro pendente.
        EvolutionApp.prototype.renderEntryPreview = function(entry) {
            const card = document.getElementById('entryPreviewCard');
            if (!card) return;
            card.innerHTML = `
                <div class="epc-top">
                    <div>
                        <div class="epc-ship">${this.escHtml(entry.navio)}</div>
                        <div class="epc-meta">${this.escHtml(entry.dataF)} • ${this.escHtml(entry.turno)}</div>
                    </div>
                    <div>
                        <div class="epc-liquid">${this.formatMoney(entry.liquido)}</div>
                        <div class="epc-bruto">Bruto ${this.formatMoney(entry.bruto)}</div>
                    </div>
                </div>
                <div class="epc-grid">
                    <div><span>Tipo</span><b>${entry.tipo === 'normal' ? 'Normal' : 'Feriado'}</b></div>
                    <div><span>Conf.</span><b>${this.escHtml(String(entry.conferentes))}</b></div>
                    <div><span>Data</span><b>${this.escHtml(entry.dataF)}</b></div>
                    <div><span>Turno</span><b>${this.escHtml(entry.turno)}</b></div>
                </div>
            `;
        };

        // Botao "Editar": apenas fecha o preview. Os campos do formulario continuam
        // preenchidos, entao o usuario pode ajustar e salvar de novo.
        EvolutionApp.prototype.editPendingEntry = function() {
            this.closeModal('entryPreviewModal');
        };

        // ETAPA 2: o usuario confirmou — agora sim grava no historico e dispara as
        // animacoes de recompensa (moedas + cartao voando para o historico).
        EvolutionApp.prototype.confirmSaveEntry = function() {
            const entry = this._pendingEntry;
            if (!entry) return;                 // nada pendente (ou ja confirmado)
            this._pendingEntry = null;          // evita gravacao dupla em clique duplo

            const btn = document.getElementById('btnConfirmEntry');
            if (btn) btn.disabled = true;

            // Captura a posicao do cartao do preview ANTES de fechar o modal,
            // para a animacao partir exatamente de onde ele estava.
            let fromRect = null;
            const cardEl = document.getElementById('entryPreviewCard');
            if (cardEl) fromRect = cardEl.getBoundingClientRect();

            // --- Gravacao real (mesma logica de antes) ---
            this.entries.unshift(entry);
            this.learnNavioName(entry.navio);
            safeStorage.setItem(`evo_data_${this.currentUserId}`, JSON.stringify(this.entries));

            this.updateDashboard();
            this.renderHistory();
            this.renderChart();
            this.updateMetaProgress();

            // FIX 2: Limpar campos para evitar registro duplicado acidental
            const _navio = document.getElementById('calcNavio');
            const _calcPT = document.getElementById('calcPT');
            const _calcP1 = document.getElementById('calcP1');
            const _calcP2 = document.getElementById('calcP2');
            if (_navio) _navio.value = '';
            if (_calcPT) _calcPT.value = '';
            if (_calcP1) _calcP1.value = '';
            if (_calcP2) _calcP2.value = '';

            this.persistData();

            // Fecha o preview e celebra
            this.closeModal('entryPreviewModal');
            if (typeof this.triggerHaptic === 'function') this.triggerHaptic('success');
            this.celebrateEntrySaved(entry, fromRect);

            this.showToast('Registro salvo!', 'success');
            // atualizar calendario e sugestoes apos salvar
            if (typeof this.syncCalendarMonthWithEntries === 'function' && typeof this.renderCalendar === 'function') { this.syncCalendarMonthWithEntries(true); this.renderCalendar(); }
            // Atualizar resumo de pendencias
            if (typeof this.renderPendingSummary === 'function') this.renderPendingSummary();
            // Atualizar sugestoes apos salvar
            this.showNavioSuggestions('calcNavio');
            this.showNavioSuggestions('relNavio');

            setTimeout(() => { if (btn) btn.disabled = false; }, 800);
        };

        // Orquestra as animacoes de recompensa. Envolto em try/catch: uma falha de
        // animacao NUNCA pode quebrar o fluxo de salvar.
        EvolutionApp.prototype.celebrateEntrySaved = function(entry, fromRect) {
            try {
                this.flyEntryToHistory(entry, fromRect);
                this.triggerMoneyBurst(fromRect);
                this.floatEarnedValue(entry, fromRect);
            } catch (e) { /* silencioso de proposito */ }
        };

        // Cartao com o resumo do registro "voando" da posicao do preview em direcao
        // ao Historico (que fica mais abaixo no app). Quando pousa, o Historico pisca.
        EvolutionApp.prototype.flyEntryToHistory = function(entry, fromRect) {
            const startX = fromRect ? fromRect.left + fromRect.width / 2 : window.innerWidth / 2;
            const startY = fromRect ? fromRect.top + fromRect.height / 2 : window.innerHeight / 2;

            const sec = document.getElementById('secHist');
            let targetX = window.innerWidth / 2;
            let targetY = window.innerHeight - 40;
            if (sec) {
                const r = sec.getBoundingClientRect();
                targetX = r.left + r.width / 2;
                targetY = r.top + 46;
                // Se o Historico esta abaixo da area visivel, mira no rodape da tela
                // (o cartao "desce" na direcao dele mesmo assim).
                if (targetY > window.innerHeight - 20) targetY = window.innerHeight - 30;
                if (targetY < 20) targetY = 20;
            }

            const fly = document.createElement('div');
            fly.className = 'entry-fly-card';
            fly.innerHTML = `<div class="efc-ship">${this.escHtml(entry.navio)}</div><div class="efc-val">${this.formatMoney(entry.liquido)}</div>`;
            fly.style.left = startX + 'px';
            fly.style.top = startY + 'px';
            fly.style.setProperty('--dx', (targetX - startX) + 'px');
            fly.style.setProperty('--dy', (targetY - startY) + 'px');
            document.body.appendChild(fly);
            setTimeout(() => { if (fly.parentNode) fly.parentNode.removeChild(fly); }, 1200);

            // Pulso de "pouso" no Historico, sincronizado com a chegada do cartao.
            setTimeout(() => {
                if (sec) {
                    sec.classList.add('history-landing');
                    setTimeout(() => sec.classList.remove('history-landing'), 950);
                }
            }, 900);
        };

        // Explosao de moedas/emojis a partir do ponto de origem (dopamina!).
        EvolutionApp.prototype.triggerMoneyBurst = function(fromRect) {
            const emojis = ['💸', '💰', '💵', '🤑', '💎', '🪙', '✨'];
            const cx = fromRect ? fromRect.left + fromRect.width / 2 : window.innerWidth / 2;
            const cy = fromRect ? fromRect.top + fromRect.height / 2 : window.innerHeight / 2;
            const N = 26;
            for (let i = 0; i < N; i++) {
                const p = document.createElement('div');
                p.className = 'coin-particle';
                p.textContent = emojis[Math.floor(Math.random() * emojis.length)];
                p.style.left = cx + 'px';
                p.style.top = cy + 'px';
                const ang = (Math.PI * 2) * (i / N) + Math.random() * 0.5;
                const dist = 120 + Math.random() * 220;
                const tx = Math.cos(ang) * dist;
                const ty = Math.sin(ang) * dist + 120; // gravidade puxa para baixo
                p.style.setProperty('--tx', tx + 'px');
                p.style.setProperty('--ty', ty + 'px');
                p.style.setProperty('--rot', `${(Math.random() - 0.5) * 720}deg`);
                p.style.fontSize = (18 + Math.random() * 18) + 'px';
                p.style.animationDelay = (Math.random() * 0.12) + 's';
                document.body.appendChild(p);
                setTimeout(() => { if (p.parentNode) p.parentNode.removeChild(p); }, 1400);
            }
        };

        // Valor liquido "+R$ X,XX" subindo e sumindo, para reforcar a recompensa.
        EvolutionApp.prototype.floatEarnedValue = function(entry, fromRect) {
            const el = document.createElement('div');
            el.className = 'payment-float-value';
            el.textContent = '+ ' + this.formatMoney(entry.liquido);
            const cx = fromRect ? fromRect.left + fromRect.width / 2 : window.innerWidth / 2;
            const cy = fromRect ? fromRect.top : window.innerHeight / 2;
            el.style.left = cx + 'px';
            el.style.top = cy + 'px';
            document.body.appendChild(el);
            setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 1600);
        };

        // Mantido por compatibilidade — nao e mais chamado no fluxo principal.
        EvolutionApp.prototype.triggerMoneyAnimation = function() {
            const emojis = ['💸', '💰', '💵', '🤑', '💎'];
            for (let i = 0; i < 20; i++) {
                const particle = document.createElement('div');
                particle.className = 'money-particle';
                particle.textContent = emojis[Math.floor(Math.random() * emojis.length)];
                particle.style.left = (window.innerWidth / 2) + 'px';
                particle.style.top = (window.innerHeight / 2) + 'px';
                particle.style.setProperty('--tx', `${(Math.random() - 0.5) * window.innerWidth * 1.5}px`);
                particle.style.setProperty('--ty', `${(Math.random() - 0.5) * window.innerHeight * 1.5}px`);
                particle.style.setProperty('--rot', `${(Math.random() - 0.5) * 720}deg`);
                document.body.appendChild(particle);
                setTimeout(() => particle.remove(), 1000);
            }
        };

        // ============================================
        // RELATORIO
        // ============================================
        EvolutionApp.prototype.generateReport = function() {
            // Restricao VIP: nao-VIP pode gerar apenas 1 relatorio por semana
            if (!this.isAdmin && !this.isVip) {
                const lastReportKey = `evo_last_report_${this.currentUserId}`;
                const lastReport = safeStorage.getItem(lastReportKey);
                if (lastReport) {
                    const lastDate = new Date(lastReport);
                    const now = new Date();
                    const diffDays = (now - lastDate) / (1000 * 60 * 60 * 24);
                    if (diffDays < 7) {
                        const daysLeft = Math.ceil(7 - diffDays);
                        this.requireVip(`Você já usou seu relatório gratuito desta semana. Próximo disponível em ${daysLeft} dia${daysLeft !== 1 ? 's' : ''}. Assine o VIP para relatórios ilimitados.`);
                        return;
                    }
                }
            }

            const navio = document.getElementById('relNavio').value.toUpperCase().trim();
            const dataInput = document.getElementById('relData').value;
            const turno = document.getElementById('relTurno').value;
            const terno = document.getElementById('relTernoSelecao').value;

            if (!navio || !dataInput) {
                this.showToast('Preencha navio e data', 'error');
                return;
            }

            const [y, m, d] = dataInput.split('-');
            const dataFormatada = `${d}/${m}/${y}`;

            // Detectar domingo automaticamente
            const diaSemana = new Date(parseInt(y), parseInt(m) - 1, parseInt(d)).getDay();
            const isDomingo = diaSemana === 0;
            const turnoLabel = isDomingo ? `${turno} ( DOMINGO )` : turno;

            let msg = `*${navio}*
Data: ${dataFormatada} - ${turnoLabel}
Terno: ${terno}
`;
            if (turno === '15x23') {
                const p1 = document.getElementById('relP1')?.value || 0;
                const p2 = document.getElementById('relP2')?.value || 0;
                msg += `15x19: ${p1}
19x23: ${p2}
TOTAL: ${(parseInt(p1, 10) || 0) + (parseInt(p2, 10) || 0)}
`;
            } else {
                msg += `TOTAL: ${document.getElementById('relPT')?.value || 0}
`;
            }
            let userName = String(this.currentUser || 'USUARIO').trim() || 'USUARIO';
            if (userName && userName.toLowerCase().includes('anderson prado')) {
                userName += ' \u{1F64F}';
            }
            msg += `
${userName}`;
            // Registrar timestamp do relatorio para controle de limite semanal (nao-VIP)
            if (!this.isAdmin && !this.isVip) {
                safeStorage.setItem(`evo_last_report_${this.currentUserId}`, new Date().toISOString());
            }
            this.openReportPreview(msg);
        };

        EvolutionApp.prototype.openReportPreview = function(msg) {
            this._reportText = msg || '';
            const textEl = document.getElementById('reportPreviewText');
            const subEl = document.getElementById('reportPreviewSubtitle');
            if (textEl) textEl.value = this._reportText;
            if (subEl) subEl.textContent = this._reportText ? 'Relatorio pronto para enviar' : 'Aguardando geracao...';
            this.openModal('reportPreviewModal');
        };

        EvolutionApp.prototype.getReportPreviewText = function() {
            const textEl = document.getElementById('reportPreviewText');
            const currentText = textEl ? String(textEl.value || '') : '';
            this._reportText = currentText;
            return currentText;
        };

        EvolutionApp.prototype.onReportPreviewInput = function() {
            const currentText = this.getReportPreviewText();
            const subEl = document.getElementById('reportPreviewSubtitle');
            if (subEl) subEl.textContent = currentText.trim() ? 'Relatório editado e pronto para enviar' : 'Digite o relatório para continuar';
        };

        EvolutionApp.prototype.clearReportPreview = function() {
            this._reportText = '';
            const textEl = document.getElementById('reportPreviewText');
            const subEl = document.getElementById('reportPreviewSubtitle');
            if (textEl) textEl.value = '';
            if (subEl) subEl.textContent = 'Aguardando geracao...';
        };

        EvolutionApp.prototype.copyReportText = function() {
            const currentText = this.getReportPreviewText();
            if (!currentText.trim()) {
                this.showToast('Gere um relatório primeiro', 'warning');
                return;
            }
            this.copyToClipboard(currentText, 'Relatorio copiado!');
        };

        EvolutionApp.prototype.shareReportText = async function() {
            const currentText = this.getReportPreviewText();
            if (!currentText.trim()) {
                this.showToast('Gere um relatório primeiro', 'warning');
                return;
            }
            if (navigator.share) {
                try {
                    await navigator.share({
                        title: 'Relatorio EVOLUTION',
                        text: currentText
                    });
                    // Compartilhamento concluido: fecha a tela de edicao e volta para a tela principal
                    this.closeModal('reportPreviewModal');
                    return;
                } catch (e) {
                    // Usuario cancelou o compartilhamento: mantem a tela de edicao aberta, sem copiar
                    if (e && e.name === 'AbortError') return;
                }
            }
            this.copyReportText();
            this.showToast('Copiado para compartilhar', 'info');
        };
