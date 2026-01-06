// ======================================================
// 1. PWA & CONFIGURATION
// ======================================================
if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("sw.js").catch(e => console.log("SW Fail:", e));
    });
}
window.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const action = params.get('action');
    if(action && currentUser) {
        setTimeout(() => {
            if (action === 'exam') { showScreen('dashboard-screen'); setMode('test'); document.getElementById('study-panel').scrollIntoView(); }
            else if (action === 'stats') openAnalytics();
            else if (action === 'mistakes') startMistakePractice();
        }, 1000);
    }
    // Install Button Handler
    const installBtn = document.getElementById('install-btn');
    if(installBtn) {
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            let deferredPrompt = e;
            installBtn.style.display = 'block';
            installBtn.onclick = () => {
                deferredPrompt.prompt();
                deferredPrompt.userChoice.then(c => { deferredPrompt = null; });
            };
        });
    }
});

const COURSE_CONFIG = {
    'FCPS': { name: "FCPS Part 1", sheet: "https://docs.google.com/spreadsheets/d/e/2PACX-1vR8aw1eGppF_fgvI5VAOO_3XEONyI-4QgWa0IgQg7K-VdxeFyn4XBpWT9tVDewbQ6PnMEQ80XpwbASh/pub?output=csv", prefix: "", theme: "" },
    'MBBS_1': { name: "First Year", sheet: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQavpclI1-TLczhnGiPiF7g6rG32F542mmjCBIg612NcSAkdhXScIgsK6-4w6uGVM9l_XbQe6aCiOyE/pub?output=csv", prefix: "MBBS1_", theme: "mbbs-mode" },
    'MBBS_2': { name: "Second Year", sheet: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQvD7HQYS6gFFcwo4_DTkvR9BIh70xjM4M1XMTSD5DFeGv69BTXtGVchf3ON6CFxRJ3GIN7t2ojU5Gb/pub?output=csv", prefix: "MBBS2_", theme: "mbbs-mode" },
    'MBBS_3': { name: "Third Year", sheet: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSPwZrNWryh937oxXV1zwnBYtnhysGCiJ0wLaV7J941MFGVhaG_1BC-ZODYZlgDATW6UOXrJrac-bdV/pub?output=csv", prefix: "MBBS3_", theme: "mbbs-mode" },
    'MBBS_4': { name: "Fourth Year", sheet: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTTGsPZWg-U9_zG2_FWkQWDp5nsQ8OVGqQnoqdqxw4bQz2JSAYsgPvrgbrwX8gtiJj5LrY9MUaNvkBn/pub?output=csv", prefix: "MBBS4_", theme: "mbbs-mode" },
    'MBBS_5': { name: "Final Year", sheet: "https://docs.google.com/spreadsheets/d/e/2PACX-1vS6fLWMz_k89yK_S8kfjqAGs9I_fGzBE-WQ-Ci8l-D5ownRGV0I1Tz-ifZZKBOTXZAx9bvs4wVuWLID/pub?output=csv", prefix: "MBBS_", theme: "mbbs-mode" }
};

const firebaseConfig = {
  apiKey: "AIzaSyAhrX36_mEA4a3VIuSq3rYYZi0PH5Ap_ks",
  authDomain: "fcps-prep.firebaseapp.com",
  projectId: "fcps-prep",
  storageBucket: "fcps-prep.firebasestorage.app",
  messagingSenderId: "949920276784",
  appId: "1:949920276784:web:c9af3432814c0f80e028f5"
};

if (typeof firebase !== 'undefined' && !firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
    firebase.firestore().enablePersistence().catch(() => {});
}
const auth = firebase.auth();
const db = firebase.firestore();

// ======================================================
// 2. STATE VARIABLES
// ======================================================
let currentUser = null, userProfile = null, isGuest = false;
let currentCourse = 'FCPS'; 
let allQuestions = [], filteredQuestions = [];
let userBookmarks = [], userSolvedIDs = [], userMistakes = [];
let currentMode = 'practice', isMistakeReview = false, currentIndex = 0; 
let testTimer = null, testAnswers = {}, testFlags = {}, testTimeRemaining = 0;
let selectedSubjectForModal = "", selectedExamTopics = [];
let currentDeviceId = localStorage.getItem('fcps_device_id') || ('dev_' + Math.random().toString(36).substr(2, 9));
localStorage.setItem('fcps_device_id', currentDeviceId);

// ======================================================
// 3. AUTH & ROUTING
// ======================================================
auth.onAuthStateChanged(async (user) => {
    if (user) {
        currentUser = user; isGuest = false;
        document.getElementById('auth-screen').classList.add('hidden');
        document.getElementById('auth-screen').classList.remove('active');
        
        const lastCourse = localStorage.getItem('last_active_course');
        const isAdminMode = localStorage.getItem('admin_mode') === 'true';

        if (isAdminMode && lastCourse && COURSE_CONFIG[lastCourse]) {
            currentCourse = lastCourse;
            loadQuestions(COURSE_CONFIG[lastCourse].sheet);
            loadUserData();
        } else if (lastCourse && COURSE_CONFIG[lastCourse]) {
            selectCourse(lastCourse); 
        } else {
            showScreen('course-selection-screen');
            updateCourseSelectionUI();
        }
        checkLoginSecurity(user);
    } else {
        if (!isGuest) { currentUser = null; showScreen('auth-screen'); }
    }
});

async function checkLoginSecurity(user) {
    const docRef = db.collection('users').doc(user.uid);
    const doc = await docRef.get();
    if (!doc.exists) await docRef.set({ email: user.email, deviceId: currentDeviceId, role: 'student', joined: new Date(), isPremium: false, solved: [], bookmarks: [], mistakes: [] }, { merge: true });
    else await docRef.update({ deviceId: currentDeviceId });

    docRef.onSnapshot((snap) => {
        if (!snap.exists) return;
        userProfile = snap.data();
        if (userProfile.deviceId && userProfile.deviceId !== currentDeviceId) {
            auth.signOut(); alert("Logged in on another device."); location.reload();
        }
        updateCourseSelectionUI();
        if (userProfile.role === 'admin') document.getElementById('admin-btn').classList.remove('hidden');
    });
}

function updateCourseSelectionUI() {
    if(!userProfile) return;
    ['FCPS','MBBS_1','MBBS_2','MBBS_3','MBBS_4','MBBS_5'].forEach(k => {
        const conf = COURSE_CONFIG[k];
        const p = conf.prefix;
        const isPrem = userProfile[p+'isPremium'] || (k==='FCPS' && userProfile.isPremium);
        const exp = userProfile[p+'expiryDate'] || (k==='FCPS' && userProfile.expiryDate);
        const active = isPrem && isDateActive(exp);
        const el = document.getElementById(k==='FCPS'?'status-badge-FCPS':k.replace('_','status-badge-'));
        if(el) { el.innerText = active ? "✅ Active" : "🔒 Free"; el.style.background = active ? "#d1fae5" : "#e2e8f0"; }
    });
}

function selectCourse(c) {
    if (!COURSE_CONFIG[c]) return alert("Coming soon!");
    localStorage.setItem('last_active_course', c);
    currentCourse = c;
    const config = COURSE_CONFIG[c];
    document.body.className = config.theme;
    document.getElementById('active-course-badge').innerText = config.name;
    document.getElementById('stats-title').innerText = `📊 ${config.name} Progress`;
    showScreen('dashboard-screen');
    loadQuestions(config.sheet); loadUserData();
}

function returnToCourseSelection() {
    localStorage.removeItem('last_active_course');
    showScreen('course-selection-screen');
    document.getElementById('main-menu-container').classList.remove('hidden');
    document.getElementById('mbbs-years-container').classList.add('hidden');
    updateCourseSelectionUI();
}

function guestLogin() {
    isGuest = true; userProfile = { role: 'guest' };
    selectCourse('FCPS');
    document.getElementById('user-display').innerText = "Guest";
    document.getElementById('premium-badge').classList.add('hidden');
    alert("👤 Guest Mode: Progress NOT saved.");
}

async function login() {
    const e = document.getElementById('email').value.trim(), p = document.getElementById('password').value;
    if(!e || !p) return alert("Enter details");
    document.getElementById('auth-msg').innerText = "Verifying...";
    try {
        let email = e;
        if (!e.includes('@')) {
            const s = await db.collection('users').where('username','==',e.toLowerCase()).limit(1).get();
            if(s.empty) throw new Error("User not found");
            email = s.docs[0].data().email;
        }
        await auth.signInWithEmailAndPassword(email, p);
    } catch(err) { document.getElementById('auth-msg').innerText = "❌ " + err.message; }
}

async function logout() {
    await auth.signOut(); localStorage.clear(); location.reload();
}

// ======================================================
// 4. DATA LOGIC
// ======================================================
async function loadUserData() {
    if(isGuest) { renderStatsUI(document.getElementById('quick-stats')); return; }
    if(!currentUser) { setTimeout(loadUserData,500); return; }
    
    let data;
    try {
        const doc = await db.collection('users').doc(currentUser.uid).get();
        if(doc.exists) { data = doc.data(); localStorage.setItem('cached_user', JSON.stringify(data)); }
    } catch(e) {}
    if(!data) data = JSON.parse(localStorage.getItem('cached_user')||'null');
    
    if(data) {
        userProfile = data;
        const k = getStoreKey('');
        userSolvedIDs = userProfile[k+'solved'] || [];
        userBookmarks = userProfile[k+'bookmarks'] || [];
        userMistakes = userProfile[k+'mistakes'] || [];
        renderStatsUI(document.getElementById('quick-stats'));
        checkPremiumExpiry();
    }
}

function getStoreKey(base) { return COURSE_CONFIG[currentCourse].prefix + base; }

function renderStatsUI(box) {
    if(!box) return;
    if(isGuest) { box.innerHTML = "Guest Mode (Unsaved)"; return; }
    const acc = userSolvedIDs.length > 0 ? Math.round((userSolvedIDs.length / (userSolvedIDs.length + userMistakes.length)) * 100) : 0;
    box.innerHTML = `<div>✅ Solved: <b>${userSolvedIDs.length}</b></div>
                     <div>🎯 Accuracy: <b>${acc}%</b></div>
                     <div>❌ Mistakes: <b>${userMistakes.length}</b></div>`;
}

function loadQuestions(url) {
    const key = 'cached_q_' + currentCourse;
    Papa.parse(url, {
        download: true, header: true, skipEmptyLines: true,
        complete: (res) => {
            localStorage.setItem(key, JSON.stringify(res.data));
            processData(res.data);
        },
        error: () => {
            const c = localStorage.getItem(key);
            if(c) { alert("Offline Mode"); processData(JSON.parse(c)); }
            else alert("Offline & No Data.");
        }
    });
}

function processData(data) {
    const seen = new Set(); allQuestions = [];
    data.forEach((row, i) => {
        const q = row.Question || row.Questions;
        if(!q || !row.CorrectAnswer) return;
        const sig = q.trim().toLowerCase();
        if(seen.has(sig)) return; seen.add(sig);
        
        row._uid = "id_" + Math.abs(generateHash(sig));
        row.Question = q; row.Subject = (row.Subject||"General").trim(); row.Topic = (row.Topic||"Mixed").trim();
        allQuestions.push(row);
    });
    renderSubjectGrid();
    if(document.getElementById('admin-total-q')) document.getElementById('admin-total-q').innerText = allQuestions.length;
}
function generateHash(s) { let h=0; for(let i=0;i<s.length;i++) h=((h<<5)-h)+s.charCodeAt(i)|0; return h; }

// ======================================================
// 5. NEW UI: GRID & MODALS
// ======================================================
function handleSearchInput() { renderSubjectGrid(document.getElementById('subject-search').value); }

function renderSubjectGrid(filter='') {
    const grid = document.getElementById('subject-grid');
    if(!grid) return;
    grid.innerHTML = "";
    const term = filter.toLowerCase();
    const subjs = [...new Set(allQuestions.map(q=>q.Subject))].sort();
    
    let found = false;
    subjs.forEach(sub => {
        const qs = allQuestions.filter(q=>q.Subject===sub);
        if(term && !sub.toLowerCase().includes(term) && !qs.some(q=>(q.Topic||"").toLowerCase().includes(term))) return;
        found = true;
        
        const solved = qs.filter(q=>userSolvedIDs.includes(q._uid)).length;
        const pct = qs.length ? Math.round((solved/qs.length)*100) : 0;
        
        const card = document.createElement('div');
        card.className = 'subject-card';
        card.style.cssText = "background:white; border:1px solid #e2e8f0; border-radius:12px; padding:16px; margin-bottom:15px; cursor:pointer;";
        card.innerHTML = `
            <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
                <h3 style="margin:0; font-size:16px;">${sub}</h3>
                <span style="font-size:11px; background:#d1fae5; padding:4px 10px; border-radius:20px;">${solved}/${qs.length}</span>
            </div>
            <div style="background:#f1f5f9; height:8px; border-radius:4px;"><div style="width:${pct}%; background:#10b981; height:100%;"></div></div>`;
        card.onclick = () => openSubjectModal(sub);
        grid.appendChild(card);
    });
    if(!found) grid.innerHTML = "<div style='text-align:center; padding:20px;'>No subjects found.</div>";
}

function openSubjectModal(sub) {
    selectedSubjectForModal = sub; selectedExamTopics = [];
    const modal = document.getElementById('study-modal');
    document.getElementById('modal-subject-title').innerText = sub;
    const qs = allQuestions.filter(q=>q.Subject===sub);
    const topics = [...new Set(qs.map(q=>q.Topic))].sort();
    
    const list = document.getElementById('modal-topic-list');
    const actions = document.getElementById('modal-actions-area');
    list.innerHTML = ""; actions.innerHTML = "";

    if(currentMode === 'practice') {
        document.getElementById('exam-settings-area').classList.add('hidden');
        document.getElementById('modal-footer').style.display = 'none';
        
        const btn = document.createElement('button');
        btn.innerHTML = `<b>Practice Entire Subject</b> (${qs.length} Qs)`;
        btn.style.cssText = "width:100%; padding:15px; background:#10b981; color:white; border:none; border-radius:10px; margin-bottom:15px;";
        btn.onclick = () => { closeStudyModal(); startPractice(sub, null); };
        actions.appendChild(btn);

        topics.forEach(t => {
            const row = document.createElement('div');
            row.style.cssText = "padding:12px; border:1px solid #eee; margin-bottom:5px; border-radius:8px; cursor:pointer;";
            row.innerText = t;
            row.onclick = () => { closeStudyModal(); startPractice(sub, t); };
            list.appendChild(row);
        });
    } else {
        document.getElementById('exam-settings-area').classList.remove('hidden');
        document.getElementById('modal-footer').style.display = 'block';
        actions.innerHTML = `<div style="padding:10px; background:#f8fafc;"><input type="checkbox" onchange="toggleSelectAllTopics(this)"> Select All</div>`;
        
        topics.forEach(t => {
            const row = document.createElement('div');
            row.style.cssText = "padding:12px; border-bottom:1px solid #eee; cursor:pointer;";
            row.innerText = t;
            row.onclick = () => {
                row.classList.toggle('selected'); row.style.background = row.classList.contains('selected') ? '#eff6ff' : 'white';
                if(row.classList.contains('selected')) selectedExamTopics.push(t);
                else selectedExamTopics = selectedExamTopics.filter(x=>x!==t);
            };
            list.appendChild(row);
        });
    }
    modal.classList.remove('hidden');
}
function toggleSelectAllTopics(cb) {
    const list = document.getElementById('modal-topic-list').children;
    const all = [...new Set(allQuestions.filter(q=>q.Subject===selectedSubjectForModal).map(q=>q.Topic))];
    Array.from(list).forEach(r => {
        r.classList.toggle('selected', cb.checked);
        r.style.background = cb.checked ? '#eff6ff' : 'white';
    });
    selectedExamTopics = cb.checked ? all : [];
}
function closeStudyModal() { document.getElementById('study-modal').classList.add('hidden'); }

// ======================================================
// 6. QUIZ LOGIC
// ======================================================
function setMode(m) {
    currentMode = m;
    document.getElementById('btn-mode-practice').classList.toggle('active', m==='practice');
    document.getElementById('btn-mode-test').classList.toggle('active', m==='test');
    if(document.getElementById('study-modal').classList.contains('hidden')) renderSubjectGrid(document.getElementById('subject-search').value);
}

function startPractice(sub, top) {
    let pool = allQuestions.filter(q=>q.Subject===sub);
    if(top) pool = pool.filter(q=>q.Topic===top);
    
    // Limits
    const isAdmin = userProfile && userProfile.role==='admin';
    const isPrem = userProfile && (userProfile[getStoreKey('isPremium')] || userProfile.isPremium);
    if(!isAdmin && !isPrem && pool.length>50) pool = pool.slice(0,50);
    if(isGuest && pool.length>20) pool = pool.slice(0,20);
    
    if(pool.length===0) return alert("No questions.");
    if(document.getElementById('unattempted-only').checked) pool = pool.filter(q=>!userSolvedIDs.includes(q._uid));
    
    filteredQuestions = pool; currentMode = 'practice'; currentIndex = 0;
    showScreen('quiz-screen'); renderPage();
}

function startExamFromModal() {
    if(!selectedExamTopics.length) return alert("Select topic");
    let pool = allQuestions.filter(q=>q.Subject===selectedSubjectForModal && selectedExamTopics.includes(q.Topic));
    if(document.getElementById('unattempted-only').checked) pool = pool.filter(q=>!userSolvedIDs.includes(q._uid));
    if(!pool.length) return alert("No questions");
    
    const count = parseInt(document.getElementById('new-exam-q-count').value)||20;
    filteredQuestions = pool.sort(()=>Math.random()-0.5).slice(0,count);
    closeStudyModal();
    currentMode = 'test'; currentIndex = 0; testAnswers = {}; testFlags = {};
    testTimeRemaining = (parseInt(document.getElementById('new-exam-timer').value)||30)*60;
    showScreen('quiz-screen'); renderPage();
    if(testTimer) clearInterval(testTimer);
    testTimer = setInterval(updateTimer, 1000);
}

function startMistakePractice() {
    if(!userMistakes.length) return alert("No mistakes!");
    filteredQuestions = allQuestions.filter(q=>userMistakes.includes(q._uid));
    currentMode = 'practice'; currentIndex = 0;
    showScreen('quiz-screen'); renderPage();
}

function renderPage() {
    const box = document.getElementById('quiz-content-area');
    if(!box) return; box.innerHTML = "";
    if(currentMode==='test') {
        document.getElementById('timer').classList.remove('hidden');
        document.getElementById('test-sidebar').classList.add('active');
        renderNavigator();
    } else {
        document.getElementById('timer').classList.add('hidden');
        document.getElementById('test-sidebar').classList.remove('active');
        renderPracticeNavigator();
    }
    
    const q = filteredQuestions[currentIndex];
    if(q) box.appendChild(createQuestionCard(q, currentIndex));
    
    document.getElementById('prev-btn').classList.toggle('hidden', currentIndex===0);
    const isLast = currentIndex === filteredQuestions.length-1;
    document.getElementById('next-btn').classList.toggle('hidden', isLast);
    document.getElementById('submit-btn').classList.toggle('hidden', !(currentMode==='test'&&isLast));
}

function createQuestionCard(q, idx) {
    const div = document.createElement('div');
    div.className = 'test-question-block';
    if(testFlags[q._uid]) div.classList.add('is-flagged-card');
    
    div.innerHTML = `
    <div class="question-card-header">
        <span class="q-number-tag">Q ${idx+1}</span>
        <div>
            <button class="action-icon-btn" onclick="toggleFlag('${q._uid}')">${testFlags[q._uid]?'🚩':'🏳️'}</button>
        </div>
    </div>
    <div class="test-q-text">${q.Question}</div>`;
    
    const opts = document.createElement('div'); opts.className = 'options-group';
    const raw = [q.OptionA, q.OptionB, q.OptionC, q.OptionD, q.OptionE].filter(x=>x);
    raw.forEach(o => {
        const btn = document.createElement('button'); btn.className = 'option-btn';
        btn.innerText = o;
        if(testAnswers[q._uid]===o) btn.classList.add('selected');
        btn.onclick = () => checkAnswer(o, btn, q);
        opts.appendChild(btn);
    });
    div.appendChild(opts);
    return div;
}

function checkAnswer(sel, btn, q) {
    if(currentMode==='test') {
        testAnswers[q._uid] = sel;
        Array.from(btn.parentElement.children).forEach(b=>b.classList.remove('selected'));
        btn.classList.add('selected'); renderNavigator();
    } else {
        const corr = q.CorrectAnswer.trim();
        let isRight = (sel.toLowerCase() === corr.toLowerCase());
        if(!isRight && q['Option'+corr] === sel) isRight = true;
        
        btn.style.background = isRight ? '#dcfce7' : '#fee2e2';
        updateStats(isRight, q);
        if(isRight) {
            document.getElementById('explanation-text').innerHTML = q.Explanation || "Correct!";
            document.getElementById('explanation-modal').classList.remove('hidden');
        }
    }
}

async function updateStats(isCorrect, q) {
    if(!currentUser || isGuest) return;
    const k = getStoreKey('');
    if(isCorrect) {
        if(!userSolvedIDs.includes(q._uid)) {
            userSolvedIDs.push(q._uid);
            await db.collection('users').doc(currentUser.uid).update({ [k+'solved']: firebase.firestore.FieldValue.arrayUnion(q._uid) });
        }
    } else {
        if(!userMistakes.includes(q._uid)) {
            userMistakes.push(q._uid);
            await db.collection('users').doc(currentUser.uid).update({ [k+'mistakes']: firebase.firestore.FieldValue.arrayUnion(q._uid) });
        }
    }
    renderPracticeNavigator();
}

function updateTimer() {
    testTimeRemaining--;
    const m = Math.floor(testTimeRemaining/60), s = testTimeRemaining%60;
    document.getElementById('timer').innerText = `${m}:${s<10?'0':''}${s}`;
    if(testTimeRemaining<=0) submitTest();
}
function submitTest() {
    clearInterval(testTimer);
    let score = 0;
    filteredQuestions.forEach(q => {
        const u = testAnswers[q._uid], c = q.CorrectAnswer;
        if(u && (u===c || q['Option'+c]===u)) score++;
    });
    showScreen('result-screen');
    document.getElementById('final-score').innerText = `${Math.round((score/filteredQuestions.length)*100)}%`;
}

// ======================================================
// 7. UTILS & ADMIN
// ======================================================
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s=>s.classList.add('hidden'));
    document.querySelectorAll('.modal-overlay').forEach(m=>m.classList.add('hidden'));
    const el = document.getElementById(id);
    if(el) { el.classList.remove('hidden'); el.classList.add('active'); }
}
function renderNavigator() {
    const n = document.getElementById('nav-grid'); n.innerHTML = "";
    filteredQuestions.forEach((q,i) => {
        const b = document.createElement('button'); b.innerText = i+1;
        if(testAnswers[q._uid]) b.style.background = "#3b82f6";
        b.onclick = () => { currentIndex = i; renderPage(); };
        n.appendChild(b);
    });
}
function renderPracticeNavigator() {
    const n = document.getElementById('practice-nav-container'); n.innerHTML = ""; n.classList.remove('hidden');
    filteredQuestions.forEach((q,i) => {
        const b = document.createElement('button'); b.className = "nav-btn"; b.innerText = i+1;
        if(userSolvedIDs.includes(q._uid)) b.style.color = "#10b981";
        if(userMistakes.includes(q._uid)) b.style.color = "#ef4444";
        b.onclick = () => { currentIndex = i; renderPage(); };
        n.appendChild(b);
    });
}
function toggleFlag(id) { testFlags[id] = !testFlags[id]; renderPage(); }
function nextPage() { if(currentIndex<filteredQuestions.length-1) { currentIndex++; renderPage(); } }
function prevPage() { if(currentIndex>0) { currentIndex--; renderPage(); } }
function nextPageFromModal() { document.getElementById('explanation-modal').classList.add('hidden'); nextPage(); }
function closeModal() { document.getElementById('explanation-modal').classList.add('hidden'); }
function goHome() { clearInterval(testTimer); showScreen('dashboard-screen'); loadUserData(); }

function openAdminPanel() {
    if(userProfile.role!=='admin') return alert("Denied");
    showScreen('admin-screen'); loadAllUsers();
}
async function loadAllUsers() {
    const l = document.getElementById('admin-user-result'); l.innerHTML = "Loading...";
    const s = await db.collection('users').get();
    let h = "";
    s.forEach(d => {
        const u = d.data();
        h += `<div style="padding:10px; border-bottom:1px solid #eee;">
            <b>${u.email}</b> (${u.role}) 
            <button onclick="adminGrant('${d.id}')">Grant</button>
            <button onclick="adminRevoke('${d.id}')">Revoke</button>
        </div>`;
    });
    l.innerHTML = h;
}
async function adminGrant(uid) {
    await db.collection('users').doc(uid).update({ isPremium: true, expiryDate: new Date(Date.now()+86400000*30) });
    alert("Granted 30 days"); loadAllUsers();
}
async function adminRevoke(uid) {
    await db.collection('users').doc(uid).update({ isPremium: false });
    alert("Revoked"); loadAllUsers();
}
function switchAdminTab(t) {
    ['users','reports','payments','keys'].forEach(x=>document.getElementById('tab-'+x).classList.add('hidden'));
    document.getElementById('tab-'+t).classList.remove('hidden');
    if(t==='users') loadAllUsers();
}
function isDateActive(d) { return d ? new Date() < (d.toDate?d.toDate():new Date(d)) : false; }
function showMbbsYears() { document.getElementById('main-menu-container').classList.add('hidden'); document.getElementById('mbbs-years-container').classList.remove('hidden'); }
function backToMainMenu() { document.getElementById('mbbs-years-container').classList.add('hidden'); document.getElementById('main-menu-container').classList.remove('hidden'); }

let isSignupMode = false;
function toggleAuthMode() {
    isSignupMode = !isSignupMode;
    document.getElementById('auth-title').innerText = isSignupMode ? "Sign Up" : "Log In";
    document.getElementById('main-auth-btn').innerText = isSignupMode ? "Sign Up" : "Log In";
    document.getElementById('signup-username-group').classList.toggle('hidden', !isSignupMode);
}
function handleAuthAction() { isSignupMode ? signup() : login(); }
async function signup() {
    const e=document.getElementById('email').value, p=document.getElementById('password').value;
    try { await auth.createUserWithEmailAndPassword(e,p); await db.collection('users').doc(auth.currentUser.uid).set({email:e, role:'student', joined:new Date()}); }
    catch(err){ alert(err.message); }
}
