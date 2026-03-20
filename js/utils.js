        // ============================================
        // CONFIGURACOES
        // ============================================
        EvolutionApp.prototype.exportData = function() {
            const data = {
                v: window.EVOLUTION_APP_VERSION || 'V5.37',
                u: this.currentUser,
                t: new Date().toISOString(),
                r: this.entries
            };
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            const objectUrl = URL.createObjectURL(blob);
            a.href = objectUrl;
            a.download = `backup_${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            setTimeout(() => {
                try { URL.revokeObjectURL(objectUrl); } catch (_) {}
            }, 1000);
            this.showToast('Backup exportado!', 'success');
            this.closeModal('configModal');
        };

        EvolutionApp.prototype.triggerImport = function() {
            document.getElementById('importInput').click();
        };

        EvolutionApp.prototype.importData = function(e) {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const data = JSON.parse(ev.target.result);
                    const regs = data.r || data.registros || [];
                    if (regs.length > 0) {
                        // FIX 3: Deduplica por ID e garante IDs unicos para evitar duplicatas em re-importacao
                        const existingIds = new Set(this.entries.map(x => String(x.id)));
                        const imported = regs.map(x => ({
                            ...x,
                            id: String(x.id || (Date.now() + '_' + Math.random().toString(36).substr(2, 6))),
                            bruto: Number(x.bruto) || 0,
                            liquido: Number(x.liquido) || 0
                        })).filter(x => !existingIds.has(String(x.id)));
                        // Mescla: importados + existentes, sem duplicar
                        const allById = new Map();
                        [...this.entries, ...imported].forEach(x => allById.set(String(x.id), x));
                        this.entries = Array.from(allById.values());
                        this.migrateOldEntries();
                        safeStorage.setItem(`evo_data_${this.currentUserId}`, JSON.stringify(this.entries));
                        this.updateDashboard();
                        this.renderHistory();
                        this.renderChart();
                        this.updateMetaProgress();
                        this.persistData();
                        this.showToast('Importado!', 'success');
                        this.closeModal('configModal');
                    }
                } catch (err) {
                    this.showToast('Arquivo invalido', 'error');
                }
            };
            reader.readAsText(file);
            e.target.value = '';
        };

        // ============================================
        // PDF
        // ============================================
        EvolutionApp.prototype.openPdfOptions = function() {
            this.closeModal('configModal');
            this.openModal('pdfOptionsModal');
            document.getElementById('pdfMonthPicker').value = this.selectedMonth;
        };

        EvolutionApp.prototype.generatePdf = async function(type) {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF({ unit: 'mm', format: 'a4' });

            const APP_VERSION = (window.EVOLUTION_APP_VERSION || 'V5.37');
            const generatedAt = new Date().toLocaleString('pt-BR');
            const pageW = 210;
            const marginL = 14;
            const marginR = 196;

            let filtered = [], titlePeriod = '', totalBruto = 0, totalLiquido = 0;

            if (type === 'all') {
                filtered = [...this.entries];
                const monthNames = ['Janeiro','Fevereiro','Marco','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
                if (filtered.length > 0) {
                    const dates = filtered.map(e => e.data).filter(Boolean).sort();
                    const [fy, fm] = dates[0].split('-');
                    const [ly, lm] = dates[dates.length - 1].split('-');
                    titlePeriod = `${monthNames[parseInt(fm,10)-1]} ${fy} ate ${monthNames[parseInt(lm,10)-1]} ${ly}`;
                } else {
                    titlePeriod = 'Historico Completo';
                }
            } else if (type === 'weekly') {
                const today = getManausDate();
                const sevenDaysAgo = new Date(today);
                sevenDaysAgo.setDate(today.getDate() - 7);
                filtered = this.entries.filter(e => {
                    const d = new Date(e.data);
                    return d >= sevenDaysAgo && d <= today;
                });
                titlePeriod = `Semanal  •  ${sevenDaysAgo.toLocaleDateString('pt-BR')} ate ${today.toLocaleDateString('pt-BR')}`;
            } else {
                const picker = document.getElementById('pdfMonthPicker');
                const monthVal = picker.value;
                if (!monthVal) {
                    this.showToast('Selecione um mes', 'error');
                    return;
                }
                const [y, m] = monthVal.split('-');
                const monthNames = ['Janeiro','Fevereiro','Marco','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
                filtered = this.entries.filter(e => {
                    if (!e.data) return false;
                    const parts = e.data.split('-');
                    return parts[0] === y && parts[1] === m;
                });
                titlePeriod = `${monthNames[parseInt(m, 10) - 1]} de ${y}`;
            }

            if (filtered.length === 0) {
                this.showToast('Nenhum dado no periodo', 'warning');
                return;
            }

            // Para 'all': ordem cronologica ASC para agrupar por mes
            // Para outros tipos: ordem DESC (mais recente primeiro)
            if (type === 'all') {
                filtered.sort((a, b) => new Date(a.data) - new Date(b.data));
            } else {
                filtered.sort((a, b) => new Date(b.data) - new Date(a.data));
            }

            const _mNames = ['Janeiro','Fevereiro','Marco','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
            const tableBody = [];
            let _lastMk = null;
            filtered.forEach((e) => {
                totalBruto += Number(e.bruto) || 0;
                totalLiquido += Number(e.liquido) || 0;
                // Separador de mes para tipo 'all'
                if (type === 'all' && e.data) {
                    const mk = e.data.substring(0, 7);
                    if (mk !== _lastMk) {
                        _lastMk = mk;
                        const [ym, mm] = mk.split('-');
                        const mLabel = (_mNames[parseInt(mm, 10) - 1] + ' ' + ym).toUpperCase();
                        tableBody.push([{
                            content: mLabel,
                            colSpan: 7,
                            styles: {
                                fillColor: [10, 18, 46],
                                textColor: [0, 212, 255],
                                fontStyle: 'bold',
                                fontSize: 9,
                                halign: 'center',
                                cellPadding: { top: 4, right: 3, bottom: 4, left: 3 }
                            }
                        }]);
                    }
                }
                const isPaid = !!e.pago;
                tableBody.push([
                    e.dataF || e.data || '-',
                    e.navio || '-',
                    e.turno || '-',
                    e.tipo === 'normal' ? 'Normal' : 'Feriado',
                    {
                        content: '',
                        paid: isPaid,
                        styles: { halign: 'center' }
                    },
                    this.formatMoney(e.bruto),
                    this.formatMoney(e.liquido)
                ]);
            });

            const totalPago = filtered.filter(e => e.pago).reduce((sum, e) => sum + (Number(e.liquido) || 0), 0);
            const totalPendente = totalLiquido - totalPago;
            const qtdPago = filtered.filter(e => e.pago).length;
            const qtdPendente = filtered.filter(e => !e.pago).length;

            // -- HELPER: Desenha cabecalho em cada pagina --
            const drawHeader = () => {
                // Fundo escuro do topo
                doc.setFillColor(8, 12, 34);
                doc.rect(0, 0, pageW, 30, 'F');
                // Faixa lateral ciano
                doc.setFillColor(0, 212, 255);
                doc.rect(0, 0, 3, 30, 'F');
                // Linha inferior do header
                doc.setDrawColor(0, 212, 255);
                doc.setLineWidth(0.4);
                doc.line(0, 30, pageW, 30);

                // Titulo EVOLUTION
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(20);
                doc.setTextColor(255, 255, 255);
                doc.text('EVOLUTION', 9, 13);
                // Subtitulo
                doc.setFontSize(7.5);
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(0, 212, 255);
                doc.text('SISTEMA DE GESTAO DE PRODUCAO PORTUARIA', 9, 19);
                // Versao
                doc.setFontSize(6.5);
                doc.setTextColor(120, 140, 180);
                doc.text(APP_VERSION, 9, 25);
                // Data geracao (direita)
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(7);
                doc.setTextColor(180, 200, 220);
                doc.text('Gerado em:', marginR, 16, { align: 'right' });
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(7.5);
                doc.setTextColor(255, 255, 255);
                doc.text(generatedAt, marginR, 22, { align: 'right' });
            };

            // -- HELPER: Marca dagua em cada pagina --
            const drawWatermark = () => {
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(64);
                doc.setTextColor(228, 238, 248);
                doc.text('EVOLUTION', 105, 152, { align: 'center', angle: 38 });
                // Removido o texto da marca d'agua que exibia o nome do desenvolvedor.
                // Agora, somente "EVOLUTION" e mostrado como marca d'agua.
            };

            // -- HELPER: Rodape em cada pagina --
            const drawFooter = (pageNum, totalPagesRef) => {
                const pageH = doc.internal.pageSize.height;
                doc.setFillColor(245, 248, 252);
                doc.rect(0, pageH - 12, pageW, 12, 'F');
                doc.setDrawColor(200, 215, 230);
                doc.setLineWidth(0.3);
                doc.line(0, pageH - 12, pageW, pageH - 12);
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(7);
                doc.setTextColor(80, 100, 130);
                doc.text('EVOLUTION  |  ' + (this.currentUser || 'Usuario').toUpperCase(), marginL, pageH - 5);
                doc.setFont('helvetica', 'normal');
                doc.text(`Pag. ${pageNum}`, marginR, pageH - 5, { align: 'right' });
            };

            // Metadados do documento (evita avisos de assinatura em leitores de PDF)
            doc.setProperties({
                title: 'Relatorio EVOLUTION - ' + titlePeriod,
                subject: 'Relatorio de Producao Portuaria',
                author: this.currentUser || 'Usuario',
                creator: 'EVOLUTION'
            });

            // -- PAGINA 1 --
            drawWatermark();
            drawHeader();

            // Bloco de identificacao
            doc.setFillColor(248, 250, 253);
            doc.setDrawColor(220, 230, 245);
            doc.setLineWidth(0.3);
            doc.roundedRect(marginL, 34, marginR - marginL, 18, 3, 3, 'FD');
            // Faixa colorida esquerda do bloco
            doc.setFillColor(0, 212, 255);
            doc.roundedRect(marginL, 34, 3, 18, 1.5, 1.5, 'F');

            doc.setFont('helvetica', 'bold');
            doc.setFontSize(12);
            doc.setTextColor(15, 25, 50);
            doc.text(this.currentUser || 'Usuario', 21, 42);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8);
            doc.setTextColor(80, 100, 140);
            doc.text('Operador Portuario  |  ' + titlePeriod, 21, 48);
            // Registros no canto direito
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9);
            doc.setTextColor(0, 150, 200);
            doc.text(`${filtered.length} registros`, marginR, 42, { align: 'right' });
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7.5);
            doc.setTextColor(120, 140, 170);
            doc.text(`${qtdPago} pagos  •  ${qtdPendente} pendentes`, marginR, 48, { align: 'right' });

            // Cards de resumo (4 cards lado a lado)
            const cardW = 43;
            const cardGap = 3;
            const cardStartX = marginL;
            const cardY = 56;
            const cardH = 22;

            const cardDefs = [
                { title: 'BRUTO TOTAL',   value: this.formatMoney(totalBruto),    accent: [0, 180, 216],   bg: [240, 252, 255] },
                { title: 'LIQUIDO TOTAL', value: this.formatMoney(totalLiquido),   accent: [255, 184, 0],   bg: [255, 252, 235] },
                { title: 'JA RECEBIDO',   value: this.formatMoney(totalPago),      accent: [0, 210, 160],   bg: [240, 255, 250] },
                { title: 'PENDENTE',      value: this.formatMoney(totalPendente),  accent: [255, 56, 96],   bg: [255, 242, 245] }
            ];

            cardDefs.forEach((card, i) => {
                const cx = cardStartX + i * (cardW + cardGap);
                // Fundo do card
                doc.setFillColor(...card.bg);
                doc.setDrawColor(...card.accent.map(v => Math.min(255, v + 40)));
                doc.setLineWidth(0.25);
                doc.roundedRect(cx, cardY, cardW, cardH, 3, 3, 'FD');
                // Faixa topo colorida
                doc.setFillColor(...card.accent);
                doc.roundedRect(cx, cardY, cardW, 2.5, 1.5, 1.5, 'F');
                doc.rect(cx, cardY + 1.5, cardW, 1, 'F');
                // Label
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(6.2);
                doc.setTextColor(...card.accent);
                doc.text(card.title, cx + 3, cardY + 8);
                // Valor
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(9.5);
                doc.setTextColor(15, 25, 50);
                // Quebra valor se for muito longo
                const valText = card.value;
                doc.text(valText, cx + 3, cardY + 17, { maxWidth: cardW - 5 });
            });

            // Barra de progresso pago/total (visual)
            const barY = 82;
            const barW = marginR - marginL;
            const pctPago = totalLiquido > 0 ? (totalPago / totalLiquido) : 0;
            doc.setFillColor(230, 238, 248);
            doc.roundedRect(marginL, barY, barW, 4, 2, 2, 'F');
            if (pctPago > 0) {
                doc.setFillColor(0, 210, 160);
                doc.roundedRect(marginL, barY, barW * pctPago, 4, 2, 2, 'F');
            }
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(6.5);
            doc.setTextColor(80, 100, 140);
            doc.text(`${Math.round(pctPago * 100)}% recebido`, marginL, barY + 8);
            doc.text(`${Math.round((1 - pctPago) * 100)}% pendente`, marginR, barY + 8, { align: 'right' });

            // Legenda de status para a coluna com bolinhas
            const legendY = 93;
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(6.8);
            doc.setTextColor(80, 100, 140);
            doc.text('Status:', marginL, legendY);
            doc.setFillColor(220, 50, 90);
            doc.circle(marginL + 18, legendY - 1, 1.1, 'F');
            doc.setFont('helvetica', 'normal');
            doc.text('Pendente', marginL + 21.5, legendY);
            doc.setFillColor(0, 170, 120);
            doc.circle(marginL + 45.5, legendY - 1, 1.1, 'F');
            doc.text('Pago', marginL + 49, legendY);

            // Tabela principal
            doc.autoTable({
                startY: 97,
                head: [['Data', 'Navio', 'Turno', 'Tipo', '', 'Bruto (R$)', 'Liquido (R$)']],
                body: tableBody,
                theme: 'grid',
                styles: {
                    fontSize: 8.2,
                    cellPadding: { top: 3, right: 3, bottom: 3, left: 3 },
                    textColor: [24, 32, 52],
                    lineColor: [215, 225, 240],
                    lineWidth: 0.18
                },
                headStyles: {
                    fillColor: [10, 18, 46],
                    textColor: [220, 235, 255],
                    fontStyle: 'bold',
                    fontSize: 8,
                    cellPadding: { top: 4, right: 3, bottom: 4, left: 3 }
                },
                alternateRowStyles: {
                    fillColor: [248, 251, 255]
                },
                columnStyles: {
                    0: { cellWidth: 22 },
                    1: { cellWidth: 52 },
                    2: { cellWidth: 20 },
                    3: { cellWidth: 17 },
                    4: { halign: 'center', cellWidth: 7 },
                    5: { halign: 'right', cellWidth: 31, fontStyle: 'normal' },
                    6: { halign: 'right', cellWidth: 33, fontStyle: 'bold', textColor: [0, 140, 100] }
                },
                // Rodape com total distribuido em 7 colunas
                foot: [[
                    { content: '', colSpan: 3, styles: { fillColor: [15, 25, 60] } },
                    { content: 'TOTAL', colSpan: 2, styles: { halign: 'right', fontStyle: 'bold', textColor: [200, 220, 255], fillColor: [15, 25, 60], fontSize: 8 } },
                    { content: this.formatMoney(totalBruto), styles: { halign: 'right', fontStyle: 'bold', textColor: [200, 220, 255], fillColor: [15, 25, 60] } },
                    { content: this.formatMoney(totalLiquido), styles: { halign: 'right', fontStyle: 'bold', textColor: [0, 220, 170], fillColor: [15, 25, 60] } }
                ]],
                didParseCell: (data) => {
                    if (data.section !== 'body' || data.column.index !== 6) return;
                    const raw = data.row?.raw;
                    const statusCell = Array.isArray(raw) ? raw[4] : null;
                    if (!statusCell || typeof statusCell !== 'object' || !Object.prototype.hasOwnProperty.call(statusCell, 'paid')) return;
                    data.cell.styles.textColor = statusCell.paid ? [0, 140, 100] : [220, 50, 90];
                },
                didDrawCell: (data) => {
                    if (data.section !== 'body' || data.column.index !== 4) return;
                    const raw = data.cell.raw;
                    if (!raw || typeof raw !== 'object' || !Object.prototype.hasOwnProperty.call(raw, 'paid')) return;
                    const dotColor = raw.paid ? [0, 170, 120] : [220, 50, 90];
                    const cx = data.cell.x + (data.cell.width / 2);
                    const cy = data.cell.y + (data.cell.height / 2);
                    doc.setFillColor(...dotColor);
                    doc.circle(cx, cy, 1.1, 'F');
                },
                willDrawPage: (data) => {
                    const pgNum = doc.internal.getNumberOfPages();
                    // Marca dagua e cabecalho ANTES do conteudo nas paginas adicionais
                    if (pgNum > 1) {
                        drawWatermark();
                        drawHeader();
                    }
                },
                didDrawPage: (data) => {
                    const pgNum = doc.internal.getNumberOfPages();
                    drawFooter(pgNum, '?');
                }
            });

            // Atualizando rodape da pagina 1 com total correto de paginas
            const totalPages = doc.internal.getNumberOfPages();
            for (let p = 1; p <= totalPages; p++) {
                doc.setPage(p);
                const pageH = doc.internal.pageSize.height;
                // Reescrever apenas o numero de pagina com total correto
                doc.setFillColor(245, 248, 252);
                doc.rect(marginR - 25, pageH - 11, 30, 9, 'F');
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(7);
                doc.setTextColor(80, 100, 130);
                doc.text(`Pag. ${p} / ${totalPages}`, marginR, pageH - 5, { align: 'right' });
            }

            doc.save(`Evolution_${(this.currentUser || 'usuario').replace(/\s+/g, '_')}_${titlePeriod.replace(/\s+/g, '_')}.pdf`);
            this.closeModal('pdfOptionsModal');
            this.showToast('PDF gerado com sucesso!', 'success');
        };

        // ============================================
        // UTILITARIOS
        // ============================================
        EvolutionApp.prototype.escHtml = function(str) {
            return String(str ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;')
                .replace(/`/g, '&#96;');
        };

        EvolutionApp.prototype.formatMoney = function(cents) {
            return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        };

        EvolutionApp.prototype.copyToClipboard = function(text, msg) {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text)
                    .then(() => this.showToast(msg, 'success'))
                    .catch(() => this._copyFallback(text, msg));
            } else {
                this._copyFallback(text, msg);
            }
        };

        EvolutionApp.prototype._copyFallback = function(text, msg) {
            try {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;';
                document.body.appendChild(ta);
                ta.focus();
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                this.showToast(msg, 'success');
            } catch(e) {
                this.showToast('Nao foi possivel copiar automaticamente', 'error');
            }
        };

        EvolutionApp.prototype.showToast = function(msg, type = 'info') {
            const container = document.getElementById('toastContainer');
            if (!container) return;
            // FIX 14: Limita a 3 toasts simultaneos para nao entupir a tela
            const existing = container.querySelectorAll('.toast');
            if (existing.length >= 3) existing[0].remove();
            const toast = document.createElement('div');
            toast.className = 'toast';
            const colors = { success: 'var(--success)', error: 'var(--danger)', warning: 'var(--warning)', info: 'var(--primary)' };
            const icons = { success: '✓', error: '✕', warning: '⚠', info: '•' };
            toast.style.borderLeft = `3px solid ${colors[type] || colors.info}`;
            // FIX XSS: usa DOM nodes em vez de innerHTML para evitar injecao via msg com dados do usuario
            const iconSpan = document.createElement('span');
            iconSpan.style.cssText = `color:${colors[type] || colors.info};font-weight:800;`;
            iconSpan.textContent = icons[type] || icons.info;
            toast.appendChild(iconSpan);
            toast.appendChild(document.createTextNode(' ' + msg));
            container.appendChild(toast);
            setTimeout(() => { try { toast.remove(); } catch(_) {} }, 3000);
        };

        EvolutionApp.prototype.showUndoToast = function(msg, onUndo) {
            const container = document.getElementById('toastContainer');
            if (!container) return;
            const existing = container.querySelectorAll('.toast');
            if (existing.length >= 3) existing[0].remove();
            const toast = document.createElement('div');
            toast.className = 'toast';
            toast.style.cssText = 'border-left: 3px solid var(--danger); pointer-events: auto; justify-content: space-between;';
            const left = document.createElement('span');
            left.style.cssText = 'display:flex;align-items:center;gap:8px;';
            const icon = document.createElement('span');
            icon.style.cssText = 'color:var(--danger);font-weight:800;';
            icon.textContent = '🗑';
            left.appendChild(icon);
            left.appendChild(document.createTextNode(' ' + msg));
            const undoBtn = document.createElement('button');
            undoBtn.textContent = '↩ Desfazer';
            undoBtn.style.cssText = 'background:var(--danger);color:#fff;border:none;border-radius:8px;padding:4px 10px;font-size:0.75rem;font-weight:700;cursor:pointer;flex-shrink:0;margin-left:12px;font-family:inherit;';
            undoBtn.onclick = () => { toast.remove(); if (typeof onUndo === 'function') onUndo(); };
            toast.appendChild(left);
            toast.appendChild(undoBtn);
            container.appendChild(toast);
            setTimeout(() => { try { toast.remove(); } catch(_) {} }, 5000);
        };

        // ============================================
        // AVATAR
        // ============================================
        EvolutionApp.prototype.uploadAvatar = function() {
            document.getElementById('avatarInput').click();
        };

        EvolutionApp.prototype.handleAvatarChange = function(event) {
            const file = event.target.files?.[0];
            if (!file || !this.currentUserId) return;

            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = async () => {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    const side = Math.min(img.width, img.height);
                    const sx = Math.max(0, Math.floor((img.width - side) / 2));
                    const sy = Math.max(0, Math.floor((img.height - side) / 2));
                    const MAX_SIZE = 600;
                    canvas.width = MAX_SIZE;
                    canvas.height = MAX_SIZE;
                    ctx.drawImage(img, sx, sy, side, side, 0, 0, MAX_SIZE, MAX_SIZE);
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.82);

                    // Salva base64 no localStorage para exibicao instantanea
                    safeStorage.setItem(`evo_avatar_local_${this.currentUserId}`, dataUrl);
                    if (!this.users[this.currentUserId]) this.users[this.currentUserId] = {};
                    this.users[this.currentUserId].avatar = dataUrl;
                    this.saveUsersToCache();
                    this.showMainApp();
                    this.showToast('Foto atualizada!', 'success');

                    // Upload para Firebase Storage (sem limite de tamanho)
                    if (storage && db) {
                        try {
                            const storageRef = storage.ref(`avatars/${this.currentUserId}/profile.jpg`);
                            const response = await fetch(dataUrl);
                            const blob = await response.blob();
                            await storageRef.put(blob, { contentType: 'image/jpeg' });
                            const downloadURL = await storageRef.getDownloadURL();
                            // Salva apenas a URL (pequena) no Firestore - sem pressao no documento
                            await db.collection('users').doc(this.currentUserId).update({ avatar: downloadURL });
                            // Atualiza cache local com a URL para que outros dispositivos carreguem direto
                            this.users[this.currentUserId].avatar = downloadURL;
                            this.saveUsersToCache();
                        } catch (err) {
                            console.error('Falha ao salvar avatar no Storage:', err);
                            // Fallback silencioso: imagem ja salva no localStorage
                            // Nao persiste base64 no Firestore para nao violar limite de 1MB por documento
                        }
                    }
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        };

        EvolutionApp.prototype.deleteAvatar = function() {
            this.openModal('deleteAvatarModal');
        };

        EvolutionApp.prototype.executeDeleteAvatar = async function() {
            this.closeModal('deleteAvatarModal');
            safeStorage.removeItem(`evo_avatar_local_${this.currentUserId}`);
            if (this.users[this.currentUserId]) {
                this.users[this.currentUserId].avatar = null;
                this.saveUsersToCache();
            }
            this.showMainApp();
            if (db) {
                try {
                    await db.collection('users').doc(this.currentUserId).update({ avatar: null });
                } catch (e) {
                    console.error('Falha ao remover avatar no Firestore:', e);
                }
            }
            // Remove do Firebase Storage tambem
            if (storage) {
                try {
                    await storage.ref(`avatars/${this.currentUserId}/profile.jpg`).delete();
                } catch (e) {
                    // Ignora erro se arquivo nao existe no Storage (foto antiga salva como base64)
                }
            }
            this.showToast('Foto removida', 'success');
        };

        // ============================================
        // TEMA
        // ============================================
        EvolutionApp.prototype.toggleTheme = function() {
            document.body.classList.toggle('light-mode');
            safeStorage.setItem('evo_theme_v516', document.body.classList.contains('light-mode') ? 'light' : 'dark');
        };

        // ============================================
        // MODAIS
        // ============================================
        EvolutionApp.prototype.openModal = function(id) {
            const m = document.getElementById(id);
            if (m) {
                m.classList.add('active');
                // FIX 9: Conta modais abertos para nao restaurar scroll prematuramente
                this._openModalCount = (this._openModalCount || 0) + 1;
                document.body.style.overflow = 'hidden';

                // Atualizacoes ao abrir modais
                if (id === 'profileModal') {
                    this.updateVipUI();
                }
                if (id === 'adminModal' && this.isAdmin) {
                    this.loadPendingUsers();
                    this.renderUserList();
                }
                // FIX: Sempre abre configModal com metaEditor recolhido (estado limpo)
                if (id === 'configModal') {
                    const me = document.getElementById('metaEditor');
                    const cc = document.getElementById('cancelMetaContainer');
                    if (me) me.style.display = 'none';
                    if (cc) cc.innerHTML = '';
                }
            }
        };

        EvolutionApp.prototype.closeModal = function(id) {
            const m = document.getElementById(id);
            if (m) {
                m.classList.remove('active');
                // FIX 9: So restaura overflow quando TODOS os modais estiverem fechados
                this._openModalCount = Math.max(0, (this._openModalCount || 1) - 1);
                if (this._openModalCount === 0) {
                    document.body.style.overflow = '';
                }
                if (id === 'reportPreviewModal' && typeof this.clearReportPreview === 'function') {
                    this.clearReportPreview();
                }
                // FIX: Recolhe metaEditor ao fechar configModal (qualquer forma de fechar)
                if (id === 'configModal') {
                    const me = document.getElementById('metaEditor');
                    const cc = document.getElementById('cancelMetaContainer');
                    if (me) me.style.display = 'none';
                    if (cc) cc.innerHTML = '';
                }
            }
        };

        EvolutionApp.prototype.closeModalOnOverlay = function(e, id) {
            if (e.target.id === id) this.closeModal(id);
        };

        EvolutionApp.prototype.toggleSection = function(id) {
            const target = document.getElementById(id);
            if (!target) return;
            const wasExpanded = target.classList.contains('expanded');
            // Fecha todas as sections abertas
            document.querySelectorAll('.section.expanded').forEach(s => s.classList.remove('expanded'));
            // Se estava fechado, abre; se estava aberto, permanece fechado (toggle)
            if (!wasExpanded) target.classList.add('expanded');
        };

        // ============================================
        // ADMIN - MENSAGENS DO SISTEMA
        // BUG FIX: Funcoes faltavam completamente - causavam erro ao clicar nos botoes admin
        // ============================================
        EvolutionApp.prototype.toggleMsgDates = function() {
            const msgType = document.getElementById('msgType')?.value;
            const dates = document.getElementById('msgDates');
            if (dates) dates.style.display = msgType === 'period' ? 'grid' : 'none';
        };

        EvolutionApp.prototype.publishMessage = async function() {
            const content = document.getElementById('msgContent')?.value?.trim();
            const type = document.getElementById('msgType')?.value || 'once';
            if (!content) {
                this.showToast('Digite o conteudo do aviso', 'error');
                return;
            }
            const msgData = {
                content,
                type,
                createdAt: new Date().toISOString()
            };
            if (type === 'period') {
                msgData.startDate = document.getElementById('msgStart')?.value || '';
                msgData.endDate = document.getElementById('msgEnd')?.value || '';
                if (!msgData.startDate || !msgData.endDate) {
                    this.showToast('Selecione as datas do periodo', 'error');
                    return;
                }
            }
            if (!db) { this.showToast('Firebase nao disponivel', 'error'); return; }
            try {
                await db.collection('config').doc('message').set(msgData);
                this.showToast('Aviso publicado com sucesso!', 'success');
            } catch (e) {
                this.showToast('Erro ao publicar aviso', 'error');
            }
        };

        EvolutionApp.prototype.deleteMessage = async function() {
            if (!db) { this.showToast('Firebase nao disponivel', 'error'); return; }
            try {
                await db.collection('config').doc('message').delete();
                this.showToast('Aviso removido!', 'success');
            } catch (e) {
                this.showToast('Erro ao remover aviso', 'error');
            }
        };

        EvolutionApp.prototype.saveFloodRate = async function() {
            const input = document.getElementById('floodPercentage');
            const value = parseInt(input?.value ?? '40');
            if (isNaN(value) || value < 0 || value > 100) {
                this.showToast('Valor deve ser entre 0 e 100', 'error');
                return;
            }
            if (!db) { this.showToast('Firebase nao disponivel', 'error'); return; }
            try {
                await db.collection('config').doc('settings').set({ floodPercentage: value }, { merge: true });
                this.showToast('Taxa de doacao salva!', 'success');
            } catch (e) {
                this.showToast('Erro ao salvar taxa', 'error');
            }
        };

        // ============================================
        // PIX / DOACAO
        // ============================================
        EvolutionApp.prototype.showPix = function() {
            this.closeModal('configModal');
            const msg = DONATION_MESSAGES[Math.floor(Math.random() * DONATION_MESSAGES.length)];
            document.getElementById('pixMessage').textContent = msg;
            setTimeout(() => this.openModal('pixModal'), 200);
        };

        EvolutionApp.prototype.copyPix = function() {
            this.copyToClipboard('92994821868', 'Chave Copiada!');
        };

        // ============================================
        // PWA
        // ============================================
        EvolutionApp.prototype.addToHomeScreen = function() {
            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
            if (isIOS) {
                this.openModal('iosInstallModal');
            } else {
                this.showToast('Pressione Opcoes > Adicionar a Tela de Inicio', 'info');
            }
        };

        // ============================================
        // LOGOUT
        // ============================================
        EvolutionApp.prototype.logout = function() {
            const prevUserId = this.currentUserId;
            if (typeof this.stopSessionWatch === 'function') {
                this.stopSessionWatch();
            }
            if (prevUserId && this.users[prevUserId]) {
                this.users[prevUserId].lastSeenAt = new Date().toISOString();
                this.saveUsersToCache();
            }
            if (db && prevUserId) {
                db.collection('users').doc(prevUserId).set({
                    lastSeenAt: new Date().toISOString(),
                    lastSeenSource: 'logout'
                }, { merge: true }).catch(() => {});
            }
            clearTimeout(this.historySyncTimer);

            // Cancelar todas as subscriptions e nullar referencias
            if (this.unsubscribeUsers) { this.unsubscribeUsers(); this.unsubscribeUsers = null; }
            if (this.unsubscribeEntries) { this.unsubscribeEntries(); this.unsubscribeEntries = null; }
            if (this.unsubscribePending) { this.unsubscribePending(); this.unsubscribePending = null; }

            // Fechar TODOS os modais abertos (eles sao position:fixed e ficam visiveis
            // mesmo apos mainApp ser ocultado, causando o bug de "tela nao muda")
            // FIX 1: Reset explicito do contador para garantir que body.overflow seja
            // restaurado corretamente em qualquer sessao futura (evita scroll travado)
            document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
            this._openModalCount = 0;
            document.body.style.overflow = '';

            // Limpar sessao e estado
            safeStorage.removeItem('evo_session_v516');
            safeStorage.removeItem('evo_calendar_month');
            this.pendingSessionData = null;
            this.currentUser = null;
            this.currentUserCode = null;
            this.currentUserId = null;
            this.isAdmin = false;
            this.isVip = false;
            this.entries = [];
            this.expandedHistoryId = null;
            this.editingEntryId = null;
            this.managingUser = null;
            this.pinValue = '';

            // Mostrar tela de login
            document.getElementById('mainApp').classList.add('hidden');
            document.getElementById('loginScreen').classList.remove('hidden');
            this.updatePinDisplay();
        };

        // ============================================
        // CONFIRM MODAL
        // ============================================
        EvolutionApp.prototype.openConfirmModal = function(actionType, message, targetId) {
            this.pendingAction = { type: actionType, id: targetId };
            document.getElementById('confirmActionText').textContent = message;
            document.getElementById('btnConfirmActionExec').onclick = () => {
                if (this.pendingAction.type === 'reject') {
                    this.rejectUser(this.pendingAction.id);
                } else if (this.pendingAction.type === 'deleteUser') {
                    this.deleteUser(this.pendingAction.id);
                }
                this.closeModal('confirmActionModal');
            };
            // FIX: Fecha apenas modais realmente ativos para nao dessincronizar _openModalCount
            const _mgmt = document.getElementById('userManagementModal');
            const _adm  = document.getElementById('adminModal');
            if (_mgmt && _mgmt.classList.contains('active')) this.closeModal('userManagementModal');
            if (_adm  && _adm.classList.contains('active'))  this.closeModal('adminModal');
            setTimeout(() => this.openModal('confirmActionModal'), 100);
        };
