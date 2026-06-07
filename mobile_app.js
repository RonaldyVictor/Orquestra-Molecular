/**
 * Orquestra Molecular — Mobile App
 * 
 * Site estático apresentativo para visualização 3D e audificação
 * de modos vibracionais de moléculas pré-processadas.
 * 
 * Dados carregados de db_moleculas.json (gerado por processar_logs.py).
 */

// ============================================================
// GLOBAL STATE
// ============================================================
const AppState = {
    molecules: [],              // Array de moléculas carregadas do JSON
    currentMolecule: null,      // Molécula selecionada atualmente
    activeModeIndex: -1,        // Índice do modo vibracional ativo
    timeline: [],               // Notas adicionadas à partitura
    viewer: null,               // Instância do 3Dmol viewer
    audioCtx: null,             // AudioContext (criado sob demanda)
    animationTimer: null,       // Timer da animação 3D
    currentOscillators: [],     // Osciladores de áudio ativos (para cancelamento)
    isTransitioning: false,     // Previne transições duplas
};

// ============================================================
// CONSTANTS
// ============================================================
const NUM_FRAMES = 20;
const ANIMATION_INTERVAL_MS = 50;
const MAX_TIMELINE_NOTES = 200; // Limite de notas na partitura
const MAX_GRID_BUTTONS = 81;    // 9x9

// Tabela de raios covalentes para detecção de ligações
const COVALENT_RADII = {
    'H': 0.32, 'C': 0.75, 'N': 0.71, 'O': 0.63, 'F': 0.64,
    'Si': 1.11, 'P': 1.11, 'S': 1.03, 'Cl': 0.99, 'Br': 1.14, 'I': 1.33,
    'B': 0.82,
};

const BOND_TOLERANCE = 0.45;

// Notas cromáticas para mapeamento ABC
const CHROMATIC_NOTES = ["C", "^C", "D", "^D", "E", "F", "^F", "G", "^G", "A", "^A", "B"];

// Cores para as notas na partitura
const NOTE_COLORS = [
    '#8b5cf6', '#ec4899', '#6366f1', '#a855f7',
    '#d946ef', '#7c3aed', '#c084fc', '#f472b6',
];


// ============================================================
// INITIALIZATION
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
    showLoader('Carregando moléculas...');
    createFloatingAtoms();

    try {
        const response = await fetch('db_moleculas.json');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        AppState.molecules = await response.json();
        populateSelect();
    } catch (err) {
        console.error('Erro ao carregar db_moleculas.json:', err);
        alert('Erro ao carregar banco de dados de moléculas. Verifique se db_moleculas.json existe.');
    } finally {
        hideLoader();
    }

    // Event listeners
    document.getElementById('mol-select').addEventListener('change', onMoleculeSelected);
    document.getElementById('btn-select').addEventListener('click', onSelectButtonClick);
    document.getElementById('btn-back').addEventListener('click', onBackButtonClick);
    document.getElementById('score-header').addEventListener('click', toggleScorePanel);
});


// ============================================================
// SCREEN MANAGEMENT
// ============================================================
function showScreen(screenId) {
    if (AppState.isTransitioning) return;
    AppState.isTransitioning = true;

    document.querySelectorAll('.screen').forEach(s => {
        s.classList.add('hidden');
        s.classList.remove('visible');
    });

    const target = document.getElementById(screenId);
    // Small delay to allow CSS transition
    requestAnimationFrame(() => {
        target.classList.remove('hidden');
        target.classList.add('visible');
        setTimeout(() => { AppState.isTransitioning = false; }, 500);
    });
}


// ============================================================
// LOADER
// ============================================================
function showLoader(text) {
    document.getElementById('loader-text').textContent = text;
    document.getElementById('loader').classList.add('active');
}

function hideLoader() {
    document.getElementById('loader').classList.remove('active');
}


// ============================================================
// FLOATING ATOMS DECORATION (Screen 1)
// ============================================================
function createFloatingAtoms() {
    const container = document.getElementById('floating-atoms');
    if (!container) return;

    const colors = ['rgba(139,92,246,0.3)', 'rgba(236,72,153,0.2)', 'rgba(167,139,250,0.2)', 'rgba(249,168,212,0.15)'];

    for (let i = 0; i < 12; i++) {
        const particle = document.createElement('div');
        particle.className = 'atom-particle';
        const size = 4 + Math.random() * 12;
        particle.style.width = size + 'px';
        particle.style.height = size + 'px';
        particle.style.left = Math.random() * 100 + '%';
        particle.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        particle.style.animationDuration = (8 + Math.random() * 16) + 's';
        particle.style.animationDelay = (-Math.random() * 20) + 's';
        container.appendChild(particle);
    }
}


// ============================================================
// SELECT POPULATION
// ============================================================
function populateSelect() {
    const select = document.getElementById('mol-select');

    // Sort alphabetically by nome
    const sorted = [...AppState.molecules].sort((a, b) => a.nome.localeCompare(b.nome));

    sorted.forEach(mol => {
        const opt = document.createElement('option');
        opt.value = mol.id;
        opt.textContent = `${mol.nome} (${mol.data.freqs.length} modos)`;
        select.appendChild(opt);
    });
}

function onMoleculeSelected(e) {
    const btn = document.getElementById('btn-select');
    btn.disabled = !e.target.value;
}


// ============================================================
// SELECT BUTTON → GO TO VIEWER
// ============================================================
function onSelectButtonClick() {
    const selectEl = document.getElementById('mol-select');
    const selectedId = selectEl.value;
    if (!selectedId) return;

    const mol = AppState.molecules.find(m => m.id === selectedId);
    if (!mol) return;

    AppState.currentMolecule = mol;
    AppState.activeModeIndex = -1;
    AppState.timeline = [];

    // Update viewer header
    document.getElementById('viewer-mol-name').textContent = mol.nome;

    showScreen('screen-viewer');

    // Initialize 3D viewer after screen transition
    setTimeout(() => {
        initViewer(mol);
        renderModeGrid(mol);
        renderScore();
    }, 300);
}


// ============================================================
// BACK BUTTON
// ============================================================
function onBackButtonClick() {
    stopAnimation();
    cancelAllAudio();
    AppState.currentMolecule = null;
    AppState.activeModeIndex = -1;
    AppState.timeline = [];

    if (AppState.viewer) {
        AppState.viewer.clear();
    }

    showScreen('screen-select');
}


// ============================================================
// 3D VIEWER ENGINE
// ============================================================
function initViewer(mol) {
    const container = document.getElementById('mol-viewer');
    container.innerHTML = '';

    AppState.viewer = $3Dmol.createViewer(container, {
        backgroundColor: '#0c0418',
    });

    loadMoleculeIntoViewer(mol.data, 0);
}

function loadMoleculeIntoViewer(molData, modeIndex) {
    stopAnimation();

    const viewer = AppState.viewer;
    if (!viewer) return;

    const atoms = molData.atoms;
    const coords = molData.coords;
    const modeArray = molData.modes[modeIndex] || [];

    // Calculate displacement vectors and normalize
    let rawVectors = [];
    let maxDistSq = 0;

    for (let i = 0; i < atoms.length; i++) {
        let dx = 0, dy = 0, dz = 0;
        if (Array.isArray(modeArray[i])) {
            dx = modeArray[i][0] || 0;
            dy = modeArray[i][1] || 0;
            dz = modeArray[i][2] || 0;
        }
        rawVectors.push({ dx, dy, dz });
        maxDistSq = Math.max(maxDistSq, dx * dx + dy * dy + dz * dz);
    }

    let scale = maxDistSq > 1e-10 ? (0.15 / Math.sqrt(maxDistSq)) : 0;
    if (scale === 0) {
        for (let i = 0; i < atoms.length; i++) {
            rawVectors[i] = {
                dx: coords[i][0] * 0.01,
                dy: coords[i][1] * 0.01,
                dz: coords[i][2] * 0.01,
            };
        }
        scale = 1.0;
    }

    const vectors = rawVectors.map(v => ({
        dx: v.dx * scale,
        dy: v.dy * scale,
        dz: v.dz * scale,
    }));

    // Detect bonds
    const bonds = [];
    for (let i = 0; i < atoms.length; i++) {
        for (let j = i + 1; j < atoms.length; j++) {
            const dx = coords[i][0] - coords[j][0];
            const dy = coords[i][1] - coords[j][1];
            const dz = coords[i][2] - coords[j][2];
            const distSq = dx * dx + dy * dy + dz * dz;
            if (isBonded(atoms[i], atoms[j], distSq)) {
                bonds.push([i + 1, j + 1]); // 1-indexed for SDF
            }
        }
    }

    // Build multi-frame SDF for animation
    const padL = (n, s) => { let r = n.toString(); while (r.length < s) r = " " + r; return r; };
    const padR = (str, s) => { while (str.length < s) str += " "; return str; };
    const formatC = (c) => { let r = c.toFixed(4); while (r.length < 10) r = " " + r; return r; };

    let sdfData = "";
    for (let f = 0; f < NUM_FRAMES; f++) {
        const phase = Math.sin((f / NUM_FRAMES) * Math.PI * 2);

        sdfData += `Frame_${f}\n  Orquestra Molecular\n\n`;
        sdfData += `${padL(atoms.length, 3)}${padL(bonds.length, 3)}  0  0  0  0  0  0  0  0  1 V2000\n`;

        for (let i = 0; i < atoms.length; i++) {
            const nx = coords[i][0] + vectors[i].dx * phase;
            const ny = coords[i][1] + vectors[i].dy * phase;
            const nz = coords[i][2] + vectors[i].dz * phase;
            sdfData += `${formatC(nx)}${formatC(ny)}${formatC(nz)} ${padR(atoms[i], 3)} 0  0  0  0  0  0  0  0  0  0  0  0\n`;
        }

        for (const b of bonds) {
            sdfData += `${padL(b[0], 3)}${padL(b[1], 3)}  1  0  0  0  0\n`;
        }
        sdfData += `M  END\n$$$$\n`;
    }

    viewer.clear();
    viewer.addModelsAsFrames(sdfData, "sdf");
    viewer.setStyle({}, { stick: { radius: 0.15 }, sphere: { radius: 0.35 } });
    viewer.zoomTo();
    viewer.render();

    startAnimation(viewer);
}

function isBonded(atom1, atom2, distSq) {
    const r1 = COVALENT_RADII[atom1] || 1.0;
    const r2 = COVALENT_RADII[atom2] || 1.0;
    const limit = r1 + r2 + BOND_TOLERANCE;
    return distSq <= (limit * limit);
}

function startAnimation(viewer) {
    let frame = 0;
    AppState.animationTimer = setInterval(() => {
        frame = (frame + 1) % NUM_FRAMES;
        viewer.setFrame(frame);
        viewer.render();
    }, ANIMATION_INTERVAL_MS);
}

function stopAnimation() {
    if (AppState.animationTimer) {
        clearInterval(AppState.animationTimer);
        AppState.animationTimer = null;
    }
}


// ============================================================
// MODE GRID RENDERING
// ============================================================
function renderModeGrid(mol) {
    const grid = document.getElementById('modes-grid');
    const countEl = document.getElementById('modes-count');
    const data = mol.data;

    const totalModes = Math.min(data.freqs.length, MAX_GRID_BUTTONS);
    countEl.textContent = `${data.freqs.length} modos`;

    let html = '';
    for (let i = 0; i < totalModes; i++) {
        const freq = data.freqs[i];
        const sym = (data.syms && data.syms[i] && data.syms[i] !== 'N/A') ? data.syms[i] : '';
        const isActive = i === AppState.activeModeIndex;

        html += `
            <button class="mode-btn ${isActive ? 'active' : ''}" 
                    data-index="${i}" 
                    id="mode-btn-${i}"
                    onclick="onModeButtonClick(${i})">
                <span class="mode-number">Modo ${i + 1}</span>
                <span class="mode-freq">${Math.abs(freq).toFixed(0)}</span>
                <span class="mode-unit">cm⁻¹</span>
                ${sym ? `<span class="mode-sym">${sym}</span>` : ''}
            </button>
        `;
    }

    grid.innerHTML = html;
}


// ============================================================
// MODE BUTTON CLICK — DEBOUNCE SYSTEM
// ============================================================
function onModeButtonClick(index) {
    if (!AppState.currentMolecule) return;

    const mol = AppState.currentMolecule;
    const data = mol.data;

    if (index < 0 || index >= data.freqs.length) return;

    // ---- DEBOUNCE: Cancel previous vibration & audio instantly ----
    stopAnimation();
    cancelAllAudio();

    // Update active state in grid
    document.querySelectorAll('.mode-btn.active').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById(`mode-btn-${index}`);
    if (btn) btn.classList.add('active');

    AppState.activeModeIndex = index;

    // Load new vibration in 3D viewer
    loadMoleculeIntoViewer(data, index);

    // Play audio for this mode
    playModeAudio(data.freqs[index]);

    // Add note to timeline/score
    addNoteToTimeline(index, data.freqs[index]);
}


// ============================================================
// AUDIO ENGINE — with full cancellation support
// ============================================================
function getAudioContext() {
    if (!AppState.audioCtx) {
        AppState.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (AppState.audioCtx.state === 'suspended') {
        AppState.audioCtx.resume();
    }
    return AppState.audioCtx;
}

function cancelAllAudio() {
    // Immediately stop and disconnect all active oscillators
    for (const entry of AppState.currentOscillators) {
        try {
            entry.osc.stop(0);
            entry.gain.disconnect();
        } catch (_) { /* already stopped */ }
    }
    AppState.currentOscillators = [];
}

function playModeAudio(freq) {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    const absFreq = Math.abs(freq);
    const residuo = absFreq % 100;

    // Map frequency to audible range using logarithmic scale
    const fMapped = Math.max(50, Math.min(absFreq, 4000));
    const floatMidi = 36 + (Math.log(fMapped / 50) / Math.log(4000 / 50)) * (108 - 36);
    let freqAudible = 440 * Math.pow(2, (floatMidi - 69) / 12);

    if (isNaN(freqAudible) || freqAudible <= 0) freqAudible = 440;

    const decayTime = 0.8;

    // Main oscillator
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = residuo > 20 ? 'sawtooth' : 'sine';
    osc.frequency.setValueAtTime(freqAudible, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(residuo > 20 ? 0.3 : 0.2, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, now + decayTime);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + decayTime + 0.1);

    // Track for cancellation
    const entry = { osc, gain };
    AppState.currentOscillators.push(entry);

    // Auto-cleanup after the note ends
    osc.onended = () => {
        const idx = AppState.currentOscillators.indexOf(entry);
        if (idx !== -1) AppState.currentOscillators.splice(idx, 1);
        try { gain.disconnect(); } catch (_) {}
    };

    // Secondary oscillator for "trill" effect on high-residue frequencies
    if (residuo > 20) {
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();

        osc2.type = 'sawtooth';
        osc2.frequency.setValueAtTime(freqAudible + (residuo / 10), now);

        gain2.gain.setValueAtTime(0.0001, now);
        gain2.gain.linearRampToValueAtTime(0.12, now + 0.04);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + decayTime);

        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(now);
        osc2.stop(now + decayTime + 0.1);

        const entry2 = { osc: osc2, gain: gain2 };
        AppState.currentOscillators.push(entry2);

        osc2.onended = () => {
            const idx = AppState.currentOscillators.indexOf(entry2);
            if (idx !== -1) AppState.currentOscillators.splice(idx, 1);
            try { gain2.disconnect(); } catch (_) {}
        };
    }
}


// ============================================================
// TIMELINE & SCORE
// ============================================================
function addNoteToTimeline(modeIndex, freq) {
    // Limit timeline to prevent performance issues
    if (AppState.timeline.length >= MAX_TIMELINE_NOTES) {
        AppState.timeline.shift(); // Remove oldest note
    }

    AppState.timeline.push({ modeIndex, freq });
    renderScore();
}

function renderScore() {
    const container = document.getElementById('abc-render');
    const panel = document.getElementById('score-panel');

    if (AppState.timeline.length === 0) {
        container.innerHTML = '<p style="text-align:center;color:#999;font-size:0.8rem;padding:12px;">Toque um modo para ver a nota aqui</p>';
        return;
    }

    // Ensure panel is visible
    panel.classList.remove('collapsed');

    const abcString = generateABCString();
    if (!abcString) return;

    try {
        ABCJS.renderAbc("abc-render", abcString, {
            responsive: "resize",
            staffwidth: 300,
        });
    } catch (err) {
        console.warn('Erro ao renderizar partitura:', err);
        // Fallback: reset timeline if score breaks
        if (AppState.timeline.length > 50) {
            AppState.timeline = AppState.timeline.slice(-20);
            renderScore();
        }
    }
}

function generateABCString() {
    if (AppState.timeline.length === 0) return "";

    let abc = "X:1\nT:Orquestra Molecular\nM:4/4\nL:1/4\nK:C\n";
    let notes = "";

    // Only render last N notes to keep score readable on mobile
    const MAX_SCORE_NOTES = 32;
    const startIdx = Math.max(0, AppState.timeline.length - MAX_SCORE_NOTES);

    for (let i = startIdx; i < AppState.timeline.length; i++) {
        const entry = AppState.timeline[i];
        const absFreq = Math.abs(entry.freq);
        const residuo = absFreq % 100;

        // Map to MIDI
        const fMapped = Math.max(50, Math.min(absFreq, 4000));
        const midiIndex = Math.floor(36 + (Math.log(fMapped / 50) / Math.log(4000 / 50)) * (108 - 36));

        // Clamp MIDI to safe range for ABC notation
        const safeMidi = Math.max(36, Math.min(midiIndex, 96));

        const baseNoteStr = CHROMATIC_NOTES[safeMidi % 12];
        const octave = Math.floor(safeMidi / 12) - 1;

        const isAccidental = baseNoteStr.startsWith("^");
        const letter = isAccidental ? baseNoteStr[1] : baseNoteStr;
        const prefix = isAccidental ? "^" : "";

        let abcBaseNote = "";

        if (octave <= 2) {
            const commas = ",".repeat(Math.max(1, 3 - octave));
            abcBaseNote = prefix + letter + commas;
        } else if (octave === 3) {
            abcBaseNote = prefix + letter;
        } else if (octave >= 4) {
            const apostrophes = "'".repeat(Math.min(octave - 4, 3)); // Cap apostrophes
            abcBaseNote = prefix + letter.toLowerCase() + apostrophes;
        }

        // Color and dynamics
        const noteColor = NOTE_COLORS[i % NOTE_COLORS.length];
        let abcNote = `!color:${noteColor}! `;

        if (residuo > 20) {
            abcNote += "!trill! !ff! " + abcBaseNote;
        } else {
            abcNote += "!p! " + abcBaseNote;
        }

        notes += abcNote + " ";

        if ((i - startIdx + 1) % 4 === 0) notes += "| ";
        if ((i - startIdx + 1) % 16 === 0) notes += "\n";
    }

    return abc + notes;
}


// ============================================================
// SCORE PANEL TOGGLE
// ============================================================
function toggleScorePanel() {
    const panel = document.getElementById('score-panel');
    panel.classList.toggle('collapsed');
}
