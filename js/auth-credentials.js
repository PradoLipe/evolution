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
            // v7.8: "migrado" passa a incluir quem ja tem conta real no Firebase
            // Auth (authUid). Esses documentos nao guardam mais hash de senha —
            // quem confere a senha e o proprio Firebase.
            EvolutionApp.prototype.isUserMigrated = function(u) {
                if (!u || !u.loginId) return false;
                if (u.authUid) return true;
                return !!(u.authMigrated === true && u.passwordHash && u.passwordSalt);
            };

            // Conta que ja vive no Firebase Auth (cadeado fechado no servidor).
            EvolutionApp.prototype.hasAuthAccount = function(u) {
                return !!(u && u.authUid);
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
                if (passInput) passInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.submitCredentialLoginForm(); } });
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
            // v7.8: a consulta "where('loginId','==',x)" morre assim que o
            // primeiro documento fecha — o Firestore recusa a consulta inteira
            // quando nao consegue garantir que TODOS os resultados possiveis sao
            // permitidos. Agora o caminho normal e ler o ponteiro
            // loginIndex/{hash do ID} direto pelo id do documento. A consulta
            // antiga fica so como ultimo recurso, para contas que ainda nao
            // tiveram o ponteiro gerado.
            EvolutionApp.prototype.resolveLoginTarget = async function(loginId) {
                const id = PasswordSecurity.normalizeLoginId(loginId);
                if (!id) return null;

                let docId = null;
                let version = 1;

                const idx = await AuthIdentity.readLoginIndex(id);
                if (idx) { docId = idx.docId; version = idx.v || 1; }

                if (!docId) {
                    for (const [k, u] of Object.entries(this.users || {})) {
                        if (u && PasswordSecurity.normalizeLoginId(u.loginId) === id) { docId = k; break; }
                    }
                }
                if (!docId && db && this.firebaseReady) {
                    try {
                        const q = await db.collection('users').where('loginId', '==', id).limit(1).get();
                        if (!q.empty) docId = q.docs[0].id;
                    } catch (e) {
                        // Esperado depois que a colecao fecha: sem ponteiro, sem login.
                    }
                }
                if (!docId) return null;

                let user = null;
                let restricted = false;
                if (db) {
                    try {
                        const doc = await db.collection('users').doc(docId).get();
                        if (doc.exists) user = { ...doc.data(), docId: doc.id };
                    } catch (e) {
                        // Documento ja fechado pela regra: e sinal de que existe
                        // conta no Auth. Nao caimos no cache — ele poderia estar
                        // velho e conter um hash que nao vale mais.
                        if (e?.code === 'permission-denied') restricted = true;
                    }
                }
                if (!user && !restricted && this.users[docId]) {
                    user = { ...this.users[docId], docId };   // offline
                }
                if (user) {
                    this.users[docId] = user;
                    this.saveUsersToCache();
                    if (user.authEmailVersion) version = Number(user.authEmailVersion) || version;
                }
                return { docId, version, user, restricted };
            };

            // Mantida para o cadastro e a migracao, que so precisam saber se o ID
            // ja pertence a alguem.
            EvolutionApp.prototype.findUserByLoginId = async function(loginId) {
                const target = await this.resolveLoginTarget(loginId);
                if (!target) return null;
                return target.user ? target.user : { docId: target.docId, loginId: PasswordSecurity.normalizeLoginId(loginId) };
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
                // v7.8: o documento do admin tambem fecha. Sem isso ele ficaria
                // sendo o unico perfil legivel por qualquer visitante depois que
                // todo mundo migrasse.
                const authUser = auth && auth.currentUser;
                if (db && authUser && !authUser.isAnonymous && !userData.authUid) {
                    const marca = { authUid: authUser.uid, authClaimedAt: new Date().toISOString(), authClaimedDevice: this.deviceId || null };
                    try {
                        await db.collection('users').doc(docId).set(marca, { merge: true });
                        userData = { ...userData, ...marca };
                    } catch (e) {
                        console.warn('[admin] cadeado do proprio documento adiado:', e?.code || e);
                    }
                }
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

            // ---------- v8.1: SALVAR SENHA (Face ID / digital) ----------
            // Enter no campo de senha passa pelo envio do <form>, que e o sinal que
            // o iPhone (Chaves do iCloud) e o Android usam para oferecer "Salvar senha".
            EvolutionApp.prototype.submitCredentialLoginForm = function() {
                const form = document.getElementById('idLoginForm');
                if (form && typeof form.requestSubmit === 'function') form.requestSubmit();
                else this.loginWithCredentials();
            };

            // Depois de um login bem-sucedido, pede ao navegador (Chrome/Android/Edge)
            // para salvar o ID e a senha no gerenciador de senhas do aparelho. No
            // iPhone o proprio Safari oferece ao enviar o formulario. Nada e guardado
            // pelo Evolution: a senha fica so no cofre do sistema, protegido por
            // Face ID / digital. Qualquer falha aqui e ignorada — nunca afeta o login.
            EvolutionApp.prototype.offerSaveLoginCredential = function(loginId, password, displayName) {
                try {
                    if (!loginId || !password) return;
                    if (typeof window === 'undefined' || !window.PasswordCredential || !navigator.credentials || !navigator.credentials.store) return;
                    const cred = new window.PasswordCredential({
                        id: String(loginId),
                        password: String(password),
                        name: displayName ? String(displayName) : String(loginId)
                    });
                    navigator.credentials.store(cred).catch(() => {});
                } catch (e) {
                    // Navegador sem suporte ou recusou: segue normalmente.
                }
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
                        } else {
                            this.offerSaveLoginCredential(String(idInput.value).trim(), password, 'Administrador');
                            if (passInput) {
                                passInput.value = '';
                                this.setPreferredLoginMethod('id');
                            }
                        }
                        return;
                    }

                    const target = await this.resolveLoginTarget(loginId);
                    if (!target) {
                        LoginRateLimit.registerFailure();
                        this.showToast('ID ou senha incorretos', 'error');
                        return;
                    }

                    // v7.8: tres estados possiveis do documento, e o app escolhe
                    // sozinho — para a pessoa a tela e sempre a mesma.
                    //
                    //   a) ja tem conta no Auth  -> entra pelo Firebase;
                    //   b) senha temporaria do admin (reset) -> confere o hash
                    //      temporario e cria a conta versionada;
                    //   c) ainda no hash local  -> confere o hash e, dando certo,
                    //      cria a conta do Auth em silencio (migracao automatica).
                    let user = target.user;
                    const emReset = !!(user && user.authResetRequested === true && user.passwordHash);
                    const usaAuth = target.restricted || (!!user && !!user.authUid && !emReset);

                    if (usaAuth) {
                        const r = await this.signInExistingAuthAccount(loginId, password, target.version);
                        if (!r.ok) {
                            LoginRateLimit.registerFailure();
                            this.showToast('ID ou senha incorretos', 'error');
                            return;
                        }
                        // Agora somos o dono: o documento volta a ser legivel.
                        try {
                            const doc = await db.collection('users').doc(target.docId).get();
                            if (doc.exists) user = { ...doc.data(), docId: doc.id };
                        } catch (e) {
                            if (!user) user = { ...(this.users[target.docId] || {}), docId: target.docId };
                        }
                        // Sobrou hash de uma limpeza que nao completou? Sai agora.
                        if (user && user.passwordHash) {
                            db.collection('users').doc(target.docId).set({
                                passwordHash: firebase.firestore.FieldValue.delete(),
                                passwordSalt: firebase.firestore.FieldValue.delete(),
                                passwordAlgo: firebase.firestore.FieldValue.delete(),
                                passwordIter: firebase.firestore.FieldValue.delete()
                            }, { merge: true }).catch(() => {});
                        }
                    } else {
                        const ok = user && user.passwordHash && await PasswordSecurity.verify(user, password);
                        if (!ok) {
                            LoginRateLimit.registerFailure();
                            this.showToast('ID ou senha incorretos', 'error');
                            return;
                        }
                        if (user.blocked && !user.isAdmin) {
                            this.showToast('Usuário bloqueado', 'error');
                            return;
                        }
                        // A senha confere: a partir daqui o acesso esta garantido.
                        // A criacao da conta no Auth e um bonus — se falhar, o
                        // login segue pelo caminho antigo e tenta de novo depois.
                        try {
                            const mig = await this.attachFirebaseAuthAccount({
                                docId: target.docId,
                                loginId: loginId,
                                password: password,
                                version: target.version,
                                isReset: emReset,
                                oldCode: user.code || null
                            });
                            if (mig.ok) {
                                user = { ...(this.users[target.docId] || user), docId: target.docId };
                            } else {
                                console.warn('[seguranca] conta do Auth nao criada agora:', mig.code);
                            }
                        } catch (e) {
                            console.warn('[seguranca] migracao adiada:', e?.code || e?.message || e);
                        }
                    }

                    if (!user) {
                        LoginRateLimit.registerFailure();
                        this.showToast('ID ou senha incorretos', 'error');
                        return;
                    }
                    if (user.blocked && !user.isAdmin) {
                        this.showToast('Usuário bloqueado', 'error');
                        return;
                    }
                    if (!user.docId) user.docId = target.docId;
                    // Conta sem ponteiro (aprovada antes da v7.8): cria agora.
                    AuthIdentity.ensureLoginIndex(loginId, target.docId).catch(() => {});

                    LoginRateLimit.registerSuccess();
                    this.offerSaveLoginCredential(String(idInput?.value || '').trim() || loginId, password, user.name);
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

                    // ID precisa ser unico (le o ponteiro no servidor)
                    const existing = await withTimeout(this.findUserByLoginId(loginId), MIGRATION_TIMEOUT_MS, 'timeout-lookup');
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

                    // v7.8: a conta do Firebase Auth nasce AQUI, no mesmo passo —
                    // a pessoa acabou de digitar a senha, nao ha por que esperar
                    // o proximo login. O bloco acima ja gravou e conferiu o hash,
                    // entao se esta parte falhar (offline, e-mail em uso, o que
                    // for) ela sai daqui com ID + senha funcionando e a conta do
                    // Auth e criada sozinha no acesso seguinte.
                    const codigoAntigo = (this.users[docId] || {}).code || null;
                    try {
                        const mig = await withTimeout(this.attachFirebaseAuthAccount({
                            docId: docId,
                            loginId: loginId,
                            password: password,
                            version: 1,
                            oldCode: codigoAntigo
                        }), MIGRATION_TIMEOUT_MS, 'timeout-auth');
                        if (!mig.ok) console.warn('[seguranca] conta do Auth adiada:', mig.code);
                    } catch (e) {
                        console.warn('[seguranca] conta do Auth adiada:', e?.code || e?.message || e);
                    }
                    await AuthIdentity.ensureLoginIndex(loginId, docId);
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

                    // ============================================
                    // v7.8: RECUPERACAO DE SENHA POR CONTA VERSIONADA
                    //
                    // O Firebase nao deixa um cliente trocar a senha de outra
                    // pessoa — isso exigiria o Admin SDK, que roda em Cloud
                    // Function (pago). Entao o admin faz o que sempre fez: define
                    // uma senha temporaria. O documento recebe o hash dela,
                    // authResetRequested = true (que reabre o documento so para
                    // esta pessoa entrar) e a versao do e-mail sobe. No proximo
                    // login o app cria a conta nova (joao+v2@...), aponta o
                    // authUid para ela e fecha tudo de novo. A conta antiga fica
                    // orfa: nada aponta para ela, nao alcanca documento nenhum.
                    //
                    // O usuario nao perde NADA: o docId e o mesmo, users/{id}/data
                    // nao e tocado, e meta, VIP e nome ficam como estavam.
                    // ============================================
                    const versaoAtual = Number(user.authEmailVersion) || 1;
                    const novaVersao = user.authUid ? versaoAtual + 1 : versaoAtual;
                    const payload = {
                        passwordHash: cred.passwordHash,
                        passwordSalt: cred.passwordSalt,
                        passwordAlgo: cred.passwordAlgo,
                        passwordIter: cred.passwordIter,
                        authMigrated: true,
                        authResetRequested: true,
                        // A reabertura do documento tem prazo: se a pessoa nao
                        // entrar em 7 dias, ele volta a ficar fechado e o admin
                        // redefine de novo. Encurta a janela em que um estranho
                        // poderia reivindicar a conta.
                        authResetExpiresMs: Date.now() + 7 * 24 * 60 * 60 * 1000,
                        authEmailVersion: novaVersao,
                        passwordResetByAdminAt: new Date().toISOString()
                    };
                    await db.collection('users').doc(docId).set(payload, { merge: true });
                    // O ponteiro guarda a versao para que o login saiba qual
                    // e-mail usar antes mesmo de conseguir ler o documento.
                    if (user.loginId) {
                        const key = await AuthIdentity.loginIndexKey(user.loginId);
                        if (key) {
                            try { await db.collection('loginIndex').doc(key).set({ docId: docId, v: novaVersao }, { merge: true }); }
                            catch (e) { console.warn('[indice] versao nao gravada:', e?.code || e); }
                        }
                    }
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
                    if (next === current) { this.showToast('A nova senha deve ser diferente da atual', 'error'); return; }

                    // v7.8: conta ja no Firebase Auth — quem guarda a senha e o
                    // Firebase. Confere a atual reautenticando e troca por la.
                    if (this.hasAuthAccount(user)) {
                        const authUser = auth && auth.currentUser;
                        if (!authUser || authUser.isAnonymous || authUser.uid !== user.authUid) {
                            this.showToast('Entre de novo com seu ID e senha para trocar a senha.', 'error');
                            return;
                        }
                        const email = AuthIdentity.emailFor(user.loginId, user.authEmailVersion);
                        try {
                            const credential = firebase.auth.EmailAuthProvider.credential(email, current);
                            await authUser.reauthenticateWithCredential(credential);
                        } catch (e) {
                            this.showToast('Senha atual incorreta', 'error');
                            return;
                        }
                        await authUser.updatePassword(next);
                        const marca = { passwordChangedAt: new Date().toISOString() };
                        try { await db.collection('users').doc(docId).set(marca, { merge: true }); } catch (e) {}
                        this.users[docId] = { ...(this.users[docId] || {}), ...marca };
                        this.saveUsersToCache();
                        this.closeModal('changePasswordModal');
                        this.showToast('Senha alterada com sucesso!', 'success');
                        return;
                    }

                    // Conta ainda no hash local (nao migrou): caminho antigo.
                    const ok = await PasswordSecurity.verify(user, current);
                    if (!ok) { this.showToast('Senha atual incorreta', 'error'); return; }
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
