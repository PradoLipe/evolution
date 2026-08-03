    // ============================================
    // EVOLUTION V5.52 - CODIGO COMPLETO E FUNCIONAL
    // ============================================

        // Versao do App
    window.EVOLUTION_APP_VERSION = 'V5.54';

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
    const LEGACY_ADMIN_ID = "002451-FELIPE_PRADO";

    // Taxas padrao
    const DEFAULT_TAXAS = {
        '07x15': { normal: 5.73, feriado: 8.61 },
        '15x23': { normal: { p1: 5.73, p2: 6.88 }, feriado: { p1: 8.61, p2: 10.32 } },
        '23x07': { normal: 6.88, feriado: 10.32 }
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
        } catch(e) { return btoa(JSON.stringify(obj)); }
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
