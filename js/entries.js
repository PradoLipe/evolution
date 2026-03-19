        EvolutionApp.prototype.updateSimFields = function() {
            const turno = document.getElementById('simTurno').value;
            const container = document.getElementById('simCampos');
            if (turno === '15x23') {
                container.innerHTML = `<div class="input-row"><div class="input-group"><label class="input-label">15h-19h</label><input type="number" id="simP1" placeholder="0" oninput="app.calcularSimulacao()" inputmode="numeric"></div><div class="input-group"><label class="input-label">19h-23h</label><input type="number" id="simP2" placeholder="0" oninput="app.calcularSimulacao()" inputmode="numeric"></div></div>`;
            } else {
                container.innerHTML = `<div class="input-group"><label class="input-label">Producao Total</label><input type="number" id="simPT" placeholder="0" oninput="app.calcularSimulacao()" inputmode="numeric"></div>`;
            }
            this.calcularSimulacao();
        };

        EvolutionApp.prototype.calcularSimulacao = function() {
            const turno = document.getElementById('simTurno').value;
            const tipo = document.getElementById('simTipo').value;
            const conf = document.getElementById('simConf').value;
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
            const turno = document.getElementById('calcTurno').value;
            const container = document.getElementById('calcCampos');
            if (turno === '15x23') {
                container.innerHTML = `<div class="input-row"><div class="input-group"><label class="input-label">15h-19h</label><input type="number" id="calcP1" placeholder="0" inputmode="numeric"></div><div class="input-group"><label class="input-label">19h-23h</label><input type="number" id="calcP2" placeholder="0" inputmode="numeric"></div></div>`;
            } else {
                container.innerHTML = `<div class="input-group"><label class="input-label">Producao Total</label><input type="number" id="calcPT" placeholder="0" inputmode="numeric"></div>`;
            }
        };

        EvolutionApp.prototype.toggleRelatorioCampos = function() {
            const turno = document.getElementById('relTurno').value;
            const container = document.getElementById('relCamposProducao');
            if (turno === '15x23') {
                container.innerHTML = `<div class="input-row"><div class="input-group"><label class="input-label">15h-19h</label><input type="number" id="relP1" placeholder="0" inputmode="numeric"></div><div class="input-group"><label class="input-label">19h-23h</label><input type="number" id="relP2" placeholder="0" inputmode="numeric"></div></div>`;
            } else {
                container.innerHTML = `<div class="input-group"><label class="input-label">Producao Total</label><input type="number" id="relPT" placeholder="0" inputmode="numeric"></div>`;
            }
        };

        // ============================================
        // SALVAR REGISTRO
        // ============================================
        EvolutionApp.prototype.saveEntry = async function() {
            const btn = document.getElementById('btnSaveEntry');
            if (btn) btn.disabled = true;

            const navio = document.getElementById('calcNavio').value.toUpperCase().trim();
            const dataInput = document.getElementById('calcData').value;

            if (!navio || !dataInput) {
                this.showToast('Preencha todos os campos', 'error');
                if (btn) btn.disabled = false;
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
                this.showToast('Informe a producao antes de salvar', 'error');
                if (btn) btn.disabled = false;
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

            this.entries.unshift(entry);
            this.learnNavioName(navio);
            safeStorage.setItem(`evo_data_${this.currentUserId}`, JSON.stringify(this.entries));

            this.updateDashboard();
            this.renderHistory();
            this.renderChart();
            this.updateMetaProgress();

            document.getElementById('calcNavio').value = '';
            // FIX 2: Limpar campos de producao para evitar registro duplicado acidental
            const _calcPT = document.getElementById('calcPT');
            const _calcP1 = document.getElementById('calcP1');
            const _calcP2 = document.getElementById('calcP2');
            if (_calcPT) _calcPT.value = '';
            if (_calcP1) _calcP1.value = '';
            if (_calcP2) _calcP2.value = '';
            this.triggerMoneyAnimation();
            this.persistData();

            this.showToast('Registro salvo!', 'success');
            // atualizar calendario e sugestoes apos salvar
            if (typeof this.renderCalendar === 'function') { this.syncCalendarMonthWithEntries(true); this.renderCalendar(); }
            // Atualizar sugestoes apos salvar
            this.showNavioSuggestions('calcNavio');
            this.showNavioSuggestions('relNavio');

            setTimeout(() => { if (btn) btn.disabled = false; }, 1500);
        };

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

            let msg = `*${navio}*
Data: ${dataFormatada} - ${turno}
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
            this.openReportPreview(msg);
        };

        EvolutionApp.prototype.openReportPreview = function(msg) {
            this._reportText = msg || '';
            const textEl = document.getElementById('reportPreviewText');
            const subEl = document.getElementById('reportPreviewSubtitle');
            if (textEl) textEl.textContent = this._reportText;
            if (subEl) subEl.textContent = this._reportText ? 'Relatorio pronto para enviar' : 'Aguardando geracao...';
            this.openModal('reportPreviewModal');
        };

        EvolutionApp.prototype.clearReportPreview = function() {
            this._reportText = '';
            const textEl = document.getElementById('reportPreviewText');
            const subEl = document.getElementById('reportPreviewSubtitle');
            if (textEl) textEl.textContent = '';
            if (subEl) subEl.textContent = 'Aguardando geracao...';
        };

        EvolutionApp.prototype.copyReportText = function() {
            if (!this._reportText) {
                this.showToast('Gere um relatorio primeiro', 'warning');
                return;
            }
            this.copyToClipboard(this._reportText, 'Relatorio copiado!');
        };

        EvolutionApp.prototype.shareReportText = async function() {
            if (!this._reportText) {
                this.showToast('Gere um relatorio primeiro', 'warning');
                return;
            }
            if (navigator.share) {
                try {
                    await navigator.share({
                        title: 'Relatorio EVOLUTION',
                        text: this._reportText
                    });
                    return;
                } catch (e) {}
            }
            this.copyReportText();
            this.showToast('Copiado para compartilhar', 'info');
        };
