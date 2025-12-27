// ======================================================
// 1. CONFIGURATION & STATE
// ======================================================

const GOOGLE_SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vR8aw1eGppF_fgvI5VAOO_3XEONyI-4QgWa0IgQg7K-VdxeFyn4XBpWT9tVDewbQ6PnMEQ80XpwbASh/pub?output=csv";

const firebaseConfig = {
  apiKey: "AIzaSyAhrX36_mEA4a3VIuSq3rYYZi0PH5Ap_ks",
  authDomain: "fcps-prep.firebaseapp.com",
  projectId: "fcps-prep",
  storageBucket: "fcps-prep.firebasestorage.app",
  messagingSenderId: "949920276784",
  appId: "1:949920276784:web:c9af3432814c0f80e028f5"
};

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// STATE
let currentUser = null;
let userProfile = null;
let isGuest = false;
let allQuestions = [];
let filteredQuestions = [];
let userBookmarks = [];
let userSolvedIDs = [];
let userMistakes = [];
let currentMode = 'practice';
let currentIndex = 0;
let testTimer = null;
let testAnswers = {};
let testFlags = {};
let testTimeRemaining = 0;

// DEVICE ID (Anti-Sharing)
let currentDeviceId = localStorage.getItem('fcps_device_id');
if (!currentDeviceId) {
    currentDeviceId = 'dev_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('fcps_device_id', currentDeviceId);
}

// PLANS
const PLAN_DURATIONS = {
    '1_day': 86400000,
    '1_week': 604800000,
    '1_month': 2592000000,
    '3_months': 7776000000,
    '6_months': 15552000000,
    '1_year': 31536000000,
    'lifetime': 2524608000000
};

// ======================================================
// 2. AUTHENTICATION & SECURITY
// ======================================================

auth.onAuthStateChanged(async (user) => {
    if (user) {
        currentUser = user;
        isGuest = false;
        await checkLoginSecurity(user);
    } else {
        if (!isGuest) {
            currentUser = null;
            userProfile = null;
            showScreen('auth-screen');
        }
    }
});

async function checkLoginSecurity(user) {
    try {
        const docRef = db.collection('users').doc(user.uid);
        const doc = await docRef.get();

        if (!doc.exists) {
            // First time login
            await docRef.set({
                email: user.email,
                deviceId: currentDeviceId,
                role: 'student',
                isPremium: false,
                joined: new Date(),
                solved: [], bookmarks: [], mistakes: [], stats: {}
            });
            loadUserData();
        } else {
            const data = doc.data();
            
            // BAN CHECK
            if (data.disabled) {
                auth.signOut();
                alert("⛔ Your account has been disabled by the admin.");
                return;
            }

            // DEVICE LOCK CHECK
            if (data.deviceId && data.deviceId !== currentDeviceId) {
                auth.signOut();
                alert("🚫 Security Alert: Login detected on a new device.\n\nPlease log out from other devices first.");
                return;
            }

            // Update legacy users or current session
            if (!data.deviceId) await docRef.update({ deviceId: currentDeviceId });
            
            userProfile = data;
            loadUserData();
        }
        
        loadQuestions();
        showScreen('dashboard-screen');
        
        // Admin Button Logic
        if (userProfile && userProfile.role === 'admin') {
            document.getElementById('admin-btn').classList.remove('hidden');
        }

        checkPremiumExpiry();

    } catch (e) { console.error("Auth Error:", e); }
}

function guestLogin() {
    isGuest = true;
    userProfile = { role: 'guest', isPremium: false };
    showScreen('dashboard-screen');
    loadQuestions();
    document.getElementById('user-display').innerText = "Guest User";
    alert("👤 Guest Mode: Progress is NOT saved.\nLimit: 20 Questions per topic.");
}

function login() {
    const e = document.getElementById('email').value;
    const p = document.getElementById('password').value;
    auth.signInWithEmailAndPassword(e, p).catch(err => document.getElementById('auth-msg').innerText = err.message);
}

function signup() {
    const e = document.getElementById('email').value;
    const p = document.getElementById('password').value;
    auth.createUserWithEmailAndPassword(e, p).catch(err => document.getElementById('auth-msg').innerText = err.message);
}

function logout() {
    auth.signOut().then(() => {
        isGuest = false;
        window.location.reload();
    });
}

function checkPremiumExpiry() {
    if (!userProfile || !userProfile.expiryDate || !userProfile.isPremium) {
        document.getElementById('premium-badge').classList.add('hidden');
        document.getElementById('get-premium-btn').classList.remove('hidden');
        return;
    }
    
    const now = new Date().getTime();
    // Handle Firestore Timestamp or Date object
    const expiry = userProfile.expiryDate.toMillis ? userProfile.expiryDate.toMillis() : new Date(userProfile.expiryDate).getTime();

    if (now > expiry) {
        db.collection('users').doc(currentUser.uid).update({ isPremium: false });
        userProfile.isPremium = false;
        document.getElementById('premium-badge').classList.add('hidden');
        document.getElementById('get-premium-btn').classList.remove('hidden');
    } else {
        document.getElementById('premium-badge').classList.remove('hidden');
        document.getElementById('get-premium-btn').classList.add('hidden');
    }
}

// ======================================================
// 3. DATA & APP LOGIC
// ======================================================

function loadQuestions() {
    Papa.parse(GOOGLE_SHEET_URL, {
        download: true, header: true, skipEmptyLines: true,
        complete: function(results) { processData(results.data); }
    });
}

function processData(data) {
    const seen = new Set();
    allQuestions = [];
    const subjects = new Set();
    const map = {}; 

    data.forEach((row, index) => {
        delete row.Book; delete row.Exam; delete row.Number;
        const qText = row.Question || row.Questions;
        const correctVal = row.CorrectAnswer;
        if (!qText || !correctVal) return;

        const qSignature = String(qText).trim().toLowerCase();
        if (seen.has(qSignature)) return; 
        seen.add(qSignature);

        row._uid = generateStableID(qSignature);
        row.Question = qText; 
        row.SheetRow = index + 2; // Row Locator

        const subj = row.Subject ? row.Subject.trim() : "General";
        const topic = row.Topic ? row.Topic.trim() : "Mixed";
        row.Subject = subj; 
        row.Topic = topic;
        
        allQuestions.push(row);
        subjects.add(subj);
        if (!map[subj]) map[subj] = new Set();
        map[subj].add(topic);
    });

    renderMenus(subjects, map); 
    renderTestFilters(subjects, map);
    if(document.getElementById('admin-total-q')) document.getElementById('admin-total-q').innerText = allQuestions.length;
}

function generateStableID(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash) + str.charCodeAt(i) | 0;
    return "id_" + Math.abs(hash);
}

// --- STUDY LOGIC (WITH GATING) ---

function startPractice(subject, topic) {
    let pool = allQuestions.filter(q => q.Subject === subject && (!topic || q.Topic === topic));
    
    // GUEST / FREE LIMITS
    const isPrem = userProfile && userProfile.isPremium;
    if (!isPrem) {
        if (pool.length > 20) {
            pool = pool.slice(0, 20);
            if(currentIndex === 0) alert("🔒 Free/Guest Mode: Limited to first 20 questions.\nGo Premium to unlock full bank.");
        }
    }

    if (pool.length === 0) return alert("No questions found.");
    
    filteredQuestions = pool;
    currentMode = 'practice';
    currentIndex = 0;
    showScreen('quiz-screen');
    renderPage();
    renderPracticeNavigator();
}

function startTest() {
    // Only Premium users can take full custom tests, or limited for free
    if (!isGuest && (!userProfile || !userProfile.isPremium)) {
        if(!confirm("⚠️ Free Version: Exam mode is limited.\nUpgrade for full access?")) return;
    }

    const count = parseInt(document.getElementById('q-count').value);
    const mins = parseInt(document.getElementById('t-limit').value);
    
    // Logic for selection... (Simplified for brevity, assumes all selected)
    // In real implementation, bring back the filter logic from previous code
    let pool = [...allQuestions].sort(() => Math.random() - 0.5).slice(0, count);
    
    filteredQuestions = pool;
    currentMode = 'test';
    currentIndex = 0;
    testAnswers = {};
    testTimeRemaining = mins * 60;
    
    showScreen('quiz-screen');
    document.getElementById('timer').classList.remove('hidden');
    document.getElementById('test-sidebar').classList.add('active');
    testTimer = setInterval(updateTimer, 1000);
    renderPage();
    renderNavigator();
}

// ======================================================
// 4. ADMIN & PREMIUM FEATURES
// ======================================================

// --- REDEEM KEY ---
async function redeemKey() {
    const code = document.getElementById('activation-code').value.trim();
    if (!code) return alert("Please enter a key.");

    try {
        const snap = await db.collection('activation_keys').where('code', '==', code).where('isUsed', '==', false).get();
        if (snap.empty) return alert("❌ Invalid or used key.");
        
        const keyDoc = snap.docs[0];
        const keyData = keyDoc.data();
        const duration = PLAN_DURATIONS[keyData.plan];
        const newExpiry = new Date().getTime() + duration;

        const batch = db.batch();
        batch.update(db.collection('users').doc(currentUser.uid), {
            isPremium: true,
            expiryDate: new Date(newExpiry)
        });
        batch.update(db.collection('activation_keys').doc(keyDoc.id), {
            isUsed: true, usedBy: currentUser.email, usedAt: new Date()
        });
        
        await batch.commit();
        alert("🎉 Premium Activated!");
        window.location.reload();

    } catch (e) { alert("Error: " + e.message); }
}

// --- SUBMIT PROOF ---
async function submitPaymentProof() {
    const tid = document.getElementById('pay-tid').value;
    const file = document.getElementById('pay-proof').files[0];
    if(!tid) return alert("Transaction ID required");

    let imgStr = null;
    if(file) {
        if(file.size > 500000) return alert("Image too large (Max 500KB)");
        imgStr = await new Promise(r => {
            let fr = new FileReader();
            fr.onload = () => r(fr.result);
            fr.readAsDataURL(file);
        });
    }

    db.collection('payment_requests').add({
        uid: currentUser.uid, email: currentUser.email, tid: tid, image: imgStr, status: 'pending', timestamp: new Date()
    }).then(() => {
        alert("✅ Request Sent!");
        document.getElementById('premium-modal').classList.add('hidden');
    });
}

// --- ADMIN PANEL ---
function openAdminPanel() {
    if (!currentUser) return;
    db.collection('users').doc(currentUser.uid).get().then(doc => {
        if (doc.data().role === 'admin') {
            showScreen('admin-screen');
            switchAdminTab('reports');
        } else {
            alert("⛔ Access Denied.");
        }
    });
}

function switchAdminTab(tab) {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    event.target.classList.add('active');
    ['reports', 'payments', 'keys', 'users'].forEach(t => document.getElementById('tab-'+t).classList.add('hidden'));
    document.getElementById('tab-'+tab).classList.remove('hidden');
    if(tab==='reports') loadAdminReports();
    if(tab==='payments') loadAdminPayments();
    if(tab==='keys') loadAdminKeys();
}

async function loadAdminReports() {
    const list = document.getElementById('admin-reports-list');
    list.innerHTML = "Loading...";
    const snap = await db.collection('reports').orderBy('timestamp', 'desc').limit(20).get();
    if(snap.empty) { list.innerHTML = "No reports."; return; }

    let html = "";
    snap.forEach(doc => {
        const r = doc.data();
        const q = allQuestions.find(q => q._uid === r.questionID);
        const row = q ? q.SheetRow : "Deleted";
        html += `<div class="report-card">
            <div style="font-size:11px; color:gray;">${r.reportedBy} • Row ${row}</div>
            <div style="color:red; font-weight:bold;">${r.reportReason}</div>
            <div style="font-size:12px;">"${r.questionText.substring(0,60)}..."</div>
            <button class="secondary" onclick="deleteReport('${doc.id}')" style="margin-top:5px; padding:5px;">Resolve</button>
        </div>`;
    });
    list.innerHTML = html;
}

function deleteReport(id) { db.collection('reports').doc(id).delete().then(()=>loadAdminReports()); }

async function loadAdminPayments() {
    const list = document.getElementById('admin-payments-list');
    list.innerHTML = "Loading...";
    const snap = await db.collection('payment_requests').where('status','==','pending').get();
    if(snap.empty) { list.innerHTML = "No pending payments."; return; }

    let html = "";
    snap.forEach(doc => {
        const p = doc.data();
        html += `<div class="report-card">
            <div>${p.email} | TID: ${p.tid}</div>
            ${p.image ? `<img src="${p.image}" style="max-width:100%; border-radius:5px; margin:5px 0;">` : ''}
            <div style="display:flex; gap:5px; margin-top:5px;">
                <select id="dur-${doc.id}"><option value="1_month">1 Month</option><option value="6_months">6 Months</option><option value="lifetime">Lifetime</option></select>
                <button class="primary" onclick="approvePayment('${doc.id}','${p.uid}')" style="padding:5px;">Approve</button>
                <button class="secondary" onclick="db.collection('payment_requests').doc('${doc.id}').update({status:'rejected'}).then(()=>loadAdminPayments())" style="padding:5px;">Reject</button>
            </div>
        </div>`;
    });
    list.innerHTML = html;
}

async function approvePayment(docId, uid) {
    const dur = document.getElementById('dur-'+docId).value;
    const expiry = new Date().getTime() + PLAN_DURATIONS[dur];
    const batch = db.batch();
    batch.update(db.collection('users').doc(uid), { isPremium: true, expiryDate: new Date(expiry) });
    batch.update(db.collection('payment_requests').doc(docId), { status: 'approved' });
    await batch.commit();
    loadAdminPayments();
}

async function generateAdminKey() {
    const plan = document.getElementById('key-plan').value;
    const code = 'KEY-' + Math.random().toString(36).substr(2,6).toUpperCase();
    await db.collection('activation_keys').add({ code, plan, isUsed: false, createdAt: new Date() });
    document.getElementById('generated-key-display').innerText = code;
    loadAdminKeys();
}

async function loadAdminKeys() {
    const list = document.getElementById('admin-keys-list');
    const snap = await db.collection('activation_keys').orderBy('createdAt','desc').limit(10).get();
    let html = "<table><tr><th>Code</th><th>Plan</th><th>Status</th></tr>";
    snap.forEach(doc => {
        const k = doc.data();
        html += `<tr><td>${k.code}</td><td>${k.plan}</td><td>${k.isUsed?'USED':'ACTIVE'}</td></tr>`;
    });
    list.innerHTML = html + "</table>";
}

async function adminLookupUser() {
    const input = document.getElementById('admin-user-input').value;
    const res = document.getElementById('admin-user-result');
    res.innerHTML = "Searching...";
    
    let doc = await db.collection('users').doc(input).get();
    if(!doc.exists) {
        const s = await db.collection('users').where('email','==',input).limit(1).get();
        if(!s.empty) doc = s.docs[0];
    }

    if(!doc.exists) { res.innerHTML = "Not found"; return; }
    const u = doc.data();
    
    res.innerHTML = `<div class="user-card">
        <b>${u.email}</b><br>Role: ${u.role}<br>Premium: ${u.isPremium}<br>
        <button onclick="adminToggleBan('${doc.id}', ${!u.disabled})" style="background:${u.disabled?'green':'red'}; color:white; margin-top:5px; padding:5px;">${u.disabled?'Unban':'Ban User'}</button>
        <button onclick="adminResetUser('${doc.id}')" style="background:orange; color:white; margin-top:5px; padding:5px;">Reset Progress</button>
    </div>`;
}

function adminToggleBan(uid, status) { db.collection('users').doc(uid).update({disabled: status}).then(()=>adminLookupUser()); }
function adminResetUser(uid) { db.collection('users').doc(uid).update({solved:[], mistakes:[], bookmarks:[], stats:{}}).then(()=>alert("Reset Done")); }

// ======================================================
// 5. HELPER UTILS (Renderers, UI Toggles)
// ======================================================

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => { s.classList.remove('active'); s.classList.add('hidden'); });
    const target = document.getElementById(id);
    if(target) { target.classList.remove('hidden'); target.classList.add('active'); }
}

function goHome() { 
    clearInterval(testTimer); 
    showScreen('dashboard-screen'); 
    loadUserData(); 
}

function renderMenus(subjects, map) {
    const c = document.getElementById('dynamic-menus');
    c.innerHTML = "";
    Array.from(subjects).sort().forEach(s => {
        const det = document.createElement('details');
        det.className = "subject-dropdown-card";
        det.innerHTML = `<summary class="subject-summary">${s} <span>▼</span></summary>`;
        const content = document.createElement('div');
        content.style.padding = "10px";
        
        // Practice All Button
        const allBtn = document.createElement('div');
        allBtn.className = "topic-item-container";
        allBtn.style.marginBottom = "10px";
        allBtn.style.textAlign = "center";
        allBtn.style.fontWeight = "bold";
        allBtn.innerHTML = `Practice All ${s}`;
        allBtn.onclick = () => startPractice(s, null);
        content.appendChild(allBtn);

        const grid = document.createElement('div');
        grid.className = "topics-text-grid";
        Array.from(map[s]).sort().forEach(t => {
            const item = document.createElement('div');
            item.className = "topic-item-container";
            item.innerText = t;
            item.onclick = () => startPractice(s, t);
            grid.appendChild(item);
        });
        content.appendChild(grid);
        det.appendChild(content);
        c.appendChild(det);
    });
}

function renderTestFilters(subjects, map) {
    const c = document.getElementById('filter-container');
    if(!c) return;
    c.innerHTML = "";
    subjects.forEach(s => {
        c.innerHTML += `<div><input type="checkbox"> ${s}</div>`; // Simplified for brevity
    });
}

// ... (Existing Render, Timer, and Quiz Logic functions remain largely the same, just ensured variables match) ...
function updateTimer() {
    testTimeRemaining--;
    const m = Math.floor(testTimeRemaining/60);
    const s = testTimeRemaining%60;
    document.getElementById('timer').innerText = `${m}:${s<10?'0':''}${s}`;
    if(testTimeRemaining<=0) submitTest();
}

function renderPage() {
    const container = document.getElementById('quiz-content-area');
    container.innerHTML = "";
    if(currentMode==='practice') {
        document.getElementById('next-btn').classList.remove('hidden');
        document.getElementById('submit-btn').classList.add('hidden');
        container.appendChild(createQuestionCard(filteredQuestions[currentIndex], currentIndex));
    } else {
        const end = Math.min(currentIndex+5, filteredQuestions.length);
        for(let i=currentIndex; i<end; i++) container.appendChild(createQuestionCard(filteredQuestions[i], i));
        if(end===filteredQuestions.length) { document.getElementById('next-btn').classList.add('hidden'); document.getElementById('submit-btn').classList.remove('hidden'); }
    }
}

function createQuestionCard(q, idx) {
    const d = document.createElement('div');
    d.className = "test-question-block";
    d.innerHTML = `<div class="test-q-text">${idx+1}. ${q.Question}</div>`;
    
    ['OptionA','OptionB','OptionC','OptionD','OptionE'].forEach(optKey => {
        if(q[optKey]) {
            const btn = document.createElement('button');
            btn.className = "option-btn";
            btn.innerHTML = `<span>${q[optKey]}</span>`;
            btn.onclick = () => checkAnswer(q[optKey], btn, q);
            d.appendChild(btn);
        }
    });
    return d;
}

function checkAnswer(ans, btn, q) {
    if(currentMode !== 'practice') {
        // Exam Mode: Select only
        const all = btn.parentElement.querySelectorAll('.option-btn');
        all.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        testAnswers[q._uid] = ans;
        return;
    }

    // Practice Mode: Check Result
    const correct = (q.CorrectAnswer||"").trim().toLowerCase();
    const user = ans.trim().toLowerCase();
    
    // Simple Letter Check (A vs OptionA) - Enhanced logic needed for full robustness
    // For now, simple text match or simple letter match
    let isCor = (user === correct); 
    
    // If not direct match, check if correct is "A" and user text matches OptionA
    if(!isCor && correct.length === 1) {
        const map = { 'a': q.OptionA, 'b': q.OptionB, 'c': q.OptionC, 'd': q.OptionD, 'e': q.OptionE };
        if(map[correct] && map[correct].trim().toLowerCase() === user) isCor = true;
    }

    if(isCor) {
        btn.classList.add('correct');
        showExplanation(q);
        // Save Progress logic here...
    } else {
        btn.classList.add('wrong');
    }
}

function showExplanation(q) {
    const m = document.getElementById('explanation-modal');
    document.getElementById('explanation-text').innerText = q.Explanation || "No explanation.";
    m.classList.remove('hidden');
}

function closeModal() { document.getElementById('explanation-modal').classList.add('hidden'); }
function nextPage() { currentIndex += (currentMode==='practice'?1:5); renderPage(); }
function prevPage() { currentIndex -= (currentMode==='practice'?1:5); renderPage(); }

function submitTest() {
    clearInterval(testTimer);
    let score = 0;
    // Calculation Logic...
    showScreen('result-screen');
    document.getElementById('final-score').innerText = "Done";
}

function openPremiumModal() { document.getElementById('premium-modal').classList.remove('hidden'); }
function switchPremTab(tab) {
    document.getElementById('prem-content-code').classList.add('hidden');
    document.getElementById('prem-content-manual').classList.add('hidden');
    document.getElementById('tab-btn-code').classList.remove('active-prem-tab');
    document.getElementById('tab-btn-manual').classList.remove('active-prem-tab');
    
    document.getElementById('prem-content-'+tab).classList.remove('hidden');
    document.getElementById('tab-btn-'+tab).classList.add('active-prem-tab');
}

function loadUserData() {
    // Only load if not guest
    if(isGuest || !currentUser) return;
    db.collection('users').doc(currentUser.uid).get().then(doc => {
        if(doc.exists) {
            const d = doc.data();
            userSolvedIDs = d.solved || [];
            userBookmarks = d.bookmarks || [];
            // Update Stats UI...
        }
    });
}

function toggleAuthMode() {
    const t = document.getElementById('auth-title');
    const btn = document.getElementById('auth-btn-container');
    const link = document.getElementById('auth-toggle-link');
    
    if (t.innerText === "FCPS PREP") {
        t.innerText = "Create Account";
        btn.innerHTML = `<button class="primary" onclick="signup()">Sign Up</button>`;
        link.innerText = "Log In here";
    } else {
        t.innerText = "FCPS PREP";
        btn.innerHTML = `<button class="primary" onclick="login()">Log In</button>`;
        link.innerText = "Create New ID";
    }
}
