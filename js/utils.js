        // ============================================
        // CONFIGURACOES
        // ============================================
        EvolutionApp.prototype.exportData = function() {
            if (!this.isAdmin && !this.isVip) {
                this.closeModal('configModal');
                setTimeout(() => this.requireVip('O backup de dados e um recurso exclusivo para usuarios VIP.'), 150);
                return;
            }
            const data = {
                v: window.EVOLUTION_APP_VERSION || 'V5.53',
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
            if (!this.isAdmin && !this.isVip) {
                this.closeModal('configModal');
                setTimeout(() => this.requireVip('A importação de dados é um recurso exclusivo para usuários VIP.'), 150);
                return;
            }
            document.getElementById('importInput').click();
        };

        EvolutionApp.prototype.importData = function(e) {
            if (!this.isAdmin && !this.isVip) { e.target.value = ''; return; }
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
            if (!this.isAdmin && !this.isVip) {
                setTimeout(() => this.requireVip('O download de PDF e um recurso exclusivo para usuarios VIP.'), 150);
                return;
            }
            this.openModal('pdfOptionsModal');
            document.getElementById('pdfMonthPicker').value = this.selectedMonth;
        };

        EvolutionApp.prototype.generatePdf = async function(type) {
            if (!this.requireVip('O download de PDF e um recurso exclusivo para usuarios VIP.')) return;
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF({ unit: 'mm', format: 'a4' });

            const APP_VERSION = (window.EVOLUTION_APP_VERSION || 'V5.53');
            const generatedAt = new Date().toLocaleString('pt-BR');
            const pageW = 210;
            const marginL = 14;
            const marginR = 196;

            let filtered = [], titlePeriod = '', totalBruto = 0, totalLiquido = 0;

            if (type === 'all') {
                filtered = [...this.entries];
                const monthNames = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
                if (filtered.length > 0) {
                    const dates = filtered.map(e => e.data).filter(Boolean).sort();
                    const [fy, fm] = dates[0].split('-');
                    const [ly, lm] = dates[dates.length - 1].split('-');
                    titlePeriod = `${monthNames[parseInt(fm,10)-1]} ${fy} até ${monthNames[parseInt(lm,10)-1]} ${ly}`;
                } else {
                    titlePeriod = 'Histórico Completo';
                }
            } else if (type === 'weekly') {
                const today = getManausDate();
                const sevenDaysAgo = new Date(today);
                sevenDaysAgo.setDate(today.getDate() - 7);
                // Compara como strings "YYYY-MM-DD" (horario local de Manaus) em vez de
                // epoch, para nao misturar a data UTC de e.data com o epoch deslocado de getManausDate.
                const todayStr = formatDateManaus(today);
                const sevenDaysAgoStr = formatDateManaus(sevenDaysAgo);
                filtered = this.entries.filter(e => e.data && e.data >= sevenDaysAgoStr && e.data <= todayStr);
                titlePeriod = `Semanal  •  ${sevenDaysAgo.toLocaleDateString('pt-BR')} até ${today.toLocaleDateString('pt-BR')}`;
            } else {
                const picker = document.getElementById('pdfMonthPicker');
                const monthVal = picker.value;
                if (!monthVal) {
                    this.showToast('Selecione um mês', 'error');
                    return;
                }
                const [y, m] = monthVal.split('-');
                const monthNames = ['Janeiro','Fevereiro','Marco','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
                filtered = this.entries.filter(e => {
                    if (!e.data) return false;
                    const parts = e.data.split('-');
                    return parts[0] === y && parts[1] === m;
                });
                const monthNamesLong = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
                titlePeriod = `${monthNamesLong[parseInt(m, 10) - 1]} de ${y}`;
            }

            if (filtered.length === 0) {
                this.showToast('Nenhum dado no período', 'warning');
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

            // Rotulo de mes a partir da chave "YYYY-MM" (com fallback defensivo para dados sem data)
            const monthLabel = (mk) => {
                const parts = (mk || '').split('-');
                const mi = parseInt(parts[1], 10) - 1;
                if (!parts[0] || isNaN(mi) || mi < 0 || mi > 11) return 'SEM DATA';
                return (_mNames[mi] + ' ' + parts[0]).toUpperCase();
            };
            const entryRow = (e) => {
                const isPaid = !!e.pago;
                return [
                    e.dataF || e.data || '-',
                    e.navio || '-',
                    e.turno || '-',
                    e.tipo === 'normal' ? 'Normal' : 'Feriado',
                    String(e.conferentes || 1),
                    this.formatMoney(Number(e.bruto) || 0),
                    { content: this.formatMoney(Number(e.liquido) || 0), paid: isPaid }
                ];
            };
            // Linha do MES: vai no TOPO da tabela (dentro do head), acima do cabecalho
            // de colunas (Data, Navio...). Como fica no head, ela se repete em toda pagina
            // que aquele mes ocupar. Antes esta linha ficava no corpo, abaixo do cabecalho
            // de colunas ("invertido"); agora e o cabecalho principal do mes.
            const monthHeadRow = (mk) => ([{
                content: monthLabel(mk),
                colSpan: 7,
                styles: { fillColor: [13, 17, 23], textColor: [37, 99, 235], fontStyle: 'bold', fontSize: 10.5, halign: 'center', cellPadding: { top: 4.5, right: 3, bottom: 4.5, left: 3 } }
            }]);
            const monthSubtotalRow = (mk, bruto, liquido) => ([
                { content: `Subtotal ${monthLabel(mk)}`, colSpan: 5, styles: { halign: 'right', fontStyle: 'bold', textColor: [80, 100, 140], fillColor: [235, 242, 250], fontSize: 7.5, cellPadding: { top: 3, right: 6, bottom: 3, left: 3 } } },
                { content: this.formatMoney(bruto), styles: { halign: 'right', fontStyle: 'bold', textColor: [0, 130, 180], fillColor: [235, 242, 250], fontSize: 7.5 } },
                { content: this.formatMoney(liquido), styles: { halign: 'right', fontStyle: 'bold', textColor: [0, 150, 110], fillColor: [235, 242, 250], fontSize: 7.5 } }
            ]);

            // Para 'all': agrupa por mes (cada grupo vira uma pagina propria na tabela).
            // Para os demais tipos: lista simples, sem separadores (comportamento inalterado).
            const tableBody = [];
            const monthGroups = [];
            if (type === 'all') {
                let current = null;
                filtered.forEach((e) => {
                    totalBruto += Number(e.bruto) || 0;
                    totalLiquido += Number(e.liquido) || 0;
                    const mk = e.data ? e.data.substring(0, 7) : (current ? current.key : '');
                    if (!current || current.key !== mk) {
                        current = { key: mk, rows: [], bruto: 0, liquido: 0 };
                        monthGroups.push(current);
                    }
                    current.bruto += Number(e.bruto) || 0;
                    current.liquido += Number(e.liquido) || 0;
                    current.rows.push(entryRow(e));
                });
            } else {
                filtered.forEach((e) => {
                    totalBruto += Number(e.bruto) || 0;
                    totalLiquido += Number(e.liquido) || 0;
                    tableBody.push(entryRow(e));
                });
            }

            const totalPago = filtered.filter(e => e.pago).reduce((sum, e) => sum + (Number(e.liquido) || 0), 0);
            const totalPendente = totalLiquido - totalPago;
            const qtdPago = filtered.filter(e => e.pago).length;
            const qtdPendente = filtered.filter(e => !e.pago).length;

            // -- HELPER: Desenha cabecalho em cada pagina --
            const drawHeader = () => {
                // Fundo escuro do topo
                doc.setFillColor(13, 17, 23);
                doc.rect(0, 0, pageW, 30, 'F');
                // Faixa lateral ciano
                doc.setFillColor(37, 99, 235);
                doc.rect(0, 0, 3, 30, 'F');
                // Linha inferior do header
                doc.setDrawColor(37, 99, 235);
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
                doc.setTextColor(37, 99, 235);
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
            };

            // Metadados do documento (evita avisos de assinatura em leitores de PDF)
            doc.setProperties({
                title: 'Relatório EVOLUTION - ' + titlePeriod,
                subject: 'Relatório de Produção Portuária',
                author: this.currentUser || 'Usuário',
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
            doc.setFillColor(37, 99, 235);
            doc.roundedRect(marginL, 34, 3, 18, 1.5, 1.5, 'F');

            doc.setFont('helvetica', 'bold');
            doc.setFontSize(12);
            doc.setTextColor(15, 25, 50);
            doc.text(this.currentUser || 'Usuario', 21, 42);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8);
            doc.setTextColor(80, 100, 140);
            doc.text('Conferente / Planista  |  ' + titlePeriod, 21, 48);
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
                { title: 'PENDENTE',      value: this.formatMoney(totalPendente),  accent: [239, 68, 68],   bg: [255, 242, 245] }
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

            // Configuracao compartilhada por todas as tabelas (uma unica tabela para
            // weekly/month; uma tabela por mes, cada qual em sua propria pagina, para 'all')
            const commonTableOpts = {
                theme: 'grid',
                head: [['Data', 'Navio', 'Turno', 'Tipo', 'Conf.', 'Bruto (R$)', 'Líquido (R$)']],
                styles: {
                    fontSize: 8.2,
                    cellPadding: { top: 3.2, right: 3, bottom: 3.2, left: 3 },
                    textColor: [24, 32, 52],
                    lineColor: [220, 228, 242],
                    lineWidth: 0.15
                },
                headStyles: {
                    fillColor: [13, 17, 23],
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
                    1: { cellWidth: 50 },
                    2: { cellWidth: 18 },
                    3: { cellWidth: 18 },
                    4: { cellWidth: 14, halign: 'center' },
                    5: { halign: 'right', cellWidth: 30, fontStyle: 'normal' },
                    6: { halign: 'right', cellWidth: 30, fontStyle: 'bold' }
                },
                // Reserva o espaco do cabecalho (0-30mm) em toda pagina que a tabela tocar,
                // para o didDrawPage poder repintar o cabecalho sem sobrepor linhas da tabela.
                margin: { top: 34 },
                didParseCell: (data) => {
                    // Cor do valor liquido: verde = pago, vermelho = pendente
                    if (data.section !== 'body' || data.column.index !== 6) return;
                    const raw = data.cell.raw;
                    if (raw && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, 'paid')) {
                        data.cell.text = [raw.content || ''];
                        data.cell.styles.textColor = raw.paid ? [0, 140, 100] : [220, 50, 90];
                        data.cell.styles.fontStyle = 'bold';
                    }
                },
                // NOTA: "willDrawPage" nunca dispara nesta versao do jspdf-autotable (3.5.28) —
                // testado e confirmado. Por isso o cabecalho e redesenhado aqui no didDrawPage,
                // que e o unico hook de pagina que de fato roda em toda pagina da tabela.
                didDrawPage: (data) => {
                    const pgNum = doc.internal.getNumberOfPages();
                    drawHeader();
                    drawFooter(pgNum, '?');
                }
            };

            const footRows = [
                [
                    { content: 'TOTAL GERAL', colSpan: 5, styles: { halign: 'right', fontStyle: 'bold', textColor: [37, 99, 235], fillColor: [13, 17, 23], fontSize: 9, cellPadding: { top: 4, right: 6, bottom: 4, left: 3 } } },
                    { content: this.formatMoney(totalBruto), styles: { halign: 'right', fontStyle: 'bold', textColor: [255, 214, 195], fillColor: [13, 17, 23], cellPadding: { top: 4, right: 3, bottom: 4, left: 3 } } },
                    { content: this.formatMoney(totalLiquido), styles: { halign: 'right', fontStyle: 'bold', textColor: [0, 220, 170], fillColor: [13, 17, 23], cellPadding: { top: 4, right: 3, bottom: 4, left: 3 } } }
                ],
                [
                    { content: `Resumo: ${filtered.length} registros  •  ${qtdPago} pagos  •  ${qtdPendente} pendentes  •  Recebido ${this.formatMoney(totalPago)}  •  Pendente ${this.formatMoney(totalPendente)}`, colSpan: 7, styles: { halign: 'center', fontStyle: 'bold', textColor: [220, 235, 255], fillColor: [15, 25, 55], fontSize: 7, cellPadding: { top: 3, right: 3, bottom: 3, left: 3 } } }
                ]
            ];

            if (type === 'all') {
                // Uma tabela por mes: cada mes comeca em pagina propria (addPage antes de cada
                // grupo, exceto o primeiro que segue direto na pagina 1). Se um mes tiver muitos
                // registros, a propria tabela continua paginando normalmente (didDrawPage cuida
                // do cabecalho nessas paginas extras).
                monthGroups.forEach((grp, i) => {
                    if (i > 0) doc.addPage();
                    const isLast = i === monthGroups.length - 1;
                    doc.autoTable({
                        ...commonTableOpts,
                        startY: i === 0 ? 90 : 36,
                        // Cabecalho em duas linhas: 1a) o MES (topo), 2a) as colunas.
                        head: [monthHeadRow(grp.key), commonTableOpts.head[0]],
                        body: [...grp.rows, monthSubtotalRow(grp.key, grp.bruto, grp.liquido)],
                        ...(isLast ? { showFoot: 'lastPage', foot: footRows } : {})
                    });
                });
            } else {
                doc.autoTable({
                    ...commonTableOpts,
                    startY: 90,
                    body: tableBody,
                    showFoot: 'everyPage',
                    foot: footRows
                });
            }

            // ============================================================
            // PAGINA FINAL: RESUMO VISUAL DO PERIODO
            // Gerada SOMENTE no download do periodo completo (type === 'all').
            // Relatorios semanal e mensal NAO recebem esta pagina.
            // Substitui os subtotais discretos por destaques grandes + graficos.
            // ============================================================
            if (type === 'all' && filtered.some(e => !!e.data)) {
                const _mAbbr = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
                const _mLong = ['Janeiro','Fevereiro','Marco','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

                // -- Agregacao por mes a partir dos registros do periodo --
                const _aggMap = new Map();
                filtered.forEach((e) => {
                    if (!e.data) return;
                    const mk = e.data.substring(0, 7);
                    let a = _aggMap.get(mk);
                    if (!a) { a = { key: mk, liquido: 0, bruto: 0, count: 0, dias: new Set() }; _aggMap.set(mk, a); }
                    a.liquido += Number(e.liquido) || 0;
                    a.bruto += Number(e.bruto) || 0;
                    a.count += 1;
                    a.dias.add(e.data);
                });
                const monthsArr = [..._aggMap.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
                monthsArr.forEach((m) => {
                    const [yy, mm] = m.key.split('-');
                    const mi = parseInt(mm, 10) - 1;
                    m.label = _mAbbr[mi] + '/' + yy.slice(2);
                    m.fullLabel = _mLong[mi] + ' ' + yy;
                });

                // Destaques (baseados em DIAS distintos trabalhados, nao no numero de registros)
                const bestMoney = monthsArr.reduce((b, m) => (m.liquido > b.liquido ? m : b), monthsArr[0]);
                const mostWork  = monthsArr.reduce((b, m) => (m.dias.size > b.dias.size ? m : b), monthsArr[0]);
                const leastWork = monthsArr.reduce((b, m) => (m.dias.size < b.dias.size ? m : b), monthsArr[0]);
                const bestMoneyIdx = monthsArr.indexOf(bestMoney);
                const mostWorkIdx  = monthsArr.indexOf(mostWork);
                // Soma de dias distintos de cada mes = total de dias trabalhados no periodo
                const totalDias    = monthsArr.reduce((s, m) => s + m.dias.size, 0);
                const mediaMensal  = totalLiquido / monthsArr.length;
                // Formata "N dia(s)" com plural correto
                const diasLabel = (n) => n + (n === 1 ? ' dia trabalhado' : ' dias trabalhados');

                // Formata valor em centavos de forma compacta (para topo das barras)
                const moneyShort = (cents) => {
                    const v = (cents || 0) / 100;
                    if (Math.abs(v) >= 1000) {
                        const k = Math.round((v / 1000) * 10) / 10;
                        return k.toLocaleString('pt-BR') + 'k';
                    }
                    return String(Math.round(v));
                };

                // -- HELPER: desenha um grafico de barras verticais --
                const drawBarChart = (x, y, w, h, title, data, barColor, valFmt, highlightIdx) => {
                    doc.setFillColor(250, 252, 255);
                    doc.setDrawColor(224, 232, 245);
                    doc.setLineWidth(0.3);
                    doc.roundedRect(x, y, w, h, 3, 3, 'FD');
                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(9);
                    doc.setTextColor(15, 25, 50);
                    doc.text(title, x + 6, y + 9);

                    const padL = 8, padR = 8, padTop = 16, padBottom = 12;
                    const plotX = x + padL, plotW = w - padL - padR;
                    const plotTop = y + padTop, plotBottom = y + h - padBottom, plotH = plotBottom - plotTop;
                    const n = data.length;
                    const maxVal = Math.max(...data.map(d => d.value), 1);

                    // Linhas de grade
                    doc.setDrawColor(232, 238, 248);
                    doc.setLineWidth(0.15);
                    for (let g = 1; g <= 3; g++) {
                        const gy = plotBottom - (plotH * g / 3);
                        doc.line(plotX, gy, plotX + plotW, gy);
                    }
                    // Base
                    doc.setDrawColor(200, 212, 230);
                    doc.setLineWidth(0.3);
                    doc.line(plotX, plotBottom, plotX + plotW, plotBottom);

                    const slot = plotW / n;
                    const barW = Math.min(slot * 0.62, 16);
                    const fs = n > 16 ? 4 : (n > 10 ? 4.6 : 5.4);
                    const labelStep = n > 20 ? 2 : 1;
                    data.forEach((d, i) => {
                        const cx = plotX + slot * i + slot / 2;
                        const bh = maxVal > 0 ? (d.value / maxVal) * plotH : 0;
                        const bx = cx - barW / 2, by = plotBottom - bh;
                        doc.setFillColor(...(i === highlightIdx ? [255, 184, 0] : barColor));
                        doc.roundedRect(bx, by, barW, Math.max(bh, 0.6), 1, 1, 'F');
                        // Valor no topo da barra
                        doc.setFont('helvetica', 'bold');
                        doc.setFontSize(fs);
                        doc.setTextColor(70, 90, 120);
                        doc.text(valFmt(d.value), cx, by - 1.5, { align: 'center' });
                        // Rotulo do mes
                        if (i % labelStep === 0) {
                            doc.setFont('helvetica', 'normal');
                            doc.setTextColor(120, 138, 165);
                            doc.text(d.label, cx, plotBottom + 4.5, { align: 'center' });
                        }
                    });
                };

                // -- Monta a pagina --
                doc.addPage();
                drawWatermark();
                drawHeader();

                // Titulo da secao
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(13);
                doc.setTextColor(15, 25, 50);
                doc.text('RESUMO DO PERIODO', marginL, 40);
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(8);
                doc.setTextColor(100, 120, 150);
                doc.text('Analise visual do periodo completo  •  ' + monthsArr.length + ' ' + (monthsArr.length === 1 ? 'mes' : 'meses'), marginL, 46);

                // -- Cards de destaque --
                const hcY = 52, hcH = 30, hcGap = 4;
                const hcW = (marginR - marginL - 2 * hcGap) / 3;
                const drawHighlight = (x, accent, bg, label, bigText, subText) => {
                    doc.setFillColor(...bg);
                    doc.setDrawColor(...accent.map(v => Math.min(255, v + 50)));
                    doc.setLineWidth(0.3);
                    doc.roundedRect(x, hcY, hcW, hcH, 3, 3, 'FD');
                    doc.setFillColor(...accent);
                    doc.roundedRect(x, hcY, hcW, 3, 1.5, 1.5, 'F');
                    doc.rect(x, hcY + 1.5, hcW, 1.5, 'F');
                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(6);
                    doc.setTextColor(...accent);
                    doc.text(label, x + 4, hcY + 9, { maxWidth: hcW - 8 });
                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(11);
                    doc.setTextColor(15, 25, 50);
                    doc.text(bigText, x + 4, hcY + 18, { maxWidth: hcW - 8 });
                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(8);
                    doc.setTextColor(90, 110, 140);
                    doc.text(subText, x + 4, hcY + 25, { maxWidth: hcW - 8 });
                };
                drawHighlight(marginL, [0, 170, 120], [240, 253, 248],
                    'MES QUE MAIS FATUROU', bestMoney.fullLabel, this.formatMoney(bestMoney.liquido));
                drawHighlight(marginL + hcW + hcGap, [0, 160, 210], [240, 251, 255],
                    'MES QUE MAIS TRABALHOU', mostWork.fullLabel, diasLabel(mostWork.dias.size));
                drawHighlight(marginL + 2 * (hcW + hcGap), [255, 140, 40], [255, 248, 240],
                    'MES QUE MENOS TRABALHOU', leastWork.fullLabel, diasLabel(leastWork.dias.size));

                // -- Grafico 1: faturamento liquido por mes --
                drawBarChart(marginL, 88, marginR - marginL, 80,
                    'FATURAMENTO LIQUIDO POR MES',
                    monthsArr.map(m => ({ label: m.label, value: m.liquido })),
                    [0, 180, 216], moneyShort, bestMoneyIdx);

                // -- Grafico 2: dias trabalhados por mes (dias distintos, nao numero de registros) --
                drawBarChart(marginL, 174, marginR - marginL, 80,
                    'DIAS TRABALHADOS POR MES',
                    monthsArr.map(m => ({ label: m.label, value: m.dias.size })),
                    [112, 90, 230], (v) => String(v), mostWorkIdx);

                // -- Faixa de estatisticas gerais --
                const isY = 260, isH = 18, isGap = 3;
                const isW = (marginR - marginL - 3 * isGap) / 4;
                const statBoxes = [
                    { label: 'TOTAL LIQUIDO',    val: this.formatMoney(totalLiquido),              c: [0, 150, 110] },
                    { label: 'MEDIA POR MES',    val: this.formatMoney(Math.round(mediaMensal)),   c: [0, 160, 210] },
                    { label: 'TOTAL DE DIAS',    val: String(totalDias),                           c: [112, 90, 230] },
                    { label: 'MESES NO PERIODO', val: String(monthsArr.length),                    c: [255, 140, 40] }
                ];
                statBoxes.forEach((s, i) => {
                    const sx = marginL + i * (isW + isGap);
                    doc.setFillColor(248, 250, 253);
                    doc.setDrawColor(224, 232, 245);
                    doc.setLineWidth(0.25);
                    doc.roundedRect(sx, isY, isW, isH, 2.5, 2.5, 'FD');
                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(5.6);
                    doc.setTextColor(...s.c);
                    doc.text(s.label, sx + 3, isY + 6);
                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(9);
                    doc.setTextColor(15, 25, 50);
                    doc.text(s.val, sx + 3, isY + 13, { maxWidth: isW - 5 });
                });

                drawFooter(0, '?');
            }

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
        // VIP GATE - bloqueia recurso para nao-VIP
        // ============================================
        EvolutionApp.prototype.requireVip = function(featureMessage) {
            if (this.isAdmin || this.isVip) return true;
            const msgEl = document.getElementById('vipRequiredMessage');
            if (msgEl) msgEl.textContent = featureMessage || 'Este recurso esta disponivel apenas para usuarios VIP.';
            this.openModal('vipRequiredModal');
            return false;
        };

        // ============================================
        // AVISO ENCERRAMENTO GRATUITO (expira 31/03/2026)
        // ============================================
        EvolutionApp.prototype.showAnnouncementIfNeeded = function() {
            // Data limite: apos 31/03/2026 nao mostra mais nada
            const deadline = new Date('2026-04-01T00:00:00-03:00');
            const now = new Date();
            if (now >= deadline) {
                // Prazo expirou — esconder tudo
                const banner = document.getElementById('announcementBanner');
                if (banner) banner.classList.add('hidden');
                return;
            }

            // Banner sempre visivel ate 31/03
            const banner = document.getElementById('announcementBanner');
            if (banner) banner.classList.remove('hidden');

            // Modal apenas 1 vez por usuario — apos confirmar, nunca mais aparece para ele
            const seenKey = `evo_announcement_confirmed_${this.currentUserId}`;
            if (!safeStorage.getItem(seenKey)) {
                setTimeout(() => this.openModal('announcementModal'), 600);
            }
        };

        EvolutionApp.prototype.confirmAnnouncement = function() {
            safeStorage.setItem(`evo_announcement_confirmed_${this.currentUserId}`, '1');
            this.closeModal('announcementModal');
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
                this.showToast('Não foi possível copiar automaticamente', 'error');
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
            if (!this.isAdmin) { this.showToast('Acesso restrito a administradores.', 'error'); return; }
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
            if (!this.isAdmin) { this.showToast('Acesso restrito a administradores.', 'error'); return; }
            if (!db) { this.showToast('Firebase nao disponivel', 'error'); return; }
            try {
                await db.collection('config').doc('message').delete();
                this.showToast('Aviso removido!', 'success');
            } catch (e) {
                this.showToast('Erro ao remover aviso', 'error');
            }
        };

        EvolutionApp.prototype.saveFloodRate = async function() {
            if (!this.isAdmin) { this.showToast('Acesso restrito a administradores.', 'error'); return; }
            const input = document.getElementById('floodPercentage');
            const value = parseInt(input?.value ?? '40');
            if (isNaN(value) || value < 0 || value > 100) {
                this.showToast('Valor deve ser entre 0 e 100', 'error');
                return;
            }
            if (!db) { this.showToast('Firebase nao disponivel', 'error'); return; }
            try {
                await db.collection('config').doc('settings').set({ floodPercentage: value }, { merge: true });
                this.showToast('Taxa de doação salva!', 'success');
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
            if (window.TurtleBlock) window.TurtleBlock.hide();
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
                }, { merge: true }).catch((e) => { console.warn('[sync] logout lastSeen falhou:', e?.code || e?.message || e); });
            }
            clearTimeout(this.historySyncTimer);

            // Cancelar todas as subscriptions e nullar referencias
            if (this.unsubscribeUsers) { this.unsubscribeUsers(); this.unsubscribeUsers = null; }
            if (this.unsubscribeEntries) { this.unsubscribeEntries(); this.unsubscribeEntries = null; }
            if (this.unsubscribePending) { this.unsubscribePending(); this.unsubscribePending = null; }

            // Remover event listeners globais registrados no init
            if (this._clickOutsideNavioHandler) {
                document.removeEventListener('click', this._clickOutsideNavioHandler);
                this._clickOutsideNavioHandler = null;
            }

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
                } else if (this.pendingAction.type === 'removeVipConfirm') {
                    this.executeRemoveVip(this.pendingAction.id);
                } else if (this.pendingAction.type === 'removeNavio') {
                    this.executeRemoveNavio(this.pendingAction.id);
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
