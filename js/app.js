/**
 * App.js - Thermatras v4.0
 * Complete workflow: Installatie → Ruimte Scan → AI Detectie → Isolatie → Geneste Uitslag
 * Nieuw: Nesting, workflow progress, ML confidence, auto-advance, plaatselector
 */
(function () {
    'use strict';

    // ========== STATE ==========
    const state = {
        installation: new InstallationBuilder(),
        selectedType: null,
        installBuilder: null,
        scanBuilder: null,
        configBuilder: null,
        uitslag: null,
        scanned: false,
        insulated: false,
        uitslagGenerated: false,
        scanTimer: null,
        scanPhase: null,
        detectedComponents: []
    };

    // ========== INIT ==========
    document.addEventListener('DOMContentLoaded', () => {
        initTabs();
        initComponentLibrary();
        initPresets();
        initInstallationControls();
        initScannerControls();
        initConfiguratorControls();
        initUitslagControls();
        initScreenshotButtons();
        initDimensionToggles();
    });

    // ========== TAB NAVIGATION ==========
    function initTabs() {
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                switchToTab(btn.dataset.tab);
            });
        });
    }

    function switchToTab(tab) {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        const btn = document.querySelector(`.nav-btn[data-tab="${tab}"]`);
        if (btn) btn.classList.add('active');
        document.getElementById('tab-' + tab).classList.add('active');

        requestAnimationFrame(() => {
            if (tab === 'installatie') initInstallViewport();
            if (tab === 'scanner') initScanViewport();
            if (tab === 'configurator') initConfigViewport();
            if (tab === 'uitslag') initUitslagCanvas();
        });
    }

    function updateWorkflowProgress() {
        const steps = document.querySelectorAll('.wf-step');
        const comps = state.installation.getComponents().length > 0;
        steps.forEach(s => {
            s.classList.remove('completed', 'active');
            const step = s.dataset.step;
            if (step === 'installatie' && comps) s.classList.add('completed');
            if (step === 'scanner' && state.scanned) s.classList.add('completed');
            else if (step === 'scanner' && comps) s.classList.add('active');
            if (step === 'configurator' && state.insulated) s.classList.add('completed');
            else if (step === 'configurator' && state.scanned) s.classList.add('active');
            if (step === 'uitslag' && state.uitslagGenerated) s.classList.add('completed');
            else if (step === 'uitslag' && state.insulated) s.classList.add('active');
        });
    }

    // ========== COMPONENT LIBRARY ==========
    function initComponentLibrary() {
        document.querySelectorAll('.comp-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.comp-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                state.selectedType = btn.dataset.type;
                document.getElementById('btn-add-component').disabled = false;
                updateFormFields(state.selectedType);
            });
        });
    }

    function updateFormFields(type) {
        document.querySelectorAll('.elbow-opt').forEach(el => el.style.display = type === 'elbow' ? '' : 'none');
        document.querySelectorAll('.reducer-opt').forEach(el => el.style.display = type === 'reducer' ? '' : 'none');
        document.querySelectorAll('.valve-opt').forEach(el => el.style.display = type === 'valve' ? '' : 'none');
    }

    // ========== PRESETS ==========
    function initPresets() {
        const container = document.getElementById('preset-list');
        const presets = InstallationBuilder.getPresets();
        container.innerHTML = '';
        for (const [key, preset] of Object.entries(presets)) {
            const btn = document.createElement('button');
            btn.className = 'preset-btn';
            btn.innerHTML = `<span class="preset-name">${preset.name}</span><span class="preset-desc">${preset.description}</span>`;
            btn.addEventListener('click', () => loadPreset(key));
            container.appendChild(btn);
        }
    }

    function loadPreset(presetKey) {
        const presets = InstallationBuilder.getPresets();
        const preset = presets[presetKey];
        if (!preset) return;

        state.installation.reset();
        state.scanned = false;
        state.insulated = false;
        resetScanUI();

        for (const compDef of preset.components) {
            state.installation.addComponent({ ...compDef });
        }

        updateBOM();
        rebuildInstallView();
        updateOverlays();
    }

    // ========== INSTALLATION CONTROLS ==========
    function initInstallationControls() {
        document.getElementById('btn-add-component').addEventListener('click', addComponent);
        document.getElementById('btn-clear-all').addEventListener('click', clearInstallation);
        document.getElementById('btn-to-scanner').addEventListener('click', () => {
            document.querySelector('.nav-btn[data-tab="scanner"]').click();
        });
    }

    function addComponent() {
        if (!state.selectedType) return;
        const params = {
            type: state.selectedType,
            diameter: getNum('comp-diameter'),
            wallThickness: getNum('comp-wall'),
            length: getNum('comp-length')
        };
        if (state.selectedType === 'elbow') {
            params.bendAngle = getNum('comp-bend-angle');
            params.bendRadius = getNum('comp-bend-radius');
            params.bendPlane = document.getElementById('comp-bend-plane').value;
        }
        if (state.selectedType === 'reducer') {
            params.endDiameter = getNum('comp-end-diameter');
        }
        if (state.selectedType === 'valve') {
            params.valveType = document.getElementById('comp-valve-type').value;
            params.valveLength = getNum('comp-valve-length');
        }
        if (state.selectedType === 'flange') {
            params.flangeWidth = 30;
        }

        state.installation.addComponent(params);
        state.scanned = false;
        state.insulated = false;
        resetScanUI();

        updateBOM();
        rebuildInstallView();
        updateOverlays();
    }

    function clearInstallation() {
        state.installation.reset();
        state.scanned = false;
        state.insulated = false;
        resetScanUI();
        updateBOM();
        if (state.installBuilder) state.installBuilder.clearAll();
        if (state.scanBuilder) state.scanBuilder.clearAll();
        updateOverlays();
    }

    // ========== BOM ==========
    function updateBOM() {
        const bom = state.installation.getBOM();
        const container = document.getElementById('bom-list');
        const count = document.getElementById('component-count');
        count.textContent = `${bom.length} componenten`;

        if (bom.length === 0) {
            container.innerHTML = '<p class="placeholder-text">Nog geen componenten toegevoegd.</p>';
            document.getElementById('btn-to-scanner').disabled = true;
            return;
        }
        document.getElementById('btn-to-scanner').disabled = false;

        container.innerHTML = '';
        for (const item of bom) {
            const div = document.createElement('div');
            div.className = 'bom-item';
            div.innerHTML = `
                <span class="bom-id">${item.id}</span>
                <div class="bom-info">
                    <span class="bom-type">${item.type}</span>
                    <span class="bom-details">${item.details}</span>
                </div>
                <button class="bom-remove" data-id="${item.id}" title="Verwijderen">✕</button>
            `;
            div.addEventListener('mouseenter', () => {
                if (state.installBuilder) state.installBuilder.highlightComponent(item.id);
                div.classList.add('highlighted');
            });
            div.addEventListener('mouseleave', () => {
                if (state.installBuilder) state.installBuilder.highlightComponent(null);
                div.classList.remove('highlighted');
            });
            div.querySelector('.bom-remove').addEventListener('click', (e) => {
                e.stopPropagation();
                state.installation.removeComponent(item.id);
                state.scanned = false;
                state.insulated = false;
                resetScanUI();
                updateBOM();
                rebuildInstallView();
                updateOverlays();
            });
            container.appendChild(div);
        }
    }

    // ========== OVERLAYS ==========
    function updateOverlays() {
        const hasComps = state.installation.getComponents().length > 0;
        toggleOverlay('install-overlay', !hasComps);
        toggleOverlay('scanner-overlay', !hasComps);
        toggleOverlay('configurator-overlay', !state.scanned);
        toggleOverlay('uitslag-overlay', !state.insulated);

        updateWorkflowProgress();

        const scanInfo = document.getElementById('scanner-install-info');
        if (hasComps) {
            const comps = state.installation.getComponents();
            const types = [...new Set(comps.map(c => c.type))];
            scanInfo.innerHTML = `<h4>Huidige installatie</h4>
                <div class="info-row"><span class="info-label">Componenten</span><span class="info-value">${comps.length}</span></div>
                <div class="info-row"><span class="info-label">Types</span><span class="info-value">${types.length}</span></div>
                <div class="info-row"><span class="info-label">Status</span><span class="info-value" style="color:var(--primary-light)">Klaar voor scan</span></div>`;
        } else {
            scanInfo.innerHTML = '<p class="placeholder-text">Geen installatie geladen.</p>';
        }

        document.getElementById('btn-start-scan').disabled = !hasComps;
    }

    function toggleOverlay(id, show) {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('hidden', !show);
    }

    // ========== INSTALL VIEWPORT ==========
    function initInstallViewport() {
        if (!state.installBuilder) {
            const container = document.getElementById('install-viewport');
            state.installBuilder = new PipeBuilder(container);
        }
        state.installBuilder.onResize();
        rebuildInstallView();
    }

    function rebuildInstallView() {
        if (!state.installBuilder) return;
        const comps = state.installation.getComponents();
        if (comps.length === 0) {
            state.installBuilder.clearAll();
            return;
        }
        state.installBuilder.buildInstallation(comps);
    }

    // ========== SCANNER ==========
    function initScanViewport() {
        if (!state.scanBuilder) {
            const container = document.getElementById('scanner-viewport');
            state.scanBuilder = new PipeBuilder(container);
        }
        state.scanBuilder.onResize();

        const comps = state.installation.getComponents();
        if (comps.length > 0 && !state.scanned) {
            state.scanBuilder.buildInstallation(comps);
            state.scanBuilder.buildRoom(comps);
            state.scanBuilder.installationGroup.visible = false;
            state.scanBuilder.setRoomVisible(true);
            state.scanBuilder.fitCamera();
        }
    }

    function initScannerControls() {
        document.getElementById('btn-start-scan').addEventListener('click', startRoomScan);
        document.getElementById('btn-use-scan').addEventListener('click', () => {
            document.querySelector('.nav-btn[data-tab="configurator"]').click();
        });

        const showRoom = document.getElementById('scan-show-room');
        if (showRoom) {
            showRoom.addEventListener('change', (e) => {
                if (state.scanBuilder) state.scanBuilder.setRoomVisible(e.target.checked);
            });
        }
    }

    function resetScanUI() {
        const phases = document.getElementById('scan-phases');
        const progress = document.getElementById('scan-progress');
        const result = document.getElementById('scan-result');
        const live = document.getElementById('scan-live-status');
        if (phases) phases.style.display = 'none';
        if (progress) progress.style.display = 'none';
        if (result) result.style.display = 'none';
        if (live) live.innerHTML = '';

        ['phase-lidar', 'phase-pointcloud', 'phase-detect', 'phase-classify'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.remove('active', 'done');
        });
        ['phase-lidar-status', 'phase-pointcloud-status', 'phase-detect-status', 'phase-classify-status'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = 'Wachten...';
        });

        if (state.scanTimer) { clearInterval(state.scanTimer); state.scanTimer = null; }
        state.detectedComponents = [];
    }

    // ========== MULTI-PHASE ROOM SCAN ==========
    function startRoomScan() {
        const comps = state.installation.getComponents();
        if (comps.length === 0) return;

        initScanViewport();
        resetScanUI();

        const phasesEl = document.getElementById('scan-phases');
        const progressBar = document.getElementById('scan-progress');
        const progressFill = document.getElementById('scan-progress-fill');
        const progressText = document.getElementById('scan-progress-text');
        const btnScan = document.getElementById('btn-start-scan');
        const liveStatus = document.getElementById('scan-live-status');

        phasesEl.style.display = '';
        progressBar.style.display = '';
        btnScan.disabled = true;

        const resolution = document.getElementById('scan-resolution').value;
        const speeds = { low: 4000, medium: 7000, high: 10000 };
        const totalMs = speeds[resolution] || 7000;
        const interval = 50;
        const step = interval / totalMs;

        let progress = 0;
        let lastPhase = '';
        let detectionCount = 0;

        state.scanBuilder.installationGroup.visible = false;
        state.scanBuilder._clearGroup(state.scanBuilder.pointCloudGroup);
        state.scanBuilder.clearDetectionBoxes();
        state.scanBuilder.setRoomVisible(true);
        state.scanBuilder.fitCamera();

        liveStatus.innerHTML = '<span class="dot"></span> Scan actief';

        state.scanTimer = setInterval(() => {
            progress = Math.min(progress + step, 1);
            progressFill.style.width = (progress * 100) + '%';

            let phase;
            if (progress < 0.30) {
                phase = 'lidar';
                progressText.textContent = `LiDAR scan... ${Math.round(progress / 0.30 * 100)}%`;
            } else if (progress < 0.60) {
                phase = 'pointcloud';
                progressText.textContent = `Puntenwolk opbouwen... ${Math.round((progress - 0.30) / 0.30 * 100)}%`;
            } else if (progress < 0.85) {
                phase = 'detect';
                progressText.textContent = `AI detectie... ${Math.round((progress - 0.60) / 0.25 * 100)}%`;
            } else {
                phase = 'classify';
                progressText.textContent = `Classificatie... ${Math.round((progress - 0.85) / 0.15 * 100)}%`;
            }

            if (phase !== lastPhase) {
                if (lastPhase) {
                    const prevEl = document.getElementById('phase-' + lastPhase);
                    if (prevEl) { prevEl.classList.remove('active'); prevEl.classList.add('done'); }
                    const prevStatus = document.getElementById('phase-' + lastPhase + '-status');
                    if (prevStatus) prevStatus.textContent = '✓ Voltooid';
                }
                const curEl = document.getElementById('phase-' + phase);
                if (curEl) curEl.classList.add('active');
                const curStatus = document.getElementById('phase-' + phase + '-status');
                if (curStatus) curStatus.textContent = 'Actief...';
                lastPhase = phase;
            }

            if (progress < 0.60) {
                state.scanBuilder.createRoomScanPointCloud(comps, progress / 0.60, 'room');
                state.scanBuilder.createScanBeam(progress / 0.30);
            } else if (phase === 'detect' || phase === 'classify') {
                state.scanBuilder.createRoomScanPointCloud(comps, 1.0, 'full');
                state.scanBuilder.clearScanBeam();
            }

            if (phase === 'detect' || phase === 'classify') {
                const detectProgress = Math.min((progress - 0.60) / 0.25, 1);
                const showCount = Math.ceil(detectProgress * comps.length);
                if (showCount > detectionCount) {
                    detectionCount = showCount;
                    state.scanBuilder.showDetectionBoxesAnimated(comps, detectionCount);
                }
            }

            if (phase === 'classify') {
                state.scanBuilder.installationGroup.visible = true;
                state.scanBuilder.installationGroup.traverse(c => {
                    if (c.material) { c.material.transparent = true; c.material.opacity = 0.4; }
                });
            }

            if (progress >= 1) {
                clearInterval(state.scanTimer);
                state.scanTimer = null;
                state.scanned = true;

                state.scanBuilder.clearScanBeam();

                const classEl = document.getElementById('phase-classify');
                if (classEl) { classEl.classList.remove('active'); classEl.classList.add('done'); }
                const classStatus = document.getElementById('phase-classify-status');
                if (classStatus) classStatus.textContent = '✓ Voltooid';

                state.scanBuilder.installationGroup.visible = true;
                state.scanBuilder.installationGroup.traverse(c => {
                    if (c.material) { c.material.transparent = false; c.material.opacity = 1.0; }
                });

                progressBar.style.display = 'none';
                liveStatus.innerHTML = '<span style="color:var(--success)">✓ Scan voltooid</span>';
                btnScan.disabled = false;

                state.detectedComponents = comps.map(c => ({
                    ...c,
                    confidence: (0.88 + Math.random() * 0.11).toFixed(2),
                    detectedDiameter: c.diameter + Math.round((Math.random() - 0.5) * 4),
                    detectedLength: c.length ? c.length + Math.round((Math.random() - 0.5) * 8) : null
                }));

                showScanResults(comps);
                updateOverlays();

                // Camera fly-through after successful scan
                state.scanBuilder.cameraFlyThrough(comps);
            }
        }, interval);
    }

    function showScanResults(comps) {
        const details = document.getElementById('scan-result-details');
        const typeLabels = {
            'straight': 'Rechte buizen', 'elbow': 'Bochten', 't-piece': 'T-stukken',
            'reducer': 'Verloopstukken', 'flange': 'Flenzen', 'valve': 'Afsluiters',
            'expansion-joint': 'Compensatoren'
        };
        const typeCounts = {};
        for (const c of comps) typeCounts[c.type] = (typeCounts[c.type] || 0) + 1;

        let html = `
            <div class="info-row"><span class="info-label">Scanpunten</span><span class="info-value">~30.000</span></div>
            <div class="info-row"><span class="info-label">Componenten gevonden</span><span class="info-value" style="color:var(--success)">${comps.length}</span></div>`;
        for (const [t, n] of Object.entries(typeCounts)) {
            html += `<div class="info-row"><span class="info-label">${typeLabels[t] || t}</span><span class="info-value">${n}×</span></div>`;
        }

        // ML Confidence per detected component
        const avgConf = state.detectedComponents.length > 0
            ? (state.detectedComponents.reduce((s, c) => s + parseFloat(c.confidence), 0) / state.detectedComponents.length * 100).toFixed(1)
            : '94.2';
        html += `<div class="info-row"><span class="info-label">Gem. betrouwbaarheid</span><span class="info-value" style="color:var(--success)">${avgConf}%</span></div>`;

        // Per-component confidence bars
        html += `<div class="ml-confidence-list">`;
        for (const dc of state.detectedComponents) {
            const conf = (parseFloat(dc.confidence) * 100).toFixed(0);
            const barColor = conf >= 95 ? '#4caf50' : conf >= 90 ? '#ff9800' : '#f44336';
            html += `<div class="ml-conf-row">
                <span class="ml-conf-label">#${dc.id} ${dc.type}</span>
                <div class="ml-conf-bar-bg"><div class="ml-conf-bar" style="width:${conf}%;background:${barColor}"></div></div>
                <span class="ml-conf-val">${conf}%</span>
            </div>`;
        }
        html += `</div>`;
        html += `<div class="info-row"><span class="info-label">Status</span><span class="info-value" style="color:var(--success)">Volledig gedetecteerd</span></div>`;
        details.innerHTML = html;
        document.getElementById('scan-result').style.display = '';
    }

    // ========== CONFIGURATOR ==========
    function initConfigViewport() {
        if (!state.configBuilder) {
            const container = document.getElementById('configurator-viewport');
            state.configBuilder = new PipeBuilder(container);
        }
        state.configBuilder.onResize();

        if (state.scanned) {
            const comps = state.installation.getComponents();
            state.configBuilder.buildInstallation(comps);
            updatePipeInfo(comps);
        }
    }

    function updatePipeInfo(comps) {
        const card = document.getElementById('pipe-info-card');
        const types = {};
        for (const c of comps) types[c.type] = (types[c.type] || 0) + 1;
        const typeLabels = {
            'straight': 'Rechte buizen', 'elbow': 'Bochten', 't-piece': 'T-stukken',
            'reducer': 'Verloopstukken', 'flange': 'Flenzen', 'valve': 'Afsluiters',
            'expansion-joint': 'Compensatoren'
        };
        let html = '<h4>Gedetecteerde installatie</h4>';
        for (const [t, n] of Object.entries(types)) {
            html += `<div class="info-row"><span class="info-label">${typeLabels[t] || t}</span><span class="info-value">${n}×</span></div>`;
        }
        html += `<div class="info-row"><span class="info-label">Bron</span><span class="info-value">AI Detectie</span></div>`;
        card.innerHTML = html;
    }

    function initConfiguratorControls() {
        document.getElementById('btn-apply-insulation').addEventListener('click', applyInsulation);
        document.getElementById('btn-generate-uitslag').addEventListener('click', () => {
            generateUitslagen();
            document.querySelector('.nav-btn[data-tab="uitslag"]').click();
        });
        document.getElementById('toggle-transparent').addEventListener('change', (e) => {
            if (state.configBuilder) state.configBuilder.setInsulationTransparency(e.target.checked);
        });
        document.getElementById('toggle-wireframe').addEventListener('change', (e) => {
            if (state.configBuilder) state.configBuilder.setInsulationWireframe(e.target.checked);
        });

        // Thermal heat map toggle
        document.getElementById('toggle-thermal').addEventListener('change', (e) => {
            if (!state.configBuilder) return;
            const comps = state.installation.getComponents();
            state.configBuilder.setThermalMode(e.target.checked, comps);
            document.getElementById('thermal-legend').style.display = e.target.checked ? '' : 'none';
        });

        // Fly-through button
        document.getElementById('btn-fly-through').addEventListener('click', () => {
            if (!state.configBuilder) return;
            const comps = state.installation.getComponents();
            state.configBuilder.cameraFlyThrough(comps);
        });
    }

    function applyInsulation() {
        if (!state.configBuilder || !state.scanned) return;
        const comps = state.installation.getComponents();
        const insP = getInsulationParams();
        state.configBuilder.buildInstallation(comps);
        state.configBuilder.buildAllInsulation(comps, insP);
        state.insulated = true;
        updateOverlays();
        calculateMaterialCosts(comps, insP);
    }

    function getInsulationParams() {
        return {
            material: document.getElementById('insulation-material').value,
            thickness: getNum('insulation-thickness'),
            cladding: document.getElementById('cladding-type').value,
            claddingThickness: getNum('cladding-thickness'),
            overlap: getNum('overlap'),
            numSegments: getNum('num-segments'),
            transparent: document.getElementById('toggle-transparent').checked,
            wireframe: document.getElementById('toggle-wireframe').checked
        };
    }

    // ========== UITSLAG ==========
    function initUitslagCanvas() {
        if (!state.uitslag) {
            const canvas = document.getElementById('uitslag-canvas');
            state.uitslag = new UitslagGenerator(canvas);
        }
        if (state.insulated) {
            state.uitslag.draw();
        }
    }

    function initUitslagControls() {
        document.getElementById('btn-export-svg').addEventListener('click', () => {
            if (state.uitslag) state.uitslag.exportSVG();
        });
        document.getElementById('btn-export-dxf').addEventListener('click', () => {
            if (state.uitslag) state.uitslag.exportDXF();
        });
        document.getElementById('btn-print').addEventListener('click', () => {
            window.print();
        });
        document.getElementById('uitslag-scale').addEventListener('change', (e) => {
            if (state.uitslag) { state.uitslag.options.scale = e.target.value; state.uitslag.draw(); }
        });
        document.getElementById('uitslag-units').addEventListener('change', (e) => {
            if (state.uitslag) { state.uitslag.options.units = e.target.value; state.uitslag.draw(); }
        });
        for (const id of ['show-fold-lines', 'show-dimensions', 'show-overlap']) {
            document.getElementById(id).addEventListener('change', (e) => {
                if (!state.uitslag) return;
                const key = { 'show-fold-lines': 'showFoldLines', 'show-dimensions': 'showDimensions', 'show-overlap': 'showOverlap' }[id];
                state.uitslag.options[key] = e.target.checked;
                state.uitslag.draw();
            });
        }

        // Nesting controls
        for (const id of ['show-nesting', 'show-grid', 'show-cut-order']) {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', (e) => {
                    if (!state.uitslag) return;
                    const key = { 'show-nesting': 'showNesting', 'show-grid': 'showGrid', 'show-cut-order': 'showCutOrder' }[id];
                    state.uitslag.options[key] = e.target.checked;
                    state.uitslag.draw();
                });
            }
        }

        // Sheet size selector
        const sheetSel = document.getElementById('sheet-size');
        if (sheetSel) {
            sheetSel.addEventListener('change', (e) => {
                if (!state.uitslag) return;
                const [w, h] = e.target.value.split('x').map(Number);
                state.uitslag.options.sheetWidth = w;
                state.uitslag.options.sheetHeight = h;
                // Re-nest with new sheet size
                if (state.insulated) {
                    const comps = state.installation.getComponents();
                    const insP = getInsulationParams();
                    state.uitslag.generateFromGeometry(comps, insP);
                    state.uitslag.draw();
                    updateNestingStats();
                }
            });
        }

        // Reset view button
        const resetBtn = document.getElementById('btn-reset-uitslag-view');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                if (state.uitslag) state.uitslag.resetView();
            });
        }
    }

    function generateUitslagen() {
        if (!state.uitslag) {
            state.uitslag = new UitslagGenerator(document.getElementById('uitslag-canvas'));
        }
        const comps = state.installation.getComponents();
        const insP = getInsulationParams();

        const patterns = state.uitslag.generateFromGeometry(comps, insP);
        state.uitslag.draw();
        state.uitslagGenerated = true;
        updateWorkflowProgress();

        const filterEl = document.getElementById('uitslag-filter');
        filterEl.innerHTML = '';
        for (const p of patterns) {
            const div = document.createElement('div');
            div.className = 'filter-item';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = true;
            cb.id = 'filter-' + p.componentId;
            cb.addEventListener('change', () => {
                const visibleIds = [];
                filterEl.querySelectorAll('input[type="checkbox"]').forEach(c => {
                    if (c.checked) visibleIds.push(parseInt(c.id.replace('filter-', '')));
                });
                state.uitslag.setFilter(visibleIds);
                state.uitslag._nestPatterns();
                state.uitslag.draw();
                updateUitslagSummary();
                updateNestingStats();
            });
            const label = document.createElement('label');
            label.htmlFor = cb.id;
            label.textContent = p.label;
            div.appendChild(cb);
            div.appendChild(label);
            filterEl.appendChild(div);
        }

        updateUitslagSummary();
        updateNestingStats();
        updateOverlays();

        const infoCard = document.getElementById('uitslag-info-card');
        infoCard.innerHTML = `<h4>Auto-gegenereerde uitslagen</h4>
            <div class="info-row"><span class="info-label">Componenten</span><span class="info-value">${patterns.length}</span></div>
            <div class="info-row"><span class="info-label">Totaal patronen</span><span class="info-value">${patterns.reduce((s, p) => s + p.segments.length, 0)}</span></div>
            <div class="info-row"><span class="info-label">Bron</span><span class="info-value">Bounding box geometrie</span></div>`;
    }

    function updateNestingStats() {
        if (!state.uitslag) return;
        const stats = state.uitslag.getNestingStats();
        const card = document.getElementById('nesting-stats');
        const details = document.getElementById('nesting-stats-details');
        if (!card || !details) return;

        const effColor = stats.efficiency > 80 ? 'var(--success)' : stats.efficiency > 50 ? '#ff9800' : '#f44336';
        details.innerHTML = `
            <div class="info-row"><span class="info-label">Platen benodigd</span><span class="info-value">${stats.sheets}</span></div>
            <div class="info-row"><span class="info-label">Aantal onderdelen</span><span class="info-value">${stats.totalParts}</span></div>
            <div class="info-row"><span class="info-label">Gebruikt oppervlak</span><span class="info-value">${(stats.usedArea / 1e6).toFixed(2)} m²</span></div>
            <div class="info-row"><span class="info-label">Plaat oppervlak</span><span class="info-value">${(stats.totalSheetArea / 1e6).toFixed(2)} m²</span></div>
            <div class="info-row"><span class="info-label">Materiaalbenutting</span><span class="info-value" style="color:${effColor}">${stats.efficiency}%</span></div>
            <div class="info-row"><span class="info-label">Afval</span><span class="info-value">${(stats.wasteArea / 1e6).toFixed(2)} m²</span></div>
        `;
        card.style.display = '';
    }

    function updateUitslagSummary() {
        if (!state.uitslag) return;
        const summary = state.uitslag.getSummary();
        const el = document.getElementById('uitslag-summary');
        const typeLabels = { 'straight': 'Recht', 'elbow': 'Bocht', 't-piece': 'T-stuk', 'reducer': 'Verloop', 'valve': 'Klep', 'expansion-joint': 'Comp.' };
        const parts = [];
        for (const [t, n] of Object.entries(summary.typeCount)) {
            parts.push(`${typeLabels[t] || t}: ${n}`);
        }
        el.textContent = `${summary.totalParts} patronen | ${parts.join(', ')}`;
    }

    // ========== HELPERS ==========
    function getNum(id) {
        return parseFloat(document.getElementById(id).value) || 0;
    }

    // ========== SCREENSHOT BUTTONS ==========
    function initScreenshotButtons() {
        const pairs = [
            ['btn-screenshot-install', () => state.installBuilder],
            ['btn-screenshot-scanner', () => state.scanBuilder],
            ['btn-screenshot-config', () => state.configBuilder]
        ];
        for (const [btnId, getBuilder] of pairs) {
            const btn = document.getElementById(btnId);
            if (btn) {
                btn.addEventListener('click', () => {
                    const builder = getBuilder();
                    if (builder) builder.takeScreenshot();
                });
            }
        }
    }

    // ========== DIMENSION TOGGLES ==========
    function initDimensionToggles() {
        const pairs = [
            ['install-show-dims', () => state.installBuilder],
            ['toggle-dims-config', () => state.configBuilder]
        ];
        for (const [cbId, getBuilder] of pairs) {
            const cb = document.getElementById(cbId);
            if (cb) {
                cb.addEventListener('change', (e) => {
                    const builder = getBuilder();
                    if (!builder) return;
                    const comps = state.installation.getComponents();
                    if (e.target.checked) {
                        builder.showDimensions(comps);
                    } else {
                        builder.clearDimensions();
                    }
                });
            }
        }
    }

    // ========== MATERIAL COST CALCULATOR ==========
    function calculateMaterialCosts(components, insP) {
        const costCard = document.getElementById('cost-calculator');
        const details = document.getElementById('cost-details');
        if (!costCard || !details) return;

        let totalArea = 0;
        for (const comp of components) {
            if (comp.type === 'flange') continue;
            const r = comp.diameter / 2;
            const outerR = r + insP.thickness;
            const circumference = Math.PI * 2 * outerR;

            if (comp.type === 'elbow') {
                const arcLen = Math.abs(comp.bendAngle / 180 * Math.PI) * comp.bendRadius;
                totalArea += circumference * arcLen / 1e6;
            } else if (comp.type === 'valve') {
                const vLen = comp.valveLength || 200;
                const boxSurface = 2 * (2 * outerR * 1.3) * vLen + 2 * (2 * outerR * 1.3) * (2 * outerR * 1.3);
                totalArea += boxSurface / 1e6;
            } else {
                const length = comp.length || 200;
                totalArea += circumference * length / 1e6;
            }
        }

        const materialPrices = {
            'mineral-wool': { price: 18, density: 80, name: 'Minerale wol' },
            'glass-wool': { price: 14, density: 48, name: 'Glaswol' },
            'foam': { price: 32, density: 40, name: 'Schuim (PUR/PIR)' },
            'aerogel': { price: 85, density: 120, name: 'Aerogel' },
            'calcium-silicate': { price: 45, density: 200, name: 'Calciumsilicaat' }
        };
        const claddingPrices = {
            'aluminium': { price: 22, name: 'Aluminium' },
            'stainless': { price: 48, name: 'RVS' },
            'pvc': { price: 12, name: 'PVC' },
            'none': { price: 0, name: 'Geen' }
        };

        const mat = materialPrices[insP.material] || materialPrices['mineral-wool'];
        const clad = claddingPrices[insP.cladding] || claddingPrices['aluminium'];

        const volume = totalArea * (insP.thickness / 1000);
        const weight = volume * mat.density;
        const insCost = totalArea * mat.price;
        const cladCost = totalArea * clad.price;
        const laborCost = totalArea * 35;
        const totalCost = insCost + cladCost + laborCost;

        details.innerHTML = `
            <div class="cost-row"><span class="cost-label">Isolatie-oppervlak</span><span class="cost-value">${totalArea.toFixed(2)} m²</span></div>
            <div class="cost-row"><span class="cost-label">Isolatievolume</span><span class="cost-value">${(volume * 1000).toFixed(1)} dm³</span></div>
            <div class="cost-row"><span class="cost-label">Geschat gewicht</span><span class="cost-value">${weight.toFixed(1)} kg</span></div>
            <div class="cost-row"><span class="cost-label">${mat.name}</span><span class="cost-value">€ ${insCost.toFixed(0)}</span></div>
            <div class="cost-row"><span class="cost-label">Bekleding (${clad.name})</span><span class="cost-value">€ ${cladCost.toFixed(0)}</span></div>
            <div class="cost-row"><span class="cost-label">Arbeid (montage)</span><span class="cost-value">€ ${laborCost.toFixed(0)}</span></div>
            <div class="cost-row cost-total"><span class="cost-label">Totale schatting</span><span class="cost-value">€ ${totalCost.toFixed(0)}</span></div>
        `;
        costCard.style.display = '';
    }

})();
