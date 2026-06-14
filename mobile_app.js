const AppState = {
    molecules: [],
    currentMolecule: null,
    activeModeIndex: -1,
    timeline: [],
    viewer: null,
    audioCtx: null,
    animationTimer: null,
    currentOscillators: [],
    isTransitioning: false,
};

const NUM_FRAMES = 20;
const ANIMATION_INTERVAL_MS = 50;
const MAX_GRID_BUTTONS = 81;

const COVALENT_RADII = {
    'H': 0.32, 'C': 0.75, 'N': 0.71, 'O': 0.63, 'F': 0.64,
    'Si': 1.11, 'P': 1.11, 'S': 1.03, 'Cl': 0.99, 'Br': 1.14, 'I': 1.33,
    'B': 0.82,
};
const BOND_TOLERANCE = 0.45;

document.addEventListener('DOMContentLoaded', async () => {
    showLoader('Carregando...');
    createFloatingAtoms();
    try {
        const response = await fetch('db_moleculas.json');
        if (!response.ok) throw new Error('HTTP ' + response.status);
        AppState.molecules = await response.json();
        populateSelect();
    } catch (err) {
        console.error('Erro ao carregar db_moleculas.json:', err);
        alert('Erro ao carregar banco de dados.');
    } finally {
        hideLoader();
    }
    document.getElementById('mol-select').addEventListener('change', onMoleculeSelected);
    document.getElementById('btn-select').addEventListener('click', onSelectButtonClick);
    document.getElementById('btn-back').addEventListener('click', onBackButtonClick);
    document.getElementById('score-header').addEventListener('click', toggleScorePanel);
});

function showLoader(text) {
    document.getElementById('loader-text').textContent = text;
    document.getElementById('loader').classList.add('active');
}
function hideLoader() {
    document.getElementById('loader').classList.remove('active');
}

function showScreen(screenId) {
    if (AppState.isTransitioning) return;
    AppState.isTransitioning = true;
    document.querySelectorAll('.screen').forEach(s => {
        s.classList.add('hidden');
        s.classList.remove('visible');
    });
    const target = document.getElementById(screenId);
    requestAnimationFrame(() => {
        target.classList.remove('hidden');
        target.classList.add('visible');
        setTimeout(() => { AppState.isTransitioning = false; }, 500);
    });
}

function createFloatingAtoms() {
    const container = document.getElementById('floating-atoms');
    if (!container) return;
    const colors = ['rgba(139,92,246,0.3)', 'rgba(236,72,153,0.2)', 'rgba(167,139,250,0.2)'];
    for (let i = 0; i < 12; i++) {
        const p = document.createElement('div');
        p.className = 'atom-particle';
        const size = 4 + Math.random() * 12;
        p.style.width = size + 'px';
        p.style.height = size + 'px';
        p.style.left = Math.random() * 100 + '%';
        p.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        p.style.animationDuration = (8 + Math.random() * 16) + 's';
        p.style.animationDelay = (-Math.random() * 20) + 's';
        container.appendChild(p);
    }
}

function populateSelect() {
    const select = document.getElementById('mol-select');
    const sorted = [...AppState.molecules].sort((a, b) => a.nome.localeCompare(b.nome));
    sorted.forEach(mol => {
        const opt = document.createElement('option');
        opt.value = mol.id;
        opt.textContent = mol.nome + ' (' + mol.data.freqs.length + ' modos)';
        select.appendChild(opt);
    });
}

function onMoleculeSelected(e) {
    document.getElementById('btn-select').disabled = !e.target.value;
}

function onSelectButtonClick() {
    const selectedId = document.getElementById('mol-select').value;
    if (!selectedId) return;
    const mol = AppState.molecules.find(m => m.id === selectedId);
    if (!mol) return;
    AppState.currentMolecule = mol;
    AppState.activeModeIndex = -1;
    AppState.timeline = [];
    document.getElementById('viewer-mol-name').textContent = mol.nome;
    document.getElementById('abc-render').innerHTML = '';
    showScreen('screen-viewer');
    setTimeout(() => {
        initViewer(mol);
        renderModeGrid(mol);
    }, 300);
}

function onBackButtonClick() {
    stopAnimation();
    cancelAllAudio();
    AppState.currentMolecule = null;
    AppState.activeModeIndex = -1;
    AppState.timeline = [];
    if (AppState.viewer) AppState.viewer.clear();
    showScreen('screen-select');
}

function initViewer(mol) {
    const container = document.getElementById('mol-viewer');
    container.innerHTML = '';
    AppState.viewer = $3Dmol.createViewer(container, { backgroundColor: '#0c0418' });
    loadMoleculeIntoViewer(mol.data, 0);
}

function loadMoleculeIntoViewer(molData, modeIndex) {
    stopAnimation();
    const viewer = AppState.viewer;
    if (!viewer) return;
    const atoms = molData.atoms;
    const coords = molData.coords;
    const modeArray = molData.modes[modeIndex] || [];

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
        maxDistSq = Math.max(maxDistSq, dx*dx + dy*dy + dz*dz);
    }

    let scale = maxDistSq > 1e-10 ? (0.15 / Math.sqrt(maxDistSq)) : 0;
    if (scale === 0) {
        for (let i = 0; i < atoms.length; i++) {
            rawVectors[i] = { dx: coords[i][0]*0.01, dy: coords[i][1]*0.01, dz: coords[i][2]*0.01 };
        }
        scale = 1.0;
    }
    const vectors = rawVectors.map(v => ({ dx: v.dx*scale, dy: v.dy*scale, dz: v.dz*scale }));

    const bonds = [];
    for (let i = 0; i < atoms.length; i++) {
        for (let j = i+1; j < atoms.length; j++) {
            const dx = coords[i][0]-coords[j][0], dy = coords[i][1]-coords[j][1], dz = coords[i][2]-coords[j][2];
            const d2 = dx*dx+dy*dy+dz*dz;
            const r1 = COVALENT_RADII[atoms[i]]||1.0, r2 = COVALENT_RADII[atoms[j]]||1.0;
            const lim = r1+r2+BOND_TOLERANCE;
            if (d2 <= lim*lim) bonds.push([i+1, j+1]);
        }
    }

    const pad = (n,s) => { let r=n.toString(); while(r.length<s) r=" "+r; return r; };
    const padR = (str,s) => { while(str.length<s) str+=" "; return str; };
    const fmtC = (c) => { let r=c.toFixed(4); while(r.length<10) r=" "+r; return r; };

    let sdf = "";
    for (let f = 0; f < NUM_FRAMES; f++) {
        const phase = Math.sin((f/NUM_FRAMES)*Math.PI*2);
        sdf += "Frame_"+f+"\n  OM\n\n";
        sdf += pad(atoms.length,3)+pad(bonds.length,3)+"  0  0  0  0  0  0  0  0  1 V2000\n";
        for (let i = 0; i < atoms.length; i++) {
            sdf += fmtC(coords[i][0]+vectors[i].dx*phase)+fmtC(coords[i][1]+vectors[i].dy*phase)+fmtC(coords[i][2]+vectors[i].dz*phase)+" "+padR(atoms[i],3)+" 0  0  0  0  0  0  0  0  0  0  0  0\n";
        }
        for (const b of bonds) sdf += pad(b[0],3)+pad(b[1],3)+"  1  0  0  0  0\n";
        sdf += "M  END\n$$$$\n";
    }

    viewer.clear();
    viewer.addModelsAsFrames(sdf, "sdf");
    viewer.setStyle({}, { stick: { radius: 0.15 }, sphere: { radius: 0.35 } });
    viewer.zoomTo();
    viewer.render();
    startAnimation(viewer);
}

function startAnimation(viewer) {
    let frame = 0;
    AppState.animationTimer = setInterval(() => {
        frame = (frame+1) % NUM_FRAMES;
        viewer.setFrame(frame);
        viewer.render();
    }, ANIMATION_INTERVAL_MS);
}

function stopAnimation() {
    if (AppState.animationTimer) { clearInterval(AppState.animationTimer); AppState.animationTimer = null; }
}

function renderModeGrid(mol) {
    const grid = document.getElementById('modes-grid');
    const countEl = document.getElementById('modes-count');
    const data = mol.data;
    const total = Math.min(data.freqs.length, MAX_GRID_BUTTONS);
    countEl.textContent = data.freqs.length + ' modos';
    let html = '';
    for (let i = 0; i < total; i++) {
        const freq = data.freqs[i];
        const sym = (data.syms && data.syms[i] && data.syms[i] !== 'N/A') ? data.syms[i] : '';
        html += '<button class="mode-btn" data-index="'+i+'" id="mode-btn-'+i+'" onclick="onModeButtonClick('+i+')">';
        html += '<span class="mode-number">Modo '+(i+1)+'</span>';
        html += '<span class="mode-freq">'+Math.abs(freq).toFixed(0)+'</span>';
        html += '<span class="mode-unit">cm\u207b\u00b9</span>';
        if (sym) html += '<span class="mode-sym">'+sym+'</span>';
        html += '</button>';
    }
    grid.innerHTML = html;
}

function onModeButtonClick(index) {
    if (!AppState.currentMolecule) return;
    const data = AppState.currentMolecule.data;
    if (index < 0 || index >= data.freqs.length) return;
    stopAnimation();
    cancelAllAudio();
    document.querySelectorAll('.mode-btn.active').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById('mode-btn-'+index);
    if (btn) btn.classList.add('active');
    AppState.activeModeIndex = index;
    loadMoleculeIntoViewer(data, index);
    playModeAudio(data.freqs[index]);
    addNoteToTimeline(index, data.freqs[index]);
}

function getAudioContext() {
    if (!AppState.audioCtx) AppState.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (AppState.audioCtx.state === 'suspended') AppState.audioCtx.resume();
    return AppState.audioCtx;
}

function cancelAllAudio() {
    for (const e of AppState.currentOscillators) {
        try { e.osc.stop(0); e.gain.disconnect(); } catch(_) {}
    }
    AppState.currentOscillators = [];
}

function playModeAudio(freq) {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const absFreq = Math.abs(freq);
    const fMapped = Math.max(50, Math.min(absFreq, 4000));
    const floatMidi = 36 + (Math.log(fMapped/50) / Math.log(4000/50)) * (108-36);
    let freqAud = 440 * Math.pow(2, (floatMidi-69)/12);
    if (isNaN(freqAud) || freqAud <= 0) freqAud = 440;
    const decay = 0.8;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = (absFreq % 100) > 20 ? 'sawtooth' : 'sine';
    osc.frequency.setValueAtTime(freqAud, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.25, now+0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, now+decay);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(now); osc.stop(now+decay+0.1);
    const entry = { osc, gain };
    AppState.currentOscillators.push(entry);
    osc.onended = () => { const idx = AppState.currentOscillators.indexOf(entry); if (idx!==-1) AppState.currentOscillators.splice(idx,1); try{gain.disconnect();}catch(_){} };
}

function addNoteToTimeline(modeIndex, freq) {
    if (AppState.timeline.length >= 200) AppState.timeline.shift();
    AppState.timeline.push({ modeIndex, freq });
    renderScore();
}

function freqToAbcNote(freq) {
    const absFreq = Math.abs(freq);
    const fMapped = Math.max(50, Math.min(absFreq, 4000));
    const midi = Math.round(36 + (Math.log(fMapped/50) / Math.log(4000/50)) * (108-36));
    const safe = Math.max(48, Math.min(midi, 83));
    const names = ['C','^C','D','^D','E','F','^F','G','^G','A','^A','B'];
    const name = names[safe % 12];
    const oct = Math.floor(safe / 12) - 1;
    const isSharp = name.startsWith('^');
    const letter = isSharp ? name[1] : name;
    const prefix = isSharp ? '^' : '';
    let abcBaseNote = "";
    if (oct <= 3) {
        abcBaseNote = prefix + letter + (oct < 3 ? ','.repeat(3 - oct) : '');
    } else {
        abcBaseNote = prefix + letter.toLowerCase() + (oct > 4 ? "'".repeat(Math.min(oct - 4, 2)) : '');
    }
    
    const residuo = absFreq % 100;
    if (residuo > 20) {
        return "!trill!!ff!" + abcBaseNote;
    } else {
        return "!p!" + abcBaseNote;
    }
}

function renderScore() {
    const el = document.getElementById('abc-render');
    if (AppState.timeline.length === 0) {
        el.innerHTML = '';
        return;
    }
    const maxNotes = 24;
    const start = Math.max(0, AppState.timeline.length - maxNotes);
    let notes = '';
    for (let i = start; i < AppState.timeline.length; i++) {
        notes += freqToAbcNote(AppState.timeline[i].freq);
        if ((i - start + 1) % 4 === 0) notes += '|';
    }
    notes += '|]';
    const abc = 'X:1\nM:4/4\nL:1/4\nK:C\n' + notes;
    console.log('ABC:', abc);
    ABCJS.renderAbc(el, abc, { staffwidth: 300 });
}

function toggleScorePanel() {
    const content = document.getElementById('score-content');
    const icon = document.getElementById('toggle-icon');
    content.classList.toggle('collapsed');
    icon.classList.toggle('rotated');
}