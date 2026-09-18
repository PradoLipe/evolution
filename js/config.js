    // ============================================
    // EVOLUTION V5.52 - CODIGO COMPLETO E FUNCIONAL
    // ============================================

        // Versao do App
    window.EVOLUTION_APP_VERSION = 'V7.5';

// Configuracao Firebase
    const firebaseConfig = {
        apiKey: "AIzaSyBEIQTvTguTmvq_I3DdyO0XsWGu5lYb6gw",
        authDomain: "evolution-v50-final.firebaseapp.com",
        projectId: "evolution-v50-final",
        storageBucket: "evolution-v50-final.firebasestorage.app",
        messagingSenderId: "657178030818",
        appId: "1:657178030818:web:06cbbb4949c761f91a64bb"
    };

    // Variaveis globais
    let db = null, auth = null, storage = null;
    let REMOTE_ADMIN_PIN = null;

    // Taxas padrao
    const DEFAULT_TAXAS = {
        '07x15': { normal: 5.73, feriado: 8.61 },
        '15x23': { normal: { p1: 5.73, p2: 6.88 }, feriado: { p1: 8.61, p2: 10.32 } },
        '23x07': { normal: 6.88, feriado: 10.32 },
        '07x19': { normal: 5.73, feriado: 8.61 },
        '19x07': { normal: 6.88, feriado: 10.32 }
    };

    // O BrIta inicia visivel para comunicar a implantacao, mas bloqueado ate
    // que o administrador confirme os valores e libere a operacao.
    const DEFAULT_TAXAS_BRITA = {
        '07x15': { normal: 0, feriado: 0 },
        '15x23': { normal: { p1: 0, p2: 0 }, feriado: { p1: 0, p2: 0 } },
        '23x07': { normal: 0, feriado: 0 },
        '07x19': { normal: 0, feriado: 0 },
        '19x07': { normal: 0, feriado: 0 }
    };

    // Mantem as taxas salvas em versoes anteriores compativeis com novos turnos.
    // Sem essa mesclagem, documentos antigos no Firebase nao teriam 07x19/19x07.
    function mergeRatesWithDefaults(defaults, savedRates) {
        const saved = (savedRates && typeof savedRates === 'object') ? savedRates : {};
        return {
            '07x15': { ...defaults['07x15'], ...(saved['07x15'] || {}) },
            '15x23': {
                normal: { ...defaults['15x23'].normal, ...(saved['15x23']?.normal || {}) },
                feriado: { ...defaults['15x23'].feriado, ...(saved['15x23']?.feriado || {}) }
            },
            '23x07': { ...defaults['23x07'], ...(saved['23x07'] || {}) },
            '07x19': { ...defaults['07x19'], ...(saved['07x19'] || {}) },
            '19x07': { ...defaults['19x07'], ...(saved['19x07'] || {}) }
        };
    }
    const DEFAULT_PORT_SETTINGS = {
        britaVisible: true,
        britaEnabled: false
    };

    // Mensagens de meta
    const GOAL_MESSAGES = [
        { title: "META ATINGIDA! 🎯", message: "Voce e imparavel! Sua dedicacao e inspiradora." },
        { title: "PARABENS! 🚀", message: "Voce provou que pode conquistar tudo o que deseja!" },
        { title: "VITORIA! 🏆", message: "Seu esforco foi recompensado. Continue brilhando!" },
        { title: "INCRiVEL! 💪", message: "Voce transformou sonhos em realidade. Parabens!" },
        { title: "CONQUISTA! ⭐", message: "Sua persistencia e o segredo do seu sucesso!" },
        { title: "EXCEPCIONAL! 🌟", message: "Voce superou todas as expectativas!" },
        { title: "SUCESSO! 💎", message: "Cada esforco valeu a pena. Voce conseguiu!" },
        { title: "FANTASTICO! 🔥", message: "Sua determinacao e um exemplo para todos!" }
    ];

    const DONATION_MESSAGES = [
        "Sua contribuicao garante servidores mais rapidos e estaveis.",
        "Ajude a manter o Evolution livre de anuncios intrusivos.",
        "O desenvolvimento continuo de novas funcoes depende do seu apoio.",
        "Garanta a manutencao mensal do sistema que organiza seu trabalho.",
        "Apoie quem trabalha para facilitar a sua produtividade diaria."
    ];

    // Safe Storage — captura erros de cota e avisa o usuario
    const safeStorage = {
        _quotaWarned: false,
        getItem: (k) => { try { return localStorage.getItem(k); } catch(e) { return null; } },
        setItem: (k, v) => {
            try {
                localStorage.setItem(k, v);
            } catch(e) {
                if (!safeStorage._quotaWarned && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
                    safeStorage._quotaWarned = true;
                    setTimeout(() => {
                        const t = document.getElementById('toastContainer');
                        if (t) {
                            const d = document.createElement('div');
                            d.className = 'toast';
                            d.style.borderLeft = '3px solid var(--warning)';
                            d.innerHTML = '<span style="color:var(--warning);font-weight:800;">⚠</span> Armazenamento local cheio. Exporte um backup.';
                            t.appendChild(d);
                            setTimeout(() => d.remove(), 5000);
                        }
                    }, 500);
                }
            }
        },
        removeItem: (k) => { try { localStorage.removeItem(k); } catch(e) {} }
    };

    // ============================================
    // SEGURANCA (ATT SEGURANCA): hash de PIN (SHA-256) + limite de tentativas
    // Nao altera logins existentes: PINs antigos em texto puro continuam
    // funcionando e sao migrados para hash automaticamente no proximo login
    // com sucesso (auth.js). Ver README-SEGURANCA.md para detalhes.
    // ============================================
    const PinSecurity = {
        _salt: 'EVOLUTION_PIN_SALT_v1',
        async hash(pin) {
            try {
                if (!window.crypto || !window.crypto.subtle) return null;
                const data = new TextEncoder().encode(this._salt + ':' + String(pin));
                const digest = await window.crypto.subtle.digest('SHA-256', data);
                return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
            } catch (e) {
                return null;
            }
        },
        isHashed(value) {
            return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
        },
        async matches(storedValue, enteredPin, precomputedHash) {
            if (storedValue == null || enteredPin == null) return false;
            if (this.isHashed(storedValue)) {
                const h = precomputedHash !== undefined ? precomputedHash : await this.hash(enteredPin);
                return !!h && storedValue === h;
            }
            return String(storedValue) === String(enteredPin);
        }
    };
    window.PinSecurity = PinSecurity;

    const LoginRateLimit = {
        _key: 'evo_login_attempts_v1',
        _maxAttempts: 5,
        _baseLockMs: 15000,
        _maxLockMs: 5 * 60 * 1000,
        _read() {
            try { return JSON.parse(localStorage.getItem(this._key)) || { fails: 0, lockUntil: 0, lockLevel: 0 }; }
            catch (e) { return { fails: 0, lockUntil: 0, lockLevel: 0 }; }
        },
        _write(state) {
            try { localStorage.setItem(this._key, JSON.stringify(state)); } catch (e) {}
        },
        checkLocked() {
            const s = this._read();
            const remaining = s.lockUntil - Date.now();
            return remaining > 0 ? remaining : null;
        },
        registerFailure() {
            const s = this._read();
            s.fails = (s.fails || 0) + 1;
            if (s.fails >= this._maxAttempts) {
                s.lockLevel = (s.lockLevel || 0) + 1;
                const lockMs = Math.min(this._baseLockMs * Math.pow(2, s.lockLevel - 1), this._maxLockMs);
                s.lockUntil = Date.now() + lockMs;
                s.fails = 0;
            }
            this._write(s);
        },
        registerSuccess() {
            this._write({ fails: 0, lockUntil: 0, lockLevel: 0 });
        }
    };
    window.LoginRateLimit = LoginRateLimit;

    // ============================================
    // SEGURANCA v7.2: senha de acesso (ID + senha) com PBKDF2-SHA256
    // Sal aleatorio por usuario + 120.000 iteracoes. A senha nunca e gravada
    // em texto puro, nem em logs, URL, localStorage ou sessionStorage.
    // Ver auth-credentials.js (migracao PIN -> ID + senha) e README-SEGURANCA.md.
    // ============================================
    const PasswordSecurity = {
        _iterations: 120000,
        _algo: 'PBKDF2-SHA256',
        available() {
            return !!(window.crypto && window.crypto.subtle && window.crypto.getRandomValues && window.TextEncoder);
        },
        _toHex(buf) {
            return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
        },
        _fromHex(hex) {
            const clean = String(hex || '');
            const out = new Uint8Array(clean.length / 2);
            for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
            return out;
        },
        randomSalt() {
            const b = new Uint8Array(16);
            window.crypto.getRandomValues(b);
            return this._toHex(b);
        },
        async derive(password, saltHex, iterations) {
            const key = await window.crypto.subtle.importKey(
                'raw', new TextEncoder().encode(String(password)), 'PBKDF2', false, ['deriveBits']
            );
            const bits = await window.crypto.subtle.deriveBits(
                { name: 'PBKDF2', hash: 'SHA-256', salt: this._fromHex(saltHex), iterations: iterations },
                key, 256
            );
            return this._toHex(bits);
        },
        async create(password) {
            const passwordSalt = this.randomSalt();
            const passwordHash = await this.derive(password, passwordSalt, this._iterations);
            return { passwordHash, passwordSalt, passwordAlgo: this._algo, passwordIter: this._iterations };
        },
        async verify(user, password) {
            try {
                if (!user || !user.passwordHash || !user.passwordSalt || typeof password !== 'string') return false;
                if (user.passwordAlgo && user.passwordAlgo !== this._algo) return false;
                const iter = Number(user.passwordIter) || this._iterations;
                const h = await this.derive(password, user.passwordSalt, iter);
                if (h.length !== String(user.passwordHash).length) return false;
                let diff = 0;
                for (let i = 0; i < h.length; i++) diff |= h.charCodeAt(i) ^ String(user.passwordHash).charCodeAt(i);
                return diff === 0;
            } catch (e) {
                return false;
            }
        },
        normalizeLoginId(value) {
            return String(value || '').trim().toLowerCase();
        },
        isValidLoginId(value) {
            return /^[a-z0-9][a-z0-9._-]{3,19}$/.test(String(value || ''));
        },
        isValidPassword(value) {
            return typeof value === 'string' && value.length >= 6 && value.length <= 64;
        }
    };
    window.PasswordSecurity = PasswordSecurity;

    // FIX 24: Helpers de sessao — mascara o PIN antes de salvar no localStorage
    // Nao e criptografia real, mas impede leitura trivial do PIN no DevTools
    function encodeSession(obj) {
        try {
            const json = JSON.stringify(obj);
            // XOR simples com chave fixa para ofuscar o conteudo
            const key = 'EVOLUTIONv532';
            let out = '';
            for (let i = 0; i < json.length; i++) {
                out += String.fromCharCode(json.charCodeAt(i) ^ key.charCodeAt(i % key.length));
            }
            return btoa(out);
        } catch(e) {
            // FIX 16: o fallback tambem pode estourar (nome com emoji ou caractere
            // fora de Latin-1 quebra o btoa). Antes a excecao subia e derrubava o
            // login inteiro. Agora devolve string vazia: a sessao nao e lembrada,
            // mas o login funciona normalmente.
            try { return btoa(JSON.stringify(obj)); } catch(_) { return ''; }
        }
    }
    function decodeSession(str) {
        try {
            const raw = atob(str);
            const key = 'EVOLUTIONv532';
            let out = '';
            for (let i = 0; i < raw.length; i++) {
                out += String.fromCharCode(raw.charCodeAt(i) ^ key.charCodeAt(i % key.length));
            }
            return JSON.parse(out);
        } catch(e) {
            // Fallback: tenta decodificar como base64 puro (sessoes antigas)
            try { return JSON.parse(atob(str)); } catch(_) { return null; }
        }
    }
    function getManausDate() {
        const now = new Date();
        const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
        return new Date(utc + (-4 * 60 * 60000));
    }

    function formatDateManaus(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    function getCurrentDateStringManaus() {
        return formatDateManaus(getManausDate());
    }

    function getCurrentMonthStringManaus() {
        const d = getManausDate();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
