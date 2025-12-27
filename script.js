// ======================================================
// 1. CONFIGURATION
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

// Initialize Firebase
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// ======================================================
// 2. STATE VARIABLES
// ======================================================

let currentUser = null;
let userProfile = null; 
let isGuest = false;

let allQuestions = [];
let filteredQuestions = [];
let userBookmarks = [];
let userSolvedIDs = [];
let userMistakes = [];

let currentMode = 'practice';
let isMistakeReview = false;
let currentIndex = 0; 
let testTimer = null;
let testAnswers = {}; 
let testFlags = {}; 
let testTimeRemaining = 0;

// Device Lock ID
let currentDeviceId = localStorage.getItem('fcps_device_id');
if (!currentDeviceId) {
    currentDeviceId = 'dev_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('fcps_device_id', currentDeviceId);
}

// Premium Plans
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
// 3. AUTHENTICATION & LOGIN LOGIC
// ======================================================

auth.onAuthStateChanged(async (user) => {
    if (user) {
        currentUser = user;
        isGuest = false;
        console.log("✅ User detected:", user.email);
        await checkLoginSecurity(user);
    } else {
        if (!isGuest) {
            console.log("🔒 No user signed in.");
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
            // New User Setup
            await docRef.set({
                email: user.email,
                deviceId: currentDeviceId,
                role: 'student',
                isPremium: false,
                joined: new Date(),
                solved: [], bookmarks: [], mistakes: [], stats: {}
            }, { merge: true });
            loadUserData();
        } else {
            const data = doc.data();
            
            // 1. Ban Check
            if (data.disabled) {
                auth.signOut();
                alert("⛔ Your account has been disabled by the admin.");
                return;
            }

            // 2. Device Lock Check
            if (data.deviceId && data.deviceId !== currentDeviceId) {
                auth.signOut();
                alert("🚫 Security Alert: Account logged in on another device.\nPlease log out from the other device first.");
                return;
            }

            // Update Device ID if missing
            if (!data.deviceId) await docRef.update({ deviceId: currentDeviceId });
            
            userProfile = data;
            loadUserData();
        }
        
        // Success: Enter App
        showScreen('dashboard-screen');
        loadQuestions(); 
        
        // Show Admin Button if Admin
        if (userProfile && userProfile.role === 'admin') {
            const btn = document.getElementById('admin-btn');
            if(btn) btn.classList.remove('hidden');
        }

        checkPremiumExpiry();

    } catch (e) { 
        console.error("Auth Error:", e); 
        alert("Login Error: " + e.message);
    }
}

function guestLogin() {
    console.log("👤 Guest Login Clicked");
    isGuest = true;
    userProfile = { role: 'guest', isPremium: false };
    
    showScreen('dashboard-screen');
    loadQuestions();
    
    document.getElementById('user-display').innerText = "Guest User";
    document.getElementById('premium-badge').classList.add('hidden');
    
    alert("👤 Guest Mode Active\n\n⚠️ Progress is NOT saved.\n🔒 Limit: 20 Questions per topic.");
}

function login() {
    const e = document.getElementById('email').value;
    const p = document.getElementById('password').value;
    if(!e || !p) return alert("Please enter email and password");
    auth.signInWithEmailAndPassword(e, p).catch(err => document.getElementById('auth-msg').innerText = err.message);
}

function signup() {
    const e = document.getElementById('email').value;
    const p = document.getElementById('password').value;
    if(!e || !p) return alert("Please enter email and password");
    auth.createUserWithEmailAndPassword(e, p).catch(err => document.getElementById('auth-msg').innerText = err.message);
}

function logout() {
    auth.signOut().then(() => {
        isGuest = false;
        window.location.reload();
    });
}

// --- SCREEN SWITCHER (FIXED) ---
function showScreen(screenId) {
    console.log("📺 Switching to:", screenId);

    // Hide EVERYTHING first
    const allIds = [
        'auth-screen', 'dashboard-screen', 'quiz-screen', 'result-screen', 'admin-screen',
        'explanation-modal', 'premium-modal', 'profile-modal', 'analytics-modal', 'badges-modal'
    ];

    allIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.add('hidden');
            el.classList.remove('active');
        }
    });

    // Show Target
    const target = document.getElementById(screenId);
    if (target) {
        target.classList.remove('hidden');
        target.classList.add('active');
    }
}

function goHome() { 
    clearInterval(testTimer); 
    showScreen('dashboard-screen'); 
    loadUserData(); 
}

// ======================================================
// 4. DATA & PROGRESS
// ======================================================

async function loadUserData() {
    if (isGuest || !currentUser) return;

    if (currentUser.displayName) {
        const nameDisplay = document.getElementById('user-display');
        if(nameDisplay) nameDisplay.innerText = currentUser.displayName;
    }

    try {
        const doc = await db.collection('users').doc(currentUser.uid).get();
        if(doc.exists) {
            const data = doc.data();
            userBookmarks = data.bookmarks || [];
            userSolvedIDs = data.solved || [];
            userMistakes = data.mistakes || []; 
            checkStreak(data);
            
            // Update Stats Display
            const statsBox = document.getElementById('quick-stats');
            if(statsBox) {
                statsBox.innerHTML = `
                    <div style="margin-top:5px;">
                        <div>✅ Solved: <b>${userSolvedIDs.length}</b></div>
                        <div style="color:#ef4444">❌ Mistakes: <b>${userMistakes.length}</b></div>
                    </div>`;
            }
            updateBadgeButton();
            // Refresh Menus
            if (allQuestions.length > 0) processData(allQuestions, true);
        }
    } catch (e) { console.error("Data Load Error:", e); }
}

function checkStreak(data) {
    const today = new Date().toDateString();
    const lastLogin = data.lastLoginDate;
    let currentStreak = data.streak || 0;

    if (lastLogin !== today) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        if (lastLogin === yesterday.toDateString()) currentStreak++;
        else currentStreak = 1;
        
        db.collection('users').doc(currentUser.uid).set({
            lastLoginDate: today, streak: currentStreak
        }, { merge: true });
    }

    if(currentStreak > 0) {
        document.getElementById('streak-display').classList.remove('hidden');
        document.getElementById('streak-count').innerText = currentStreak + " Days";
    }
}

function checkPremiumExpiry() {
    if (!userProfile || !userProfile.isPremium) {
        document.getElementById('premium-badge').classList.add('hidden');
        document.getElementById('get-premium-btn').classList.remove('hidden');
        return;
    }
    const now = new Date().getTime();
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
// 5. CSV LOADING & PROCESSING
// ======================================================

function loadQuestions() {
    Papa.parse(GOOGLE_SHEET_URL, {
        download: true, header: true, skipEmptyLines: true,
        complete: function(results) { processData(results.data); }
    });
}

function processData(data, reRenderOnly = false) {
    if(!reRenderOnly) {
        const seen = new Set();
        allQuestions = [];
        data.forEach((row, index) => {
            const qText = row.Question || row.Questions;
            const correctVal = row.CorrectAnswer;
            if (!qText || !correctVal) return;

            const qSignature = String(qText).trim().toLowerCase();
            if (seen.has(qSignature)) return; 
            seen.add(qSignature);

            row._uid = "id_" + Math.abs(generateHash(qSignature));
            row.Question = qText; 
            row.SheetRow = index + 2; 
            row.Subject = row.Subject ? row.Subject.trim() : "General";
            row.Topic = row.Topic ? row.Topic.trim() : "Mixed";
            
            allQuestions.push(row);
        });
    }

    const subjects = new Set();
    const map = {}; 
    allQuestions.forEach(q => {
        subjects.add(q.Subject);
        if (!map[q.Subject]) map[q.Subject] = new Set();
        map[q.Subject].add(q.Topic);
    });

    renderMenus(subjects, map); 
    renderTestFilters(subjects, map);
    if(document.getElementById('admin-total-q')) document.getElementById('admin-total-q').innerText = allQuestions.length;
}

function generateHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash) + str.charCodeAt(i) | 0;
    return hash;
}

// ======================================================
// 6. UI RENDERERS (Menus)
// ======================================================

function renderMenus(subjects, map) {
    const container = document.getElementById('dynamic-menus');
    container.innerHTML = "";
    Array.from(subjects).sort().forEach(subj => {
        const subjQs = allQuestions.filter(q => q.Subject === subj);
        const solvedCount = subjQs.filter(q => userSolvedIDs.includes(q._uid)).length;
        const pct = subjQs.length ? Math.round((solvedCount/subjQs.length)*100) : 0;

        const details = document.createElement('details');
        details.className = "subject-dropdown-card";
        details.innerHTML = `
            <summary class="subject-summary">
                <div class="summary-header"><span>${subj}</span><span style="font-size:11px;">${pct}%</span></div>
                <div class="progress-bar-thin"><div class="fill" style="width:${pct}%"></div></div>
            </summary>`;
        
        const content = document.createElement('div');
        content.className = "dropdown-content";
        
        // Practice All Button
        const allBtn = document.createElement('div');
        allBtn.className = "practice-all-row";
        allBtn.innerHTML = `Practice All ${subj}`;
        allBtn.onclick = () => startPractice(subj, null);
        content.appendChild(allBtn);

        const grid = document.createElement('div');
        grid.className = "topics-text-grid";
        
        Array.from(map[subj] || []).sort().forEach(topic => {
            const topQs = subjQs.filter(q => q.Topic === topic);
            const topSolved = topQs.filter(q => userSolvedIDs.includes(q._uid)).length;
            const topPct = topQs.length ? Math.round((topSolved/topQs.length)*100) : 0;

            const item = document.createElement('div');
            item.className = "topic-item-container";
            item.onclick = () => startPractice(subj, topic);
            item.innerHTML = `
                <span class="topic-name">${topic}</span>
                <div class="topic-mini-track"><div class="topic-mini-fill" style="width:${topPct}%"></div></div>`;
            grid.appendChild(item);
        });
        content.appendChild(grid);
        details.appendChild(content);
        container.appendChild(details);
    });
}

function renderTestFilters(subjects, map) {
    const container = document.getElementById('filter-container');
    if (!container) return;
    container.innerHTML = "";
    
    Array.from(subjects).sort().forEach(subj => {
        const details = document.createElement('details');
        details.className = "subject-dropdown-card"; 
        details.innerHTML = `
            <summary class="subject-summary">
                <div class="summary-header"><span>${subj}</span></div>
            </summary>`;
        
        const content = document.createElement('div');
        content.className = "dropdown-content";
        const grid = document.createElement('div');
        grid.className = "topics-text-grid";
        
        Array.from(map[subj] || []).sort().forEach(topic => {
            const item = document.createElement('div');
            item.className = "topic-text-item exam-selectable";
            item.innerText = topic;
            item.dataset.subject = subj;
            item.dataset.topic = topic;
            item.onclick = function() { this.classList.toggle('selected'); };
            grid.appendChild(item);
        });
        content.appendChild(grid);
        details.appendChild(content);
        container.appendChild(details);
    });
}

// ======================================================
// 7. STUDY LOGIC (Practice/Test)
// ======================================================

function setMode(mode) {
    currentMode = mode;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    if(event) event.target.classList.add('active');
    
    document.getElementById('test-settings').classList.toggle('hidden', mode !== 'test');
    document.getElementById('dynamic-menus').classList.toggle('hidden', mode === 'test');
    
    const filterControls = document.getElementById('practice-filter-controls');
    if(filterControls) filterControls.style.display = (mode === 'test') ? 'none' : 'flex';
}

function startPractice(subject, topic) {
    let pool = allQuestions.filter(q => q.Subject === subject && (!topic || q.Topic === topic));
    
    // PREMIUM GATE
    if (!userProfile?.isPremium) {
        if (pool.length > 20) {
            pool = pool.slice(0, 20);
            if(currentIndex === 0) alert("🔒 Free Mode Limit: 20 Questions per topic.");
        }
    }

    if (pool.length === 0) return alert("No questions found.");

    if (document.getElementById('unattempted-only').checked) {
        pool = pool.filter(q => !userSolvedIDs.includes(q._uid));
        if (pool.length === 0) return alert("All questions solved!");
    }

    filteredQuestions = pool;
    currentMode = 'practice';
    isMistakeReview = false;
    currentIndex = 0;
    
    showScreen('quiz-screen');
    renderPage();
    renderPracticeNavigator();
}

function startMistakePractice() {
    if (userMistakes.length === 0) return alert("No mistakes pending!");
    filteredQuestions = allQuestions.filter(q => userMistakes.includes(q._uid));
    currentMode = 'practice';
    isMistakeReview = true;
    currentIndex = 0;
    showScreen('quiz-screen');
    renderPage();
    renderPracticeNavigator();
}

function startSavedQuestions() {
    if (userBookmarks.length === 0) return alert("No bookmarks!");
    filteredQuestions = allQuestions.filter(q => userBookmarks.includes(q._uid));
    currentMode = 'practice';
    isMistakeReview = false;
    currentIndex = 0;
    showScreen('quiz-screen');
    renderPage();
}

function startTest() {
    if (!userProfile?.isPremium && !isGuest) {
        if(!confirm("⚠️ Free Mode: Upgrade for full exams?")) return;
    }
    
    const count = parseInt(document.getElementById('q-count').value);
    const mins = parseInt(document.getElementById('t-limit').value);
    
    const selected = document.querySelectorAll('.exam-selectable.selected');
    let pool = [];
    
    if (selected.length === 0) {
        if(!confirm("Test from ALL subjects?")) return;
        pool = [...allQuestions];
    } else {
        const keys = new Set();
        selected.forEach(el => keys.add(el.dataset.subject + "|" + el.dataset.topic));
        pool = allQuestions.filter(q => keys.has(q.Subject + "|" + q.Topic));
    }

    if(pool.length === 0) return alert("No questions found.");
    filteredQuestions = pool.sort(() => Math.random() - 0.5).slice(0, count);
    
    currentMode = 'test';
    currentIndex = 0;
    testAnswers = {};
    testFlags = {};
    testTimeRemaining = mins * 60;
    
    showScreen('quiz-screen');
    document.getElementById('timer').classList.remove('hidden');
    document.getElementById('test-sidebar').classList.add('active');
    renderNavigator();
    
    clearInterval(testTimer);
    testTimer = setInterval(updateTimer, 1000);
    renderPage();
}

// ======================================================
// 8. QUIZ EXECUTION
// ======================================================

function renderPage() {
    const container = document.getElementById('quiz-content-area');
    container.innerHTML = "";
    window.scrollTo(0,0);

    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const submitBtn = document.getElementById('submit-btn');
    const flagBtn = document.getElementById('flag-btn'); 
    
    prevBtn.classList.toggle('hidden', currentIndex === 0);

    if (currentMode === 'practice') {
        document.getElementById('timer').classList.add('hidden');
        document.getElementById('test-sidebar').classList.remove('active'); 
        flagBtn.classList.add('hidden'); 
        submitBtn.classList.add('hidden');
        
        if (currentIndex < filteredQuestions.length - 1) nextBtn.classList.remove('hidden');
        else nextBtn.classList.add('hidden');
        
        container.appendChild(createQuestionCard(filteredQuestions[currentIndex], currentIndex));
        renderPracticeNavigator();
    } else {
        document.getElementById('timer').classList.remove('hidden');
        flagBtn.classList.remove('hidden'); 

        const end = Math.min(currentIndex + 5, filteredQuestions.length);
        for (let i = currentIndex; i < end; i++) {
            container.appendChild(createQuestionCard(filteredQuestions[i], i, true));
        }
        
        if (end === filteredQuestions.length) {
            nextBtn.classList.add('hidden');
            submitBtn.classList.remove('hidden');
        } else {
            nextBtn.classList.remove('hidden');
            submitBtn.classList.add('hidden');
        }
        renderNavigator();
    }
}

function createQuestionCard(q, idx, isTestMode = false) {
    const block = document.createElement('div');
    block.className = "test-question-block";
    block.id = `q-card-${idx}`;
    
    block.innerHTML = `<div class="test-q-text">${idx+1}. ${q.Question}</div>`;
    
    const optsDiv = document.createElement('div');
    optsDiv.className = "options-group";
    
    const options = [q.OptionA, q.OptionB, q.OptionC, q.OptionD, q.OptionE].filter(o => o && o.trim());
    
    options.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = "option-btn";
        btn.innerHTML = `<span class="opt-text">${opt}</span><span class="elim-eye">👁️</span>`;
        
        btn.onclick = (e) => {
            if(e.target.classList.contains('elim-eye')) {
                e.stopPropagation(); btn.classList.toggle('eliminated'); return;
            }
            checkAnswer(opt, btn, q);
        };
        
        // Restore State
        if(testAnswers[q._uid] === opt) btn.classList.add('selected');
        
        optsDiv.appendChild(btn);
    });
    
    block.appendChild(optsDiv);
    return block;
}

function checkAnswer(ans, btn, q) {
    if (currentMode === 'test') {
        const all = btn.parentElement.querySelectorAll('.option-btn');
        all.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        testAnswers[q._uid] = ans;
        renderNavigator();
        return;
    }

    // Practice Mode
    const correct = (q.CorrectAnswer || "").trim().toLowerCase();
    const user = ans.trim().toLowerCase();
    
    let isCor = (user === correct); 
    if(!isCor) {
        // Fallback: Check if answer is "A", "B" etc.
        const map = {'a': q.OptionA, 'b': q.OptionB, 'c': q.OptionC, 'd': q.OptionD, 'e': q.OptionE};
        if(map[correct] && map[correct].toLowerCase() === user) isCor = true;
    }

    if(isCor) {
        btn.classList.add('correct');
        showExplanation(q);
        saveProgress(q, true);
    } else {
        btn.classList.add('wrong');
        saveProgress(q, false);
    }
    renderPracticeNavigator();
}

function saveProgress(q, isCorrect) {
    if(isGuest || !currentUser) return;
    
    if(isCorrect) {
        if(!userSolvedIDs.includes(q._uid)) {
            userSolvedIDs.push(q._uid);
            db.collection('users').doc(currentUser.uid).update({
                solved: firebase.firestore.FieldValue.arrayUnion(q._uid)
            });
        }
        if(isMistakeReview) {
            db.collection('users').doc(currentUser.uid).update({
                mistakes: firebase.firestore.FieldValue.arrayRemove(q._uid)
            });
        }
    } else {
        if(!userMistakes.includes(q._uid) && !userSolvedIDs.includes(q._uid)) {
            userMistakes.push(q._uid);
            db.collection('users').doc(currentUser.uid).update({
                mistakes: firebase.firestore.FieldValue.arrayUnion(q._uid)
            });
        }
    }
}

// ======================================================
// 9. ADMIN, ANALYTICS & EXTRAS
// ======================================================

// --- ADMIN ---
function openAdminPanel() {
    if (!currentUser) return;
    db.collection('users').doc(currentUser.uid).get().then(doc => {
        if (doc.data().role === 'admin') {
            showScreen('admin-screen');
            switchAdminTab('reports');
        } else alert("⛔ Access Denied.");
    });
}

function switchAdminTab(tab) {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    if(event) event.target.classList.add('active');
    
    ['reports', 'payments', 'keys', 'users'].forEach(t => document.getElementById('tab-'+t).classList.add('hidden'));
    document.getElementById('tab-'+tab).classList.remove('hidden');
    
    if(tab==='reports') loadAdminReports();
    if(tab==='payments') loadAdminPayments();
    if(tab==='keys') loadAdminKeys();
    if(tab==='users') loadAllUsers();
}

async function loadAllUsers() {
    const res = document.getElementById('admin-user-result');
    res.innerHTML = "Loading...";
    const snap = await db.collection('users').limit(20).get();
    let html = "<div style='background:white; border-radius:12px;'>";
    snap.forEach(doc => {
        const u = doc.data();
        html += `<div class="user-list-item">
            <div><b>${u.email}</b><br><small>${u.role}</small></div>
            <button onclick="adminLookupUser('${doc.id}')" style="width:auto; padding:5px; font-size:10px;">Manage</button>
        </div>`;
    });
    html += "</div>";
    res.innerHTML = html;
}

async function adminLookupUser(targetId) {
    const input = targetId || document.getElementById('admin-user-input').value;
    const res = document.getElementById('admin-user-result');
    res.innerHTML = "Searching...";
    
    let doc = await db.collection('users').doc(input).get();
    if(!doc.exists) {
        const s = await db.collection('users').where('email','==',input).limit(1).get();
        if(!s.empty) doc = s.docs[0];
    }

    if(!doc.exists) { res.innerHTML = "Not found"; return; }
    const u = doc.data();
    
    res.innerHTML = `
    <div class="user-card">
        <h3>${u.email}</h3>
        <p>Premium: ${u.isPremium}</p>
        <button onclick="db.collection('users').doc('${doc.id}').update({disabled:${!u.disabled}}).then(()=>alert('Done'))" style="background:${u.disabled?'green':'red'}; color:white;">${u.disabled?'Unban':'Ban'}</button>
    </div>`;
}

// --- ANALYTICS ---
async function openAnalytics() {
    const modal = document.getElementById('analytics-modal');
    const container = document.getElementById('analytics-content');
    modal.classList.remove('hidden');
    container.innerHTML = "Loading...";
    
    if(!currentUser || isGuest) { container.innerHTML = "Sign in to see stats."; return; }
    
    const doc = await db.collection('users').doc(currentUser.uid).get();
    const stats = doc.data().stats || {};
    let html = "";
    
    Object.keys(stats).forEach(key => {
        const s = stats[key];
        const pct = Math.round((s.correct/s.total)*100);
        html += `<div class="stat-item">
            <div class="stat-header"><span>${key}</span><span>${pct}%</span></div>
            <div class="progress-track"><div class="progress-fill" style="width:${pct}%; background:#2ecc71;"></div></div>
        </div>`;
    });
    container.innerHTML = html || "No data yet.";
}

function openBadges() {
    const modal = document.getElementById('badges-modal');
    const container = document.getElementById('badge-list');
    modal.classList.remove('hidden');
    
    const badges = [
        { limit: 10, icon: "👶", name: "Novice" },
        { limit: 100, icon: "🥉", name: "Bronze" },
        { limit: 500, icon: "🥈", name: "Silver" },
        { limit: 1000, icon: "🥇", name: "Gold" },
        { limit: 2000, icon: "💎", name: "Diamond" },
        { limit: 5000, icon: "👑", name: "Master" }
    ];

    let html = "";
    badges.forEach(b => {
        const isUnlocked = userSolvedIDs.length >= b.limit;
        html += `<div class="badge-item ${isUnlocked?'unlocked':''}"><span class="badge-icon">${b.icon}</span><span class="badge-name">${b.name}</span></div>`;
    });
    container.innerHTML = html;
}

// --- UTILS ---
function toggleTheme() {
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    document.body.setAttribute('data-theme', isDark ? '' : 'dark');
    document.getElementById('theme-btn').innerText = isDark ? '🌙' : '☀️';
    localStorage.setItem('fcps-theme', isDark ? 'light' : 'dark');
}
function updateTimer() {
    testTimeRemaining--;
    const m = Math.floor(testTimeRemaining/60);
    const s = testTimeRemaining%60;
    document.getElementById('timer').innerText = `${m}:${s<10?'0':''}${s}`;
    if(testTimeRemaining<=0) submitTest();
}
function submitTest() {
    clearInterval(testTimer);
    showScreen('result-screen');
}
function toggleAuthMode() {
    const t = document.getElementById('auth-title');
    if(t.innerText === "FCPS PREP") {
        t.innerText = "Create Account";
        document.getElementById('auth-btn-container').innerHTML = `<button class="primary" onclick="signup()">Sign Up</button>`;
        document.getElementById('auth-toggle-link').innerText = "Log In here";
    } else {
        t.innerText = "FCPS PREP";
        document.getElementById('auth-btn-container').innerHTML = `<button class="primary" onclick="login()">Log In</button>`;
        document.getElementById('auth-toggle-link').innerText = "Create New ID";
    }
}
function showExplanation(q) {
    document.getElementById('explanation-text').innerText = q.Explanation || "No explanation.";
    document.getElementById('explanation-modal').classList.remove('hidden');
}
function closeModal() { document.getElementById('explanation-modal').classList.add('hidden'); }
function nextPageFromModal() { closeModal(); setTimeout(nextPage, 300); }
function nextPage() { currentIndex++; renderPage(); }
function prevPage() { currentIndex--; renderPage(); }
function toggleFlag() { /* ... */ }
function renderPracticeNavigator() { /* ... */ }
function renderNavigator() { /* ... */ }
function openPremiumModal() { document.getElementById('premium-modal').classList.remove('hidden'); }
function switchPremTab(t) {
    document.getElementById('prem-content-code').classList.add('hidden');
    document.getElementById('prem-content-manual').classList.add('hidden');
    document.getElementById('prem-content-'+t).classList.remove('hidden');
}
window.onload = () => {
    if(localStorage.getItem('fcps-theme')==='dark') toggleTheme();
}
