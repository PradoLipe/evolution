<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <meta name="theme-color" content="#0a0e27">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="Evolution">
    <title>EVOLUTION V5.37 | Felipe Prado Systems</title>
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA1MTIgNTEyIj48cmVjdCB3aWR0aD0iNTEyIiBoZWlnaHQ9IjUxMiIgcng9IjEwMCIgcnk9IjEwMCIgZmlsbD0iIzBhMGUyNyIvPjxwYXRoIGQ9Ik0yNTYgNjAgTDQ1MCAxNjAgTDQ1MCAzNDAgUTI1NiA1MDAgNjIgMzQwIEw2MiAxNjAgWiIgc3Ryb2tlPSIjMDBkNGZmIiBzdHJva2Utd2lkdGg9IjIwIiBmaWxsPSJyZ2JhKDAsIDIxMiwgMjU1LCAwLjEpIi8+PHRleHQgeD0iNTAlIiB5PSI1NSUiIGRvbWluYW50LWJhc2VsaW5lPSJtaWRkbGUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9InVybCgjZykiIGZvbnQtc2l6ZT0iMjgwIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC13ZWlnaHQ9IjgwMCI+RTwvdGV4dD48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImciIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9IjEwMCUiPjxzdG9wIG9mZnNldD0iMCUiIHN0b3AtY29sb3I9IiMwMGQ0ZmYiLz48c3RvcCBvZmZzZXQ9IjEwMCUiIHN0b3AtY29sb3I9IiM3MDAwZmYiLz48L2xpbmVhckdyYWRpZW50PjwvZGVmcz48L3N2Zz4=">
    <link rel="stylesheet" href="styles.css">
    <script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-storage-compat.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.28/jspdf.plugin.autotable.min.js"></script>
</head>
<body>
    <div class="ambient-bg"></div>
    <div class="toast-container" id="toastContainer"></div>
    <div id="goalCelebrationContainer"></div>

    <!-- MODAIS -->
    <div class="modal-overlay" id="iosInstallModal" onclick="app.closeModalOnOverlay(event, 'iosInstallModal')">
        <div class="modal-content">
            <div class="modal-header" style="justify-content: center;">
                <h3 class="modal-title" style="color: var(--primary);">Instalar no iPhone</h3>
            </div>
            <div class="modal-body">
                <p style="margin-bottom: 20px; font-size: 0.9rem; color: var(--text-secondary); line-height: 1.5; text-align: center;">A Apple nao permite instalacao automatica. Siga os passos:</p>
                <div class="ios-steps">
                    <div class="ios-step"><div class="ios-step-icon">1</div><div>Toque no botao Compartilhar na barra inferior do Safari</div></div>
                    <div class="ios-step"><div class="ios-step-icon">2</div><div>Role para baixo e toque em Adicionar a Tela de Inicio</div></div>
                    <div class="ios-step"><div class="ios-step-icon">3</div><div>Toque em Adicionar no canto superior direito</div></div>
                </div>
                <button class="btn btn-glass" onclick="app.closeModal('iosInstallModal')" style="width: 100%;">Entendi</button>
            </div>
        </div>
    </div>

    <div class="modal-overlay" id="confirmActionModal" onclick="app.closeModalOnOverlay(event, 'confirmActionModal')">
        <div class="modal-content" style="text-align: center;">
            <div class="modal-header" style="justify-content: center;"><h3 class="modal-title" id="confirmActionTitle" style="color: var(--danger);">Confirmacao</h3></div>
            <div class="modal-body">
                <div style="font-size: 2.5rem; margin-bottom: 16px;" id="confirmActionIcon">⚠</div>
                <p style="margin-bottom: 20px; font-size: 0.9rem; color: var(--text-secondary);" id="confirmActionText">Tem certeza?</p>
                <div style="display: flex; gap: 10px;">
                    <button class="btn btn-glass" onclick="app.closeModal('confirmActionModal')">Cancelar</button>
                    <button class="btn btn-danger" id="btnConfirmActionExec">Confirmar</button>
                </div>
            </div>
        </div>
    </div>

    <!-- Edit Record Modal -->
    <div class="modal-overlay" id="editModal" onclick="app.closeModalOnOverlay(event, 'editModal')">
        <div class="modal-content" style="max-width: 380px;">
            <div class="modal-header"><h3 class="modal-title">Editar Registro</h3></div>
            <div class="modal-body">
                <div class="input-group">
                    <label class="input-label">Navio</label>
                    <input type="text" id="editNavio" style="text-transform: uppercase;">
                </div>
                <div class="input-row">
                    <div class="input-group"><label class="input-label">Data</label><input type="date" id="editData"></div>
                    <div class="input-group"><label class="input-label">Conf.</label><input type="number" id="editQtdConf" min="1" step="1"></div>
                </div>
                <div class="input-row">
                    <div class="input-group"><label class="input-label">Turno</label><select id="editTurno" onchange="app.adjustEditFields()"><option value="07x15">07x15</option><option value="15x23">15x23</option><option value="23x07">23x07</option></select></div>
                    <div class="input-group"><label class="input-label">Tipo</label><select id="editTipo"><option value="normal">Normal</option><option value="feriado">Feriado</option></select></div>
                </div>
                <div id="editCampos">
                    <div class="input-row">
                        <div class="input-group"><label class="input-label">15h-19h</label><input type="number" id="editP1" placeholder="0"></div>
                        <div class="input-group"><label class="input-label">19h-23h</label><input type="number" id="editP2" placeholder="0"></div>
                    </div>
                </div>
                <div style="display: flex; gap: 10px; margin-top: 16px; justify-content: flex-end;">
                    <button class="btn btn-glass" onclick="app.closeModal('editModal')">Cancelar</button>
                    <button class="btn btn-primary" onclick="app.saveEditedEntry()">Salvar</button>
                </div>
            </div>
        </div>
    </div>

    <!-- Day Summary Modal -->
    <div class="modal-overlay" id="daySummaryModal" onclick="app.closeModalOnOverlay(event, 'daySummaryModal')">
        <div class="modal-content" style="max-width: 400px;">
            <div class="modal-header">
                <h3 class="modal-title" id="daySummaryTitle" style="display:flex;align-items:center;gap:8px;">
                    <span style="font-size:1.1rem;">📅</span> Resumo do Dia
                </h3>
                <button class="modal-close" onclick="app.closeModal('daySummaryModal')">✕</button>
            </div>
            <div class="modal-body" style="padding-top:0;">
                <div id="daySummaryContent"></div>
                <div style="margin-top: 14px;">
                    <button class="btn btn-glass" onclick="app.closeModal('daySummaryModal')" style="height:40px;">Fechar</button>
                </div>
            </div>
        </div>
    </div>

    <div class="modal-overlay" id="confirmModal" onclick="app.closeModalOnOverlay(event, 'confirmModal')">
        <div class="modal-content" style="text-align: center;">
            <div class="modal-header" style="justify-content: center;"><h3 class="modal-title" style="color: var(--danger);">Confirmar Exclusao</h3></div>
            <div class="modal-body">
                <div style="font-size: 2.5rem; margin-bottom: 16px;">🗑</div>
                <p style="margin-bottom: 20px; font-size: 0.9rem; color: var(--text-secondary);">Tem certeza que deseja excluir este registro permanentemente?</p>
                <div style="display: flex; gap: 10px;">
                    <button class="btn btn-glass" onclick="app.closeModal('confirmModal')">Cancelar</button>
                    <button class="btn btn-danger" onclick="app.executeDelete()">Excluir</button>
                </div>
            </div>
        </div>
    </div>

    <!-- DELETE AVATAR CONFIRM MODAL -->
    <div class="modal-overlay" id="deleteAvatarModal" onclick="app.closeModalOnOverlay(event, 'deleteAvatarModal')">
        <div class="modal-content" style="text-align: center;">
            <div class="modal-header" style="justify-content: center;"><h3 class="modal-title" style="color: var(--danger);">Remover Foto</h3></div>
            <div class="modal-body">
                <div style="font-size: 2.5rem; margin-bottom: 16px;">🗑</div>
                <p style="margin-bottom: 20px; font-size: 0.9rem; color: var(--text-secondary);">Tem certeza que deseja remover sua foto de perfil?</p>
                <div style="display: flex; gap: 10px;">
                    <button class="btn btn-glass" onclick="app.closeModal('deleteAvatarModal')">Cancelar</button>
                    <button class="btn btn-danger" onclick="app.executeDeleteAvatar()">Remover</button>
                </div>
            </div>
        </div>
    </div>

    <!-- LOGIN SCREEN -->
    <div class="login-screen" id="loginScreen">
        <div class="login-container">
            <div class="login-hero">
                <div class="sindicato-emblem">
                    <svg class="sindicato-icon" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M50 8 L85 25 L85 60 Q50 92 15 60 L15 25 Z" stroke="url(#grad1)" stroke-width="3" fill="rgba(0, 212, 255, 0.1)"/>
                        <rect x="32" y="30" width="36" height="40" rx="4" stroke="url(#grad1)" stroke-width="2.5" fill="none"/>
                        <line x1="38" y1="40" x2="62" y2="40" stroke="var(--primary)" stroke-width="2.5" stroke-linecap="round"/>
                        <line x1="38" y1="50" x2="62" y2="50" stroke="var(--primary)" stroke-width="2.5" stroke-linecap="round" opacity="0.6"/>
                        <line x1="38" y1="60" x2="52" y2="60" stroke="var(--primary)" stroke-width="2.5" stroke-linecap="round" opacity="0.4"/>
                        <circle cx="68" cy="68" r="10" fill="var(--success)" fill-opacity="0.2" stroke="var(--success)" stroke-width="2"/>
                        <path d="M64 68 L67 71 L72 65" stroke="var(--success)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
                        <defs><linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#00d4ff;stop-opacity:1" /><stop offset="100%" style="stop-color:#7000ff;stop-opacity:1" /></linearGradient></defs>
                    </svg>
                </div>
                <h1 class="login-title">EVOLUTION</h1>
                <p class="login-subtitle">Controle e Registro de Producao</p>
            </div>

            <div class="login-mode-toggle">
                <button class="login-mode-btn active" onclick="app.setLoginMode('login')" id="btnModeLogin">Entrar</button>
                <button class="login-mode-btn" onclick="app.setLoginMode('register')" id="btnModeRegister">Cadastrar</button>
            </div>

            <div class="login-card">
                <div class="login-section active" id="loginSection">
                    <div class="pin-display" id="pinDisplay">
                        <div class="pin-dot"></div><div class="pin-dot"></div><div class="pin-dot"></div>
                        <div class="pin-dot"></div><div class="pin-dot"></div><div class="pin-dot"></div>
                    </div>
                    <div class="keypad">
                        <button class="key-btn" onclick="app.addDigit(1)">1</button>
                        <button class="key-btn" onclick="app.addDigit(2)">2</button>
                        <button class="key-btn" onclick="app.addDigit(3)">3</button>
                        <button class="key-btn" onclick="app.addDigit(4)">4</button>
                        <button class="key-btn" onclick="app.addDigit(5)">5</button>
                        <button class="key-btn" onclick="app.addDigit(6)">6</button>
                        <button class="key-btn" onclick="app.addDigit(7)">7</button>
                        <button class="key-btn" onclick="app.addDigit(8)">8</button>
                        <button class="key-btn" onclick="app.addDigit(9)">9</button>
                        <button class="key-btn delete" onclick="app.removeDigit()">⌫</button>
                        <button class="key-btn" onclick="app.addDigit(0)">0</button>
                        <button class="key-btn action" id="btnLoginAction" onclick="app.login()">→</button>
                    </div>
                </div>

                <div class="register-section" id="registerSection">
                    <div id="registerForm">
                        <div class="input-tip">
                            <span class="input-tip-icon">💡</span>
                            <span class="input-tip-text"><strong>Dica:</strong> O nome que voce cadastrar aqui sera usado para te identificar nos relatorios enviados via WhatsApp.</span>
                        </div>
                        <div class="input-group">
                            <label class="input-label">Nome Completo</label>
                            <input type="text" id="regName" placeholder="Seu nome (sera usado nos relatorios)" style="text-transform: uppercase;">
                            <div class="input-hint">Este nome aparecera nos relatorios que voce gerar</div>
                        </div>
                        <div class="input-group">
                            <label class="input-label">Senha (4 a 6 digitos)</label>
                            <input type="password" id="regCode" placeholder="Crie uma senha numerica" maxlength="6" inputmode="numeric">
                            <div class="input-hint">De 4 a 6 numeros. Esta sera sua senha de acesso.</div>
                        </div>
                        <div class="input-group">
                            <label class="input-label">Confirmar Senha</label>
                            <input type="password" id="regCodeConfirm" placeholder="Repita a senha" maxlength="6" inputmode="numeric">
                        </div>
                        <button class="btn btn-orange" onclick="app.submitRegistration()">Solicitar Cadastro</button>
                    </div>
                    <div id="registerStatus" class="register-status hidden">
                        <div class="register-status-icon">⏳</div>
                        <div class="register-status-title">Cadastro em Analise</div>
                        <div class="register-status-text">Seu pedido foi enviado para aprovacao do administrador.<br>Voce recebera uma notificacao quando for aprovado.</div>
                        <div style="margin-top: 12px;"><span class="pending-badge"><span class="pending-dot"></span>Aguardando Aprovacao</span></div>
                        <button class="btn btn-glass" style="margin-top: 16px;" onclick="app.backToLogin()">Voltar para Login</button>
                    </div>
                </div>
            </div>

            <div class="login-footer"><p>© 2026 Felipe Prado Systems</p></div>
        </div>
    </div>

    <!-- MAIN APP -->
    <div class="app-container hidden" id="mainApp">
        <header class="app-header">
            <div class="user-pill" onclick="app.openModal('profileModal')">
                <div class="avatar" id="userAvatarContainer">
                    <span id="userAvatarInitials">FP</span>
                    <img id="userAvatarImg" src="" class="hidden" alt="Avatar">
                </div>
                <div class="user-info">
                    <h3 id="userName">Usuario <span id="vipBadge" class="vip-badge hidden">VIP</span></h3>
                    <span class="status-text"><span class="status-dot"></span>Online</span>
                </div>
            </div>
            <div class="header-actions">
                <button class="icon-btn admin-btn hidden" id="btnAdmin" onclick="app.openModal('adminModal')">🛡</button>
                <button class="icon-btn" onclick="app.toggleTheme()">◐</button>
                <button class="icon-btn" onclick="app.openModal('configModal')">⚙</button>
            </div>
        </header>

        <main class="app-content">
            <!-- Dashboard Controls -->
            <div class="dashboard-controls fade-in">
                <div class="dashboard-controls-compact">
                    <div class="segmented-control-mini" id="dashboardSegmentedControl" data-state="all">
                        <div class="segment-highlight-mini"></div>
                        <button id="btnFilterAll" class="segment-btn-mini active" onclick="app.setDashboardMode('all')">
                            <span style="font-size: 0.9rem;">∞</span><span>Todos</span>
                        </button>
                        <button id="btnFilterMonth" class="segment-btn-mini" onclick="app.setDashboardMode('month')">
                            <span style="font-size: 0.9rem;">📅</span><span>Mensal</span>
                        </button>
                    </div>
                    <div id="monthSelectorInline" class="month-selector-inline">
                        <span class="month-label">Periodo:</span>
                        <input type="month" id="dashboardMonthInput" class="month-input-compact" onchange="app.updateDashboard()">
                    </div>
                    <div id="periodIndicator" class="period-indicator"></div>
                </div>
            </div>

            <!-- Stats Grid -->
            <div class="dashboard-grid fade-in">
                <div class="stat-card bruto" id="cardBruto">
                    <div class="stat-label">Total Bruto</div>
                    <div class="stat-value" id="dashBruto">R$ 0,00</div>
                    <div class="stat-meta">Acumulado</div>
                </div>
                <div class="stat-card liquido" id="cardLiquido">
                    <div class="stat-label">Total Liquido</div>
                    <div class="stat-value" id="dashLiq">R$ 0,00</div>
                    <div class="stat-meta">Recebimento</div>
                </div>
                <div class="stat-card pendente" onclick="app.setFilter('pending')">
                    <div class="stat-label">Pendente</div>
                    <div class="stat-value" id="dashPend" style="color: var(--danger);">R$ 0,00</div>
                    <div class="stat-meta" id="countPend">0 servicos</div>
                </div>
                <div class="stat-card pago" onclick="app.setFilter('paid')">
                    <div class="stat-label">Recebido</div>
                    <div class="stat-value" id="dashPago" style="color: var(--success);">R$ 0,00</div>
                    <div class="stat-meta" id="countPago">0 servicos</div>
                </div>
            </div>

            <!-- Meta Card -->
            <div class="meta-card fade-in" id="metaCard" style="display: none;">
                <div class="meta-header">
                    <div class="meta-title">Meta de Recebimento</div>
                    <div class="meta-value" id="metaValor">R$ 0,00</div>
                </div>
                <div class="progress-container">
                    <div class="progress-bar" id="metaProgress" style="width: 0%"></div>
                </div>
                <div class="progress-text">
                    <span id="metaAtual">R$ 0,00 acumulado</span>
                    <span id="metaPercent">0%</span>
                </div>
            </div>

            <!-- Calendar -->
            <div class="section fade-in" id="secCal">
                <div class="section-header" onclick="app.toggleSection('secCal')">
                    <div class="section-title-group">
                        <div class="section-icon">📅</div>
                        <div class="section-titles"><h3>Calendario</h3><p>Resumo mensal de operacoes</p></div>
                    </div>
                    <div class="section-arrow">▼</div>
                </div>
                <div class="section-content">
                    <div class="section-inner">
                        <div class="calendar-toolbar">
                            <label for="calendarMonth" style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700;">Mes</label>
                            <input type="month" id="calendarMonth" class="calendar-month-input" onchange="app.handleCalendarMonthChange()">
                        </div>
                        <div class="calendar-summary" id="calendarSummary">
                            <div class="calendar-summary-card total"><div class="calendar-summary-label">Servicos</div><div class="calendar-summary-value" id="calendarTotalServicos">0</div></div>
                            <div class="calendar-summary-card paid"><div class="calendar-summary-label">Pagos</div><div class="calendar-summary-value" id="calendarTotalPagos">0</div></div>
                            <div class="calendar-summary-card pending"><div class="calendar-summary-label">Pendentes</div><div class="calendar-summary-value" id="calendarTotalPendentes">0</div></div>
                        </div>
                        <div id="calendarGrid" class="calendar-grid"></div>
                    </div>
                </div>
            </div>

            <!-- Performance Chart -->
            <div class="section fade-in" id="secChart">
                <div class="section-header" onclick="app.toggleSection('secChart')">
                    <div class="section-title-group">
                        <div class="section-icon">🚀</div>
                        <div class="section-titles"><h3>Performance</h3><p>Grafico Semanal</p></div>
                    </div>
                    <div class="section-arrow">▼</div>
                </div>
                <div class="section-content">
                    <div class="section-inner">
                        <div class="chart-stats-overlay">
                            <div class="chart-stat-item">
                                <div class="chart-stat-label">Atual</div>
                                <div class="chart-stat-value" id="chartTotalCurr" style="color: var(--primary);">R$ 0,00</div>
                            </div>
                            <div class="chart-growth" id="chartGrowth">0%</div>
                            <div class="chart-stat-item" style="text-align: right;">
                                <div class="chart-stat-label">Anterior</div>
                                <div class="chart-stat-value" id="chartTotalPrev" style="color: var(--text-secondary);">R$ 0,00</div>
                            </div>
                        </div>
                        <svg class="chart-svg" id="evolutionChart" viewBox="0 0 300 160" preserveAspectRatio="none">
                            <defs><linearGradient id="gradChart" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:#00d4ff;stop-opacity:0.4" /><stop offset="100%" style="stop-color:#00d4ff;stop-opacity:0" /></linearGradient></defs>
                        </svg>
                    </div>
                </div>
            </div>

            <!-- Simulator -->
            <div class="section fade-in" id="secSim">
                <div class="section-header" onclick="app.toggleSection('secSim')">
                    <div class="section-title-group">
                        <div class="section-icon">🧮</div>
                        <div class="section-titles"><h3>Simulador Rapido</h3><p>Calcule sem salvar</p></div>
                    </div>
                    <div class="section-arrow">▼</div>
                </div>
                <div class="section-content">
                    <div class="section-inner">
                        <div class="input-row-3">
                            <div class="input-group">
                                <label class="input-label">Turno</label>
                                <select id="simTurno" onchange="app.updateSimFields()">
                                    <option value="07x15">07x15</option>
                                    <option value="15x23" selected>15x23</option>
                                    <option value="23x07">23x07</option>
                                </select>
                            </div>
                            <div class="input-group">
                                <label class="input-label">Tipo</label>
                                <select id="simTipo" onchange="app.calcularSimulacao()">
                                    <option value="normal">Normal</option>
                                    <option value="feriado">Feriado</option>
                                </select>
                            </div>
                            <div class="input-group">
                                <label class="input-label">Conf.</label>
                                <input type="number" id="simConf" value="3" min="1" step="1" oninput="app.calcularSimulacao()" inputmode="numeric">
                            </div>
                        </div>
                        <div id="simCampos">
                            <div class="input-row">
                                <div class="input-group"><label class="input-label">15h-19h</label><input type="number" id="simP1" placeholder="0" oninput="app.calcularSimulacao()" inputmode="numeric"></div>
                                <div class="input-group"><label class="input-label">19h-23h</label><input type="number" id="simP2" placeholder="0" oninput="app.calcularSimulacao()" inputmode="numeric"></div>
                            </div>
                        </div>
                        <div class="sim-result">
                            <div class="sim-result-label">Projecao por Conferente</div>
                            <div class="sim-result-value" id="simResult">R$ 0,00</div>
                            <div class="sim-result-detail" id="simDetalhe">Bruto: R$ 0,00 | Liquido: R$ 0,00</div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- New Entry -->
            <div class="section fade-in" id="secNew">
                <div class="section-header" onclick="app.toggleSection('secNew'); app.suggestDefaultTurno()">
                    <div class="section-title-group">
                        <div class="section-icon">➕</div>
                        <div class="section-titles"><h3>Registrar Producao</h3><p>Adicionar ao historico</p></div>
                    </div>
                    <div class="section-arrow">▼</div>
                </div>
                <div class="section-content">
                    <div class="section-inner">
                        <div class="input-group navio-suggestions">
                            <label class="input-label">Navio</label>
                            <div class="navio-input-wrapper">
                                <input type="text" id="calcNavio" style="text-transform: uppercase;" placeholder="Nome do navio" autocomplete="off" autocorrect="off" spellcheck="false" oncontextmenu="return false" oninput="app._onNavioInput(this,'calcNavio')" onfocus="app.showNavioSuggestions('calcNavio')">
                                <button class="navio-clear-btn" id="calcNavioClear" onclick="app.clearNavioInput('calcNavio')" tabindex="-1">✕</button>
                            </div>
                            <!-- Caixa de sugestoes dinamica para o campo calcNavio -->
                            <div class="navio-suggestions-list" id="calcNavioSuggestions" style="display: none;"></div>
                        </div>
                        <div class="input-row">
                            <div class="input-group"><label class="input-label">Data</label><input type="date" id="calcData"></div>
                            <div class="input-group"><label class="input-label">Conf.</label><input type="number" id="calcQtdConf" value="3" min="1" step="1" inputmode="numeric"></div>
                        </div>
                        <div class="input-row">
                            <div class="input-group"><label class="input-label">Turno</label><select id="calcTurno" onchange="app.adjustCalcFields()"><option value="07x15">07x15</option><option value="15x23" selected>15x23</option><option value="23x07">23x07</option></select></div>
                            <div class="input-group"><label class="input-label">Tipo</label><select id="calcTipoDia"><option value="normal">Normal</option><option value="feriado">Feriado</option></select></div>
                        </div>
                        <div id="calcCampos">
                            <div class="input-row">
                                <div class="input-group"><label class="input-label">15h-19h</label><input type="number" id="calcP1" placeholder="0" inputmode="numeric"></div>
                                <div class="input-group"><label class="input-label">19h-23h</label><input type="number" id="calcP2" placeholder="0" inputmode="numeric"></div>
                            </div>
                        </div>
                        <button class="btn btn-success" id="btnSaveEntry" onclick="app.saveEntry()" style="margin-top: 4px;">Salvar Registro</button>
                    </div>
                </div>
            </div>

            <!-- Report -->
            <div class="section fade-in" id="secRel">
                <div class="section-header" onclick="app.toggleSection('secRel')">
                    <div class="section-title-group">
                        <div class="section-icon">📋</div>
                        <div class="section-titles"><h3>Gerar Relatorio</h3><p>Formato para envio</p></div>
                    </div>
                    <div class="section-arrow">▼</div>
                </div>
                <div class="section-content">
                    <div class="section-inner">
                        <div class="input-group navio-suggestions"><label class="input-label">Navio</label><div class="navio-input-wrapper"><input type="text" id="relNavio" style="text-transform: uppercase;" placeholder="Nome do navio" autocomplete="off" autocorrect="off" spellcheck="false" oncontextmenu="return false" oninput="app._onNavioInput(this,'relNavio')" onfocus="app.showNavioSuggestions('relNavio')"><button class="navio-clear-btn" id="relNavioClear" onclick="app.clearNavioInput('relNavio')" tabindex="-1">✕</button></div><!-- Caixa de sugestoes dinamica para o campo relNavio --><div class="navio-suggestions-list" id="relNavioSuggestions" style="display: none;"></div></div>
                        <div class="input-group"><label class="input-label">Data</label><input type="date" id="relData"></div>
                        <div class="input-row-3">
                            <div class="input-group"><label class="input-label">Turno</label><select id="relTurno" onchange="app.toggleRelatorioCampos()"><option value="07x15">07x15</option><option value="15x23" selected>15x23</option><option value="23x07">23x07</option></select></div>
                            <div class="input-group" style="grid-column: span 2;"><label class="input-label">Terno</label><select id="relTernoSelecao"><option value="1°">1 Terno</option><option value="2°">2 Terno</option><option value="3°">3 Terno</option><option value="4°">4 Terno</option></select></div>
                        </div>
                        <div id="relCamposProducao">
                            <div class="input-row">
                                <div class="input-group"><label class="input-label">15h-19h</label><input type="number" id="relP1" placeholder="0" inputmode="numeric"></div>
                                <div class="input-group"><label class="input-label">19h-23h</label><input type="number" id="relP2" placeholder="0" inputmode="numeric"></div>
                            </div>
                        </div>
                        <button class="btn btn-primary" onclick="app.generateReport()">Copiar Relatorio</button>
                    </div>
                </div>
            </div>

            <!-- History -->
            <div class="section fade-in" id="secHist">
                <div class="section-header" onclick="app.toggleSection('secHist')">
                    <div class="section-title-group">
                        <div class="section-icon">📊</div>
                        <div class="section-titles"><h3>Historico</h3><p id="histSubtitle">Aguardando pagamento</p></div>
                    </div>
                    <div class="section-arrow">▼</div>
                </div>
                <div class="section-content">
                    <div class="section-inner">
                        <div class="filter-tabs">
                            <button class="filter-tab" onclick="app.setFilter('all')" id="filter-all">Todos</button>
                            <button class="filter-tab active" onclick="app.setFilter('pending')" id="filter-pending">Pendentes</button>
                            <button class="filter-tab" onclick="app.setFilter('paid')" id="filter-paid">Recebidos</button>
                        </div>
                        <div class="history-list" id="histList">
                            <div class="empty-state">
                                <div class="empty-state-icon">📭</div>
                                <div style="font-size: 0.85rem; font-weight: 600; color: var(--text);">Nenhum registro</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>


        </main>

        <footer class="app-footer">
            <div class="footer-brand">EVOLUTION V5.37</div>
            <div class="footer-divider"></div>
            <div class="footer-copy">
                <div style="font-weight: 700; color: var(--text); margin-bottom: 2px;">Felipe Prado Systems</div>
                <div>Todos os direitos reservados © 2026</div>
            </div>
        </footer>
    </div>

    <!-- PROFILE MODAL -->
    <div class="modal-overlay" id="profileModal" onclick="app.closeModalOnOverlay(event, 'profileModal')">
        <div class="modal-content">
            <div class="modal-header"><h3 class="modal-title">Perfil</h3><button class="modal-close" onclick="app.closeModal('profileModal')">✕</button></div>
            <div class="modal-body" style="text-align: center;">
                <div class="avatar-wrapper" style="position: relative; width: 100px; height: 100px; margin: 0 auto 20px;">
                    <div class="avatar" id="profileAvatarModal" style="width: 100%; height: 100%; font-size: 2rem;">
                        <span id="profileAvatarInitials">FP</span>
                        <img id="profileAvatarImg" src="" class="hidden" style="width: 100%; height: 100%; object-fit: cover;">
                    </div>
                    <div class="avatar-controls">
                        <button class="btn-icon-round edit" onclick="app.uploadAvatar()" data-tooltip="Alterar foto">✏</button>
                        <button class="btn-icon-round delete hidden" id="btnDeleteAvatar" onclick="app.deleteAvatar()" data-tooltip="Remover foto">🗑</button>
                    </div>
                </div>
                <input type="file" id="avatarInput" accept="image/*" style="display: none;" onchange="app.handleAvatarChange(event)">
                <h3 id="profileName" style="font-size: 1.2rem; margin-bottom: 10px;">Nome do Usuario</h3>
                <div id="profileVipInfo" class="hidden" style="margin-bottom: 20px; font-size: 0.8rem; color: var(--accent); border: 1px solid var(--accent); padding: 8px; border-radius: 8px; display: inline-block;"></div>
                <div style="margin-top: 10px;"><button class="btn btn-danger" onclick="app.logout()">Sair da Conta</button></div>
            </div>
        </div>
    </div>

    <!-- PDF OPTIONS MODAL -->
    <div class="modal-overlay" id="pdfOptionsModal" onclick="app.closeModalOnOverlay(event, 'pdfOptionsModal')">
        <div class="modal-content">
            <div class="modal-header"><h3 class="modal-title">Baixar PDF</h3><button class="modal-close" onclick="app.closeModal('pdfOptionsModal')">✕</button></div>
            <div class="modal-body">
                <p style="text-align: center; color: var(--text-secondary); margin-bottom: 20px; font-size: 0.9rem;">Selecione o periodo para gerar o relatorio profissional em PDF.</p>
                <div style="display: grid; grid-template-columns: 1fr; gap: 12px;">
                    <button class="btn btn-primary" onclick="app.generatePdf('weekly')">📅 Relatorio Semanal (7 dias)</button>
                    <div style="border-top: 1px solid var(--border); margin: 8px 0;"></div>
                    <div class="input-group">
                        <label class="input-label" style="text-align: center;">Ou selecione um mes especifico</label>
                        <div style="display: flex; gap: 8px;">
                            <input type="month" id="pdfMonthPicker" class="input-modern" style="background: var(--surface-elevated); color: var(--text); border-color: var(--primary);">
                            <button class="btn btn-glass" onclick="app.generatePdf('monthly')">Baixar</button>
                        </div>
                    </div>
                    <div style="border-top: 1px solid var(--border); margin: 8px 0;"></div>
                    <button class="btn btn-glass" onclick="app.generatePdf('all')" style="border-color: var(--accent); color: var(--accent);">📋 Todos os Registros (Historico Completo)</button>
                </div>
            </div>
        </div>
    </div>

    <!-- ADMIN MODAL -->
    <div class="modal-overlay" id="adminModal" onclick="app.closeModalOnOverlay(event, 'adminModal')">
        <div class="modal-content">
            <div class="modal-header"><h3 class="modal-title" style="color: var(--accent);">Painel Admin</h3><button class="modal-close" onclick="app.closeModal('adminModal')">✕</button></div>
            <div class="modal-body">
                <div style="display: flex; justify-content: flex-end; margin-bottom: 10px;">
                    <button class="btn-tiny btn-glass" onclick="app.refreshAdminLists()" style="display: flex; align-items: center; gap: 4px;">🔄 Atualizar Listas</button>
                </div>

                <div class="pending-section" id="pendingSection">
                    <div class="pending-title"><span>⏳</span>Cadastros Pendentes</div>
                    <div class="pending-list" id="pendingList"><div style="text-align: center; color: var(--text-muted); font-size: 0.8rem; padding: 20px;">Carregando...</div></div>
                </div>

                <div class="admin-section">
                    <button class="admin-toggle-btn" onclick="app.toggleAdminSection('admUsers')"><span>👥 Usuarios Aprovados</span><span>▼</span></button>
                    <div id="admUsers" class="admin-toggle-content">
                        <div class="input-group" style="margin-bottom: 12px;">
                            <label class="input-label">Adicionar Novo Usuario</label>
                            <div class="admin-grid-fix" style="margin-bottom: 8px;">
                                <input type="text" id="newUserName" placeholder="Nome" style="text-transform: uppercase;">
                                <input type="text" id="newUserCode" placeholder="Senha (PIN)" maxlength="6" inputmode="numeric">
                            </div>
                            <button class="btn btn-primary" onclick="app.addNewUser()">➕ Adicionar</button>
                        </div>
                        <div class="input-group">
                            <label class="input-label">Lista de Usuarios</label>
                            <div class="user-list" id="userList"><div></div></div>
                        </div>
                    </div>
                </div>

                <div class="admin-section">
                    <button class="admin-toggle-btn" onclick="app.toggleAdminSection('admRates')"><span>💲 Editar Taxas</span><span>▼</span></button>
                    <div id="admRates" class="admin-toggle-content">
                        <div class="rates-grid">
                            <div class="rate-turno-section">
                                <div class="rate-turno-title">🌅 07x15 (Manha)</div>
                                <div class="rate-type-row">
                                    <div><div class="rate-type-label"><span class="dot normal"></span> Dia Normal</div><input type="number" id="rate_07x15_normal" step="0.01" placeholder="0,00" inputmode="decimal"></div>
                                    <div><div class="rate-type-label"><span class="dot feriado"></span> Feriado</div><input type="number" id="rate_07x15_feriado" step="0.01" placeholder="0,00" inputmode="decimal"></div>
                                </div>
                            </div>
                            <div class="rate-turno-section">
                                <div class="rate-turno-title">🌇 15x23 (Tarde/Noite)</div>
                                <div class="rate-subtitle">Periodo 15h-19h</div>
                                <div class="rate-type-row">
                                    <div><div class="rate-type-label"><span class="dot normal"></span> Dia Normal</div><input type="number" id="rate_15x23_p1_normal" step="0.01" placeholder="0,00" inputmode="decimal"></div>
                                    <div><div class="rate-type-label"><span class="dot feriado"></span> Feriado</div><input type="number" id="rate_15x23_p1_feriado" step="0.01" placeholder="0,00" inputmode="decimal"></div>
                                </div>
                                <div class="rate-subtitle" style="margin-top: 12px;">Periodo 19h-23h</div>
                                <div class="rate-type-row">
                                    <div><div class="rate-type-label"><span class="dot normal"></span> Dia Normal</div><input type="number" id="rate_15x23_p2_normal" step="0.01" placeholder="0,00" inputmode="decimal"></div>
                                    <div><div class="rate-type-label"><span class="dot feriado"></span> Feriado</div><input type="number" id="rate_15x23_p2_feriado" step="0.01" placeholder="0,00" inputmode="decimal"></div>
                                </div>
                            </div>
                            <div class="rate-turno-section">
                                <div class="rate-turno-title">🌙 23x07 (Madrugada)</div>
                                <div class="rate-type-row">
                                    <div><div class="rate-type-label"><span class="dot normal"></span> Dia Normal</div><input type="number" id="rate_23x07_normal" step="0.01" placeholder="0,00" inputmode="decimal"></div>
                                    <div><div class="rate-type-label"><span class="dot feriado"></span> Feriado</div><input type="number" id="rate_23x07_feriado" step="0.01" placeholder="0,00" inputmode="decimal"></div>
                                </div>
                            </div>
                        </div>
                        <button class="btn btn-success" onclick="app.saveRates()" style="margin-top: 16px;">Salvar Taxas</button>
                    </div>
                </div>

                <div class="admin-section">
                    <button class="admin-toggle-btn" onclick="app.toggleAdminSection('admMessages')"><span>📢 Mensagens do Sistema</span><span>▼</span></button>
                    <div id="admMessages" class="admin-toggle-content">
                        <div class="input-group"><label class="input-label">Texto do Aviso</label><textarea id="msgContent" rows="3" style="width: 100%; padding: 10px; background: var(--glass); border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text); resize: none;"></textarea></div>
                        <div class="input-group"><label class="input-label">Tipo de Exibicao</label><select id="msgType" onchange="app.toggleMsgDates()"><option value="once">Uma vez (Ao logar)</option><option value="always">Sempre (Todo login)</option><option value="period">Por Periodo</option></select></div>
                        <div id="msgDates" class="input-row" style="display: none;"><input type="date" id="msgStart"><input type="date" id="msgEnd"></div>
                        <button class="btn btn-primary" style="margin-bottom: 8px;" onclick="app.publishMessage()">Publicar Aviso</button>
                        <button class="btn btn-danger" onclick="app.deleteMessage()">Remover Aviso Atual</button>
                    </div>
                </div>

                <div class="admin-section">
                    <button class="admin-toggle-btn" onclick="app.toggleAdminSection('admFlood')"><span>💸 Taxa de Doacao (Flood)</span><span>▼</span></button>
                    <div id="admFlood" class="admin-toggle-content">
                        <div class="input-group"><label class="input-label">Probabilidade de exibir mensagem (%)</label><input type="number" id="floodPercentage" min="0" max="100" value="40" placeholder="40"><div class="input-hint">Valor de 0 a 100. Define a % de chance de exibir a mensagem pedindo doacao.</div></div>
                        <button class="btn btn-success" onclick="app.saveFloodRate()">Salvar Taxa</button>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- USER MANAGEMENT MODAL -->
    <div class="modal-overlay" id="userManagementModal" onclick="app.closeModalOnOverlay(event, 'userManagementModal')">
        <div class="modal-content">
            <div class="modal-header"><h3 class="modal-title">Gerenciar Usuario</h3><button class="modal-close" onclick="app.closeModal('userManagementModal')">✕</button></div>
            <div class="modal-body">
                <h4 id="manageUserName" style="text-align: center; margin-bottom: 8px; color: var(--text);">Nome</h4>
                <div style="text-align: center; font-family: 'JetBrains Mono'; color: var(--text-secondary); margin-bottom: 8px;">PIN: <span id="manageUserPin">000000</span></div>
                <div id="manageUserLastLogin" style="text-align: center; margin-bottom: 20px; font-size: 0.7rem; color: var(--text-muted); display: flex; align-items: center; justify-content: center; gap: 5px;">
                    <span>🕐</span><span id="manageUserLastLoginText">Ultimo acesso: sem registro</span>
                </div>
                <div class="input-group">
                    <label class="input-label">Conceder VIP</label>
                    <div class="input-row">
                        <select id="vipTypeSelect"><option value="gift">🎁 Brinde (Adm)</option><option value="paid">💰 Pago</option></select>
                        <select id="vipDurationSelect"><option value="15d">15 Dias</option><option value="1">1 Mes</option><option value="3">3 Meses</option><option value="6">6 Meses</option><option value="perm">👑 Permanente</option></select>
                    </div>
                    <button class="btn btn-primary" onclick="app.applyVip()" style="margin-top: 8px;">Aplicar VIP</button>
                </div>
                <hr style="border: 0; border-top: 1px solid var(--border); margin: 16px 0;">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                    <button class="btn btn-glass" id="btnBlockUser" onclick="app.toggleBlockFromModal()">Bloquear</button>
                    <button class="btn btn-glass" onclick="app.resetDeviceFromModal()">Reset Device</button>
                </div>
                <button class="btn btn-danger" onclick="app.openConfirmModal('deleteUser', 'Excluir usuario permanentemente?', app.managingUser)" style="margin-top: 10px; background: rgba(255, 56, 96, 0.2);">🗑 Excluir Usuario</button>
            </div>
        </div>
    </div>

    <!-- VIP NOTIFICATION MODAL -->
    <div class="modal-overlay" id="vipNotificationModal">
        <div class="modal-content" style="text-align: center; border: 2px solid var(--success); box-shadow: 0 0 30px rgba(0, 217, 166, 0.2);">
            <div class="modal-header" style="justify-content: center; border-bottom-color: rgba(0, 217, 166, 0.3);"><h3 class="modal-title" style="color: var(--success); letter-spacing: 2px;">Parabens! 🌟</h3></div>
            <div class="modal-body">
                <div style="font-size: 3.5rem; margin-bottom: 16px;">🚀</div>
                <p style="margin-bottom: 12px; font-size: 0.95rem; color: var(--text); line-height: 1.6;">Seu acesso VIP foi ativado com sucesso!</p>
                <div style="background: rgba(0, 217, 166, 0.1); padding: 12px; border-radius: 12px; margin-bottom: 20px; border: 1px solid rgba(0, 217, 166, 0.3);">
                    <h2 id="vipNotifType" style="color: var(--success); font-size: 1.2rem; margin-bottom: 4px;">VIP ATIVO</h2>
                    <span id="vipNotifDate" style="font-size: 0.8rem; color: var(--text-secondary); font-weight: 700;">Vencimento: --------</span>
                </div>
                <div id="vipGiftMessageContainer" class="hidden" style="margin-bottom: 15px; font-style: italic; color: var(--text-secondary); font-size: 0.85rem;"></div>
                <button id="btnVipAction" class="btn btn-success" onclick="app.closeModal('vipNotificationModal')">Aproveitar Agora</button>
            </div>
        </div>
    </div>

    <!-- MESSAGE MODAL -->
    <div class="modal-overlay" id="messageModal">
        <div class="modal-content" style="text-align: center;">
            <div class="modal-header" style="justify-content: center;"><h3 class="modal-title" style="color: var(--primary);">Aviso do Sistema</h3></div>
            <div class="modal-body">
                <div style="font-size: 2.5rem; margin-bottom: 16px;">📢</div>
                <p id="sysMsgContent" style="margin-bottom: 20px; font-size: 0.9rem; color: var(--text); white-space: pre-wrap;"></p>
                <button class="btn btn-glass" onclick="app.closeModal('messageModal')">Entendi</button>
            </div>
        </div>
    </div>

    <!-- CONFIG MODAL -->
    <div class="modal-overlay" id="configModal" onclick="app.closeModalOnOverlay(event, 'configModal')">
        <div class="modal-content">
            <div class="modal-header"><h3 class="modal-title">Configuracoes</h3><button class="modal-close" onclick="app.closeModal('configModal')">✕</button></div>
            <div class="modal-body">
                <div class="meta-editor" id="metaEditor" style="display: none;">
                    <label>Meta de Recebimento (Liquido)</label>
                    <div class="meta-input-formatted">
                        <input type="text" id="metaInput" placeholder="5.000,00" oninput="app.formatMetaInput(this)" inputmode="decimal">
                        <span class="meta-currency">R$</span>
                    </div>
                    <div style="font-size: 0.65rem; color: var(--text-muted); margin-top: 8px;">A meta comeca a contabilizar a partir do momento em que for salva.</div>
                    <button class="btn btn-primary" onclick="app.saveMeta()" style="margin-top: 12px;">Salvar Meta</button>
                    <div id="cancelMetaContainer"></div>
                </div>
                <div class="config-buttons-grid">
                    <button class="btn btn-glass" onclick="app.exportData()">↓ Exportar</button>
                    <button class="btn btn-glass" onclick="app.triggerImport()">↑ Importar</button>
                    <button class="btn btn-glass" onclick="app.toggleMetaEditor()">🎯 Meta</button>
                    <button class="btn btn-glass" onclick="app.openPdfOptions()">📄 Baixar PDF</button>
                </div>
                <button id="btnAddHome" class="btn btn-glass" onclick="app.addToHomeScreen()" style="width: 100%; margin-top: 10px; border-color: var(--primary);">📲 ADICIONAR A TELA INICIAL</button>
                <button class="btn" onclick="app.showPix()" style="width: 100%; background: var(--gradient-gold); color: #0a0e27; margin-top: 10px; box-shadow: 0 4px 15px rgba(255, 215, 0, 0.3); font-weight: 800;">💎 APOIAR O PROJETO</button>
                <button class="btn btn-danger" onclick="app.logout()" style="margin-top: 20px;">Sair do Sistema</button>
            </div>
            <input type="file" id="importInput" style="display: none;" accept=".json">
        </div>
    </div>

    <!-- PIX MODAL -->
    <div class="modal-overlay" id="pixModal" onclick="app.closeModalOnOverlay(event, 'pixModal')">
        <div class="modal-content" style="text-align: center; padding-bottom: 40px;">
            <div class="modal-header" style="justify-content: center;"><h3 class="modal-title" style="color: var(--accent);">Fortaleca o Evolution</h3></div>
            <div class="modal-body">
                <div style="font-size: 2.5rem; margin: 10px 0 20px;">🚀</div>
                <p style="color: var(--text); font-weight: 600; font-size: 0.95rem; margin-bottom: 12px;" id="pixMessageTitle">Ajude a manter o sistema</p>
                <p style="color: var(--text-secondary); font-size: 0.85rem; line-height: 1.5; margin-bottom: 24px;" id="pixMessage"></p>
                <div onclick="app.copyPix()" style="background: var(--surface); border: 2px solid var(--primary); border-radius: 12px; padding: 20px; cursor: pointer; transition: all 0.3s; position: relative; overflow: hidden;">
                    <div style="font-family: 'JetBrains Mono', monospace; font-size: 1.3rem; font-weight: 700; color: var(--text); letter-spacing: 2px;">92994821868</div>
                    <div style="font-size: 0.7rem; color: var(--primary); margin-top: 6px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px;">Chave PIX - Felipe Prado</div>
                </div>
                <p style="font-size: 0.65rem; color: var(--text-muted); margin-top: 12px; text-transform: uppercase; letter-spacing: 1px;">Toque na chave para copiar</p>
                <p style="font-size: 0.6rem; color: var(--text-muted); margin-top: 16px; font-style: italic;">Realize uma contribuicao para remover estes avisos automaticos e manter o app atualizado.</p>
                <button class="btn btn-glass" onclick="app.closeModal('pixModal')" style="margin-top: 20px;">Agora nao</button>
            </div>
        </div>
    </div>

    <script src="js/config.js"></script>
    <script src="js/main.js"></script>
    <script src="js/auth.js"></script>
    <script src="js/firebase-sync.js"></script>
    <script src="js/ui.js"></script>
    <script src="js/entries.js"></script>
    <script src="js/admin.js"></script>
    <script src="js/utils.js"></script>
    <script src="js/init.js"></script>
</body>
</html>

        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
        :root {
            --primary: #00d4ff; --primary-glow: rgba(0, 212, 255, 0.4); --secondary: #7000ff; --accent: #ffd700;
            --danger: #ff3860; --success: #00d9a6; --warning: #ffb800; --info: #00b4d8; --bg: #0a0e27;
            --surface: rgba(255, 255, 255, 0.03); --surface-elevated: rgba(255, 255, 255, 0.06);
            --glass: rgba(20, 25, 50, 0.7); --border: rgba(255, 255, 255, 0.08); --text: #f0f2ff;
            --text-secondary: #8b92b4; --text-muted: #4a5070;
            --gradient-primary: linear-gradient(135deg, #00d4ff 0%, #7000ff 100%);
            --gradient-success: linear-gradient(135deg, #00d9a6 0%, #00b4d8 100%);
            --gradient-gold: linear-gradient(135deg, #ffd700 0%, #ffb800 100%);
            --gradient-orange: linear-gradient(135deg, #ff8c00 0%, #ff3860 100%);
            --radius: 16px; --radius-sm: 12px;
        }
        body.light-mode {
            --bg: #f5f7fa; --surface: rgba(255, 255, 255, 0.7); --surface-elevated: rgba(255, 255, 255, 0.9);
            --glass: rgba(255, 255, 255, 0.8); --border: rgba(0, 0, 0, 0.08); --text: #0f172a;
            --text-secondary: #64748b; --text-muted: #94a3b8;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        html { scroll-behavior: smooth; touch-action: manipulation; }
        body { font-family: 'Sora', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; overflow-x: hidden; transition: background 0.5s ease, color 0.3s ease; position: relative; }
        .pagination-controls { display: flex; justify-content: center; align-items: center; gap: 12px; margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border); }
        .page-btn { background: var(--surface); border: 1px solid var(--border); color: var(--text); width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s; font-weight: 700; }
        .page-btn:active { background: var(--primary); color: #fff; transform: scale(0.9); }
        .page-btn:disabled { opacity: 0.3; cursor: not-allowed; pointer-events: none; }
        .page-info { font-size: 0.75rem; color: var(--text-secondary); font-weight: 600; font-family: 'JetBrains Mono', monospace; }
        .money-particle { position: fixed; font-size: 24px; pointer-events: none; z-index: 9999; animation: flyAndFade 1s ease-out forwards; }
        @keyframes flyAndFade { 0% { transform: translate(0, 0) scale(0.5); opacity: 0; } 10% { opacity: 1; transform: translate(0, 0) scale(1); } 100% { transform: translate(var(--tx), var(--ty)) scale(1.2) rotate(var(--rot)); opacity: 0; } }
        .payment-float-value { position: fixed; font-family: 'JetBrains Mono', monospace; font-weight: 800; color: var(--success); font-size: 2rem; pointer-events: none; z-index: 10000; text-shadow: 0 2px 20px rgba(0, 217, 166, 0.5); animation: floatUpFade 1.5s ease-out forwards; background: rgba(0,0,0,0.5); padding: 8px 16px; border-radius: 12px; border: 1px solid var(--success); backdrop-filter: blur(4px); }
        @keyframes floatUpFade { 0% { transform: translate(-50%, 0) scale(0.5); opacity: 0; } 20% { transform: translate(-50%, -40px) scale(1.1); opacity: 1; } 80% { opacity: 1; } 100% { transform: translate(-50%, -150px) scale(1); opacity: 0; } }
        .goal-celebration { position: fixed; inset: 0; pointer-events: none; z-index: 99999; overflow: hidden; }
        .firework { position: absolute; width: 4px; height: 4px; border-radius: 50%; animation: firework 2.5s ease-out forwards; }
        @keyframes firework { 0% { transform: translate(0, 0) scale(1); opacity: 1; } 100% { transform: translate(var(--fx), var(--fy)) scale(0); opacity: 0; } }
        .goal-message { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: var(--glass); backdrop-filter: blur(20px); border: 2px solid var(--success); border-radius: 24px; padding: 40px 60px; text-align: center; z-index: 100000; animation: goalMessagePop 2.5s ease-out forwards; box-shadow: 0 0 60px rgba(0, 217, 166, 0.4); }
        @keyframes goalMessagePop { 0% { transform: translate(-50%, -50%) scale(0); opacity: 0; } 15% { transform: translate(-50%, -50%) scale(1.1); opacity: 1; } 20% { transform: translate(-50%, -50%) scale(1); } 85% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -50%) scale(0.9); } }
        @keyframes goalBgIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes goalCardIn { from { opacity: 0; transform: scale(0.7) translateY(30px); } to { opacity: 1; transform: scale(1) translateY(0); } }
        @keyframes goalIconSpin { from { transform: scale(0) rotate(-180deg); } to { transform: scale(1) rotate(0deg); } }
        .goal-message h2 { font-size: 2.5rem; background: var(--gradient-success); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 16px; }
        .goal-message p { font-size: 1.2rem; color: var(--text); font-weight: 600; }
        @keyframes holoShimmer { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
        .history-item.paid { background: linear-gradient(110deg, rgba(0, 217, 166, 0.05) 30%, rgba(0, 217, 166, 0.15) 50%, rgba(0, 217, 166, 0.05) 70%); background-size: 200% 100%; animation: holoShimmer 3s linear infinite; border-color: rgba(0, 217, 166, 0.3); box-shadow: 0 0 10px rgba(0, 217, 166, 0.1); }
        .avatar-controls { position: absolute; bottom: -5px; left: 50%; transform: translateX(-50%); display: flex; gap: 12px; z-index: 10; }
        .btn-icon-round { width: 32px; height: 32px; border-radius: 50%; border: none; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 4px 10px rgba(0,0,0,0.3); transition: all 0.2s ease; font-size: 0.9rem; position: relative; }
        .btn-icon-round:active { transform: scale(0.9); }
        .btn-icon-round.edit { background: var(--primary); color: white; }
        .btn-icon-round.delete { background: var(--danger); color: white; }
        .ambient-bg { position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: -1; overflow: hidden; pointer-events: none; }
        .ambient-bg::before { content: ''; position: absolute; top: -50%; left: -50%; width: 200%; height: 200%; background: radial-gradient(circle at 50% 50%, rgba(0, 212, 255, 0.03) 0%, transparent 50%); animation: rotate 60s linear infinite; }
        @keyframes rotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .app-container { max-width: 480px; margin: 0 auto; min-height: 100vh; display: flex; flex-direction: column; position: relative; padding-bottom: 100px; }
        .login-screen { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 1000; background: radial-gradient(circle at center, #151b3d 0%, #0a0e27 100%); transition: opacity 0.4s ease, transform 0.4s ease; padding: 16px; }
        .login-screen.hidden { opacity: 0; pointer-events: none; transform: scale(1.1); }
        .login-container { width: 100%; max-width: 340px; display: flex; flex-direction: column; align-items: center; }
        .login-hero { text-align: center; margin-bottom: 24px; position: relative; }
        .sindicato-emblem { width: 100px; height: 100px; margin: 0 auto 16px; position: relative; display: flex; align-items: center; justify-content: center; background: var(--glass); border: 2px solid rgba(0, 212, 255, 0.2); border-radius: 24px; backdrop-filter: blur(8px); box-shadow: 0 0 40px rgba(0, 212, 255, 0.15), inset 0 0 40px rgba(0, 212, 255, 0.05); animation: float 6s ease-in-out infinite; }
        @keyframes float { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-6px); } }
        .sindicato-icon { width: 55px; height: 55px; filter: drop-shadow(0 4px 15px rgba(0, 0, 0, 0.3)); }
        .login-title { font-size: 1.5rem; font-weight: 800; letter-spacing: 6px; background: var(--gradient-primary); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 8px; text-transform: uppercase; }
        .login-subtitle { color: var(--text-secondary); font-size: 0.7rem; letter-spacing: 3px; text-transform: uppercase; font-weight: 600; opacity: 0.9; }
        .login-mode-toggle { display: flex; background: var(--surface); border-radius: 12px; padding: 4px; margin-bottom: 16px; border: 1px solid var(--border); width: 100%; }
        .login-mode-btn { flex: 1; padding: 10px; border: none; background: transparent; color: var(--text-secondary); font-size: 0.75rem; font-weight: 600; cursor: pointer; border-radius: 8px; transition: all 0.3s; font-family: 'Inter', sans-serif; }
        .login-mode-btn.active { background: var(--gradient-primary); color: white; }
        .login-card { width: 100%; background: rgba(255, 255, 255, 0.03); backdrop-filter: blur(15px); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 20px; padding: 24px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5), inset 0 0 0 1px rgba(255, 255, 255, 0.05); }
        .register-section { display: none; }
        .register-section.active { display: block; }
        .login-section { display: block; }
        .login-section.hidden { display: none; }
        .input-tip { background: rgba(0, 180, 216, 0.1); border: 1px solid rgba(0, 180, 216, 0.3); border-radius: 8px; padding: 10px; margin-bottom: 16px; display: flex; gap: 8px; align-items: flex-start; }
        .input-tip-icon { font-size: 1rem; flex-shrink: 0; }
        .input-tip-text { font-size: 0.7rem; color: var(--info); line-height: 1.4; }
        .input-hint { font-size: 0.7rem; color: var(--text-muted); margin-top: 4px; line-height: 1.4; }
        .register-status { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px; text-align: center; }
        .register-status-icon { font-size: 2.5rem; margin-bottom: 12px; }
        .register-status-title { font-weight: 700; font-size: 1rem; margin-bottom: 8px; color: var(--warning); }
        .register-status-text { font-size: 0.8rem; color: var(--text-secondary); line-height: 1.5; margin-bottom: 16px; }
        .pending-badge { display: inline-flex; align-items: center; gap: 6px; background: rgba(255, 184, 0, 0.1); border: 1px solid rgba(255, 184, 0, 0.3); color: var(--warning); padding: 6px 12px; border-radius: 12px; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; }
        .pending-dot { width: 6px; height: 6px; background: var(--warning); border-radius: 50%; animation: pulse 1.5s infinite; }
        .pin-display { display: flex; justify-content: center; gap: 10px; margin-bottom: 24px; }
        .pin-dot { width: 12px; height: 12px; border-radius: 50%; border: 2px solid rgba(255, 255, 255, 0.2); background: transparent; transition: all 0.2s ease; }
        .pin-dot.active { background: var(--primary); border-color: var(--primary); box-shadow: 0 0 15px var(--primary-glow); transform: scale(1.1); }
        .pin-dot.error { background: var(--danger); border-color: var(--danger); animation: shake 0.4s ease; }
        @keyframes shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-10px); } 75% { transform: translateX(10px); } }
        .keypad { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
        .key-btn { aspect-ratio: 1.2; border: none; background: rgba(255, 255, 255, 0.05); color: var(--text); font-size: 1.2rem; font-weight: 600; border-radius: 12px; cursor: pointer; transition: background 0.1s ease; font-family: 'Inter', sans-serif; touch-action: manipulation; position: relative; overflow: hidden; }
        .key-btn::before { content: ''; position: absolute; inset: 0; background: radial-gradient(circle at center, rgba(255,255,255,0.1) 0%, transparent 70%); opacity: 0; transition: opacity 0.2s; }
        .key-btn:active { transform: scale(0.96); background: var(--primary); color: var(--bg); }
        .key-btn:active::before { opacity: 1; }
        .key-btn.action { background: var(--gradient-primary); color: white; font-weight: 700; box-shadow: 0 4px 20px rgba(0, 212, 255, 0.3); }
        .key-btn.delete { color: var(--danger); background: rgba(255, 56, 96, 0.1); }
        .login-footer { margin-top: 24px; text-align: center; opacity: 0.5; }
        .login-footer p { font-size: 0.6rem; letter-spacing: 2px; color: var(--text-secondary); font-weight: 500; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .app-header { position: sticky; top: 0; z-index: 100; padding: 12px 16px; background: rgba(10, 14, 39, 0.85); backdrop-filter: blur(15px); border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; transition: all 0.3s ease; }
        body.light-mode .app-header { background: rgba(245, 247, 250, 0.85); }
        .user-pill { display: flex; align-items: center; gap: 10px; padding: 6px 12px 6px 6px; background: var(--surface); border: 1px solid var(--border); border-radius: 50px; cursor: pointer; transition: all 0.3s ease; }
        .user-pill:active { transform: scale(0.98); }
        .avatar { width: 32px; height: 32px; border-radius: 50%; background: var(--gradient-primary); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.75rem; color: white; position: relative; overflow: hidden; }
        #userAvatarImg, #profileAvatarImg { width: 100%; height: 100%; object-fit: cover; object-position: center; display: block; }
        .user-info { display: flex; flex-direction: column; }
        .user-info h3 { font-size: 0.8rem; font-weight: 700; margin-bottom: 0; display: flex; align-items: center; gap: 6px; }
        .vip-badge { font-size: 0.55rem; background: var(--gradient-gold); color: #0a0e27; padding: 1px 6px; border-radius: 6px; font-weight: 800; letter-spacing: 0.5px; box-shadow: 0 0 10px rgba(255, 215, 0, 0.4); animation: pulse-gold 2s infinite; }
        .adm-badge { font-size: 0.55rem; background: var(--gradient-orange); color: white; padding: 1px 6px; border-radius: 6px; font-weight: 800; letter-spacing: 0.5px; box-shadow: 0 0 10px rgba(255, 56, 96, 0.4); animation: pulse-adm 2s infinite; }
        @keyframes pulse-gold { 0%, 100% { opacity: 0.8; transform: scale(0.95); } 50% { opacity: 1; transform: scale(1.05); } }
        @keyframes pulse-adm { 0%, 100% { opacity: 0.8; transform: scale(0.95); } 50% { opacity: 1; transform: scale(1.05); } }
        .user-info span.status-text { font-size: 0.6rem; color: var(--success); text-transform: uppercase; letter-spacing: 1px; font-weight: 700; display: flex; align-items: center; gap: 4px; }
        .status-dot { width: 5px; height: 5px; background: var(--success); border-radius: 50%; box-shadow: 0 0 8px var(--success); animation: pulse 2s infinite; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        .header-actions { display: flex; gap: 8px; }
        .icon-btn { width: 36px; height: 36px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface); color: var(--text-secondary); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s ease; font-size: 1rem; }
        .icon-btn:active { transform: scale(0.95); background: var(--primary); color: white; }
        .icon-btn.admin-btn { background: rgba(255, 215, 0, 0.1); border-color: rgba(255, 215, 0, 0.3); color: var(--accent); }
        .app-content { flex: 1; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
        .dashboard-controls { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 12px; margin-bottom: 4px; backdrop-filter: blur(10px); }
        .dashboard-controls-compact { display: flex; flex-direction: column; gap: 8px; }
        .segmented-control-mini { display: flex; background: var(--bg); border: 1px solid var(--border); border-radius: 10px; padding: 3px; position: relative; height: 36px; }
        .segment-btn-mini { flex: 1; border: none; background: transparent; color: var(--text-secondary); font-size: 0.7rem; font-weight: 600; border-radius: 8px; cursor: pointer; z-index: 2; transition: all 0.3s ease; display: flex; align-items: center; justify-content: center; gap: 4px; text-transform: none; letter-spacing: 0; position: relative; padding: 0 4px; }
        .segment-btn-mini.active { color: white; }
        .segment-highlight-mini { position: absolute; top: 3px; left: 3px; width: calc(50% - 3px); height: calc(100% - 6px); background: var(--gradient-primary); border-radius: 8px; transition: transform 0.3s cubic-bezier(0.4, 0.0, 0.2, 1); z-index: 1; box-shadow: 0 2px 8px rgba(0, 212, 255, 0.3); }
        .segmented-control-mini[data-state="month"] .segment-highlight-mini { transform: translateX(100%); }
        .month-selector-inline { display: flex; align-items: center; gap: 8px; max-height: 0; overflow: hidden; opacity: 0; transition: all 0.3s ease; padding: 0 4px; }
        .month-selector-inline.visible { max-height: 40px; opacity: 1; padding-top: 8px; border-top: 1px solid var(--border); margin-top: 4px; }
        .month-label { font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap; font-weight: 600; }
        .month-input-compact { flex: 1; padding: 6px 10px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 0.8rem; font-family: 'JetBrains Mono', monospace; outline: none; cursor: pointer; transition: all 0.2s; }
        .month-input-compact:focus { border-color: var(--primary); }
        .period-indicator { font-size: 0.6rem; color: var(--primary); text-align: center; opacity: 0; max-height: 0; overflow: hidden; transition: all 0.3s ease; font-weight: 600; letter-spacing: 0.5px; }
        .period-indicator.visible { opacity: 1; max-height: 20px; margin-top: 4px; }
        .dashboard-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 4px; }
        .stat-card { background: var(--glass); backdrop-filter: blur(10px); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px; position: relative; overflow: hidden; transition: all 0.2s ease; }
        .stat-card:active { transform: scale(0.98); }
        .stat-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px; background: var(--gradient-primary); opacity: 0; transition: opacity 0.3s ease; }
        .stat-card.bruto::before { background: var(--info); opacity: 1; }
        .stat-card.liquido::before { background: var(--gradient-gold); opacity: 1; }
        .stat-card.pendente::before { background: var(--danger); opacity: 1; }
        .stat-card.pago::before { background: var(--success); opacity: 1; }
        .stat-label { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 1.5px; color: var(--text-secondary); font-weight: 700; margin-bottom: 6px; display: flex; align-items: center; gap: 4px; }
        .stat-value { font-family: 'JetBrains Mono', monospace; font-size: 1rem; font-weight: 700; letter-spacing: -0.5px; margin-bottom: 2px; }
        .stat-card.bruto .stat-value { color: var(--info); }
        .stat-card.liquido .stat-value { color: var(--accent); }
        .stat-card.pendente .stat-value { color: var(--danger); }
        .stat-card.pago .stat-value { color: var(--success); }
        .stat-meta { font-size: 0.65rem; color: var(--text-muted); font-weight: 600; }
        .meta-card { background: var(--glass); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; margin-bottom: 4px; }
        .meta-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
        .meta-title { font-size: 0.75rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 1.5px; }
        .meta-value { font-family: 'JetBrains Mono', monospace; font-size: 1.1rem; font-weight: 700; color: var(--primary); }
        .progress-container { background: var(--surface); border-radius: 10px; height: 8px; overflow: hidden; position: relative; }
        .progress-bar { height: 100%; background: var(--gradient-primary); border-radius: 10px; transition: width 1s cubic-bezier(0.4, 0, 0.2, 1); position: relative; box-shadow: 0 0 10px var(--primary-glow); }
        .progress-text { display: flex; justify-content: space-between; margin-top: 8px; font-size: 0.7rem; color: var(--text-secondary); font-weight: 600; }
        .section { background: var(--glass); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; transition: background 0.2s ease; }
        .section-header { padding: 16px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; background: linear-gradient(90deg, rgba(0, 212, 255, 0.03) 0%, transparent 100%); transition: background 0.2s ease; }
        .section-title-group { display: flex; align-items: center; gap: 10px; }
        .section-icon { width: 36px; height: 36px; border-radius: 10px; background: var(--surface); border: 1px solid var(--border); display: flex; align-items: center; justify-content: center; font-size: 1.1rem; transition: all 0.3s ease; }
        .section.expanded .section-icon { background: var(--gradient-primary); border-color: transparent; color: white; }
        .section-titles h3 { font-size: 0.85rem; font-weight: 700; margin-bottom: 1px; }
        .section-titles p { font-size: 0.7rem; color: var(--text-secondary); font-weight: 500; }
        .section-arrow { width: 28px; height: 28px; border-radius: 50%; background: var(--surface); border: 1px solid var(--border); display: flex; align-items: center; justify-content: center; transition: transform 0.3s ease; color: var(--text-secondary); font-size: 0.7rem; }
        .section.expanded .section-arrow { transform: rotate(180deg); background: var(--primary); color: white; border-color: var(--primary); }
        .section-content { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 0.3s ease-out; }
        .section.expanded .section-content { grid-template-rows: 1fr; }
        .section-inner { overflow: hidden; padding: 0 16px; touch-action: pan-y; -webkit-overflow-scrolling: touch; }
        .section.expanded .section-inner { padding-bottom: 16px; padding-top: 5px; }
        .chart-svg { width: 100%; height: 160px; overflow: visible; }
        .chart-area-path { fill: url(#gradChart); opacity: 0.6; transition: d 0.5s cubic-bezier(0.4, 0, 0.2, 1); }
        .chart-line-path { fill: none; stroke: var(--primary); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; filter: drop-shadow(0 0 8px var(--primary-glow)); transition: d 0.5s cubic-bezier(0.4, 0, 0.2, 1); }
        .chart-line-prev { fill: none; stroke: rgba(255,255,255,0.3); stroke-width: 2; stroke-dasharray: 4, 4; stroke-linecap: round; stroke-linejoin: round; transition: d 0.5s cubic-bezier(0.4, 0, 0.2, 1); }
        .chart-point { fill: var(--bg); stroke: var(--primary); stroke-width: 2; transition: cy 0.5s cubic-bezier(0.4, 0, 0.2, 1); }
        .chart-stats-overlay { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 10px; padding: 0 4px; }
        .chart-stat-item { display: flex; flex-direction: column; }
        .chart-stat-label { font-size: 0.6rem; color: var(--text-secondary); text-transform: uppercase; font-weight: 700; }
        .chart-stat-value { font-family: 'JetBrains Mono', monospace; font-size: 0.9rem; font-weight: 700; color: var(--text); }
        .chart-growth { font-size: 0.8rem; font-weight: 800; padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.1); }
        .chart-growth.positive { color: var(--success); background: rgba(0, 217, 166, 0.1); }
        .chart-growth.negative { color: var(--danger); background: rgba(255, 56, 96, 0.1); }
        .input-group { margin-bottom: 16px; }
        .input-label { display: block; font-size: 0.65rem; text-transform: uppercase; letter-spacing: 1.5px; color: var(--text-secondary); font-weight: 700; margin-bottom: 8px; }
        input, select { width: 100%; padding: 12px 14px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text); font-size: 0.85rem; font-family: 'Inter', sans-serif; transition: all 0.3s ease; outline: none; -webkit-appearance: none; appearance: none; }

        /* ==========================
         * Calendario de operacoes
         * ==========================
         * O calendario mensal exibe os dias com registros. Dias com todos
         * pagamentos quitados ficam em verde; dias com algum pendente ficam
         * em laranja/vermelho. Os dias vazios sao escondidos.
         */
        .calendar-toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
        .calendar-month-input { flex: 1; padding: 10px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 10px; color: var(--text); font-size: 0.85rem; font-family: 'JetBrains Mono', monospace; }
        .calendar-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px; }
        .calendar-summary-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 10px; text-align: center; }
        .calendar-summary-label { font-size: 0.58rem; text-transform: uppercase; letter-spacing: 1px; color: var(--text-secondary); font-weight: 700; margin-bottom: 4px; }
        .calendar-summary-value { font-family: 'JetBrains Mono', monospace; font-size: 0.95rem; font-weight: 700; }
        .calendar-summary-card.total .calendar-summary-value { color: var(--primary); }
        .calendar-summary-card.paid .calendar-summary-value { color: var(--success); }
        .calendar-summary-card.pending .calendar-summary-value { color: var(--warning); }
        .calendar-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; margin-top: 8px; }
        .calendar-day { min-height: 42px; padding: 8px 4px; border-radius: 12px; text-align: center; font-size: 0.72rem; cursor: pointer; user-select: none; display: flex; align-items: center; justify-content: center; border: 1px solid transparent; background: rgba(255,255,255,0.02); transition: transform 0.15s ease, border-color 0.2s ease, background 0.2s ease; }
        .calendar-day:active { transform: scale(0.96); }
        .calendar-day.empty { visibility: hidden; }
        .calendar-day.header { min-height: 26px; padding: 0; font-weight: 700; color: var(--text-secondary); cursor: default; background: transparent; }
        .calendar-day.today { border-color: rgba(0, 212, 255, 0.45); box-shadow: inset 0 0 0 1px rgba(0,212,255,0.18); }
        .calendar-day.paid { background: rgba(0, 217, 166, 0.15); border: 1px solid rgba(0, 217, 166, 0.5); color: var(--success); }
        .calendar-day.pending { background: rgba(255, 184, 0, 0.15); border: 1px solid rgba(255, 184, 0, 0.5); color: var(--warning); }
        .calendar-day.has-service { font-weight: 800; cursor: pointer; }
        .calendar-day.paid:hover { background: rgba(0, 217, 166, 0.28); box-shadow: 0 0 12px rgba(0, 217, 166, 0.4); transform: scale(1.1); }
        .calendar-day.pending:hover { background: rgba(255, 184, 0, 0.28); box-shadow: 0 0 12px rgba(255, 184, 0, 0.4); transform: scale(1.1); }

        /* ==========================
         * Caixa de sugestoes de navio
         * ==========================
         * A lista de sugestoes aparece abaixo dos campos de navio ao digitar.
         * Cada item aceita clique para preencher e long-press para remover.
         */
        .navio-suggestions { position: relative; }
        .navio-suggestions.open { margin-bottom: 6px; }
        .navio-input-wrapper { position: relative; display: flex; align-items: center; }
        .navio-input-wrapper input { padding-right: 32px; }
        .navio-clear-btn { position: absolute; right: 10px; background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 0.9rem; line-height: 1; padding: 4px; z-index: 2; display: none; transition: color 0.2s; }
        .navio-clear-btn.visible { display: block; }
        .navio-clear-btn:hover { color: var(--danger); }
        .navio-suggestions-list { position: static; display: none; margin-top: 6px; background: rgba(14, 19, 44, 0.98); border: 1px solid rgba(0, 212, 255, 0.2); border-radius: 12px; box-shadow: 0 8px 20px rgba(0,0,0,0.35); max-height: 180px; overflow-y: auto; overflow-x: hidden; }
        .navio-suggestion-item { padding: 7px 12px; cursor: pointer; color: var(--text); border-bottom: 1px solid rgba(255,255,255,0.04); display: flex; align-items: center; justify-content: space-between; gap: 8px; user-select: none; -webkit-user-select: none; }
        .navio-suggestion-item:last-child { border-bottom: none; }
        .navio-suggestion-item:hover, .navio-suggestion-item:active { background: rgba(0, 212, 255, 0.1); }
        .navio-suggestion-title { font-size: 0.82rem; font-weight: 700; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }
        .navio-suggestion-meta { font-size: 0.65rem; color: var(--text-muted); white-space: nowrap; flex-shrink: 0; }
        input:focus, select:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(0, 212, 255, 0.1); }
        .input-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .input-row-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
        .btn { width: 100%; padding: 14px; border: none; border-radius: var(--radius-sm); font-family: 'Inter', sans-serif; font-weight: 700; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 2px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; transition: all 0.2s ease; touch-action: manipulation; }
        .btn:active { transform: scale(0.98); }
        .btn-primary { background: var(--gradient-primary); color: white; box-shadow: 0 4px 15px rgba(0, 212, 255, 0.3); }
        .btn-success { background: var(--gradient-success); color: white; box-shadow: 0 4px 15px rgba(0, 217, 166, 0.3); }
        .btn-glass { background: var(--surface); border: 1px solid var(--border); color: var(--text); }
        .btn-glass:active { background: var(--primary); color: white; }
        .btn-danger { background: rgba(255, 56, 96, 0.1); color: var(--danger); border: 1px solid rgba(255, 56, 96, 0.3); }
        .btn-orange { background: var(--gradient-orange); color: white; }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .sim-result { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 16px; margin-top: 16px; text-align: center; }
        .sim-result-label { font-size: 0.65rem; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 1.5px; font-weight: 700; margin-bottom: 8px; }
        .sim-result-value { font-family: 'JetBrains Mono', monospace; font-size: 1.5rem; font-weight: 700; color: var(--accent); }
        .sim-result-detail { font-size: 0.75rem; color: var(--text-muted); margin-top: 4px; font-weight: 500; }
        .history-list { display: flex; flex-direction: column; gap: 10px; }
        .history-item { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; transition: all 0.3s ease; position: relative; touch-action: pan-y; }
        .history-item:active { transform: scale(0.99); }
        .history-main-row { padding: 14px; display: flex; align-items: center; gap: 10px; cursor: pointer; position: relative; overflow: hidden; touch-action: pan-y; }
        .history-main-row::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--danger); opacity: 0; transition: opacity 0.3s ease; }
        .history-item.pending .history-main-row::before { background: var(--danger); opacity: 1; }
        .history-item.paid .history-main-row::before { background: var(--success); opacity: 1; }
        .history-main { flex: 1; min-width: 0; }
        .history-ship { font-size: 0.95rem; font-weight: 700; margin-bottom: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: color 0.3s; }
        .history-item.pending .history-ship { color: var(--danger); }
        .history-item.paid .history-ship { color: var(--success); }
        .history-meta { font-size: 0.7rem; color: var(--text-secondary); font-weight: 500; display: flex; gap: 6px; align-items: center; }
        .history-values { display: flex; flex-direction: column; gap: 2px; text-align: right; margin-right: 4px; min-width: 90px; }
        .history-liquid { font-family: 'JetBrains Mono', monospace; font-size: 0.95rem; font-weight: 700; color: var(--accent); }
        .history-bruto { font-family: 'JetBrains Mono', monospace; font-size: 0.75rem; color: var(--info); font-weight: 600; opacity: 0.8; }
        .history-expand-icon { color: var(--text-muted); font-size: 0.8rem; transition: transform 0.3s; }
        .history-item.expanded .history-expand-icon { transform: rotate(180deg); }
        .history-details { max-height: 0; overflow: hidden; background: rgba(0, 0, 0, 0.2); transition: max-height 0.4s ease, padding 0.3s ease; touch-action: pan-y; }
        .history-item.expanded .history-details { max-height: 320px; padding: 12px 14px; border-top: 1px solid var(--border); }
        .details-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
        .detail-item { font-size: 0.75rem; color: var(--text-secondary); }
        .detail-label { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 1px; color: var(--text-muted); margin-bottom: 2px; font-weight: 600; }
        .detail-value { color: var(--text); font-weight: 600; }
        .history-actions-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); }
        .action-btn { flex: 1; min-width: 60px; padding: 8px 4px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text-secondary); cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px; transition: all 0.2s ease; font-size: 0.7rem; font-weight: 600; font-family: 'Inter', sans-serif; white-space: nowrap; }
        .action-btn:active { transform: scale(0.95); background: var(--primary); color: white; border-color: var(--primary); }
        .action-btn.delete:active { background: var(--danger); border-color: var(--danger); }
        .status-badge { display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; border-radius: 12px; font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; cursor: pointer; transition: all 0.2s ease; border: 1px solid transparent; margin-top: 6px; }
        .status-badge.paid { background: rgba(0, 217, 166, 0.1); color: var(--success); border-color: rgba(0, 217, 166, 0.3); }
        .status-badge.pending { background: rgba(255, 56, 96, 0.1); color: var(--danger); border-color: rgba(255, 56, 96, 0.3); }
        .filter-tabs { display: flex; gap: 6px; margin-bottom: 12px; padding: 4px; background: var(--surface); border-radius: 10px; border: 1px solid var(--border); }
        .filter-tab { flex: 1; padding: 8px; border: none; background: transparent; color: var(--text-secondary); font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; cursor: pointer; border-radius: 8px; transition: all 0.3s ease; font-family: 'Inter', sans-serif; }
        .filter-tab.active { background: var(--primary); color: var(--bg); box-shadow: 0 2px 8px rgba(0, 212, 255, 0.3); }
        .modal-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.85); backdrop-filter: blur(10px); z-index: 1000; display: none; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.3s ease; padding: 20px; }
        .modal-overlay.active { display: flex; opacity: 1; }
        .modal-content { background: var(--glass); border: 1px solid var(--border); border-radius: 24px; width: 100%; max-width: 420px; max-height: 85vh; overflow-y: auto; transform: scale(0.9); transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); box-shadow: 0 20px 50px rgba(0,0,0,0.5); }
        .modal-overlay.active .modal-content { transform: scale(1); }
        .modal-header { padding: 20px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; position: sticky; top: 0; background: var(--glass); backdrop-filter: blur(10px); z-index: 10; }
        .modal-title { font-size: 0.9rem; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; }
        .modal-close { width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--border); background: var(--surface); color: var(--text-secondary); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.3s ease; }
        .modal-close:active { background: var(--danger); color: white; transform: rotate(90deg); }
        .modal-body { padding: 20px; }
        .config-buttons-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; }
        .admin-section { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 24px; margin-bottom: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
        .admin-grid-fix { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; }
        .admin-toggle-btn { width: 100%; text-align: left; background: transparent; border: none; color: var(--primary); font-size: 0.9rem; font-weight: 800; cursor: pointer; padding: 4px 0; text-transform: uppercase; letter-spacing: 1.5px; display: flex; justify-content: space-between; align-items: center; }
        .admin-toggle-content { display: none; padding-top: 24px; margin-top: 12px; border-top: 1px solid var(--border); }
        .user-list { max-height: 350px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; padding-right: 4px; }
        .user-item { display: flex; justify-content: space-between; align-items: center; padding: 16px; background: var(--surface-elevated); border-radius: 12px; border: 1px solid var(--border); transition: transform 0.2s; }
        .user-item:active { transform: scale(0.99); }
        .user-item-info { display: flex; flex-direction: column; gap: 4px; }
        .user-item-name { font-size: 0.95rem; font-weight: 700; color: var(--text); display: flex; align-items: center; }
        .user-item-code { font-size: 0.7rem; color: var(--text-muted); font-family: 'JetBrains Mono', monospace; letter-spacing: 1px; }
        .user-last-seen { font-size: 0.65rem; color: var(--info); font-weight: 600; margin-top: 2px; }
        .user-vip-days { font-size: 0.65rem; color: var(--success); font-weight: 700; margin-top: 2px; }
        .user-item-status { display: flex; align-items: center; gap: 8px; }
        .status-indicator { width: 8px; height: 8px; border-radius: 50%; }
        .status-indicator.active { background: var(--success); box-shadow: 0 0 8px var(--success); }
        .status-indicator.blocked { background: var(--danger); }
        .btn-small { padding: 6px 12px; font-size: 0.65rem; }
        .btn-icon { padding: 6px; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 6px; border: 1px solid var(--border); background: var(--surface); cursor: pointer; font-size: 1rem; }
        .btn-icon:active { background: rgba(0, 217, 166, 0.2); border-color: var(--success); }
        .btn-icon.delete-action { background: rgba(255, 56, 96, 0.1); border-color: var(--danger); color: var(--danger); }
        .rates-grid { display: grid; gap: 16px; }
        .rate-turno-section { background: var(--surface-elevated); border: 1px solid var(--border); border-radius: 12px; padding: 16px; }
        .rate-turno-title { font-size: 0.85rem; font-weight: 700; color: var(--primary); margin-bottom: 12px; text-transform: uppercase; letter-spacing: 1px; display: flex; align-items: center; gap: 8px; }
        .rate-type-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 8px; }
        .rate-type-label { font-size: 0.7rem; color: var(--text-secondary); margin-bottom: 4px; display: flex; align-items: center; gap: 4px; }
        .rate-type-label .dot { width: 8px; height: 8px; border-radius: 50%; }
        .rate-type-label .dot.normal { background: var(--info); }
        .rate-type-label .dot.feriado { background: var(--warning); }
        .rate-subtitle { font-size: 0.65rem; color: var(--text-muted); margin-bottom: 8px; font-style: italic; }
        .app-footer { margin-top: auto; padding: 20px 16px; text-align: center; border-top: 1px solid var(--border); background: var(--surface); }
        .footer-brand { font-size: 0.7rem; font-weight: 800; letter-spacing: 4px; background: var(--gradient-primary); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 8px; }
        .footer-copy { font-size: 0.65rem; color: var(--text-secondary); font-weight: 500; line-height: 1.5; }
        .footer-divider { width: 30px; height: 2px; background: var(--gradient-primary); margin: 8px auto; border-radius: 2px; opacity: 0.5; }
        .hidden { display: none !important; }
        .empty-state { text-align: center; padding: 40px 20px; color: var(--text-muted); }
        .empty-state-icon { font-size: 2.5rem; margin-bottom: 12px; opacity: 0.5; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .fade-in { animation: fadeIn 0.4s ease forwards; }
        .toast-container { position: fixed; top: 60px; left: 50%; transform: translateX(-50%); z-index: 99999; pointer-events: none; width: 90%; max-width: 320px; }
        .toast { background: var(--glass); backdrop-filter: blur(10px); border: 1px solid var(--border); color: var(--text); padding: 14px 18px; border-radius: 12px; margin-bottom: 10px; font-weight: 600; font-size: 0.85rem; display: flex; align-items: center; gap: 10px; box-shadow: 0 10px 30px rgba(0,0,0,0.3); animation: slideDown 0.4s ease; }
        @keyframes slideDown { from { transform: translate(-50%, -100%); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
        .pending-section { background: rgba(255, 184, 0, 0.05); border: 1px solid rgba(255, 184, 0, 0.2); border-radius: 12px; padding: 16px; margin-bottom: 20px; }
        .pending-title { font-size: 0.8rem; font-weight: 700; color: var(--warning); margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
        .pending-list { display: flex; flex-direction: column; gap: 10px; }
        .pending-item { background: var(--surface-elevated); border: 1px solid var(--border); border-radius: 10px; padding: 12px; display: flex; justify-content: space-between; align-items: center; }
        .pending-info { display: flex; flex-direction: column; gap: 2px; }
        .pending-name { font-weight: 700; font-size: 0.9rem; }
        .pending-date { font-size: 0.7rem; color: var(--text-muted); }
        .pending-actions { display: flex; gap: 6px; }
        .btn-tiny { padding: 6px 10px; font-size: 0.65rem; border-radius: 6px; border: none; cursor: pointer; font-weight: 700; }
        .btn-approve { background: var(--success); color: white; }
        .btn-reject { background: var(--danger); color: white; }
        .ios-steps { background: var(--surface); border-radius: 12px; padding: 16px; margin: 16px 0; text-align: left; }
        .ios-step { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; font-size: 0.85rem; }
        .ios-step:last-child { margin-bottom: 0; }
        .ios-step-icon { width: 32px; height: 32px; background: var(--primary); border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 1rem; flex-shrink: 0; }
        .meta-input-formatted { position: relative; }
        .meta-input-formatted input { padding-right: 40px; font-family: 'JetBrains Mono', monospace; }
        .meta-currency { position: absolute; right: 14px; top: 50%; transform: translateY(-50%); color: var(--text-muted); font-size: 0.8rem; font-weight: 600; }
