// ======================================================
// 1. CONFIGURATION & FIREBASE SETUP
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
let userProfile = null; // Stores role, premium status, device ID
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

// --- FEATURE: DEVICE LOCK (Anti-Sharing) ---
let currentDeviceId = localStorage.getItem('fcps_device_id');
if (!currentDeviceId) {
    currentDeviceId = 'dev_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('fcps_device_id', currentDeviceId);
}

// --- PREMIUM PLANS (Duration in Milliseconds) ---
const PLAN_DURATIONS = {
    '1_day': 86400000,
    '1_week': 604800000,
    '15_days': 1296000000,
    '1_month': 2592000000,
    '3_months': 7776000000,
    '6_months': 15552000000,
    '12_months': 31536000000,
    'lifetime': 2524608000000
};

// ======================================================
// 3. AUTHENTICATION & SECURITY LOGIC
// ======================================================

auth.onAuthStateChanged(async (user) => {
    if (user) {
        // User LOGGED IN
        console.log("✅ User detected:", user.email);
        currentUser = user;
        isGuest = false;
        
        // Hide Auth, Show Dashboard
        document.getElementById('auth-screen').classList.add('hidden');
        document.getElementById('auth-screen').classList.remove('active');
        
        // Run security check (this will eventually show the dashboard)
        await checkLoginSecurity(user);
        
    } else {
        // User LOGGED OUT
        if (!isGuest) {
            console.log("🔒 No user signed in.");
            currentUser = null;
            userProfile = null;
            
            // CRITICAL FIX: Hide Dashboard & Modals explicitly
            document.getElementById('dashboard-screen').classList.add('hidden');
            document.getElementById('dashboard-screen').classList.remove('active');
            
            document.getElementById('premium-modal').classList.add('hidden'); // Hide modal
            
            // Show Login
            showScreen('auth-screen');
        }
    }
});

// --- CORE SECURITY CHECK ---
async function checkLoginSecurity(user) {
    try {
        const docRef = db.collection('users').doc(user.uid);
        const doc = await docRef.get();

        if (!doc.exists) {
            // New User: Create Profile with 'joined' date
            await docRef.set({
                email: user.email,
                deviceId: currentDeviceId,
                role: 'student',
                isPremium: false,
                joined: new Date(), // <--- Sets current date for new users
                solved: [], bookmarks: [], mistakes: [], stats: {}
            }, { merge: true });
            
            loadUserData();
        } else {
            const data = doc.data();
            
            // --- AUTO-FIX: If 'joined' date is missing, add it now ---
            if (!data.joined) {
                // Use the account creation time from Firebase Auth, or current time as fallback
                const creationTime = user.metadata.creationTime ? new Date(user.metadata.creationTime) : new Date();
                
                // Update the database silently
                await docRef.update({ joined: creationTime });
                
                // Update local variable so the profile shows it immediately
                data.joined = creationTime; 
            }
            // ----------------------------------------------------------

            // 1. ADMIN BAN CHECK
            if (data.disabled) {
                auth.signOut();
                alert("⛔ Your account has been disabled by the admin.");
                return;
            }

            // 2. DEVICE LOCK CHECK
            if (data.deviceId && data.deviceId !== currentDeviceId) {
                // Optional: You can comment this out if you want to allow multi-device for now
                auth.signOut();
                alert("🚫 Security Alert: Account logged in on another device.\n\nPlease log out from the other device first.");
                return;
            }

            // Update Device ID if missing (Legacy support)
            if (!data.deviceId) await docRef.update({ deviceId: currentDeviceId });
            
            userProfile = data;
            loadUserData();
        }
        
        // Success: Load App
        showScreen('dashboard-screen');
        loadQuestions(); 
        
        // Show Admin Button if Authorized
        if (userProfile && userProfile.role === 'admin') {
            const btn = document.getElementById('admin-btn');
            if(btn) btn.classList.remove('hidden');
        }

        checkPremiumExpiry();

    } catch (e) { 
        console.error("Auth Error:", e); 
        // Fallback to allow entry if DB read fails (optional)
        loadUserData();
        showScreen('dashboard-screen');
        loadQuestions();
    }
}

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

function checkPremiumExpiry() {
    if (!userProfile || !userProfile.isPremium || !userProfile.expiryDate) {
        document.getElementById('premium-badge').classList.add('hidden');
        document.getElementById('get-premium-btn').classList.remove('hidden');
        return;
    }
    
    const now = new Date().getTime();
    // Handle Firestore Timestamp vs JS Date
    const expiry = userProfile.expiryDate.toMillis ? userProfile.expiryDate.toMillis() : new Date(userProfile.expiryDate).getTime();

    if (now > expiry) {
        // Expired: Revoke Premium
        db.collection('users').doc(currentUser.uid).update({ isPremium: false });
        userProfile.isPremium = false;
        
        document.getElementById('premium-badge').classList.add('hidden');
        document.getElementById('get-premium-btn').classList.remove('hidden');
        alert("⚠️ Your Premium Subscription has expired.");
    } else {
        // Active
        document.getElementById('premium-badge').classList.remove('hidden');
        document.getElementById('get-premium-btn').classList.add('hidden');
    }
}

// ======================================================
// 4. USER DATA MANAGEMENT (Fixed Stats)
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

        // --- CALCULATION FIX: Total Attempts vs Correct ---
        let totalAttempts = 0;
        let totalCorrect = 0;
        
        if (userData.stats) {
            Object.values(userData.stats).forEach(s => {
                totalAttempts += (s.total || 0);
                totalCorrect += (s.correct || 0);
            });
        }
        
        const accuracy = totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : 0;

        // --- DASHBOARD UI UPDATE ---
        if(statsBox) {
            statsBox.style.opacity = "1"; 
            statsBox.innerHTML = `
                <div style="margin-top:5px; font-size:14px; line-height:1.8;">
                    <div>✅ Unique Solved: <b style="color:#2ecc71;">${userSolvedIDs.length}</b></div>
                    <div>🎯 Accuracy: <b>${accuracy}%</b> <span style="font-size:11px; color:#666;">(${totalCorrect}/${totalAttempts})</span></div>
                    <div style="color:#ef4444;">❌ Pending Mistakes: <b>${userMistakes.length}</b></div>
                </div>`;
        }

        updateBadgeButton(); 

        // Refresh Menus if data exists
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
        if (lastLogin === yesterday.toDateString()) currentStreak++;
        else currentStreak = 1;
        
        db.collection('users').doc(currentUser.uid).set({
            lastLoginDate: today, streak: currentStreak
        }, { merge: true });
    }

    if(currentStreak > 0) {
        document.getElementById('streak-display').classList.remove('hidden');
        document.getElementById('streak-count').innerText = currentStreak + " Day Streak";
    }
}

// ======================================================
// 5. DATA LOADING & PROCESSING
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

            row._uid = "id_" + Math.abs(generateHash(qSignature));
            row.Question = qText; 
            
            // --- ROW LOCATOR (For Admin) ---
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
    
    // Update Admin Stats
    if(document.getElementById('admin-total-q')) {
        document.getElementById('admin-total-q').innerText = allQuestions.length;
    }
}

function generateHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash) + str.charCodeAt(i) | 0;
    return hash;
}

// ======================================================
// 6. UI RENDERERS (Menu with Counts)
// ======================================================

function renderMenus(subjects, map) {
    const container = document.getElementById('dynamic-menus');
    container.innerHTML = "";
    Array.from(subjects).sort().forEach(subj => {
        const subjQuestions = allQuestions.filter(q => q.Subject === subj);
        const solvedCount = subjQuestions.filter(q => userSolvedIDs.includes(q._uid)).length;
        const totalSubj = subjQuestions.length;
        const pct = totalSubj > 0 ? Math.round((solvedCount/totalSubj)*100) : 0;

        const details = document.createElement('details');
        details.className = "subject-dropdown-card";
        
        // FIX: Display "Solved / Total" instead of just Percentage
        details.innerHTML = `
            <summary class="subject-summary">
                <div class="summary-header">
                    <span class="subj-name">${subj}</span>
                    <span class="subj-stats">${solvedCount} / ${totalSubj}</span>
                </div>
                <div class="progress-bar-thin">
                    <div class="fill" style="width:${pct}%"></div>
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

                // FIX: Added small count inside topic box
                item.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span class="topic-name">${topic}</span>
                        <span style="font-size:10px; color:#888;">${solvedTop}/${totalTop}</span>
                    </div>
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
// 7. STUDY LOGIC (Practice/Test with Admin Bypass)
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
    
    // --- CONTENT GATING ---
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
    // --- ADMIN BYPASS FIX ---
    const isAdmin = userProfile && userProfile.role === 'admin';
    const isPrem = userProfile && userProfile.isPremium;

    // Only block if NOT Guest AND NOT Premium AND NOT Admin
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
// 8. QUIZ ENGINE (Fixed Sidebar Logic)
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
        document.getElementById('test-sidebar').classList.add('active'); // Force sidebar

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
      updateBadgeButton();
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
    
    // --- 1. DETERMINE EXAM SUBJECT ---
    // If all questions are from one subject, use that name. Otherwise "Mixed".
    const uniqueSubjects = [...new Set(filteredQuestions.map(q => q.Subject))];
    const examSubject = uniqueSubjects.length === 1 ? uniqueSubjects[0] : "Mixed Subjects";

    filteredQuestions.forEach(q => {
        const user = testAnswers[q._uid];
        const correct = getCorrectLetter(q);
        const correctText = getOptionText(q, correct);
        if(user === correctText) {
            score++;
            if(currentUser && !isGuest) {
                db.collection('users').doc(currentUser.uid).update({ solved: firebase.firestore.FieldValue.arrayUnion(q._uid) });
            }
        }
    });

    const pct = Math.round((score/filteredQuestions.length)*100);
    
    // --- 2. SAVE WITH SUBJECT TAG ---
    if(currentUser && !isGuest) {
        db.collection('users').doc(currentUser.uid).collection('results').add({
            date: new Date(), 
            score: pct, 
            total: filteredQuestions.length,
            subject: examSubject // <--- Saving the subject here
        });
    }

    showScreen('result-screen');
    document.getElementById('final-score').innerText = `${pct}% (${score}/${filteredQuestions.length})`;
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

// --- NEW FUNCTION: Handle Plan Selection ---
function selectPlan(planValue, element) {
    // 1. Remove 'selected' class from all other items
    document.querySelectorAll('.price-item').forEach(item => {
        item.classList.remove('selected');
    });

    // 2. Add 'selected' class to the clicked item
    element.classList.add('selected');

    // 3. Store the value in the hidden input
    document.getElementById('selected-plan-value').value = planValue;
}

async function submitPaymentProof() {
    const selectedPlan = document.getElementById('selected-plan-value').value;
    const file = document.getElementById('pay-proof').files[0];
    if(!selectedPlan) return alert("❌ Please select a plan from the list above.");
    if(!file) return alert("❌ Please upload a screenshot of your payment.");

    let imgStr = null;
    if(file.size > 2000000) return alert("Image too large (Max 2MB)"); // Increased limit to 2MB
    
    const btn = event.target;
    const originalText = btn.innerText;
    btn.innerText = "Uploading...";
    btn.disabled = true;

    try {
        imgStr = await new Promise((resolve, reject) => {
            let fr = new FileReader();
            fr.onload = () => resolve(fr.result);
            fr.onerror = reject;
            fr.readAsDataURL(file);
        });

        const autoTID = "MANUAL_" + Math.random().toString(36).substr(2, 6).toUpperCase();

        await db.collection('payment_requests').add({
            uid: currentUser.uid, 
            email: currentUser.email, 
            tid: autoTID, 
            planRequested: selectedPlan, // Uses the clicked plan
            image: imgStr, 
            status: 'pending', 
            timestamp: new Date()
        });

        alert("✅ Request Sent! Please wait for admin approval.");
        document.getElementById('premium-modal').classList.add('hidden');

    } catch (e) {
        alert("Error: " + e.message);
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
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
    if(tab==='users') loadAllUsers();
}

async function loadAllUsers() {
    const res = document.getElementById('admin-user-result');
    res.innerHTML = "Loading...";
    
    const snap = await db.collection('users').limit(50).get();
    
    let html = "<div style='background:white; border-radius:12px;'>";
    
    let count = 0;
    snap.forEach(doc => {
        const u = doc.data();
        
        if (!u.email || u.email === "undefined") return;
        
        count++;
        html += `<div class="user-list-item">
            <div><b>${u.email}</b><br><small>${u.role} | ${u.isPremium ? 'Premium' : 'Free'}</small></div>
            <button onclick="adminLookupUser('${doc.id}')" style="width:auto; padding:5px 10px; font-size:11px;">Manage</button>
        </div>`;
    });
    
    if(count === 0) html += "<div style='padding:15px;'>No valid users found.</div>";
    
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
    
    if(snap.empty) { 
        list.innerHTML = "<div style='padding:20px; text-align:center; color:#666;'>No pending payment requests.</div>"; 
        return; 
    }

    let html = "";
    snap.forEach(doc => {
        const p = doc.data();
        // Get the requested plan, format it nicely (e.g., "1_week" -> "1 Week")
        const reqPlan = p.planRequested ? p.planRequested.replace('_', ' ').toUpperCase() : "UNKNOWN";
        
        html += `<div class="report-card">
            <div style="margin-bottom:5px;"><strong>${p.email}</strong></div>
            <div style="font-size:12px; color:#555; margin-bottom:10px;">
                Requested: <span style="background:#e0f2fe; color:#0284c7; padding:2px 6px; border-radius:4px; font-weight:bold;">${reqPlan}</span>
            </div>
            
            ${p.image ? `<a href="${p.image}" target="_blank"><img src="${p.image}" style="max-width:100%; border-radius:8px; border:1px solid #ddd; margin-bottom:10px;"></a>` : ''}
            
            <div style="background:#f8fafc; padding:10px; border-radius:8px; border:1px solid #eee;">
                <label style="font-size:11px; font-weight:bold; display:block; margin-bottom:5px;">Approve for Duration:</label>
                <div style="display:flex; gap:5px;">
                    <select id="dur-${doc.id}" style="flex:1; padding:8px; border:1px solid #ccc; border-radius:6px; font-size:12px;">
                        <option value="1_day" ${p.planRequested === '1_day' ? 'selected' : ''}>1 Day</option>
                        <option value="1_week" ${p.planRequested === '1_week' ? 'selected' : ''}>1 Week</option>
                        <option value="15_days" ${p.planRequested === '15_days' ? 'selected' : ''}>15 Days</option>
                        <option value="1_month" ${p.planRequested === '1_month' ? 'selected' : ''}>1 Month</option>
                        <option value="3_months" ${p.planRequested === '3_months' ? 'selected' : ''}>3 Months</option>
                        <option value="6_months" ${p.planRequested === '6_months' ? 'selected' : ''}>6 Months</option>
                        <option value="12_months" ${p.planRequested === '12_months' ? 'selected' : ''}>12 Months</option>
                        <option value="lifetime" ${p.planRequested === 'lifetime' ? 'selected' : ''}>Lifetime</option>
                    </select>
                    <button class="primary" onclick="approvePayment('${doc.id}','${p.uid}')" style="margin:0; padding:0 15px; font-size:12px;">Approve</button>
                </div>
                <button class="secondary" onclick="db.collection('payment_requests').doc('${doc.id}').update({status:'rejected'}).then(()=>loadAdminPayments())" style="width:100%; margin-top:5px; padding:8px; font-size:12px; color:#ef4444; border-color:#fecaca;">Reject Request</button>
            </div>
        </div>`;
    });
    list.innerHTML = html;
}

async function approvePayment(docId, userId) {
    // 1. Get the duration approved by Admin
    const select = document.getElementById(`dur-${docId}`);
    const planKey = select.value;
    const duration = PLAN_DURATIONS[planKey];

    if(!duration) return alert("Invalid duration selected");

    const btn = event.target;
    btn.innerText = "Processing...";
    btn.disabled = true;

    try {
        // 2. Calculate Expiry
        let newExpiry;
        if (planKey === 'lifetime') {
            newExpiry = new Date("2100-01-01");
        } else {
            newExpiry = new Date(Date.now() + duration);
        }

        const batch = db.batch();

        // 3. Update User Document
        const userRef = db.collection('users').doc(userId);
        batch.update(userRef, { 
            isPremium: true, 
            plan: planKey,
            expiryDate: newExpiry 
        });

        // 4. Update Payment Request Status
        const payRef = db.collection('payment_requests').doc(docId);
        batch.update(payRef, { status: 'approved', approvedAt: new Date() });

        await batch.commit();

        alert("✅ Request Approved & Premium Activated!");
        loadAdminPayments(); // Refresh list

    } catch (e) {
        alert("Error: " + e.message);
        btn.innerText = "Approve";
        btn.disabled = false;
    }
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
    
    // Updated HTML with Dropdown and "Refresh-on-Click" logic
    res.innerHTML = `
    <div class="user-card">
        <h3>${u.email}</h3>
        <p>Premium: ${u.isPremium ? '✅ Active' : '❌ Free'}</p>
        <p>Role: ${u.role}</p>
        
        <div style="margin-top:10px; padding-top:10px; border-top:1px solid #eee;">
            <label style="font-size:12px; font-weight:bold;">Manage Subscription:</label>
            <div style="display:flex; gap:5px; margin-top:5px;">
                <select id="admin-grant-plan-${doc.id}" style="padding:5px; border-radius:5px; border:1px solid #ccc;">
                  <option value="1_day">1 Day</option>
                  <option value="1_week">1 Week</option>
                  <option value="15_days">15 Days</option>
                  <option value="1_month">1 Month</option>
                  <option value="3_months">3 Months</option>
                  <option value="6_months">6 Months</option>
                  <option value="12_months">12 Months</option>
                  <option value="lifetime">Lifetime</option>
                </select>
                <button onclick="adminGrantPremium('${doc.id}')" style="background:#d97706; color:white; padding:5px 10px; margin:0; font-size:12px;">
                    Grant
                </button>
            </div>
        </div>
        
        <div style="display:flex; gap:10px; margin-top:15px;">
            <button onclick="adminToggleBan('${doc.id}', ${!u.disabled})" style="background:${u.disabled?'green':'red'}; color:white; flex:1;">
                ${u.disabled?'Unban':'Ban User'}
            </button>
            <button onclick="adminRevokePremium('${doc.id}')" style="background:#64748b; color:white; flex:1;">
                Revoke Premium
            </button>
        </div>
    </div>`;
}

// --- ADD THESE NEW FUNCTIONS RIGHT BELOW adminLookupUser ---

async function adminGrantPremium(uid) {
    // 1. Get the selected duration from the dropdown
    const select = document.getElementById(`admin-grant-plan-${uid}`);
    const planKey = select.value; // e.g., '1_month', 'lifetime'
    
    // 2. Look up the milliseconds from your configuration
    const duration = PLAN_DURATIONS[planKey];
    
    if (!duration) return alert("❌ Error: Invalid plan selected.");

    const confirmAction = confirm(`Grant '${planKey}' to this user?`);
    if (!confirmAction) return;

    try {
        // 3. Calculate the Expiry Date
        // If it's lifetime, we set a date far in the future (Year 2100)
        let newExpiry;
        if (planKey === 'lifetime') {
            newExpiry = new Date("2100-01-01"); 
        } else {
            newExpiry = new Date(Date.now() + duration);
        }

        // 4. SAVE TO DATABASE
        await db.collection('users').doc(uid).update({
            isPremium: true,
            plan: planKey,          // Save the plan name
            expiryDate: newExpiry,  // Save the calculated date
            updatedAt: new Date()
        });

        alert("✅ Premium Granted Successfully!");
        adminLookupUser(uid); // Refresh the admin view

    } catch (e) {
        console.error(e);
        alert("Error: " + e.message);
    }
}

async function adminRevokePremium(uid) {
    await db.collection('users').doc(uid).update({ isPremium: false });
    alert("🚫 Revoked Premium");
    adminLookupUser(uid); // <--- This refreshes the card
}

async function adminToggleBan(uid, newStatus) {
    await db.collection('users').doc(uid).update({ disabled: newStatus });
    alert("Status Updated");
    adminLookupUser(uid); // <--- This refreshes the card
}

// ======================================================
// 11. HELPERS & UTILITIES (Badges, Analytics, Screen Switcher)
// ======================================================

// --- FIX: SCREEN SWITCHER (Correctly hides everything) ---
function showScreen(screenId) {
    const ids = [
        'auth-screen', 'dashboard-screen', 'quiz-screen', 'result-screen', 'admin-screen',
        'explanation-modal', 'premium-modal', 'profile-modal', 'analytics-modal', 'badges-modal'
    ];
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
function switchPremTab(tab) {
    document.getElementById('prem-content-code').classList.add('hidden');
    document.getElementById('prem-content-manual').classList.add('hidden');
    document.getElementById('tab-btn-code').classList.remove('active');
    document.getElementById('tab-btn-manual').classList.remove('active');
    document.getElementById('prem-content-'+tab).classList.remove('hidden');
    document.getElementById('tab-btn-'+tab).classList.add('active');
}

async function openProfileModal() {
    if (!currentUser || isGuest) return alert("Please log in to edit profile.");
    
    document.getElementById('profile-modal').classList.remove('hidden');
    
    // 1. Fetch Latest Data
    let freshData = {};
    try {
        const doc = await db.collection('users').doc(currentUser.uid).get();
        if (doc.exists) freshData = doc.data();
    } catch (e) {
        console.error("Profile fetch error:", e);
        freshData = userProfile || {}; 
    }

    // 2. Email & Plan
    document.getElementById('profile-email').innerText = currentUser.email;
    const isPrem = freshData.isPremium || false;
    document.getElementById('profile-plan').innerText = isPrem ? "PREMIUM 👑" : "Free Plan";
    
    // 3. Joined Date (Auto-Fix if missing)
    let joinedText = "Unknown";
    
    // Priority 1: Database Field
    if (freshData.joined) {
        joinedText = formatDateHelper(freshData.joined);
    } 
    // Priority 2: Firebase Auth Metadata (Creation Time)
    else if (currentUser.metadata && currentUser.metadata.creationTime) {
        joinedText = new Date(currentUser.metadata.creationTime).toLocaleDateString();
        
        // OPTIONAL: Self-repair database in background
        db.collection('users').doc(currentUser.uid).update({ 
            joined: new Date(currentUser.metadata.creationTime) 
        }).catch(err => console.log("Auto-repair joined date failed", err));
    }
    document.getElementById('profile-joined').innerText = joinedText;

    // 4. Expiry Date Logic
    let expiryText = "-";
    const expiryElem = document.getElementById('profile-expiry');
    
    if (isPrem) {
        if (freshData.expiryDate) {
            const dateObj = parseDateHelper(freshData.expiryDate);
            // Check if Lifetime (Year > 2090)
            if (dateObj.getFullYear() > 2090) {
                expiryText = "Lifetime";
                expiryElem.style.color = "#10b981"; // Green
            } else {
                expiryText = dateObj.toLocaleDateString();
                expiryElem.style.color = "#d97706"; // Orange
            }
        } else {
            // Premium is TRUE, but no date exists -> Must be Admin granted or Lifetime
            expiryText = "Lifetime / Admin";
            expiryElem.style.color = "#10b981"; 
        }
    } else {
        expiryText = "Not Active";
        expiryElem.style.color = "#64748b"; // Grey
    }
    
    expiryElem.innerText = expiryText;
    
    // 5. Fill Editable Inputs
    document.getElementById('edit-name').value = freshData.displayName || "";
    document.getElementById('edit-phone').value = freshData.phone || "";
    document.getElementById('edit-college').value = freshData.college || "";
    document.getElementById('edit-exam').value = freshData.targetExam || "FCPS-1";
}

// --- HELPER TO HANDLE ALL DATE FORMATS ---
function parseDateHelper(dateInput) {
    if (!dateInput) return new Date();
    // Handle Firestore Timestamp
    if (dateInput.toDate) return dateInput.toDate(); 
    if (typeof dateInput.toMillis === 'function') return new Date(dateInput.toMillis());
    if (dateInput.seconds) return new Date(dateInput.seconds * 1000);
    // Handle String/Number
    return new Date(dateInput);
}

function formatDateHelper(dateInput) {
    const d = parseDateHelper(dateInput);
    return isNaN(d.getTime()) ? "N/A" : d.toLocaleDateString();
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
        const doc = await db.collection('users').doc(currentUser.uid).get();
        const stats = doc.data().stats || {};
        
        let html = "<h3>📊 Subject Performance</h3>";
        Object.keys(stats).forEach(key => {
            const s = stats[key];
            const pct = Math.round((s.correct/s.total)*100);
            html += `<div class="stat-item">
                <div class="stat-header"><span>${key}</span><span>${pct}% (${s.correct}/${s.total})</span></div>
                <div class="progress-track"><div class="progress-fill" style="width:${pct}%; background:#2ecc71;"></div></div>
            </div>`;
        });

        // --- NEW: FETCH EXAM HISTORY ---
        const historySnap = await db.collection('users').doc(currentUser.uid).collection('results').orderBy('date', 'desc').limit(10).get();
        
        html += "<h3 style='margin-top:25px; border-top:1px solid #eee; padding-top:15px;'>📜 Recent Exams</h3>";
        if(historySnap.empty) html += "<p style='color:#666;'>No exams taken yet.</p>";
        else {
            html += `<table style='width:100%; border-collapse:collapse; font-size:13px; margin-top:10px;'>
                <tr style='background:#f8fafc; text-align:left;'>
                    <th style='padding:8px; border:1px solid #e2e8f0;'>Date</th>
                    <th style='padding:8px; border:1px solid #e2e8f0;'>Subject</th>
                    <th style='padding:8px; border:1px solid #e2e8f0;'>Score</th>
                </tr>`;
            
            historySnap.forEach(r => {
                const d = r.data();
                const dateStr = d.date ? new Date(d.date.seconds*1000).toLocaleDateString() : '-';
                const subj = d.subject || "Mixed"; // Fallback for old data
                const scoreColor = d.score >= 70 ? "#166534" : "#b91c1c"; // Green if pass, Red if fail
                
                html += `<tr>
                    <td style='border:1px solid #e2e8f0; padding:8px;'>${dateStr}</td>
                    <td style='border:1px solid #e2e8f0; padding:8px;'>${subj}</td>
                    <td style='border:1px solid #e2e8f0; padding:8px; font-weight:bold; color:${scoreColor};'>${d.score}%</td>
                </tr>`;
            });
            html += "</table>";
        }
        
        container.innerHTML = html || "No data yet.";
    } catch(e) { container.innerHTML = "Error loading analytics: " + e.message; }
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

// Fallback for missing admin functions in case of load errors
if (typeof loadAdminReports !== 'function') window.loadAdminReports = function(){};
if (typeof loadAdminPayments !== 'function') window.loadAdminPayments = function(){};
if (typeof loadAdminKeys !== 'function') window.loadAdminKeys = function(){};

window.onload = () => {
    if(localStorage.getItem('fcps-theme')==='dark') toggleTheme();
}

// --- 1. RESET PASSWORD FUNCTION ---
function resetPassword() {
    const email = document.getElementById('email').value;
    if (!email) return alert("Please enter your email address in the box above first.");
    
    auth.sendPasswordResetEmail(email)
        .then(() => alert("📧 Password reset email sent! Check your inbox."))
        .catch(e => alert("Error: " + e.message));
}

// --- 2. PROFILE FUNCTIONS ---

// Open Modal & Load Data
function openProfileModal() {
    if (!currentUser || isGuest) return alert("Please log in to edit profile.");
    
    document.getElementById('profile-modal').classList.remove('hidden');
    
    // Load data from userProfile global variable
    document.getElementById('profile-email').innerText = currentUser.email;
    document.getElementById('profile-plan').innerText = userProfile.isPremium ? "PREMIUM 👑" : "Free Plan";
    document.getElementById('profile-joined').innerText = userProfile.joined ? new Date(userProfile.joined.seconds * 1000).toLocaleDateString() : "N/A";
    
    // Fill Inputs
    document.getElementById('edit-name').value = userProfile.displayName || "";
    document.getElementById('edit-phone').value = userProfile.phone || "";
    document.getElementById('edit-college').value = userProfile.college || "";
    document.getElementById('edit-exam').value = userProfile.targetExam || "FCPS-1";
}

// Save Data to Firebase
async function saveDetailedProfile() {
    const name = document.getElementById('edit-name').value;
    const phone = document.getElementById('edit-phone').value;
    const college = document.getElementById('edit-college').value;
    const exam = document.getElementById('edit-exam').value;

    try {
        // Update Auth Profile (Display Name)
        if (currentUser.displayName !== name) {
            await currentUser.updateProfile({ displayName: name });
        }

        // Update Firestore Document
        await db.collection('users').doc(currentUser.uid).update({
            displayName: name,
            phone: phone,
            college: college,
            targetExam: exam
        });

        // Update Local State
        userProfile.displayName = name;
        userProfile.phone = phone;
        userProfile.college = college;
        userProfile.targetExam = exam;
        
        document.getElementById('user-display').innerText = name || "User"; // Update header
        alert("✅ Profile Updated Successfully!");
        document.getElementById('profile-modal').classList.add('hidden');

    } catch (e) {
        alert("Error saving profile: " + e.message);
    }
}




