        // ============================================
        // SEGURANCA v7.2: LOGIN POR ID + SENHA E MIGRACAO A PARTIR DO PIN
        //
        // Fluxo: login antigo (PIN) valido -> modal pede ID + senha -> grava no
        // Firestore -> confirma a gravacao lendo do servidor -> marca
        // authMigrated = true. So depois disso o PIN deixa de valer para a conta.
        // Qualquer erro no meio mantem o acesso antigo funcionando.
        // A senha nunca e gravada em texto puro (PBKDF2-SHA256, sal por usuario)
        // nem passa por logs, URL, localStorage ou sessionStorage.
        // ============================================
        (function() {
            const LOGIN_METHOD_KEY = 'evo_login_method_v1';
            const MIGRATION_TIMEOUT_MS = 20000;

            function withTimeout(promise, ms, label) {
                let timer = null;
                const timeout = new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error(label || 'timeout')), ms);
                });
                return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
            }

            // ---------- Estado da conta ----------
            EvolutionApp.prototype.isUserMigrated = function(u) {
                return !!(u && u.authMigrated === true && u.loginId && u.passwordHash && u.passwordSalt);
            };

            // ---------- Tela de login: alternar PIN / ID + senha ----------
            EvolutionApp.prototype.getPreferredLoginMethod = function() {
                return safeStorage.getItem(LOGIN_METHOD_KEY) === 'id' ? 'id' : 'pin';
            };

            EvolutionApp.prototype.setPreferredLoginMethod = function(method) {
                safeStorage.setItem(LOGIN_METHOD_KEY, method === 'id' ? 'id' : 'pin');
            };

            EvolutionApp.prototype.setLoginMethod = function(method, remember = false) {
                const useId = method === 'id';
                const pinBlock = document.getElementById('pinLoginBlock');
                const idBlock = document.getElementById('idLoginBlock');
                const switchBtn = document.getElementById('btnLoginMethodSwitch');
                if (!pinBlock || !idBlock) return;
                pinBlock.classList.toggle('hidden', useId);
                idBlock.classList.toggle('hidden', !useId);
                if (switchBtn) switchBtn.textContent = useId ? 'Entrar com PIN (acesso antigo)' : 'Entrar com ID e senha';
                this.loginMethod = useId ? 'id' : 'pin';
                if (!useId) {
                    this.pinValue = '';
                    this.updatePinDisplay();
                }
                const pass = document.getElementById('loginPasswordInput');
                if (pass) pass.value = '';
                if (remember) this.setPreferredLoginMethod(this.loginMethod);
            };

            EvolutionApp.prototype.toggleLoginMethod = function() {
                this.setLoginMethod(this.loginMethod === 'id' ? 'pin' : 'id', true);
            };

            EvolutionApp.prototype.initCredentialLogin = function() {
                this.setLoginMethod(this.getPreferredLoginMethod());
                const idInput = document.getElementById('loginIdInput');
                const passInput = document.getElementById('loginPasswordInput');
                if (idInput) idInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); passInput?.focus(); } });
                if (passInput) passInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.loginWithCredentials(); } });
                ['migLoginId', 'migPassword', 'migPasswordConfirm'].forEach((id, i, arr) => {
                    const el = document.getElementById(id);
                    if (!el) return;
                    el.addEventListener('keydown', (e) => {
                        if (e.key !== 'Enter') return;
                        e.preventDefault();
                        if (i < arr.length - 1) document.getElementById(arr[i + 1])?.focus();
                        else this.submitCredentialMigration();
                    });
                });
            };

            // ---------- Busca por ID ----------
            EvolutionApp.prototype.findUserByLoginId = async function(loginId, preferServer = false) {
                const id = PasswordSecurity.normalizeLoginId(loginId);
                if (!id) return null;
                let found = null;
                if (!preferServer) {
                    for (const [docId, u] of Object.entries(this.users || {})) {
                        if (u && PasswordSecurity.normalizeLoginId(u.loginId) === id) { found = { ...u, docId }; break; }
                    }
                }
                if (db && this.firebaseReady) {
                    try {
                        if (found?.docId) {
                            const doc = await db.collection('users').doc(found.docId).get();
                            if (doc.exists) found = { ...doc.data(), docId: doc.id };
                        } else {
                            const q = await db.collection('users').where('loginId', '==', id).limit(1).get();
                            if (!q.empty) found = { ...q.docs[0].data(), docId: q.docs[0].id };
                        }
                        if (found) {
                            this.users[found.docId] = found;
                            this.saveUsersToCache();
                        }
                    } catch (e) {
                        // offline: segue com o cache local
                    }
                }
                return found;
            };

            // ---------- SEGURANCA v7.6: login de ADMINISTRADOR (e-mail + senha) ----------
            // O admin digita o e-mail no mesmo campo de ID. Nada na tela revela
            // que existe um caminho de admin. A identidade vem do Firebase Auth
            // e e conferida contra ADMIN_ACCOUNTS (config.js) — a mesma lista
            // que esta nas regras do Firestore.
            EvolutionApp.prototype.loginAsAdmin = async function(email, password) {
                if (!auth) return { ok: false };
                let cred = null;
                try {
                    cred = await auth.signInWithEmailAndPassword(String(email).trim(), password);
                } catch (e) {
                    // Credencial errada, conta inexistente, rede: mensagem generica
                    return { ok: false, code: e?.code || 'auth-failed' };
                }
                const uid = cred?.user?.uid || (auth.currentUser && auth.currentUser.uid);
                if (!isAdminUid(uid)) {
                    // Conta valida no Firebase, mas nao autorizada como admin:
                    // desfaz a sessao para nao deixar um login "meio logado".
                    try { await auth.signOut(); } catch (_) {}
                    return { ok: false, code: 'not-admin' };
                }
                const docId = ADMIN_ACCOUNTS[uid];
                await this.restoreAdminSession(docId);
                return { ok: true };
            };

            // Monta a sessao do admin a partir do documento dele no Firestore.
            // Se o documento nao existir ou o Firestore falhar, ainda assim entra
            // (a identidade ja foi provada pelo Firebase Auth) — o admin nunca
            // fica trancado do lado de fora por causa de um doc faltando.
            EvolutionApp.prototype.restoreAdminSession = async function(docId) {
                if (!docId) return;
                let userData = { ...(this.users[docId] || {}), docId };
                if (db) {
                    try {
                        const doc = await db.collection('users').doc(docId).get();
                        if (doc.exists) userData = { ...doc.data(), docId };
                    } catch (e) {
                        console.warn('[admin] nao foi possivel ler o proprio documento:', e?.code || e);
                    }
                }
                if (!userData.name) userData.name = 'ADMINISTRADOR';
                userData.blocked = false;
                this.users[docId] = { ...(this.users[docId] || {}), ...userData };
                this.saveUsersToCache();
                LoginRateLimit.registerSuccess();
                this.restoreUserSession(this.users[docId], {
                    user: userData.name,
                    code: null,
                    docId: docId,
                    isAdmin: true
                });
                const loginTs = new Date().toISOString();
                if (db) db.collection('users').doc(docId).set({ lastLoginAt: loginTs }, { merge: true }).catch(() => {});
            };

            // ---------- Login por ID + senha ----------
            EvolutionApp.prototype.loginWithCredentials = async function() {
                const idInput = document.getElementById('loginIdInput');
                const passInput = document.getElementById('loginPasswordInput');
                const btn = document.getElementById('btnCredentialLogin');
                const loginId = PasswordSecurity.normalizeLoginId(idInput?.value);
                const password = String(passInput?.value || '');

                if (!loginId || !password) {
                    this.showToast('Informe seu ID e sua senha', 'error');
                    return;
                }
                if (!PasswordSecurity.available()) {
                    this.showToast('Este navegador não suporta o login por senha. Use o PIN.', 'error');
                    return;
                }
                const lockedMs = LoginRateLimit.checkLocked();
                if (lockedMs) {
                    this.showToast(`Muitas tentativas. Aguarde ${Math.ceil(lockedMs / 1000)}s.`, 'error');
                    return;
                }
                if (this.isLoggingIn) return;
                this.isLoggingIn = true;
                if (btn) btn.disabled = true;

                try {
                    // SEGURANCA v7.6: um e-mail no campo de ID = tentativa de
                    // login administrativo pelo Firebase Auth.
                    if (String(idInput?.value || '').indexOf('@') !== -1) {
                        const r = await this.loginAsAdmin(idInput.value, password);
                        if (!r.ok) {
                            LoginRateLimit.registerFailure();
                            this.showToast('ID ou senha incorretos', 'error');
                        } else if (passInput) {
                            passInput.value = '';
                            this.setPreferredLoginMethod('id');
                        }
                        return;
                    }

                    const user = await this.findUserByLoginId(loginId);
                    const ok = user && this.isUserMigrated(user) && await PasswordSecurity.verify(user, password);
                    if (!ok) {
                        LoginRateLimit.registerFailure();
                        this.showToast('ID ou senha incorretos', 'error');
                        return;
                    }
                    if (user.blocked && !user.isAdmin) {
                        this.showToast('Usuário bloqueado', 'error');
                        return;
                    }

                    LoginRateLimit.registerSuccess();
                    if (passInput) passInput.value = '';
                    this.setPreferredLoginMethod('id');

                    // Sessao sem PIN: a restauracao usa o docId (checkSession/resumeSessionAfterFirebase)
                    this.restoreUserSession(user, {
                        user: user.name,
                        code: null,
                        docId: user.docId,
                        loginId: user.loginId
                    });

                    const loginTs = new Date().toISOString();
                    if (this.users[user.docId]) {
                        this.users[user.docId].lastLoginAt = loginTs;
                        this.saveUsersToCache();
                    }
                    if (db) {
                        db.collection('users').doc(user.docId).set({ lastLoginAt: loginTs }, { merge: true }).catch(() => {});
                    }
                } catch (err) {
                    console.error('Erro inesperado no login por ID:', err);
                    this.showToast('Erro ao autenticar. Tente novamente.', 'error');
                } finally {
                    this.isLoggingIn = false;
                    if (btn) btn.disabled = false;
                    if (passInput) passInput.value = '';
                }
            };

            // ---------- Modal de migracao (apos login antigo valido) ----------
            EvolutionApp.prototype.maybeOfferCredentialMigration = function(user, enteredPin) {
                if (!user || !user.docId) return;
                // SEGURANCA v7.6: o admin entra por e-mail + senha; nao ha o que migrar.
                if (this.isAdmin || (typeof isAdminDocId === 'function' && isAdminDocId(user.docId))) return;
                if (this.isUserMigrated(user)) return;
                if (!db || !this.firebaseReady) return;            // sem servidor nao ha como confirmar a gravacao
                if (!PasswordSecurity.available()) return;
                this._migrationPin = enteredPin || null;          // so em memoria, para impedir senha igual ao PIN
                const docId = user.docId;
                // Espera o resumo de pendencias / avisos de abertura sairem da frente
                // (mesma regra usada pela animacao do rodape em main.js).
                const BLOCKERS = '.modal-overlay.active, #pendingSummaryOverlay:not(.hidden)';
                const tryOpen = (tries) => {
                    if (this.currentUserId !== docId) return;
                    if (this.isUserMigrated(this.users[docId])) return;
                    if (document.querySelector(BLOCKERS)) {
                        if (tries < 600) setTimeout(() => tryOpen(tries + 1), 500);
                        return;
                    }
                    ['migLoginId', 'migPassword', 'migPasswordConfirm'].forEach(id => {
                        const el = document.getElementById(id);
                        if (el) el.value = '';
                    });
                    const nameEl = document.getElementById('migUserName');
                    if (nameEl) nameEl.textContent = user.name || '';
                    this.openModal('credentialMigrationModal');
                };
                setTimeout(() => tryOpen(0), 700);
            };

            EvolutionApp.prototype.postponeCredentialMigration = function() {
                this._migrationPin = null;
                this.closeModal('credentialMigrationModal');
                this.showToast('Tudo bem. Vamos lembrar você no próximo acesso.', 'info');
            };

            EvolutionApp.prototype.submitCredentialMigration = async function() {
                const docId = this.currentUserId;
                if (!docId) return;
                const idInput = document.getElementById('migLoginId');
                const passInput = document.getElementById('migPassword');
                const confirmInput = document.getElementById('migPasswordConfirm');
                const btn = document.getElementById('btnSubmitMigration');
                const loginId = PasswordSecurity.normalizeLoginId(idInput?.value);
                const password = String(passInput?.value || '');
                const confirm = String(confirmInput?.value || '');

                if (!PasswordSecurity.isValidLoginId(loginId)) {
                    this.showToast('ID inválido: use de 4 a 20 caracteres (letras, números, ponto, traço ou _)', 'error');
                    return;
                }
                if (!PasswordSecurity.isValidPassword(password)) {
                    this.showToast('A senha deve ter entre 6 e 64 caracteres', 'error');
                    return;
                }
                if (password !== confirm) {
                    this.showToast('As senhas não coincidem', 'error');
                    return;
                }
                if (this._migrationPin && password === String(this._migrationPin)) {
                    this.showToast('A senha não pode ser igual ao seu PIN antigo', 'error');
                    return;
                }
                if (password === loginId) {
                    this.showToast('A senha não pode ser igual ao ID', 'error');
                    return;
                }
                if (this._migrationBusy) return;
                this._migrationBusy = true;
                if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }

                try {
                    await this.ensureFirebaseReady();

                    // ID precisa ser unico (consulta sempre o servidor)
                    const existing = await withTimeout(this.findUserByLoginId(loginId, true), MIGRATION_TIMEOUT_MS, 'timeout-lookup');
                    if (existing && existing.docId !== docId) {
                        this.showToast('Este ID já está em uso. Escolha outro.', 'error');
                        return;
                    }

                    const cred = await PasswordSecurity.create(password);
                    const startedAt = new Date().toISOString();
                    const payload = {
                        loginId: loginId,
                        passwordHash: cred.passwordHash,
                        passwordSalt: cred.passwordSalt,
                        passwordAlgo: cred.passwordAlgo,
                        passwordIter: cred.passwordIter,
                        authMigrationStartedAt: startedAt
                    };
                    // SEGURANCA v7.6: nunca gravar isAdmin daqui — a regra do
                    // Firestore recusa esse campo vindo de sessao nao-admin, e o
                    // app nao o usa mais para decidir quem e administrador.

                    // 1) grava as novas credenciais (ainda sem invalidar o PIN)
                    await withTimeout(db.collection('users').doc(docId).set(payload, { merge: true }), MIGRATION_TIMEOUT_MS, 'timeout-write');

                    // 2) confirma a gravacao lendo direto do servidor
                    const snap = await withTimeout(db.collection('users').doc(docId).get({ source: 'server' }), MIGRATION_TIMEOUT_MS, 'timeout-verify');
                    const saved = snap.exists ? snap.data() : null;
                    if (!saved || saved.loginId !== loginId || saved.passwordHash !== cred.passwordHash || saved.passwordSalt !== cred.passwordSalt) {
                        throw new Error('verify-failed');
                    }

                    // 3) so agora marca a migracao como concluida (PIN deixa de valer para esta conta)
                    const migratedAt = new Date().toISOString();
                    await withTimeout(db.collection('users').doc(docId).set({ authMigrated: true, authMigratedAt: migratedAt }, { merge: true }), MIGRATION_TIMEOUT_MS, 'timeout-finalize');

                    this.users[docId] = { ...(this.users[docId] || {}), ...payload, authMigrated: true, authMigratedAt: migratedAt, docId };
                    this.saveUsersToCache();
                    this.setPreferredLoginMethod('id');
                    this._migrationPin = null;

                    this.closeModal('credentialMigrationModal');
                    this.showToast('Pronto! Nos próximos acessos entre com seu ID e senha.', 'success');
                    if (this.isAdmin && typeof this.renderUserList === 'function') this.renderUserList();
                } catch (e) {
                    console.warn('[seguranca] migracao nao concluida:', e?.code || e?.message || e);
                    this.showToast('Não foi possível concluir agora. Seu acesso pelo PIN continua funcionando — tente novamente mais tarde.', 'error');
                } finally {
                    this._migrationBusy = false;
                    if (btn) { btn.disabled = false; btn.textContent = 'Salvar novas credenciais'; }
                    if (passInput) passInput.value = '';
                    if (confirmInput) confirmInput.value = '';
                }
            };

            // ---------- Admin: mostra o botao "Redefinir senha" so para contas com ID + senha ----------
            EvolutionApp.prototype.updateCredentialResetButton = function(user) {
                const btn = document.getElementById('btnResetCredentials');
                if (!btn) return;
                btn.style.display = (user && user.loginId) ? '' : 'none';
            };

            // ---------- Admin: define uma NOVA senha para o usuario (quando ele esquece) ----------
            // Nunca mostra a senha atual (ela e um hash irreversivel). O admin cria uma
            // senha temporaria, informa ao usuario, e ele troca depois em Configuracoes.
            EvolutionApp.prototype.openAdminSetPassword = function() {
                const docId = this.managingUser;
                const user = docId ? this.users[docId] : null;
                if (!user || !user.loginId) { this.showToast('Este usuário ainda não tem ID e senha.', 'warning'); return; }
                const n = document.getElementById('adminSetPwUserName');
                const i = document.getElementById('adminSetPwUserId');
                const f = document.getElementById('adminNewPassword');
                if (n) n.textContent = user.name || '';
                if (i) i.textContent = user.loginId || '';
                if (f) f.value = '';
                const mgmt = document.getElementById('userManagementModal');
                if (mgmt && mgmt.classList.contains('active')) this.closeModal('userManagementModal');
                setTimeout(() => this.openModal('adminSetPasswordModal'), 60);
            };

            EvolutionApp.prototype.submitAdminSetPassword = async function() {
                if (!this.isAdmin) { this.showToast('Acesso restrito a administradores.', 'error'); return; }
                const docId = this.managingUser;
                const user = docId ? this.users[docId] : null;
                if (!user || !user.loginId) return;
                const password = String(document.getElementById('adminNewPassword')?.value || '');
                if (!PasswordSecurity.isValidPassword(password)) { this.showToast('A senha deve ter entre 6 e 64 caracteres', 'error'); return; }
                if (this._adminPwBusy) return;
                this._adminPwBusy = true;
                const btn = document.getElementById('btnAdminSetPassword');
                if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }
                try {
                    await this.ensureFirebaseReady();
                    const cred = await PasswordSecurity.create(password);
                    const payload = { passwordHash: cred.passwordHash, passwordSalt: cred.passwordSalt, passwordAlgo: cred.passwordAlgo, passwordIter: cred.passwordIter, authMigrated: true, passwordResetByAdminAt: new Date().toISOString() };
                    await db.collection('users').doc(docId).set(payload, { merge: true });
                    this.users[docId] = { ...(this.users[docId] || {}), ...payload };
                    this.saveUsersToCache();
                    this.closeModal('adminSetPasswordModal');
                    this.showToast(`Senha de ${user.name} redefinida. Informe: "${password}"`, 'success');
                } catch (e) {
                    console.error('Falha ao redefinir senha:', e);
                    this.showToast('Não foi possível redefinir agora. Verifique a internet e tente de novo.', 'error');
                } finally {
                    this._adminPwBusy = false;
                    if (btn) { btn.disabled = false; btn.textContent = 'Salvar nova senha'; }
                    const f = document.getElementById('adminNewPassword'); if (f) f.value = '';
                }
            };

            // ---------- Usuario: troca a propria senha (pede a senha atual) ----------
            EvolutionApp.prototype.updateChangePasswordButton = function() {
                const btn = document.getElementById('btnChangePassword');
                if (!btn) return;
                const u = this.users[this.currentUserId];
                btn.style.display = (u && this.isUserMigrated(u)) ? '' : 'none';
            };

            EvolutionApp.prototype.openChangePassword = function() {
                ['curPassword', 'newPassword', 'newPasswordConfirm'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
                const cfg = document.getElementById('configModal');
                if (cfg && cfg.classList.contains('active')) this.closeModal('configModal');
                setTimeout(() => this.openModal('changePasswordModal'), 60);
            };

            EvolutionApp.prototype.submitChangePassword = async function() {
                const docId = this.currentUserId;
                const user = docId ? this.users[docId] : null;
                if (!user || !this.isUserMigrated(user)) { this.showToast('Sua conta não usa senha.', 'error'); return; }
                const current = String(document.getElementById('curPassword')?.value || '');
                const next = String(document.getElementById('newPassword')?.value || '');
                const confirm = String(document.getElementById('newPasswordConfirm')?.value || '');
                if (!PasswordSecurity.isValidPassword(next)) { this.showToast('A nova senha deve ter entre 6 e 64 caracteres', 'error'); return; }
                if (next !== confirm) { this.showToast('As senhas não coincidem', 'error'); return; }
                if (this._changePwBusy) return;
                this._changePwBusy = true;
                const btn = document.getElementById('btnChangePasswordSubmit');
                if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }
                try {
                    // Confere a senha atual antes de trocar
                    const ok = await PasswordSecurity.verify(user, current);
                    if (!ok) { this.showToast('Senha atual incorreta', 'error'); return; }
                    if (next === current) { this.showToast('A nova senha deve ser diferente da atual', 'error'); return; }
                    await this.ensureFirebaseReady();
                    const cred = await PasswordSecurity.create(next);
                    const payload = { passwordHash: cred.passwordHash, passwordSalt: cred.passwordSalt, passwordAlgo: cred.passwordAlgo, passwordIter: cred.passwordIter, passwordChangedAt: new Date().toISOString() };
                    await db.collection('users').doc(docId).set(payload, { merge: true });
                    this.users[docId] = { ...(this.users[docId] || {}), ...payload };
                    this.saveUsersToCache();
                    this.closeModal('changePasswordModal');
                    this.showToast('Senha alterada com sucesso!', 'success');
                } catch (e) {
                    console.error('Falha ao alterar senha:', e);
                    this.showToast('Não foi possível alterar agora. Verifique a internet e tente de novo.', 'error');
                } finally {
                    this._changePwBusy = false;
                    if (btn) { btn.disabled = false; btn.textContent = 'Salvar nova senha'; }
                    ['curPassword', 'newPassword', 'newPasswordConfirm'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
                }
            };

            let credentialLoginInited = false;
            const runCredentialInit = () => {
                if (credentialLoginInited) return;
                if (window.app && typeof window.app.initCredentialLogin === 'function') {
                    credentialLoginInited = true;
                    window.app.initCredentialLogin();
                    // Ao sair, a tela de login reabre no metodo preferido deste aparelho
                    // (utils.js carrega depois deste arquivo, por isso o wrap e feito aqui).
                    const originalLogout = EvolutionApp.prototype.logout;
                    if (typeof originalLogout === 'function' && !originalLogout._credentialWrapped) {
                        const wrapped = function() {
                            const result = originalLogout.apply(this, arguments);
                            try { this.setLoginMethod(this.getPreferredLoginMethod()); } catch (_) {}
                            return result;
                        };
                        wrapped._credentialWrapped = true;
                        EvolutionApp.prototype.logout = wrapped;
                    }
                }
            };
            if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', runCredentialInit);
            setTimeout(runCredentialInit, 0);
        })();
