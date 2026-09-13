// Navigation and accessible disclosure behavior for the responsive workspace.
(() => {
    const motion = () => matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
    const setActiveNavigation = id => {
        document.querySelectorAll('[data-workspace-target]').forEach(button => {
            const active = button.dataset.workspaceTarget === id;
            button.classList.toggle('active', active);
            if (active) button.setAttribute('aria-current', 'location');
            else button.removeAttribute('aria-current');
        });
        const heading = document.querySelector('.header-location strong');
        const label = document.querySelector(`.sidebar-nav [data-workspace-target="${id}"] > span:not(.ui-icon)`);
        if (heading && label) heading.textContent = label.textContent;
    };
    const syncSection = section => {
        const header = section.querySelector('.section-header');
        const content = section.querySelector('.section-content');
        const open = section.classList.contains('expanded');
        header?.setAttribute('aria-expanded', String(open));
        // Keep collapsed fields out of the tab order, including after save flows.
        if (content) content.inert = !open;
    };
    EvolutionApp.prototype.navigateWorkspace = function(id) {
        const target = document.getElementById(id === 'overview' ? 'mainApp' : id);
        if (!target) return;
        // A navegação pelos atalhos (inclusive a barra inferior no celular) usa
        // uma única seção ativa: ao trocar de destino, recolhe a anterior antes
        // de abrir a nova, evitando que o usuário chegue a um painel diferente
        // ainda expandido.
        document.querySelectorAll('#mainApp .section.expanded').forEach(section => {
            if (section !== target) {
                section.classList.remove('expanded');
                syncSection(section);
            }
        });
        if (id !== 'overview') {
            target.classList.add('expanded');
            syncSection(target);
            if (id === 'secNew') this.suggestDefaultTurno();
            if (id === 'secChart') this.renderChart();
        }
        setActiveNavigation(id);
        const focusTarget = id === 'overview' ? target.querySelector('h1') : target.querySelector('.section-header');
        if (focusTarget) { focusTarget.tabIndex = 0; focusTarget.focus({ preventScroll: true }); }
        requestAnimationFrame(() => target.scrollIntoView({ behavior: motion(), block: 'start' }));
    };
    // Independent panels keep the form, calendar and history available side by side.
    EvolutionApp.prototype.toggleSection = function(id) {
        const section = document.getElementById(id);
        if (!section) return;
        section.classList.toggle('expanded');
        syncSection(section);
        if (!section.classList.contains('expanded') && document.querySelector(`.workspace-nav.active[data-workspace-target="${id}"]`)) setActiveNavigation('overview');
        if (id === 'secChart' && section.classList.contains('expanded')) this.renderChart();
    };
    document.addEventListener('DOMContentLoaded', () => {
        // Keep the workspace in the requested task order on desktop and mobile.
        // Moving existing nodes preserves all their event handlers and input values.
        const production = document.querySelector('.production-column');
        const insights = document.querySelector('.insights-column');
        const calendar = document.getElementById('secCal');
        const report = document.getElementById('secRel');
        const simulator = document.getElementById('secSim');
        const performance = document.getElementById('secChart');
        if (production && insights && calendar && report && simulator && performance) {
            production.insertBefore(calendar, simulator);
            production.insertBefore(report, simulator);
            insights.insertBefore(simulator, performance);
        }

        // Dates and suggested shifts are initialized without opening any panel.
        const initializeVisibleWorkspace = () => {
            if (document.getElementById('mainApp')?.classList.contains('hidden')) return;
            window.app?.adjustCalcTipoForDate();
            window.app?.suggestDefaultTurno();
            window.app?.renderChart();
        };
        initializeVisibleWorkspace();
        const main = document.getElementById('mainApp');
        if (main) new MutationObserver(initializeVisibleWorkspace).observe(main, {attributes:true, attributeFilter:['class']});
        document.querySelectorAll('[data-workspace-target]').forEach(button => {
            button.addEventListener('click', event => {
                event.preventDefault();
                window.app?.navigateWorkspace(button.dataset.workspaceTarget);
            });
        });
        document.querySelectorAll('#mainApp .section').forEach(section => {
            const header = section.querySelector('.section-header');
            const content = section.querySelector('.section-content');
            if (!header || !content) return;
            content.id = `${section.id}-content`;
            header.setAttribute('role', 'button');
            header.tabIndex = 0;
            header.setAttribute('aria-controls', content.id);
            header.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); header.click(); }
            });
            syncSection(section);
            new MutationObserver(records => {
                syncSection(section);
                // Saving and the pending summary can open history without a nav click.
                if (section.classList.contains('expanded') && records.some(record => !(record.oldValue || '').split(/\s+/).includes('expanded'))) setActiveNavigation(section.id);
            }).observe(section, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
        });
    });
})();
