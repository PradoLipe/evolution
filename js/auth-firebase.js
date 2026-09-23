        // ============================================
        // SEGURANCA v7.8: CADA USUARIO GANHA UMA CONTA REAL NO FIREBASE AUTH
        //
        // Por que: ate a v7.7 a colecao "users" era legivel por qualquer visitante
        // anonimo (nome, loginId e hash de senha de todo mundo), e um usuario
        // logado conseguia sobrescrever o passwordHash de outro. O servidor nao
        // tinha como distinguir uma pessoa da outra: todas eram a mesma sessao
        // anonima.
        //
        // Como: no proximo login normal, a pessoa passa a ter uma conta de
        // verdade (<loginId>@evolutionapp.local) com a MESMA senha que acabou de
        // digitar. O documento dela ganha "authUid" e a regra do Firestore fecha
        // aquele documento para o resto do mundo. Sem modal, sem aviso, sem dia
        // da virada: cada um fecha o proprio cadeado ao entrar.
        //
        // Nada e apagado antes de o servidor confirmar a gravacao (mesma receita
        // das v7.2 e v7.6). Se qualquer passo falhar, o acesso antigo continua
        // valendo e a migracao tenta de novo no proximo login.
        //
        // Continua tudo no plano gratuito: sem Cloud Functions, sem billing.
        // ============================================
        (function () {
            const AUTH_DOMAIN = 'evolutionapp.local';

            function fieldDelete() {
                try { return firebase.firestore.FieldValue.delete(); } catch (e) { return null; }
            }

            async function sha256Hex(text) {
                if (!window.crypto || !window.crypto.subtle) return null;
                const data = new TextEncoder().encode(String(text));
                const digest = await window.crypto.subtle.digest('SHA-256', data);
                return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
            }

            // ============================================
            // INDICES DE LOGIN
            //
            // O Firestore so aceita uma consulta quando a regra garante que TODOS
            // os resultados possiveis sao permitidos — ele nao filtra documento a
            // documento, recusa a consulta inteira. Entao, assim que o primeiro
            // documento fecha, "where('loginId','==',x)" e "where('code','==',x)"
            // param de funcionar para todo mundo.
            //
            // Solucao: duas colecoes de ponteiro, lidas DIRETO pelo id do
            // documento. Sem consulta, sem problema — e mais rapido e barato.
            //
            //   loginIndex/{sha256 do loginId}  -> { docId, v }
            //   pinIndex/{hash do PIN}          -> { docId }
            //
            // Nenhuma das duas guarda nome, senha ou qualquer dado pessoal, e a
            // chave ser um hash impede que sirvam de lista legivel de apelidos.
            //
            // O pinIndex e uma PONTE, nao estrutura permanente: a entrada e
            // apagada no momento em que a pessoa migra para ID + senha, entao a
            // colecao se esvazia sozinha ate nao sobrar nada. Ele tambem nao
            // expoe nada novo — a chave e o mesmo hash que ja esta no campo
            // "code" do documento, que continua aberto justamente para quem
            // ainda nao migrou.
            // ============================================
            const AuthIdentity = {
                DOMAIN: AUTH_DOMAIN,

                normalizeLoginId(value) {
                    return PasswordSecurity.normalizeLoginId(value);
                },

                // Chave do loginIndex: hash do ID normalizado.
                async loginIndexKey(loginId) {
                    const id = this.normalizeLoginId(loginId);
                    if (!id) return null;
                    return sha256Hex('loginIndex:v1:' + id);
                },

                // Chave do pinIndex: o MESMO hash que o app ja grava em "code"
                // (PinSecurity), para que o admin consiga gerar as entradas dos
                // usuarios antigos sem conhecer o PIN em texto puro.
                async pinIndexKeyFromPin(pin) {
                    if (pin == null || pin === '') return null;
                    return PinSecurity.hash(pin);
                },

                async pinIndexKeyFromStoredCode(code) {
                    if (!code) return null;
                    if (PinSecurity.isHashed(code)) return String(code);
                    return PinSecurity.hash(code);
                },

                // E-mail da conta do Firebase Auth. Versao 1 (ou ausente) nao tem
                // sufixo; a partir do reset de senha entra "+v2", "+v3"...
                emailFor(loginId, version) {
                    const id = this.normalizeLoginId(loginId);
                    const v = Number(version) || 1;
                    return v > 1 ? `${id}+v${v}@${AUTH_DOMAIN}` : `${id}@${AUTH_DOMAIN}`;
                },

                // Le o ponteiro do ID. Devolve { docId, v } ou null.
                async readLoginIndex(loginId) {
                    if (!db) return null;
                    const key = await this.loginIndexKey(loginId);
                    if (!key) return null;
                    try {
                        const snap = await db.collection('loginIndex').doc(key).get();
                        if (!snap.exists) return null;
                        const d = snap.data() || {};
                        return d.docId ? { key, docId: String(d.docId), v: Number(d.v) || 1 } : null;
                    } catch (e) {
                        return null;
                    }
                },

                async readPinIndex(pin) {
                    if (!db) return null;
                    const key = await this.pinIndexKeyFromPin(pin);
                    if (!key) return null;
                    try {
                        const snap = await db.collection('pinIndex').doc(key).get();
                        if (!snap.exists) return null;
                        const d = snap.data() || {};
                        return d.docId ? { key, docId: String(d.docId) } : null;
                    } catch (e) {
                        return null;
                    }
                },

                // Cria o ponteiro do ID. A regra so permite "create": quem tentar
                // repontar a entrada de outra pessoa e recusado pelo servidor.
                // Um erro aqui nunca derruba o login — o ponteiro e tentado de
                // novo no acesso seguinte.
                async ensureLoginIndex(loginId, docId) {
                    if (!db || !docId) return false;
                    const key = await this.loginIndexKey(loginId);
                    if (!key) return false;
                    try {
                        const ref = db.collection('loginIndex').doc(key);
                        const snap = await ref.get();
                        if (snap.exists) return String((snap.data() || {}).docId) === String(docId);
                        await ref.set({ docId: String(docId) });
                        return true;
                    } catch (e) {
                        console.warn('[indice] loginIndex nao gravado:', e?.code || e?.message || e);
                        return false;
                    }
                },

                async ensurePinIndex(pin, docId) {
                    return this._writePinIndex(await this.pinIndexKeyFromPin(pin), docId);
                },

                // Usada pelo admin: parte do campo "code" do documento, que pode
                // estar em texto puro (legado) ou ja em hash.
                async ensurePinIndexForStoredCode(code, docId) {
                    return this._writePinIndex(await this.pinIndexKeyFromStoredCode(code), docId);
                },

                async _writePinIndex(key, docId) {
                    if (!db || !docId) return false;
                    try {
                        const ref = db.collection('pinIndex').doc(key);
                        const snap = await ref.get();
                        if (snap.exists) return String((snap.data() || {}).docId) === String(docId);
                        await ref.set({ docId: String(docId) });
                        return true;
                    } catch (e) {
                        return false;
                    }
                },

                // A ponte do PIN some junto com a migracao da pessoa.
                async dropPinIndexForCode(code) {
                    if (!db || !code) return;
                    const key = await this.pinIndexKeyFromStoredCode(code);
                    if (!key) return;
                    try { await db.collection('pinIndex').doc(key).delete(); } catch (e) {}
                }
            };
            window.AuthIdentity = AuthIdentity;

            // ============================================
            // CONTAS DO FIREBASE AUTH
            // ============================================
            const FirebaseAccounts = {
                available() {
                    return !!(auth && typeof auth.createUserWithEmailAndPassword === 'function');
                },

                // Entra na conta; cria se ainda nao existir. Uma tentativa anterior
                // que morreu no meio deixa a conta criada — por isso o
                // "email-already-in-use" cai no login em vez de virar erro.
                async signInOrCreate(email, password) {
                    if (!this.available()) return { ok: false, code: 'auth-indisponivel' };
                    try {
                        const cred = await auth.createUserWithEmailAndPassword(email, password);
                        return { ok: true, uid: cred?.user?.uid || auth.currentUser?.uid, created: true };
                    } catch (e) {
                        const code = e?.code || '';
                        if (code === 'auth/email-already-in-use') {
                            try {
                                const cred = await auth.signInWithEmailAndPassword(email, password);
                                return { ok: true, uid: cred?.user?.uid || auth.currentUser?.uid, created: false };
                            } catch (e2) {
                                return { ok: false, code: e2?.code || 'auth-failed' };
                            }
                        }
                        return { ok: false, code: code || 'auth-failed' };
                    }
                },

                async signIn(email, password) {
                    if (!auth || typeof auth.signInWithEmailAndPassword !== 'function') return { ok: false, code: 'auth-indisponivel' };
                    try {
                        const cred = await auth.signInWithEmailAndPassword(email, password);
                        return { ok: true, uid: cred?.user?.uid || auth.currentUser?.uid };
                    } catch (e) {
                        return { ok: false, code: e?.code || 'auth-failed' };
                    }
                }
            };
            window.FirebaseAccounts = FirebaseAccounts;

            // ============================================
            // MIGRACAO DE UM DOCUMENTO PARA A CONTA DO AUTH
            //
            // A ordem importa e e a mesma das v7.2/v7.6:
            //   1) cria (ou entra n)a conta do Auth;
            //   2) grava o authUid — sem apagar nada ainda;
            //   3) confirma lendo DO SERVIDOR;
            //   4) so entao remove o hash da senha antiga.
            // Qualquer falha antes do passo 4 deixa tudo como estava: o hash
            // continua no lugar e o login antigo continua funcionando.
            // ============================================
            EvolutionApp.prototype.attachFirebaseAuthAccount = async function (opts) {
                const docId = opts.docId;
                const loginId = AuthIdentity.normalizeLoginId(opts.loginId);
                const password = opts.password;
                const version = Number(opts.version) || 1;
                const isReset = !!opts.isReset;
                const oldCode = opts.oldCode || null;

                if (!db || !docId || !loginId || !password) return { ok: false, code: 'dados-insuficientes' };
                if (!FirebaseAccounts.available()) return { ok: false, code: 'auth-indisponivel' };

                const email = AuthIdentity.emailFor(loginId, version);
                const account = await FirebaseAccounts.signInOrCreate(email, password);
                if (!account.ok) return { ok: false, code: account.code };
                const uid = account.uid;
                if (!uid) return { ok: false, code: 'sem-uid' };

                const ref = db.collection('users').doc(docId);

                // 2) marca o dono. Nada e removido nesta gravacao.
                const claim = {
                    authUid: uid,
                    authClaimedAt: new Date().toISOString(),
                    authClaimedDevice: this.deviceId || null
                };
                await ref.set(claim, { merge: true });

                // 3) confirma direto do servidor antes de apagar qualquer coisa
                const snap = await ref.get({ source: 'server' });
                const saved = snap.exists ? snap.data() : null;
                if (!saved || saved.authUid !== uid) return { ok: false, code: 'verify-failed' };

                // 4) agora sim, o hash antigo pode sair
                const cleanup = {
                    passwordHash: fieldDelete(),
                    passwordSalt: fieldDelete(),
                    passwordAlgo: fieldDelete(),
                    passwordIter: fieldDelete(),
                    authMigrated: true,
                    authAccountAt: new Date().toISOString()
                };
                if (isReset) cleanup.authResetRequested = false;
                try {
                    await ref.set(cleanup, { merge: true });
                } catch (e) {
                    // O cadeado ja fechou (authUid gravado e confirmado). Se a
                    // limpeza falhar, ela e refeita no proximo login — e o hash
                    // sozinho nao abre mais nada, porque a regra ja exige o dono.
                    console.warn('[seguranca] limpeza do hash adiada:', e?.code || e?.message || e);
                }

                // Ponteiros: cria o do ID e derruba a ponte do PIN.
                await AuthIdentity.ensureLoginIndex(loginId, docId);
                if (oldCode) await AuthIdentity.dropPinIndexForCode(oldCode);

                const local = { ...(this.users[docId] || {}), ...claim, authMigrated: true, docId };
                delete local.passwordHash;
                delete local.passwordSalt;
                delete local.passwordAlgo;
                delete local.passwordIter;
                if (isReset) local.authResetRequested = false;
                this.users[docId] = local;
                this.saveUsersToCache();

                return { ok: true, uid, email };
            };

            // Documento com conta do Auth: o login e o proprio Firebase.
            EvolutionApp.prototype.signInExistingAuthAccount = async function (loginId, password, version) {
                const email = AuthIdentity.emailFor(loginId, version);
                return FirebaseAccounts.signIn(email, password);
            };
        })();
