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

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// ======================================================
// 2. STATE VARIABLES
// ======================================================

let currentUser = null;
let userProfile = null; // Stores full user data (role, premium, etc.)
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

// --- DEVICE ID (Anti-Sharing) ---
let currentDeviceId = localStorage.getItem('fcps_device_id');
if (!currentDeviceId) {
    currentDeviceId = 'dev_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('fcps_device_id', currentDeviceId);
}

// --- PREMIUM PLANS (Duration in Milliseconds) ---
const PLAN_DURATIONS = {
    '1_day': 86400000,
    '1_week': 604800000,
    '1_month': 2592000000,
    '3_months': 7776000000,
    '6_months': 15552000000,
    '1_year': 31536000000,
    'lifetime': 2524608000000 // ~80 Years
};

// ======================================================
// 3. AUTHENTICATION & SECURITY
// ======================================================

auth.onAuthStateChanged(async (user) => {
    if (user) {
        currentUser = user;
        isGuest = false;
        console.log("User detected:", user.email);
        await checkLoginSecurity(user);
    } else {
        if (!isGuest) {
            console.log("No user signed in.");
            currentUser = null;
            userProfile = null;
            showScreen('auth-screen');
        }
    }
});

// --- CORE SECURITY CHECK (Device Lock & Ban) ---
async function checkLoginSecurity(user) {
    try {
        const docRef = db.collection('users').doc(user.uid);
        const doc = await docRef.get();

        if (!doc.exists) {
            // First Login: Create Profile
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
            
            // 1. BAN CHECK
            if (data.disabled) {
                auth.signOut();
                alert("⛔ Your account has been disabled by the admin.");
                return;
            }

            // 2. DEVICE LOCK CHECK
            if (data.deviceId && data.deviceId !== currentDeviceId) {
                auth.signOut();
                alert("🚫 Security Alert: Login detected on a new device.\n\nPlease log out from other devices first.");
                return;
            }

            // Update legacy users or current session
            if (!data.deviceId) await docRef.update({ deviceId: currentDeviceId });
            
            userProfile = data; // Store profile globally
            loadUserData();
        }
        
        // Load App Content
        showScreen('dashboard-screen');
        loadQuestions(); 
        
        // Show Admin Button if Authorized
        if (userProfile && userProfile.role === 'admin') {
            document.getElementById('admin-btn').classList.remove('hidden');
        }

        // Check Premium Status
        checkPremiumExpiry();

    } catch (e) { 
        console.error("Auth Error:", e); 
        loadUserData(); // Fallback
        showScreen('dashboard-screen');
        loadQuestions();
    }
}

// --- GUEST MODE ---
function guestLogin() {
    isGuest = true;
    userProfile = { role: 'guest', isPremium: false };
    showScreen('dashboard-screen');
    loadQuestions();
    
    document.getElementById('user-display').innerText = "Guest User";
    document.getElementById('premium-badge').classList.add('hidden');
    document.getElementById('get-premium-btn').classList.remove('hidden');
    
    alert("👤 Guest Mode Active\n\n⚠️ Progress is NOT saved.\n🔒 Limit: 20 Questions per topic.");
}

function login() {
    const email = document.getElementById('email').value;
    const pass = document.getElementById('password').value;
    auth.signInWithEmailAndPassword(email, pass).catch(e => document.getElementById('auth-msg').innerText = e.message);
}

function signup() {
    const email = document.getElementById('email').value;
    const pass = document.getElementById('password').value;
    auth.createUserWithEmailAndPassword(email, pass).catch(e => document.getElementById('auth-msg').innerText = e.message);
}

function logout() {
    auth.signOut().then(() => {
        isGuest = false;
        window.location.reload();
    });
}

// --- PREMIUM EXPIRY CHECK ---
function checkPremiumExpiry() {
    if (!userProfile || !userProfile.isPremium || !userProfile.expiryDate) {
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
        alert("⚠️ Your Premium Subscription has expired.");
    } else {
        document.getElementById('premium-badge').classList.remove('hidden');
        document.getElementById('get-premium-btn').classList.add('hidden');
    }
}

// ======================================================
// 4. USER DATA MANAGEMENT
// ======================================================

async function loadUserData() {
    if (isGuest || !currentUser) return;

    if (currentUser.displayName) {
        const nameDisplay = document.getElementById('user-display');
        if(nameDisplay) nameDisplay.innerText = currentUser.displayName;
    }

    try {
        const statsBox = document.getElementById('quick-stats');
        if(statsBox) statsBox.style.opacity = "0.5"; 

        const userDoc = await db.collection('users').doc(currentUser.uid).get();
        let userData = userDoc.exists ? userDoc.data() : {};

        userBookmarks = userData.bookmarks || [];
        userSolvedIDs = userData.solved || [];
        userMistakes = userData.mistakes || []; 

        checkStreak(userData);

        // --- NEW: Calculate Total Correct from Stats ---
        let totalCorrect = 0;
        if(userData.stats) {
            Object.values(userData.stats).forEach(s => totalCorrect += (s.correct || 0));
        }

        // --- FIX: Show Count instead of % on Dashboard ---
        if(statsBox) {
            statsBox.style.opacity = "1"; 
            statsBox.innerHTML = `
                <div class="stat-row"><span class="stat-lbl">✅ Correct:</span> <span class="stat-val" style="color:#2ecc71">${totalCorrect} / ${userSolvedIDs.length}</span></div>
                <div class="stat-row"><span class="stat-lbl">❌ Mistakes:</span> <span class="stat-val" style="color:#e74c3c">${userMistakes.length}</span></div>
                <div class="stat-row" style="border:none;"><span class="stat-lbl">⭐ Bookmarks:</span> <span class="stat-val">${userBookmarks.length}</span></div>`;
        }

        updateBadgeButton(); 

        if (allQuestions.length > 0) processData(allQuestions, true);

    } catch (e) { console.error("Load Error:", e); }
}

function checkStreak(data) {
    const today = new Date().toDateString();
    const lastLogin = data.lastLoginDate;
    let currentStreak = data.streak || 0;

    if (lastLogin !== today) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        
        if (lastLogin === yesterday.toDateString()) {
            currentStreak++;
        } else {
            currentStreak = 1;
        }
        
        db.collection('users').doc(currentUser.uid).set({
            lastLoginDate: today,
            streak: currentStreak
        }, { merge: true });
    }

    if(currentStreak > 0) {
        document.getElementById('streak-display').classList.remove('hidden');
        document.getElementById('streak-count').innerText = currentStreak + " Day Streak";
    }
}

// ======================================================
// 5. DATA LOADING (CSV)
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
            delete row.Book; delete row.Exam; delete row.Number;
            const qText = row.Question || row.Questions;
            const correctVal = row.CorrectAnswer;

            if (!qText || !correctVal) return;

            const qSignature = String(qText).trim().toLowerCase();
            if (seen.has(qSignature)) return; 
            seen.add(qSignature);

            row._uid = generateStableID(qSignature);
            row.Question = qText; 
            row.SheetRow = index + 2; 

            const subj = row.Subject ? row.Subject.trim() : "General";
            const topic = row.Topic ? row.Topic.trim() : "Mixed";
            row.Subject = subj; 
            row.Topic = topic;
            
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
    
    if(document.getElementById('admin-total-q')) {
        document.getElementById('admin-total-q').innerText = allQuestions.length;
    }
}

function generateStableID(str) {
    let hash = 0;
    if (str.length === 0) return hash;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0; 
    }
    return "id_" + Math.abs(hash);
}

// ======================================================
// 6. UI RENDERING (Menus & Filters)
// ======================================================

function renderMenus(subjects, map) {
    const container = document.getElementById('dynamic-menus');
    container.innerHTML = "";
    const sortedSubjects = Array.from(subjects).sort();

    sortedSubjects.forEach(subj => {
        const subjQuestions = allQuestions.filter(q => q.Subject === subj);
        const totalSubj = subjQuestions.length;
        const solvedSubj = subjQuestions.filter(q => userSolvedIDs.includes(q._uid)).length;
        const percentSubj = totalSubj > 0 ? Math.round((solvedSubj / totalSubj) * 100) : 0;
        
        const details = document.createElement('details');
        details.className = "subject-dropdown-card";

        // FIX: Display "Solved / Total" instead of just Percentage
        details.innerHTML = `
            <summary class="subject-summary">
                <div class="summary-header">
                    <span class="subj-name">${subj}</span>
                    <span class="subj-stats">${solvedSubj} / ${totalSubj}</span>
                </div>
                <div class="progress-bar-thin">
                    <div class="fill" style="width:${percentSubj}%"></div>
                </div>
            </summary>
        `;

        const contentDiv = document.createElement('div');
        contentDiv.className = "dropdown-content";

        const allBtn = document.createElement('div');
        allBtn.className = "practice-all-row";
        allBtn.innerHTML = `<span>Practice All ${subj}</span> <span>⭐</span>`;
        allBtn.onclick = () => startPractice(subj, null);
        contentDiv.appendChild(allBtn);

        const sortedTopics = Array.from(map[subj] || []).sort();
        
        if (sortedTopics.length > 0) {
            const gridContainer = document.createElement('div');
            gridContainer.className = "topics-text-grid";
            
            sortedTopics.forEach(topic => {
                const topQuestions = subjQuestions.filter(q => q.Topic === topic);
                const totalTop = topQuestions.length;
                const solvedTop = topQuestions.filter(q => userSolvedIDs.includes(q._uid)).length;
                const percentTop = totalTop > 0 ? Math.round((solvedTop / totalTop) * 100) : 0;
                
                const item = document.createElement('div');
                item.className = "topic-item-container";
                item.onclick = () => startPractice(subj, topic);

                item.innerHTML = `
                    <span class="topic-name">${topic}</span>
                    <div class="topic-mini-track">
                        <div class="topic-mini-fill" style="width:${percentTop}%"></div>
                    </div>
                `;
                gridContainer.appendChild(item);
            });
            contentDiv.appendChild(gridContainer);
        } else {
            contentDiv.innerHTML += `<div style="text-align:center; padding:10px; opacity:0.5;">(No specific topics)</div>`;
        }

        details.appendChild(contentDiv);
        container.appendChild(details);
    });
}

function renderTestFilters(subjects, map) {
    const container = document.getElementById('filter-container');
    if (!container) return; 
    container.innerHTML = "";
    
    const sortedSubjects = Array.from(subjects).sort();

    sortedSubjects.forEach(subj => {
        const details = document.createElement('details');
        details.className = "subject-dropdown-card"; 

        details.innerHTML = `
            <summary class="subject-summary">
                <div class="summary-header">
                    <span class="subj-name">${subj}</span>
                    <label class="select-all-label" onclick="event.stopPropagation()">
                        <input type="checkbox" onchange="toggleSubjectAll(this, '${subj}')"> Select All
                    </label>
                </div>
            </summary>
        `;

        const contentDiv = document.createElement('div');
        contentDiv.className = "dropdown-content";
        const sortedTopics = Array.from(map[subj] || []).sort();
        
        if (sortedTopics.length > 0) {
            const gridContainer = document.createElement('div');
            gridContainer.className = "topics-text-grid"; 
            
            sortedTopics.forEach(topic => {
                const item = document.createElement('div');
                item.className = "topic-text-item exam-selectable"; 
                item.innerText = topic;
                item.dataset.subject = subj;
                item.dataset.topic = topic;
                item.onclick = function() {
                    this.classList.toggle('selected');
                    if(!this.classList.contains('selected')) {
                        details.querySelector('input[type="checkbox"]').checked = false;
                    }
                };
                gridContainer.appendChild(item);
            });
            contentDiv.appendChild(gridContainer);
        }
        details.appendChild(contentDiv);
        container.appendChild(details);
    });
}

function toggleSubjectAll(checkbox, subjName) {
    const header = checkbox.closest('.subject-dropdown-card');
    const items = header.querySelectorAll('.exam-selectable');
    items.forEach(item => {
        if (checkbox.checked) item.classList.add('selected');
        else item.classList.remove('selected');
    });
}

// ======================================================
// 7. STUDY LOGIC (Practice/Test)
// ======================================================

function setMode(mode) {
    currentMode = mode;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    if(event && event.target) event.target.classList.add('active');
    
    document.getElementById('test-settings').classList.toggle('hidden', mode !== 'test');
    document.getElementById('dynamic-menus').classList.toggle('hidden', mode === 'test');
    
    const filterControls = document.getElementById('practice-filter-controls');
    if(filterControls) filterControls.style.display = (mode === 'test') ? 'none' : 'flex';
}

function startPractice(subject, topic) {
    let pool = allQuestions.filter(q => q.Subject === subject && (!topic || q.Topic === topic));
    
    // --- CONTENT GATING (New) ---
    const isPrem = userProfile && userProfile.isPremium;
    if (!isPrem) {
        if (pool.length > 20) {
            pool = pool.slice(0, 20);
            if(currentIndex === 0) alert("🔒 Free/Guest Mode: Limited to first 20 questions.\nGo Premium to unlock full bank.");
        }
    }

    if (pool.length === 0) return alert("No questions available.");

    const onlyUnattempted = document.getElementById('unattempted-only').checked;
    if (onlyUnattempted) {
        pool = pool.filter(q => !userSolvedIDs.includes(q._uid));
        if (pool.length === 0) return alert("You have solved all questions in this section!");
    }

    filteredQuestions = pool;
    
    // Auto-Resume Logic
    let startIndex = 0;
    if (!onlyUnattempted) {
        startIndex = filteredQuestions.findIndex(q => !userSolvedIDs.includes(q._uid));
        if (startIndex === -1) startIndex = 0;
    }

    currentMode = 'practice';
    isMistakeReview = false;
    currentIndex = startIndex;
    
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
    // --- ADMIN BYPASS FIX: Allow Admins to enter Exam Mode freely ---
    const isAdmin = userProfile && userProfile.role === 'admin';
    const isPrem = userProfile && userProfile.isPremium;

    if (!isGuest && !isPrem && !isAdmin) {
        if(!confirm("⚠️ Free Version: Exam mode is limited.\nUpgrade for unlimited tests?")) return;
    }

    const count = parseInt(document.getElementById('q-count').value);
    const mins = parseInt(document.getElementById('t-limit').value);
    
    const selectedElements = document.querySelectorAll('.exam-selectable.selected');
    let pool = [];

    if (selectedElements.length === 0) {
        if(!confirm("Test from ALL subjects?")) return;
        pool = [...allQuestions];
    } else {
        const selectedPairs = new Set();
        selectedElements.forEach(el => selectedPairs.add(el.dataset.subject + "|" + el.dataset.topic));
        pool = allQuestions.filter(q => selectedPairs.has(q.Subject + "|" + q.Topic));
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
    
    // FIX: Show Sidebar Navigator on Desktop & Mobile
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
        
        container.appendChild(createQuestionCard(filteredQuestions[currentIndex], currentIndex, false));
        renderPracticeNavigator(); 

    } else {
        document.getElementById('timer').classList.remove('hidden');
        flagBtn.classList.remove('hidden'); 

        // FIX: Ensure Sidebar is Active on Mobile/Desktop
        document.getElementById('test-sidebar').classList.add('active');

        const start = currentIndex;
        const end = Math.min(start + 5, filteredQuestions.length);
        for (let i = start; i < end; i++) {
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

function createQuestionCard(q, index, showNumber = true) {
    const block = document.createElement('div');
    block.className = "test-question-block";
    block.id = `q-card-${index}`;

    const qText = document.createElement('div');
    qText.className = "test-q-text";
    qText.innerHTML = `${showNumber ? (index + 1) + ". " : ""}${q.Question || "Missing Text"}`;
    block.appendChild(qText);

    const optionsDiv = document.createElement('div');
    optionsDiv.className = "options-group";
    optionsDiv.id = `opts-${index}`;

    let opts = [q.OptionA, q.OptionB, q.OptionC, q.OptionD, q.OptionE].filter(o => o && o.trim() !== "");

    opts.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = "option-btn";
        btn.id = `btn-${index}-${opt}`;
        
        btn.innerHTML = `<span class="opt-text">${opt}</span><span class="elim-eye">👁️</span>`;
        
        btn.querySelector('.elim-eye').onclick = (e) => {
            e.stopPropagation();
            btn.classList.toggle('eliminated');
        };

        btn.onclick = (e) => {
            if (e.target.classList.contains('elim-eye')) return;
            if (btn.classList.contains('eliminated')) btn.classList.remove('eliminated');
            checkAnswer(opt, btn, q);
        };

        btn.addEventListener('contextmenu', (e) => {
            e.preventDefault(); 
            btn.classList.toggle('eliminated');
        });

        if (typeof testAnswers !== 'undefined' && testAnswers[q._uid] === opt) {
            btn.classList.add('selected');
        }

        optionsDiv.appendChild(btn);
    });

    block.appendChild(optionsDiv);
    return block;
}

function checkAnswer(selectedOption, btnElement, q) {
    if (currentMode === 'test') {
        testAnswers[q._uid] = selectedOption;
        const container = btnElement.parentElement;
        container.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
        btnElement.classList.add('selected');
        renderNavigator();
        return;
    }

    // PRACTICE MODE
    let correctData = (q.CorrectAnswer || "").trim();
    let userText = String(selectedOption).trim();
    let isCorrect = false;

    if (userText.toLowerCase() === correctData.toLowerCase()) isCorrect = true;
    else {
        const map = {'A': q.OptionA, 'B': q.OptionB, 'C': q.OptionC, 'D': q.OptionD, 'E': q.OptionE};
        if (map[correctData] === userText) isCorrect = true;
    }

    if (isCorrect) {
        btnElement.classList.remove('wrong');
        btnElement.classList.add('correct');
        saveProgressToDB(q, true); 
        setTimeout(() => showExplanation(q), 300);
    } else {
        btnElement.classList.add('wrong');
        saveProgressToDB(q, false); 
    }
    
    renderPracticeNavigator();
}

function toggleFlag() {
    const q = filteredQuestions[currentIndex];
    if(testFlags[q._uid]) delete testFlags[q._uid];
    else testFlags[q._uid] = true;
    renderNavigator();
}

// ======================================================
// 9. DATABASE SAVING & SUBMISSION
// ======================================================

async function saveProgressToDB(q, isCorrect) {
    if (!currentUser) return;

    if (isCorrect) {
        if (!userSolvedIDs.includes(q._uid)) {
            userSolvedIDs.push(q._uid);
            db.collection('users').doc(currentUser.uid).update({
                solved: firebase.firestore.FieldValue.arrayUnion(q._uid),
                [`stats.${q.Subject.replace(/\W/g,'_')}.correct`]: firebase.firestore.FieldValue.increment(1),
                [`stats.${q.Subject.replace(/\W/g,'_')}.total`]: firebase.firestore.FieldValue.increment(1)
            });
        }
        if (isMistakeReview) {
            userMistakes = userMistakes.filter(id => id !== q._uid);
            db.collection('users').doc(currentUser.uid).update({
                mistakes: firebase.firestore.FieldValue.arrayRemove(q._uid)
            });
        }
    } else {
        if (!userMistakes.includes(q._uid) && !userSolvedIDs.includes(q._uid)) {
            userMistakes.push(q._uid);
            db.collection('users').doc(currentUser.uid).update({
                mistakes: firebase.firestore.FieldValue.arrayUnion(q._uid),
                [`stats.${q.Subject.replace(/\W/g,'_')}.total`]: firebase.firestore.FieldValue.increment(1)
            });
        }
    }
}

function updateTimer() {
    testTimeRemaining--;
    const m = Math.floor(testTimeRemaining/60);
    const s = testTimeRemaining%60;
    document.getElementById('timer').innerText = `${m}:${s<10?'0':''}${s}`;
    if(testTimeRemaining <= 0) submitTest();
}

function submitTest() {
    clearInterval(testTimer);
    let score = 0;
    let wrongList = [];
    
    filteredQuestions.forEach(q => {
        const user = testAnswers[q._uid];
        const correct = getCorrectLetter(q);
        const correctText = getOptionText(q, correct);

        if(user === correctText) {
            score++;
            if(currentUser && !isGuest) {
                db.collection('users').doc(currentUser.uid).update({ solved: firebase.firestore.FieldValue.arrayUnion(q._uid) });
            }
        } else {
            wrongList.push({q, user, correct: correctText});
            if(currentUser && !isGuest && !userMistakes.includes(q._uid)) {
                db.collection('users').doc(currentUser.uid).update({ mistakes: firebase.firestore.FieldValue.arrayUnion(q._uid) });
            }
        }
    });

    const pct = Math.round((score/filteredQuestions.length)*100);
    
    // Save Result
    if(currentUser && !isGuest) {
        db.collection('users').doc(currentUser.uid).collection('results').add({
            date: new Date(), score: pct, total: filteredQuestions.length
        });
    }

    showScreen('result-screen');
    document.getElementById('final-score').innerText = `${pct}% (${score}/${filteredQuestions.length})`;
    
    const list = document.getElementById('review-list');
    list.innerHTML = "";
    wrongList.forEach(item => {
        list.innerHTML += `
            <div style="background:white; padding:15px; margin-bottom:10px; border-left:4px solid #ef4444; border-radius:5px;">
                <b>${item.q.Question}</b><br>
                <span style="color:#ef4444">You: ${item.user||'-'}</span> | 
                <span style="color:#22c55e">Correct: ${item.correct}</span>
                <div style="background:#f9f9f9; padding:10px; margin-top:5px; font-size:0.9em;">${item.q.Explanation || ''}</div>
            </div>`;
    });
}

// ======================================================
// 10. ADMIN & PREMIUM FEATURES
// ======================================================

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

// --- ADMIN DASHBOARD ---
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
    if(event) event.target.classList.add('active');
    
    ['reports', 'payments', 'keys', 'users'].forEach(t => document.getElementById('tab-'+t).classList.add('hidden'));
    document.getElementById('tab-'+tab).classList.remove('hidden');
    
    if(tab==='reports') loadAdminReports();
    if(tab==='payments') loadAdminPayments();
    if(tab==='keys') loadAdminKeys();
    if(tab==='users') loadAllUsers(); // <--- LIST USERS (Fixed)
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
    res.innerHTML = html + "</div>";
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
            <div class="locator-box">📍 Sheet Row: <b>${row}</b></div>
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
    
    // --- UPDATED ADMIN CARD WITH PREMIUM TOGGLE ---
    res.innerHTML = `
    <div class="user-card">
        <h3>${u.email}</h3>
        <p>Premium: ${u.isPremium ? '✅ Active' : '❌ Free'}</p>
        <p>Role: ${u.role}</p>
        
        <div style="display:flex; gap:10px; margin-top:10px;">
            <button onclick="db.collection('users').doc('${doc.id}').update({disabled:${!u.disabled}}).then(()=>alert('Done'))" style="background:${u.disabled?'green':'red'}; color:white; flex:1;">
                ${u.disabled?'Unban':'Ban'}
            </button>
            
            <button onclick="db.collection('users').doc('${doc.id}').update({isPremium:${!u.isPremium}}).then(()=>alert('Status Updated'))" style="background:${u.isPremium?'#64748b':'#d97706'}; color:white; flex:1;">
                ${u.isPremium ? 'Revoke Premium' : 'Grant Premium'}
            </button>
        </div>
    </div>`;
}

// ======================================================
// 11. HELPERS & UTILITIES (Badges & Analytics Fixed)
// ======================================================

function showScreen(screenId) {
    const ids = ['auth-screen', 'dashboard-screen', 'quiz-screen', 'result-screen', 'admin-screen'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if(el) { el.classList.add('hidden'); el.classList.remove('active'); }
    });
    document.querySelectorAll('.modal-overlay').forEach(el => el.classList.add('hidden'));
    
    const target = document.getElementById(screenId);
    if(target) { target.classList.remove('hidden'); target.classList.add('active'); }
}

function getCorrectLetter(q) {
    let dbAns = String(q.CorrectAnswer || "?").trim();
    if (/^[a-eA-E]$/.test(dbAns)) return dbAns.toUpperCase();
    return '?'; 
}

function getOptionText(q, letter) {
    return q['Option' + letter] || "";
}

function showExplanation(q) {
    document.getElementById('explanation-text').innerText = q.Explanation || "No explanation.";
    document.getElementById('explanation-modal').classList.remove('hidden');
}

function closeModal() { document.getElementById('explanation-modal').classList.add('hidden'); }
function nextPageFromModal() { closeModal(); setTimeout(nextPage, 300); }
function nextPage() { currentIndex++; renderPage(); }
function prevPage() { currentIndex--; renderPage(); }

function openPremiumModal() { document.getElementById('premium-modal').classList.remove('hidden'); }
function switchPremTab(t) {
    document.getElementById('prem-content-code').classList.add('hidden');
    document.getElementById('prem-content-manual').classList.add('hidden');
    document.getElementById('prem-content-'+t).classList.remove('hidden');
}

function openProfileModal() { document.getElementById('profile-modal').classList.remove('hidden'); }
function saveProfile() {
    const name = document.getElementById('new-display-name').value;
    currentUser.updateProfile({ displayName: name }).then(() => {
        document.getElementById('user-display').innerText = name;
        document.getElementById('profile-modal').classList.add('hidden');
    });
}

// --- FIX: RESTORE BADGE DESCRIPTIONS & TROPHIES ---
function openBadges() {
    const modal = document.getElementById('badges-modal');
    const container = document.getElementById('badge-list');
    modal.classList.remove('hidden');
    
    const badges = [
        { limit: 10, icon: "👶", name: "Novice", desc: "Solve 10 Questions" },
        { limit: 100, icon: "🥉", name: "Bronze", desc: "Solve 100 Questions" },
        { limit: 500, icon: "🥈", name: "Silver", desc: "Solve 500 Questions" },
        { limit: 1000, icon: "🥇", name: "Gold", desc: "Solve 1000 Questions" },
        { limit: 2000, icon: "💎", name: "Diamond", desc: "Solve 2000 Questions" },
        { limit: 5000, icon: "👑", name: "Master", desc: "Solve 5000 Questions" }
    ];

    let html = "";
    badges.forEach(b => {
        const isUnlocked = userSolvedIDs.length >= b.limit;
        html += `<div class="badge-item ${isUnlocked?'unlocked':''}">
            <div class="badge-icon">${b.icon}</div>
            <div class="badge-name">${b.name}</div>
            <div class="badge-desc" style="font-size:10px; color:#666;">${b.desc}</div>
        </div>`;
    });
    container.innerHTML = html;
}

function updateBadgeButton() {
    // Basic icon update logic
    if(userSolvedIDs.length > 5000) document.getElementById('main-badge-btn').innerText = "👑";
    else if(userSolvedIDs.length > 2000) document.getElementById('main-badge-btn').innerText = "💎";
    else if(userSolvedIDs.length > 1000) document.getElementById('main-badge-btn').innerText = "🥇";
    else if(userSolvedIDs.length > 500) document.getElementById('main-badge-btn').innerText = "🥈";
    else if(userSolvedIDs.length > 100) document.getElementById('main-badge-btn').innerText = "🥉";
    else document.getElementById('main-badge-btn').innerText = "🏆";
}

// --- FIX: ANALYTICS TABLE & COUNTS ---
async function openAnalytics() {
    const modal = document.getElementById('analytics-modal');
    const container = document.getElementById('analytics-content');
    modal.classList.remove('hidden');
    container.innerHTML = "Loading...";
    
    if(!currentUser || isGuest) { container.innerHTML = "Sign in to see stats."; return; }
    
    try {
        // 1. Stats
        const doc = await db.collection('users').doc(currentUser.uid).get();
        const stats = doc.data().stats || {};
        
        let html = "<h3>📊 Performance</h3>";
        Object.keys(stats).forEach(key => {
            const s = stats[key];
            const pct = Math.round((s.correct/s.total)*100);
            html += `<div class="stat-item">
                <div class="stat-header"><span>${key}</span><span>${pct}%</span></div>
                <div class="progress-track"><div class="progress-fill" style="width:${pct}%; background:#2ecc71;"></div></div>
                <div class="stat-meta">${s.correct}/${s.total} Correct</div>
            </div>`;
        });

        // 2. Exam History (New Table)
        const historySnap = await db.collection('users').doc(currentUser.uid).collection('results').orderBy('date', 'desc').limit(5).get();
        
        html += "<h3 style='margin-top:20px;'>📜 Recent Exams</h3>";
        if(historySnap.empty) html += "<p>No exams taken.</p>";
        else {
            html += "<table style='width:100%; border-collapse:collapse; margin-top:10px;'><tr><th>Date</th><th>Score</th></tr>";
            historySnap.forEach(r => {
                const d = r.data();
                const dateStr = d.date ? new Date(d.date.seconds*1000).toLocaleDateString() : '-';
                html += `<tr><td style='border:1px solid #eee; padding:5px;'>${dateStr}</td><td style='border:1px solid #eee; padding:5px;'>${d.score}%</td></tr>`;
            });
            html += "</table>";
        }
        
        container.innerHTML = html || "No data yet.";
    } catch(e) { container.innerHTML = "Error: " + e.message; }
}

function toggleTheme() {
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    document.body.setAttribute('data-theme', isDark ? '' : 'dark');
    document.getElementById('theme-btn').innerText = isDark ? '🌙' : '☀️';
    localStorage.setItem('fcps-theme', isDark ? 'light' : 'dark');
}

function renderPracticeNavigator() {
    const c = document.getElementById('practice-nav-container');
    if(!c || currentMode !== 'practice') return;
    c.innerHTML = "";
    c.classList.remove('hidden');
    filteredQuestions.forEach((q,i) => {
        const b = document.createElement('button');
        b.className = `prac-nav-btn ${i===currentIndex?'active':''} ${userSolvedIDs.includes(q._uid)?'solved':''} ${userMistakes.includes(q._uid)?'wrong':''}`;
        b.innerText = i+1;
        b.onclick = () => { currentIndex=i; renderPage(); renderPracticeNavigator(); };
        c.appendChild(b);
    });
    
    setTimeout(() => {
        const activeBtn = c.querySelector('.active');
        if (activeBtn) activeBtn.scrollIntoView({ behavior: 'smooth', inline: 'center' });
    }, 100);
}

function renderNavigator() {
    const c = document.getElementById('nav-grid');
    if (!c) return;
    c.innerHTML = "";
    filteredQuestions.forEach((q,i) => {
        const b = document.createElement('div');
        b.className = `nav-btn ${i===currentIndex?'current':''} ${testAnswers[q._uid]?'answered':''}`;
        b.innerText = i+1;
        b.onclick = () => { currentIndex=i; renderPage(); renderNavigator(); };
        c.appendChild(b);
    });
}

function toggleReportForm() { document.getElementById('report-form').classList.toggle('hidden'); }
function submitReport() {
    const r = document.getElementById('report-reason').value;
    if(!r) return;
    db.collection('reports').add({
        questionID: filteredQuestions[currentIndex]._uid,
        questionText: filteredQuestions[currentIndex].Question,
        reportReason: r,
        reportedBy: currentUser ? currentUser.email : 'Guest',
        timestamp: new Date()
    }).then(() => { alert("Report Sent!"); toggleReportForm(); });
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

function goHome() { 
    clearInterval(testTimer); 
    showScreen('dashboard-screen'); 
    loadUserData(); 
}

window.onload = () => {
    if(localStorage.getItem('fcps-theme')==='dark') toggleTheme();
}
