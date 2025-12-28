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
// 2. STATE VARIABLES & GLOBALS
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

// --- FEATURE: DEVICE LOCK ---
let currentDeviceId = localStorage.getItem('fcps_device_id');
if (!currentDeviceId) {
    currentDeviceId = 'dev_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('fcps_device_id', currentDeviceId);
}

// --- GLOBAL PREMIUM PLANS CONFIGURATION (The Calculator) ---
const PLAN_DURATIONS = {
    '1_day': 86400000,
    '1_week': 604800000,
    '15_days': 1296000000,
    '1_month': 2592000000,
    '3_months': 7776000000,
    '6_months': 15552000000,
    '12_months': 31536000000,
    'lifetime': 2524608000000 // ~80 Years
};

// ======================================================
// 3. AUTHENTICATION & SECURITY LOGIC
// ======================================================

auth.onAuthStateChanged(async (user) => {
    if (user) {
        console.log("✅ User detected:", user.email);
        currentUser = user;
        isGuest = false;
        
        document.getElementById('auth-screen').classList.add('hidden');
        document.getElementById('auth-screen').classList.remove('active');
        
        await checkLoginSecurity(user);
        
    } else {
        if (!isGuest) {
            console.log("🔒 No user signed in.");
            currentUser = null;
            userProfile = null;
            
            document.getElementById('dashboard-screen').classList.add('hidden');
            document.getElementById('dashboard-screen').classList.remove('active');
            document.getElementById('premium-modal').classList.add('hidden');
            
            showScreen('auth-screen');
        }
    }
});

async function checkLoginSecurity(user) {
    try {
        const docRef = db.collection('users').doc(user.uid);
        const doc = await docRef.get();

        if (!doc.exists) {
            // New User Creation
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
            
            // --- AUTO-REPAIR: Fix Missing Data ---
            const updates = {};
            
            if (!data.email || data.email !== user.email) {
                updates.email = user.email;
                data.email = user.email; 
            }

            if (!data.joined) {
                const creationTime = user.metadata.creationTime ? new Date(user.metadata.creationTime) : new Date();
                updates.joined = creationTime;
                data.joined = creationTime;
            }

            if (Object.keys(updates).length > 0) {
                await docRef.update(updates);
            }

            if (data.disabled) {
                auth.signOut();
                alert("⛔ Your account has been disabled by the admin.");
                return;
            }

            if (!data.deviceId) await docRef.update({ deviceId: currentDeviceId });
            
            userProfile = data;
            loadUserData();
        }
        
        showScreen('dashboard-screen');
        loadQuestions(); 
        
        if (userProfile && userProfile.role === 'admin') {
            const btn = document.getElementById('admin-btn');
            if(btn) btn.classList.remove('hidden');
        }
        checkPremiumExpiry();

    } catch (e) { 
        console.error("Auth Error:", e); 
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

async function login() {
    const input = document.getElementById('email').value.trim().toLowerCase(); // Clean the input
    const p = document.getElementById('password').value;
    const msg = document.getElementById('auth-msg');
    if(!input || !p) return alert("Please enter email/username and password");
    msg.innerText = "Verifying...";
  
    let emailToUse = input;

    if (!input.includes('@')) {
        try {
            const snap = await db.collection('users').where('username', '==', input).limit(1).get();
            
            if (snap.empty) {
                msg.innerText = "❌ Username not found.";
                return;
            }
            emailToUse = snap.docs[0].data().email;
            console.log("Username found. Logging in via email:", emailToUse);
            
        } catch (e) {
            msg.innerText = "Login Error: " + e.message;
            return;
        }
    }
   auth.signInWithEmailAndPassword(emailToUse, p)
        .catch(err => {
            msg.innerText = "❌ " + err.message;
        });
}

async function signup() {
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const username = document.getElementById('reg-username').value.trim().toLowerCase().replace(/\s+/g, '');
    const msg = document.getElementById('auth-msg');

    if (!email || !password || !username) return alert("Please fill in all fields.");
    if (username.length < 3) return alert("Username must be at least 3 characters.");

    msg.innerText = "Checking availability...";

    try {
        // 1. Check if Username is Taken
        const check = await db.collection('users').where('username', '==', username).get();
        if (!check.empty) throw new Error("⚠️ Username is already taken.");

        // 2. Create Auth User
        msg.innerText = "Creating account...";
        const cred = await auth.createUserWithEmailAndPassword(email, password);
        
        // 3. Create Firestore Profile
        await db.collection('users').doc(cred.user.uid).set({
            email: email,
            username: username, // Saved!
            role: 'student',
            isPremium: false,
            joined: new Date(),
            deviceId: currentDeviceId,
            solved: [], bookmarks: [], mistakes: [], stats: {}
        });

        msg.innerText = "✅ Success!";
        // Auth listener will handle redirection

    } catch (e) {
        msg.innerText = "Error: " + e.message;
    }
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

        let totalAttempts = 0;
        let totalCorrect = 0;
        
        if (userData.stats) {
            Object.values(userData.stats).forEach(s => {
                totalAttempts += (s.total || 0);
                totalCorrect += (s.correct || 0);
            });
        }
        
        const accuracy = totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : 0;

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

function generateHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash) + str.charCodeAt(i) | 0;
    return hash;
}

// ======================================================
// 6. UI RENDERERS
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
// 7. STUDY LOGIC
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
    document.getElementById('test-sidebar').classList.add('active');
    
    renderNavigator();

    clearInterval(testTimer);
    testTimer = setInterval(updateTimer, 1000);
    renderPage();
}

// ======================================================
// 8. QUIZ ENGINE
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
    
    if(currentUser && !isGuest) {
        db.collection('users').doc(currentUser.uid).collection('results').add({
            date: new Date(), 
            score: pct, 
            total: filteredQuestions.length,
            subject: examSubject
        });
    }

    showScreen('result-screen');
    document.getElementById('final-score').innerText = `${pct}% (${score}/${filteredQuestions.length})`;
}

// ======================================================
// 10. ADMIN & PREMIUM FEATURES
// ======================================================

async function redeemKey() {
    const codeInput = document.getElementById('activation-code').value.trim().toUpperCase();
    const btn = event.target;
    
    if (!codeInput) return alert("Please enter a code.");
    
    btn.innerText = "Verifying...";
    btn.disabled = true;

    try {
        // 1. Find Key
        const snapshot = await db.collection('activation_keys').where('code', '==', codeInput).get();

        if (snapshot.empty) throw new Error("Invalid Code.");

        const keyDoc = snapshot.docs[0];
        const k = keyDoc.data();
        const keyId = keyDoc.id;

        // 2. CHECK: Expiry
        if (k.expiresAt) {
            const expiryDate = k.expiresAt.toDate();
            if (new Date() > expiryDate) throw new Error("This code has expired.");
        }

        // 3. CHECK: Usage Limit
        if (k.usedCount >= k.maxUses) throw new Error("This code has been fully redeemed.");

        // 4. CHECK: Already Used by Me?
        if (k.usersRedeemed && k.usersRedeemed.includes(currentUser.uid)) {
            throw new Error("You have already used this code.");
        }

        // 5. CALCULATE PREMIUM DURATION
        // (Ensure PLAN_DURATIONS is defined at top of script.js)
        const duration = PLAN_DURATIONS[k.plan] || 2592000000; 
        
        let newExpiry;
        if (k.plan === 'lifetime') newExpiry = new Date("2100-01-01");
        else newExpiry = new Date(Date.now() + duration);

        // 6. EXECUTE TRANSACTION (Safe Update)
        const batch = db.batch();

        // A. Update User
        const userRef = db.collection('users').doc(currentUser.uid);
        batch.update(userRef, {
            isPremium: true,
            plan: k.plan,
            expiryDate: newExpiry,
            updatedAt: new Date()
        });

        // B. Update Key Stats (Increment count, Add user ID)
        const keyRef = db.collection('activation_keys').doc(keyId);
        batch.update(keyRef, {
            usedCount: firebase.firestore.FieldValue.increment(1),
            usersRedeemed: firebase.firestore.FieldValue.arrayUnion(currentUser.uid),
            lastUsedAt: new Date()
        });

        await batch.commit();

        // 7. Success
        alert(`✅ Code Redeemed!\nPlan: ${k.plan.replace('_',' ').toUpperCase()}\nExpires: ${formatDateHelper(newExpiry)}`);
        window.location.reload();

    } catch (e) {
        alert("❌ " + e.message);
        btn.innerText = "Unlock Now";
        btn.disabled = false;
    }
}

function selectPlan(planValue, element) {
    document.querySelectorAll('.price-item').forEach(item => {
        item.classList.remove('selected');
    });
    element.classList.add('selected');
    document.getElementById('selected-plan-value').value = planValue;
}

async function submitPaymentProof() {
    const selectedPlan = document.getElementById('selected-plan-value').value;
    const file = document.getElementById('pay-proof').files[0];
    if(!selectedPlan) return alert("❌ Please select a plan from the list above.");
    if(!file) return alert("❌ Please upload a screenshot of your payment.");

    let imgStr = null;
    if(file.size > 2000000) return alert("Image too large (Max 2MB)"); 
    
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
            planRequested: selectedPlan, 
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

async function loadAdminReports() {
    const list = document.getElementById('admin-reports-list');
    list.innerHTML = "Loading reports...";
    const snap = await db.collection('reports').orderBy('timestamp', 'desc').limit(20).get();
    
    if (snap.empty) {
        list.innerHTML = "<p style='padding:15px; text-align:center;'>No reports found.</p>";
        return;
    }
    
    let html = "";
    snap.forEach(doc => {
        const r = doc.data();
        html += `<div class="report-card">
            <strong>${r.questionText.substr(0, 50)}...</strong><br>
            <span style="color:red; font-size:12px;">Reason: ${r.reportReason}</span><br>
            <small>By: ${r.reportedBy}</small><br>
            <button onclick="deleteReport('${doc.id}')" style="margin-top:5px; padding:2px 8px; font-size:10px;">Resolve/Delete</button>
        </div>`;
    });
    list.innerHTML = html;
}

async function loadAllUsers() {
    const res = document.getElementById('admin-user-result');
    res.innerHTML = "Loading users...";
    
    let snap;
    try {
        snap = await db.collection('users').orderBy('joined', 'desc').limit(500).get();
    } catch (e) {
        snap = await db.collection('users').limit(500).get();
    }
    
    const usersByEmail = {};
    const noEmailAdmins = []; 

    let hiddenGuests = 0;

    snap.forEach(doc => {
        const u = doc.data();
        u.id = doc.id;
        
        if (u.role === 'guest') {
            hiddenGuests++;
            return; 
        }

        if (!u.email || u.email === "undefined") {
            if (u.role === 'admin' || u.isPremium) {
                noEmailAdmins.push(u);
            }
        } else {
            if (!usersByEmail[u.email]) usersByEmail[u.email] = [];
            usersByEmail[u.email].push(u);
        }
    });

    let html = "<div style='background:white; border-radius:12px; overflow:hidden;'>";
    let count = 0;

    Object.keys(usersByEmail).forEach(email => {
        const accounts = usersByEmail[email];
        accounts.sort((a, b) => (a.role === 'admin' ? -1 : 1));
        
        html += renderUserRow(accounts[0]);
        count++;
    });

    noEmailAdmins.forEach(u => {
        const label = `<span style="color:red; font-weight:bold;">(Email Missing)</span>`;
        html += renderUserRow(u, label);
        count++;
    });

    if(count === 0) html += "<div style='padding:15px;'>No registered users found.</div>";
    
    res.innerHTML = `
    <div style="padding:10px; color:#666; font-size:12px; border-bottom:1px solid #eee; display:flex; justify-content:space-between;">
        <span><b>${count}</b> Registered Users</span>
        <span style="color:#94a3b8;">(Hidden Guests: ${hiddenGuests})</span>
    </div>` + html + "</div>";
}

function renderUserRow(u, extraLabel = "") {
    const isAdmin = u.role === 'admin';
    const isPrem = u.isPremium;
    
    // Determine Badge Classes
    const roleBadgeClass = isAdmin ? 'badge-admin' : 'badge-student';
    const roleText = isAdmin ? 'Admin' : 'Student';
    
    const planBadgeClass = isPrem ? 'badge-premium' : 'badge-free';
    const planText = isPrem ? 'Premium' : 'Free';
    const rowClass = isAdmin ? "is-admin-row" : "";
    
    // Format Date
    let dateStr = "N/A";
    if(u.joined) {
        const d = u.joined.seconds ? new Date(u.joined.seconds * 1000) : new Date(u.joined);
        if(!isNaN(d.getTime())) dateStr = formatDateHelper(d);
    }

    // NEW: Check for username
    const usernameDisplay = u.username ? `<span style="color:#64748b; font-size:12px; margin-left:5px;">(@${u.username})</span>` : "";

    return `
    <div class="user-list-item ${rowClass}">
        <div class="user-info-group">
            <div class="user-email-text">
                ${isAdmin ? '⭐' : ''} ${u.email || "Unknown User"} 
                ${usernameDisplay} ${extraLabel}
            </div>
            
            <div class="user-meta-row">
                <span class="status-badge ${roleBadgeClass}">${roleText}</span>
                <span class="status-badge ${planBadgeClass}">${planText}</span>
                <span style="border-left:1px solid #cbd5e1; padding-left:10px;">Joined: ${dateStr}</span>
            </div>
        </div>

        <button class="btn-manage-user" onclick="adminLookupUser('${u.id}')">
            ⚙️ Manage
        </button>
    </div>`;
}

function deleteReport(id) { db.collection('reports').doc(id).delete().then(()=>loadAdminReports()); }

async function loadAdminPayments() {
    const list = document.getElementById('admin-payments-list');
    list.innerHTML = '<div style="text-align:center; padding:20px; color:#666;">Loading requests...</div>';
    
    try {
        const snap = await db.collection('payment_requests')
            .where('status','==','pending')
            .orderBy('timestamp', 'desc') // Show newest first
            .get();
        
        if(snap.empty) { 
            list.innerHTML = "<div style='padding:30px; text-align:center; color:#94a3b8; font-style:italic;'>No pending payment requests.</div>"; 
            return; 
        }

        let html = "";
        snap.forEach(doc => {
            const p = doc.data();
            const reqPlan = p.planRequested ? p.planRequested.replace('_', ' ').toUpperCase() : "UNKNOWN";
            
            // Check if image exists
            const imageHtml = p.image 
                ? `<div class="pay-proof-container" onclick="viewFullReceipt('${p.image.replace(/'/g, "\\'")}')">
                     <img src="${p.image}" class="pay-proof-img" alt="Receipt">
                     <span class="view-receipt-text">🔍 Click to View Full Receipt</span>
                   </div>`
                : `<div style="padding:15px; background:#fff1f2; color:#be123c; border-radius:8px; font-size:12px; text-align:center; margin-bottom:15px;">
                     ⚠️ No Screenshot Uploaded
                   </div>`;

            html += `
            <div class="admin-payment-card" id="card-${doc.id}">
                <div class="pay-card-header">
                    <div>
                        <span class="pay-user-email">${p.email || "Unknown User"}</span>
                        <div style="font-size:11px; color:#94a3b8;">UID: ${p.uid}</div>
                    </div>
                    <span class="pay-plan-badge">${reqPlan}</span>
                </div>
                
                ${imageHtml}
                
                <div class="pay-action-box">
                    <label class="pay-action-label">Decide & Duration</label>
                    <div class="pay-controls-row">
                        <select id="dur-${doc.id}" class="pay-select">
                            <option value="1_day" ${p.planRequested === '1_day' ? 'selected' : ''}>1 Day</option>
                            <option value="1_week" ${p.planRequested === '1_week' ? 'selected' : ''}>1 Week</option>
                            <option value="15_days" ${p.planRequested === '15_days' ? 'selected' : ''}>15 Days</option>
                            <option value="1_month" ${p.planRequested === '1_month' ? 'selected' : ''}>1 Month</option>
                            <option value="3_months" ${p.planRequested === '3_months' ? 'selected' : ''}>3 Months</option>
                            <option value="6_months" ${p.planRequested === '6_months' ? 'selected' : ''}>6 Months</option>
                            <option value="12_months" ${p.planRequested === '12_months' ? 'selected' : ''}>12 Months</option>
                            <option value="lifetime" ${p.planRequested === 'lifetime' ? 'selected' : ''}>Lifetime</option>
                        </select>
                        
                        <button class="btn-pay-action btn-approve" onclick="approvePayment('${doc.id}','${p.uid}')">
                            ✅ Approve
                        </button>
                        
                        <button class="btn-pay-action btn-reject" onclick="rejectPayment('${doc.id}')">
                            ❌ Reject
                        </button>
                    </div>
                </div>
            </div>`;
        });
        list.innerHTML = html;
        
    } catch (e) {
        console.error(e);
        list.innerHTML = `<div style="color:red; padding:20px;">Error loading payments: ${e.message}</div>`;
    }
}

// --- NEW HELPER FUNCTIONS ---

// 1. Fix for the "Click to View" bug
function viewFullReceipt(base64Image) {
    const w = window.open("");
    if(w) {
        w.document.write(`
            <html>
                <head><title>Payment Receipt</title></head>
                <body style="margin:0; background:#0f172a; display:flex; justify-content:center; align-items:center; height:100vh;">
                    <img src="${base64Image}" style="max-width:100%; max-height:100vh; box-shadow:0 0 20px rgba(0,0,0,0.5);">
                </body>
            </html>
        `);
    } else {
        alert("⚠️ Pop-up blocked! Please allow pop-ups to view the receipt.");
    }
}

// 2. Helper for Rejection
async function rejectPayment(docId) {
    if(!confirm("Are you sure you want to REJECT this request?")) return;
    
    // UI Feedback
    const card = document.getElementById(`card-${docId}`);
    if(card) card.style.opacity = "0.5";

    try {
        await db.collection('payment_requests').doc(docId).update({
            status: 'rejected',
            rejectedAt: new Date()
        });
        // Remove from list immediately
        if(card) card.remove();
        
        // If list is empty now, reload to show "No pending requests" message
        const list = document.getElementById('admin-payments-list');
        if(list.children.length === 0) loadAdminPayments();
        
    } catch (e) {
        alert("Error: " + e.message);
        if(card) card.style.opacity = "1";
    }
}

async function approvePayment(docId, userId) {
    const btn = event.target;
    btn.innerText = "Saving to DB...";
    btn.disabled = true;

    try {
        const select = document.getElementById(`dur-${docId}`);
        const planKey = select.value; 
        const duration = PLAN_DURATIONS[planKey];
        
        if (!duration) throw new Error("Invalid Plan Duration");

        let newExpiry = (planKey === 'lifetime') 
            ? new Date("2100-01-01") 
            : new Date(Date.now() + duration);

        const batch = db.batch();

        const userRef = db.collection('users').doc(userId);
        batch.update(userRef, { 
            isPremium: true, 
            plan: planKey,
            expiryDate: newExpiry, 
            updatedAt: new Date()
        });

        const payRef = db.collection('payment_requests').doc(docId);
        batch.update(payRef, { status: 'approved', approvedAt: new Date() });

        await batch.commit();

        alert(`✅ Saved to Database!\n\nUser: ${userId}\nExpires: ${formatDateHelper(newExpiry)}`);
        loadAdminPayments(); 

    } catch (e) {
        console.error(e);
        alert("Database Save Failed: " + e.message);
        btn.innerText = "Approve";
        btn.disabled = false;
    }
}

async function generateAdminKey() {
    const plan = document.getElementById('key-plan').value;
    const customCode = document.getElementById('key-custom-code').value.trim().toUpperCase();
    const limit = parseInt(document.getElementById('key-limit').value) || 1;
    const expiryInput = document.getElementById('key-expiry').value; // YYYY-MM-DD

    // 1. Determine Code Name
    let code = customCode;
    if (!code) {
        code = 'KEY-' + Math.random().toString(36).substr(2, 6).toUpperCase();
    }

    // 2. Check for Duplicate Code
    const check = await db.collection('activation_keys').where('code', '==', code).get();
    if (!check.empty) {
        return alert("❌ Error: This code already exists!");
    }

    // 3. Prepare Data
    const keyData = {
        code: code,
        plan: plan,
        maxUses: limit,
        usedCount: 0,
        usersRedeemed: [], // Track who used it to prevent double-dipping
        createdAt: new Date(),
        active: true
    };

    // Add Expiry if set
    if (expiryInput) {
        keyData.expiresAt = new Date(expiryInput + "T23:59:59"); // End of that day
    } else {
        keyData.expiresAt = null; // Never expires
    }

    // 4. Save to DB
    await db.collection('activation_keys').add(keyData);
    
    alert(`✅ Key Created: ${code}\nLimit: ${limit} Users`);
    
    // Clear inputs
    document.getElementById('key-custom-code').value = "";
    document.getElementById('key-limit').value = "1";
    document.getElementById('key-expiry').value = "";
    
    loadAdminKeys();
}

async function loadAdminKeys() {
    const list = document.getElementById('admin-keys-list');
    list.innerHTML = "Loading...";
    
    // Sort by newest created
    const snap = await db.collection('activation_keys').orderBy('createdAt', 'desc').limit(20).get();
    
    if (snap.empty) {
        list.innerHTML = "<p style='color:#666; text-align:center;'>No keys generated yet.</p>";
        return;
    }

    let html = `<table style="width:100%; border-collapse:collapse; font-size:12px; background:white;">
        <tr style="background:#f1f5f9; text-align:left;">
            <th style="padding:10px; border-bottom:2px solid #e2e8f0;">Code</th>
            <th style="padding:10px; border-bottom:2px solid #e2e8f0;">Plan</th>
            <th style="padding:10px; border-bottom:2px solid #e2e8f0;">Usage</th>
            <th style="padding:10px; border-bottom:2px solid #e2e8f0;">Expires</th>
            <th style="padding:10px; border-bottom:2px solid #e2e8f0;">Action</th>
        </tr>`;

    snap.forEach(doc => {
        const k = doc.data();
        
        // Status Check
        const isFull = k.usedCount >= k.maxUses;
        const isExpired = k.expiresAt && new Date() > k.expiresAt.toDate();
        let statusColor = "#10b981"; // Green (Active)
        
        if (isFull) statusColor = "#ef4444"; // Red (Full)
        else if (isExpired) statusColor = "#94a3b8"; // Grey (Expired)

        // Date Format
        const expiryStr = k.expiresAt ? formatDateHelper(k.expiresAt) : "Never";

        html += `
        <tr style="border-bottom:1px solid #f1f5f9;">
            <td style="padding:10px; font-weight:bold; color:#2563eb;">${k.code}</td>
            <td style="padding:10px;">${k.plan.replace('_',' ')}</td>
            <td style="padding:10px;">
                <span style="color:${statusColor}; font-weight:bold;">${k.usedCount} / ${k.maxUses}</span>
            </td>
            <td style="padding:10px;">${expiryStr}</td>
            <td style="padding:10px;">
                <button onclick="deleteKey('${doc.id}')" style="padding:2px 6px; font-size:10px; color:red; border:1px solid red; background:white; border-radius:4px; cursor:pointer;">Delete</button>
            </td>
        </tr>`;
    });
    list.innerHTML = html + "</table>";
}

// Add this helper if missing
function deleteKey(id) {
    if(!confirm("Delete this key permanently?")) return;
    db.collection('activation_keys').doc(id).delete().then(() => loadAdminKeys());
}

async function adminLookupUser(targetId) {
    const input = targetId || document.getElementById('admin-user-input').value.trim();
    const res = document.getElementById('admin-user-result');
    res.innerHTML = "Searching...";
    
    let doc = null;

    // 1. Try fetching by UID directly
    let directDoc = await db.collection('users').doc(input).get();
    if(directDoc.exists) {
        doc = directDoc;
    } 
    else {
        // 2. Try fetching by Email
        let s = await db.collection('users').where('email','==',input).limit(1).get();
        if(!s.empty) {
            doc = s.docs[0];
        } 
        else {
            // 3. Try fetching by Username (NEW)
            let u = await db.collection('users').where('username','==',input.toLowerCase()).limit(1).get();
            if(!u.empty) {
                doc = u.docs[0];
            }
        }
    }

    if(!doc) { res.innerHTML = "Not found (Check Email, Username or UID)"; return; }
    
    // ... (Keep the rest of your render code for the user card) ...
    // Pass the data to the render function
    res.innerHTML = renderAdminUserCard(doc); // *See helper below
}

// *Helper: I separated the card HTML to make it cleaner. 
// You can replace the bottom half of your existing adminLookupUser with this:
function renderAdminUserCard(doc) {
    const u = doc.data();
    return `
    <div class="user-card">
        <h3>${u.email}</h3>
        <p style="color:#0072ff; font-weight:bold;">@${u.username || "no-username"}</p>
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
async function adminGrantPremium(uid) {
    const select = document.getElementById(`admin-grant-plan-${uid}`);
    const planKey = select.value;
    const duration = PLAN_DURATIONS[planKey];

    if (!duration) return alert("Invalid plan selected");
    if(!confirm(`Grant '${planKey}' to this user?`)) return;

    try {
        let newExpiry = (planKey === 'lifetime') 
            ? new Date("2100-01-01") 
            : new Date(Date.now() + duration);

        await db.collection('users').doc(uid).update({
            isPremium: true,
            plan: planKey,
            expiryDate: newExpiry, 
            updatedAt: new Date()
        });

        alert("✅ Premium Saved to Database!");
        adminLookupUser(uid); 

    } catch (e) {
        alert("Error: " + e.message);
    }
}

async function adminRevokePremium(uid) {
    await db.collection('users').doc(uid).update({ isPremium: false });
    alert("🚫 Revoked Premium");
    adminLookupUser(uid); 
}

async function adminToggleBan(uid, newStatus) {
    await db.collection('users').doc(uid).update({ disabled: newStatus });
    alert("Status Updated");
    adminLookupUser(uid); 
}

// ======================================================
// 11. HELPERS & UTILITIES
// ======================================================

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
    let data = userProfile || {};
    try {
        const doc = await db.collection('users').doc(currentUser.uid).get();
        if (doc.exists) data = doc.data();
    } catch (e) { console.error(e); }

    // 2. Fill Basic Fields
    document.getElementById('profile-email').innerText = currentUser.email;
    document.getElementById('edit-username').value = data.username || ""; // Allow adding if missing
    document.getElementById('edit-name').value = data.displayName || "";
    document.getElementById('edit-phone').value = data.phone || "";
    document.getElementById('edit-college').value = data.college || "";
    document.getElementById('edit-exam').value = data.targetExam || "FCPS-1";

    // 3. ROBUST DATE PARSING (The Fix)
    const joinDate = parseDateRobust(data.joined) || new Date(currentUser.metadata.creationTime);
    document.getElementById('profile-joined').innerText = formatDateHelper(joinDate);

    // 4. PLAN & EXPIRY LOGIC
    const planElem = document.getElementById('profile-plan');
    const expiryElem = document.getElementById('profile-expiry');

    if (data.isPremium) {
        planElem.innerText = "PREMIUM 👑";
        
        // Handle Lifetime vs Date
        if (data.plan === 'lifetime') {
             expiryElem.innerText = "Lifetime Access";
             expiryElem.style.color = "#10b981";
        } else {
             const expDate = parseDateRobust(data.expiryDate);
             if (expDate) {
                 expiryElem.innerText = formatDateHelper(expDate);
                 // Check if actually expired
                 if (new Date() > expDate) {
                     expiryElem.innerText += " (Expired)";
                     expiryElem.style.color = "red";
                     planElem.innerText = "Expired";
                 } else {
                     expiryElem.style.color = "#d97706";
                 }
             } else {
                 expiryElem.innerText = "Active";
             }
        }
    } else {
        planElem.innerText = "Free Plan";
        expiryElem.innerText = "-";
        expiryElem.style.color = "#64748b";
    }
}

// --- Add this Helper Function to the bottom of script.js ---
function parseDateRobust(input) {
    if (!input) return null;
    // Handle Firestore Timestamp (has .seconds)
    if (input.seconds) return new Date(input.seconds * 1000);
    // Handle String or Number
    const d = new Date(input);
    return isNaN(d.getTime()) ? null : d;
}

async function saveDetailedProfile() {
    const btn = event.target; // Get the Save button
    const originalText = btn.innerText;
    btn.innerText = "Saving...";
    btn.disabled = true;

    const name = document.getElementById('edit-name').value;
    const username = document.getElementById('edit-username').value.trim().toLowerCase().replace(/\s+/g, ''); // Remove spaces
    const phone = document.getElementById('edit-phone').value;
    const college = document.getElementById('edit-college').value;
    const exam = document.getElementById('edit-exam').value;

    try {
        // 1. UNIQUE USERNAME CHECK
        if (username) {
            // Check if anyone ELSE has this username
            const check = await db.collection('users')
                .where('username', '==', username)
                .get();

            let isTaken = false;
            check.forEach(doc => {
                if (doc.id !== currentUser.uid) isTaken = true; // Found someone else with it
            });

            if (isTaken) {
                throw new Error("⚠️ Username is already taken! Please choose another.");
            }
        }

        // 2. Standard Updates
        if (currentUser.displayName !== name) {
            await currentUser.updateProfile({ displayName: name });
        }

        await db.collection('users').doc(currentUser.uid).update({
            displayName: name,
            username: username, // Save username
            phone: phone,
            college: college,
            targetExam: exam
        });

        // Update local profile
        userProfile.displayName = name;
        userProfile.username = username;
        
        document.getElementById('user-display').innerText = name || username || "User"; 
        alert("✅ Profile Updated Successfully!");
        document.getElementById('profile-modal').classList.add('hidden');

    } catch (e) {
        alert(e.message);
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
}
function parseDateHelper(dateInput) {
    if (!dateInput) return new Date();
    if (dateInput.toDate) return dateInput.toDate(); 
    if (typeof dateInput.toMillis === 'function') return new Date(dateInput.toMillis());
    if (dateInput.seconds) return new Date(dateInput.seconds * 1000);
    return new Date(dateInput);
}

function formatDateHelper(dateInput) {
    const d = parseDateHelper(dateInput);
    if (isNaN(d.getTime())) return "N/A";

    // CUSTOM FORMAT: DD/MMM/YYYY
    const day = String(d.getDate()).padStart(2, '0'); // Ensures '05' instead of '5'
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const month = months[d.getMonth()];
    const year = d.getFullYear();

    return `${day}/${month}/${year}`;
}

function openBadges() {
    // 1. Target the NEW Modal ID (from the HTML I gave you)
    const modal = document.getElementById('achievement-modal'); 
    
    // 2. Target the Grid Container inside that modal
    const container = modal.querySelector('.ach-grid'); 

    if (!modal || !container) {
        console.error("Error: Could not find 'achievement-modal' or '.ach-grid'. Did you paste the new HTML?");
        return;
    }

    // 3. Show the modal
    modal.classList.remove('hidden');
    
    // 4. Your Badge Data
    const badges = [
        { limit: 10, icon: "👶", name: "Novice", desc: "Solve 10 Questions" },
        { limit: 100, icon: "🥉", name: "Bronze", desc: "Solve 100 Questions" },
        { limit: 500, icon: "🥈", name: "Silver", desc: "Solve 500 Questions" },
        { limit: 1000, icon: "🥇", name: "Gold", desc: "Solve 1000 Questions" },
        { limit: 2000, icon: "💎", name: "Diamond", desc: "Solve 2000 Questions" },
        { limit: 5000, icon: "👑", name: "Master", desc: "Solve 5000 Questions" }
    ];

    // 5. Generate the NEW HTML Structure
    let html = "";
    
    badges.forEach(b => {
        // Check if unlocked (Safely handle if userSolvedIDs is missing)
        const solvedCount = (typeof userSolvedIDs !== 'undefined') ? userSolvedIDs.length : 0;
        const isUnlocked = solvedCount >= b.limit;

        // Determine Styles (Locked vs Unlocked)
        const statusClass = isUnlocked ? 'unlocked' : 'locked';
        
        // Determine Icon (Checkmark vs Lock)
        const statusIcon = isUnlocked 
            ? `<div class="ach-check">✓</div>` 
            : `<div class="ach-lock">🔒</div>`;

        // Build the Card HTML
        html += `
        <div class="ach-item ${statusClass}">
            <div class="ach-icon-box">${b.icon}</div>
            <div class="ach-info">
                <h3>${b.name}</h3>
                <span>${b.desc}</span>
            </div>
            ${statusIcon}
        </div>`;
    });

    // 6. Inject into the grid
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
                const dateStr = d.date ? formatDateHelper(new Date(d.date.seconds*1000)) : '-';
                const subj = d.subject || "Mixed"; 
                const scoreColor = d.score >= 70 ? "#166534" : "#b91c1c"; 
                
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

let isSignupMode = false;

function toggleAuthMode() {
    isSignupMode = !isSignupMode;
    const title = document.getElementById('auth-title');
    const btn = document.getElementById('main-auth-btn');
    const toggleLink = document.getElementById('auth-toggle-link');
    const toggleMsg = document.getElementById('auth-toggle-msg');
    const userField = document.getElementById('signup-username-group');
    const emailField = document.getElementById('email');

    if (isSignupMode) {
        title.innerText = "Create Account";
        btn.innerText = "Sign Up";
        toggleMsg.innerText = "Already have an account?";
        toggleLink.innerText = "Log In here";
        userField.classList.remove('hidden'); // Show Username
        emailField.placeholder = "Email Address"; // Must be email for signup
    } else {
        title.innerText = "Log In";
        btn.innerText = "Log In";
        toggleMsg.innerText = "New here?";
        toggleLink.innerText = "Create New ID";
        userField.classList.add('hidden'); // Hide Username
        emailField.placeholder = "Email or Username";
    }
}

// Router for the "Enter" key
function handleAuthAction() {
    if (isSignupMode) signup();
    else login();
}

function goHome() { 
    clearInterval(testTimer); 
    showScreen('dashboard-screen'); 
    loadUserData(); 
}

function resetPassword() {
    const email = document.getElementById('email').value;
    if (!email) return alert("Please enter your email address in the box above first.");
    
    auth.sendPasswordResetEmail(email)
        .then(() => alert("📧 Password reset email sent! Check your inbox."))
        .catch(e => alert("Error: " + e.message));
}

window.onload = () => {
    if(localStorage.getItem('fcps-theme')==='dark') toggleTheme();
}






