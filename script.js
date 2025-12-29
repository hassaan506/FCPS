// ======================================================
// 1. CONFIGURATION & FIREBASE SETUP
// ======================================================

// --- NEW: MULTI-COURSE CONFIGURATION ---
const COURSE_CONFIG = {
    'FCPS': {
        name: "FCPS Part 1",
        sheet: "https://docs.google.com/spreadsheets/d/e/2PACX-1vR8aw1eGppF_fgvI5VAOO_3XEONyI-4QgWa0IgQg7K-VdxeFyn4XBpWT9tVDewbQ6PnMEQ80XpwbASh/pub?output=csv",
        prefix: "",       // Legacy Mode (No prefix = Keeps existing user progress safe)
        theme: ""         // Default Blue Theme
    },
    'MBBS': {
        name: "MBBS Final Year",
        sheet: "https://docs.google.com/spreadsheets/d/e/2PACX-1vS6fLWMz_k89yK_S8kfjqAGs9I_fGzBE-WQ-Ci8l-D5ownRGV0I1Tz-ifZZKBOTXZAx9bvs4wVuWLID/pub?output=csv",
        prefix: "MBBS_",  // Prefix ensures data separation (e.g. MBBS_solved)
        theme: "mbbs-mode" // Activates Green Theme
    }
};

const firebaseConfig = {
  apiKey: "AIzaSyAhrX36_mEA4a3VIuSq3rYYZi0PH5Ap_ks",
  authDomain: "fcps-prep.firebaseapp.com",
  projectId: "fcps-prep",
  storageBucket: "fcps-prep.firebasestorage.app",
  messagingSenderId: "949920276784",
  appId: "1:949920276784:web:c9af3432814c0f80e028f5"
};

// Initialize Firebase (Safety Check)
if (typeof firebase !== 'undefined' && !firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
} else if (typeof firebase === 'undefined') {
    alert("CRITICAL ERROR: Firebase SDK not loaded in HTML. Check your internet connection or index.html imports.");
}

const auth = firebase.auth();
const db = firebase.firestore();

// ======================================================
// 2. STATE VARIABLES & GLOBALS
// ======================================================

let currentUser = null;
let userProfile = null; 
let isGuest = false;

// --- NEW: Track Current Course ---
let currentCourse = 'FCPS'; // Default

let allQuestions = [];
let filteredQuestions = [];

// Progress Arrays (Loaded dynamically based on selected Course)
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

// --- GLOBAL PREMIUM PLANS CONFIGURATION ---
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
// 3. AUTHENTICATION & ROUTING (FIXED)
// ======================================================

auth.onAuthStateChanged(async (user) => {
    if (user) {
        console.log("✅ User detected:", user.email);
        currentUser = user;
        isGuest = false;
        
        // Hide Auth, Show Course Selection immediately to prevent "stuck" feeling
        showScreen('course-selection-screen'); 
        
        // Hide Auth UI explicitly
        const authScreen = document.getElementById('auth-screen');
        if(authScreen) {
            authScreen.classList.add('hidden');
            authScreen.classList.remove('active');
        }
        
        await checkLoginSecurity(user);
        
        // Safety Check: If HTML is missing the new screen, fallback
        if(document.getElementById('course-selection-screen')) {
            updateCourseSelectionUI();
        } else {
            console.warn("Course Selection Screen missing. Loading default.");
            selectCourse('FCPS');
        }
        
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
            // New User Creation
            await docRef.set({
                email: user.email,
                deviceId: currentDeviceId,
                role: 'student',
                joined: new Date(),
                // Init Legacy Data
                isPremium: false, solved: [], bookmarks: [], mistakes: [], stats: {}
            }, { merge: true });
            
            userProfile = (await docRef.get()).data();
        } else {
            userProfile = doc.data();
            
            if (!userProfile.email || userProfile.email !== user.email) {
                docRef.update({ email: user.email });
            }
            if (userProfile.disabled) {
                auth.signOut();
                alert("⛔ Your account has been disabled by the admin.");
                return;
            }
            if (!userProfile.deviceId) await docRef.update({ deviceId: currentDeviceId });
        }
        
        // Admin button visibility
        if (userProfile && userProfile.role === 'admin') {
            const btn = document.getElementById('admin-btn');
            if(btn) btn.classList.remove('hidden');
        }

    } catch (e) { 
        console.error("Auth Error:", e); 
        alert("Login Error: " + e.message); // Surface error to user
    }
}

// --- NEW: COURSE SELECTION LOGIC ---

function updateCourseSelectionUI() {
    if(!userProfile) return;
    
    // Check FCPS Status
    const fcpsActive = userProfile.isPremium && isDateActive(userProfile.expiryDate);
    const fcpsBadge = document.getElementById('status-badge-FCPS');
    if(fcpsBadge) {
        fcpsBadge.innerText = fcpsActive ? "✅ Active" : "🔒 Free Version";
        fcpsBadge.style.background = fcpsActive ? "#d1fae5" : "#e2e8f0";
        fcpsBadge.style.color = fcpsActive ? "#065f46" : "#475569";
    }

    // Check MBBS Status
    const mbbsActive = userProfile.MBBS_isPremium && isDateActive(userProfile.MBBS_expiryDate);
    const mbbsBadge = document.getElementById('status-badge-MBBS');
    if(mbbsBadge) {
        mbbsBadge.innerText = mbbsActive ? "✅ Active" : "🔒 Free Version";
        mbbsBadge.style.background = mbbsActive ? "#d1fae5" : "#e2e8f0";
        mbbsBadge.style.color = mbbsActive ? "#065f46" : "#475569";
    }
}

function selectCourse(courseName) {
    if (!COURSE_CONFIG[courseName]) return alert("Course coming soon!");
    
    currentCourse = courseName;
    const config = COURSE_CONFIG[courseName];

    // 1. Apply Visual Theme
    document.body.className = config.theme; 
    
    // 2. Update Header
    const badge = document.getElementById('active-course-badge');
    if(badge) badge.innerText = courseName;
    
    const title = document.getElementById('stats-title');
    if(title) title.innerText = `📊 ${courseName} Progress`;

    // 3. Load Data & Dashboard
    showScreen('dashboard-screen');
    
    // Reset Data
    allQuestions = [];
    filteredQuestions = [];
    
    loadQuestions(config.sheet); // Dynamic URL
    loadUserData(); // Dynamic Prefix Loading
}

function returnToCourseSelection() {
    showScreen('course-selection-screen');
    updateCourseSelectionUI();
    allQuestions = [];
    filteredQuestions = [];
}

// --- HELPER: GET ISOLATED DB KEY ---
function getStoreKey(baseKey) {
    // If MBBS, returns "MBBS_solved". If FCPS, returns "solved".
    const prefix = COURSE_CONFIG[currentCourse].prefix;
    return prefix + baseKey;
}

function guestLogin() {
    isGuest = true;
    userProfile = { role: 'guest' };
    
    // Force UI Update
    if(document.getElementById('course-selection-screen')) {
        showScreen('course-selection-screen');
    } else {
        selectCourse('FCPS');
    }
    
    document.getElementById('user-display').innerText = "Guest User";
    document.getElementById('premium-badge').classList.add('hidden');
    document.getElementById('get-premium-btn').classList.remove('hidden');
    alert("👤 Guest Mode Active\n\n⚠️ Progress is NOT saved.\n🔒 Limit: 20 Questions per topic.");
}

async function login() {
    const input = document.getElementById('email').value.trim().toLowerCase();
    const p = document.getElementById('password').value;
    const msg = document.getElementById('auth-msg');
    
    if(!input || !p) return alert("Please enter credentials");
    msg.innerText = "Verifying...";
   
    let emailToUse = input;

    // Username Lookup Logic
    if (!input.includes('@')) {
        try {
            const snap = await db.collection('users').where('username', '==', input).limit(1).get();
            if (snap.empty) {
                msg.innerText = "❌ Username not found.";
                return;
            }
            emailToUse = snap.docs[0].data().email;
        } catch (e) {
            console.error("Username lookup failed:", e);
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

    if (!email || !password || !username) return alert("Please fill fields.");
    if (username.length < 3) return alert("Username must be at least 3 characters.");

    msg.innerText = "Checking availability...";

    try {
        // 1. Check Username
        const check = await db.collection('users').where('username', '==', username).get();
        if (!check.empty) throw new Error("⚠️ Username taken.");

        msg.innerText = "Creating account...";
        
        // 2. Create Auth
        const cred = await auth.createUserWithEmailAndPassword(email, password);
        
        // 3. Create DB Profile
        await db.collection('users').doc(cred.user.uid).set({
            email: email,
            username: username,
            role: 'student',
            joined: new Date(),
            deviceId: currentDeviceId,
            solved: [], bookmarks: [], mistakes: [], isPremium: false
        });

        msg.innerText = "✅ Success!";
        // onAuthStateChanged will handle the rest

    } catch (e) {
        msg.innerText = "Error: " + e.message;
    }
}

function logout() {
    auth.signOut().then(() => {
        window.location.reload();
    });
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
        userField.classList.remove('hidden'); 
        emailField.placeholder = "Email Address"; 
    } else {
        title.innerText = "Log In";
        btn.innerText = "Log In";
        toggleMsg.innerText = "New here?";
        toggleLink.innerText = "Create New ID";
        userField.classList.add('hidden'); 
        emailField.placeholder = "Email or Username";
    }
}

function handleAuthAction() {
    if (isSignupMode) signup();
    else login();
}

// ======================================================
// 4. USER DATA MANAGEMENT (MODIFIED FOR ISOLATION)
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
        if(!userDoc.exists) return;
        userProfile = userDoc.data();

        // --- DYNAMIC LOADING: Use Keys for Current Course ---
        userSolvedIDs = userProfile[getStoreKey('solved')] || [];
        userBookmarks = userProfile[getStoreKey('bookmarks')] || [];
        userMistakes = userProfile[getStoreKey('mistakes')] || []; 

        checkStreak(userProfile);

        // Stats Calculation
        let totalAttempts = 0;
        let totalCorrect = 0;
        const statsObj = userProfile[getStoreKey('stats')] || {};
        
        Object.values(statsObj).forEach(s => {
            totalAttempts += (s.total || 0);
            totalCorrect += (s.correct || 0);
        });
        
        const accuracy = totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : 0;

        if(statsBox) {
            statsBox.style.opacity = "1"; 
            statsBox.innerHTML = `
                <div style="margin-top:5px; font-size:14px; line-height:1.8;">
                    <div>✅ ${currentCourse} Solved: <b style="color:var(--primary);">${userSolvedIDs.length}</b></div>
                    <div>🎯 Accuracy: <b>${accuracy}%</b> <span style="font-size:11px; color:#666;">(${totalCorrect}/${totalAttempts})</span></div>
                    <div style="color:var(--danger);">❌ Pending Mistakes: <b>${userMistakes.length}</b></div>
                    <div style="color:#f59e0b;">⭐ Bookmarked: <b>${userBookmarks.length}</b></div>
                </div>`;
        }

        updateBadgeButton(); 
        checkPremiumExpiry(); // Check Expiry for THIS course

        // Re-process questions to update 'solved' ticks in menus
        if (allQuestions.length > 0) processData(allQuestions, true);

    } catch (e) { console.error("Load Error:", e); }
}

function checkPremiumExpiry() {
    if (!userProfile) return;
    
    const premKey = getStoreKey('isPremium');
    const expKey = getStoreKey('expiryDate');
    
    const isPrem = userProfile[premKey];
    const expiryRaw = userProfile[expKey];

    if (!isPrem || !expiryRaw) {
        setPremiumUI(false);
        return;
    }
    
    if (isDateActive(expiryRaw)) {
        setPremiumUI(true);
    } else {
        // Expired logic
        db.collection('users').doc(currentUser.uid).update({ [premKey]: false });
        userProfile[premKey] = false;
        setPremiumUI(false);
        alert(`⚠️ Your ${currentCourse} Premium has expired.`);
    }
}

function setPremiumUI(isActive) {
    const badge = document.getElementById('premium-badge');
    const btn = document.getElementById('get-premium-btn');
    if(badge && btn) {
        if(isActive) {
            badge.classList.remove('hidden');
            btn.classList.add('hidden');
        } else {
            badge.classList.add('hidden');
            btn.classList.remove('hidden');
        }
    }
}

function isDateActive(dateInput) {
    if(!dateInput) return false;
    const now = new Date().getTime();
    const d = parseDateRobust(dateInput);
    if(!d) return false;
    return now < d.getTime();
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
        const display = document.getElementById('streak-display');
        if(display) {
            display.classList.remove('hidden');
            document.getElementById('streak-count').innerText = currentStreak + " Day Streak";
        }
    }
}

// ======================================================
// 5. DATA LOADING & PROCESSING
// ======================================================

function loadQuestions(sheetURLOverride) {
    const url = sheetURLOverride || GOOGLE_SHEET_URL; // Fallback
    
    // Clear menus while loading
    const menu = document.getElementById('dynamic-menus');
    if(menu) menu.innerHTML = "<p style='padding:20px; text-align:center;'>Loading Data...</p>";

    Papa.parse(url, {
        download: true, header: true, skipEmptyLines: true,
        complete: function(results) { processData(results.data); },
        error: function(e) { alert("Data Load Error: " + e.message); }
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
    if(!container) return;
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
    
    // --- UPDATED: Check Premium for Current Course ---
    const premKey = getStoreKey('isPremium');
    const expKey = getStoreKey('expiryDate');
    const isPrem = userProfile && userProfile[premKey] && isDateActive(userProfile[expKey]);

    if (!isPrem && !isGuest && userProfile.role !== 'admin') {
        if (pool.length > 20) {
            pool = pool.slice(0, 20);
            if(currentIndex === 0) alert(`🔒 ${currentCourse} Free Mode: Limited to 20 questions per section.\nGo Premium to unlock full bank.`);
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
    const premKey = getStoreKey('isPremium');
    const expKey = getStoreKey('expiryDate');
    const isPrem = userProfile && userProfile[premKey] && isDateActive(userProfile[expKey]);

    let count = parseInt(document.getElementById('q-count').value);
    const mins = parseInt(document.getElementById('t-limit').value);

    if (!isGuest && !isPrem && !isAdmin) {
        if (count > 20) {
            alert(`🔒 FREE PLAN LIMIT:\n${currentCourse} exams are limited to 20 questions.`);
            count = 20;
        }
        if(!confirm(`⚠️ ${currentCourse} Free Version: Exam mode is limited.\nUpgrade for unlimited tests?`)) return;
    }

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
        if(flagBtn) flagBtn.classList.add('hidden'); 
        submitBtn.classList.add('hidden');
        
        if (currentIndex < filteredQuestions.length - 1) nextBtn.classList.remove('hidden');
        else nextBtn.classList.add('hidden');
        
        container.appendChild(createQuestionCard(filteredQuestions[currentIndex], currentIndex, true));
        renderPracticeNavigator(); 

    } else {
        document.getElementById('timer').classList.remove('hidden');
        if(flagBtn) flagBtn.classList.remove('hidden'); 
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

    // Visual Flag Indicator
    if (testFlags[q._uid]) {
        block.classList.add('is-flagged-card');
    }

    // 1. HEADER (Number + Bookmark + Flag)
    const header = document.createElement('div');
    header.className = "question-card-header";
    
    const isBookmarked = userBookmarks.includes(q._uid);
    const isFlagged = testFlags[q._uid] || false;

    header.innerHTML = `
        <span class="q-number-tag">Question ${index + 1}</span>
        <div class="q-actions">
            <button class="action-icon-btn ${isBookmarked ? 'bookmark-active' : ''}" onclick="toggleBookmark('${q._uid}', this)" title="Save Question">
                ${isBookmarked ? '⭐' : '☆'}
            </button>
            <button class="action-icon-btn ${isFlagged ? 'flag-active' : ''}" onclick="toggleFlag('${q._uid}', this, ${index})" title="Flag Question">
                ${isFlagged ? '🚩' : '🏳️'}
            </button>
        </div>
    `;
    block.appendChild(header);

    // 2. Question Text
    const qText = document.createElement('div');
    qText.className = "test-q-text";
    qText.innerHTML = q.Question || "Missing Text";
    block.appendChild(qText);

    // 3. Options
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

function reportCurrentQuestion() {
    if (!filteredQuestions || filteredQuestions.length === 0) return;
    const currentQ = filteredQuestions[currentIndex];
    if (currentQ) {
        openReportModal(currentQ._uid);
    }
}

function toggleFlag(uid, btn, index) {
    const card = document.getElementById(`q-card-${index}`);
    
    if (testFlags[uid]) {
        delete testFlags[uid];
        if(btn) { 
            btn.innerHTML = "🏳️"; 
            btn.classList.remove('flag-active'); 
        }
        if(card) card.classList.remove('is-flagged-card');
    } else {
        testFlags[uid] = true;
        if(btn) { 
            btn.innerHTML = "🚩"; 
            btn.classList.add('flag-active'); 
        }
        if(card) card.classList.add('is-flagged-card');
    }
    renderNavigator();
}

// ======================================================
// 9. DATABASE SAVING & SUBMISSION (UPDATED PREFIX)
// ======================================================

async function saveProgressToDB(q, isCorrect) {
    if (!currentUser || isGuest) return;

    // --- PREFIX LOGIC: FCPS vs MBBS ---
    const sKey = getStoreKey('solved');
    const mKey = getStoreKey('mistakes');
    const statKey = getStoreKey('stats');
    
    const subjectKey = q.Subject.replace(/\W/g,'_');

    if (isCorrect) {
        if (!userSolvedIDs.includes(q._uid)) {
            userSolvedIDs.push(q._uid);
            db.collection('users').doc(currentUser.uid).update({
                [sKey]: firebase.firestore.FieldValue.arrayUnion(q._uid),
                [`${statKey}.${subjectKey}.correct`]: firebase.firestore.FieldValue.increment(1),
                [`${statKey}.${subjectKey}.total`]: firebase.firestore.FieldValue.increment(1)
            });
        }
        if (isMistakeReview) {
            userMistakes = userMistakes.filter(id => id !== q._uid);
            db.collection('users').doc(currentUser.uid).update({
                [mKey]: firebase.firestore.FieldValue.arrayRemove(q._uid)
            });
        }
    } else {
        if (!userMistakes.includes(q._uid) && !userSolvedIDs.includes(q._uid)) {
            userMistakes.push(q._uid);
            db.collection('users').doc(currentUser.uid).update({
                [mKey]: firebase.firestore.FieldValue.arrayUnion(q._uid),
                [`${statKey}.${subjectKey}.total`]: firebase.firestore.FieldValue.increment(1)
            });
        }
    }
    updateBadgeButton();
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
                const sKey = getStoreKey('solved');
                db.collection('users').doc(currentUser.uid).update({ [sKey]: firebase.firestore.FieldValue.arrayUnion(q._uid) });
            }
        }
    });

    const pct = Math.round((score/filteredQuestions.length)*100);
    
    if(currentUser && !isGuest) {
        db.collection('users').doc(currentUser.uid).collection('results').add({
            date: new Date(), 
            score: pct, 
            total: filteredQuestions.length, 
            subject: `${examSubject} (${currentCourse})` // Tag results
        });
    }

    showScreen('result-screen');
    document.getElementById('final-score').innerText = `${pct}% (${score}/${filteredQuestions.length})`;
}

// ======================================================
// 10. ADMIN & PREMIUM FEATURES (UPDATED)
// ======================================================

// --- NEW FUNCTION: BOOKMARK TOGGLE ---
async function toggleBookmark(uid, btn) {
    if (!currentUser || isGuest) return alert("Please log in to save bookmarks.");
    
    const key = getStoreKey('bookmarks'); 

    if (userBookmarks.includes(uid)) {
        userBookmarks = userBookmarks.filter(id => id !== uid);
        btn.innerHTML = "☆";
        btn.classList.remove('bookmark-active');
        
        await db.collection('users').doc(currentUser.uid).update({
            [key]: firebase.firestore.FieldValue.arrayRemove(uid)
        });
    } else {
        userBookmarks.push(uid);
        btn.innerHTML = "⭐";
        btn.classList.add('bookmark-active');
        
        await db.collection('users').doc(currentUser.uid).update({
            [key]: firebase.firestore.FieldValue.arrayUnion(uid)
        });
    }
}

async function redeemKey() {
    const codeInput = document.getElementById('activation-code').value.trim().toUpperCase();
    const btn = event.target;
    
    if (!codeInput) return alert("Please enter a code.");
    
    btn.innerText = "Verifying...";
    btn.disabled = true;

    try {
        const snapshot = await db.collection('activation_keys').where('code', '==', codeInput).get();

        if (snapshot.empty) throw new Error("Invalid Code.");

        const keyDoc = snapshot.docs[0];
        const k = keyDoc.data();
        const keyId = keyDoc.id;

        if (k.expiresAt && new Date() > k.expiresAt.toDate()) throw new Error("This code has expired.");
        if (k.usedCount >= k.maxUses) throw new Error("This code has been fully redeemed.");
        if (k.usersRedeemed && k.usersRedeemed.includes(currentUser.uid)) {
            throw new Error("You have already used this code.");
        }

        // --- UPDATED: Course Check ---
        const target = k.targetCourse || currentCourse; // Backward compatible
        if (target !== currentCourse) {
            throw new Error(`This key is for ${target}. Please switch courses to redeem.`);
        }

        const duration = PLAN_DURATIONS[k.plan] || 2592000000; 
        
        let newExpiry;
        if (k.plan === 'lifetime') newExpiry = new Date("2100-01-01");
        else newExpiry = new Date(Date.now() + duration);

        const batch = db.batch();
        const userRef = db.collection('users').doc(currentUser.uid);
        
        // Use proper prefix based on the key's target course
        const prefix = COURSE_CONFIG[target].prefix;

        batch.update(userRef, {
            [`${prefix}isPremium`]: true,
            [`${prefix}plan`]: k.plan,
            [`${prefix}expiryDate`]: newExpiry,
            updatedAt: new Date()
        });

        const keyRef = db.collection('activation_keys').doc(keyId);
        batch.update(keyRef, {
            usedCount: firebase.firestore.FieldValue.increment(1),
            usersRedeemed: firebase.firestore.FieldValue.arrayUnion(currentUser.uid),
            lastUsedAt: new Date()
        });

        await batch.commit();

        alert(`✅ ${target} Unlocked!\nPlan: ${k.plan.replace('_',' ').toUpperCase()}\nExpires: ${formatDateHelper(newExpiry)}`);
        
        loadUserData(); // Refresh UI
        document.getElementById('premium-modal').classList.add('hidden');

    } catch (e) {
        alert("❌ " + e.message);
    } finally {
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

// Image Compression Helper
function compressImage(file, maxWidth = 800, quality = 0.6) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = event => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                if (width > maxWidth) {
                    height *= maxWidth / width;
                    width = maxWidth;
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = error => reject(error);
        };
        reader.onerror = error => reject(error);
    });
}

async function submitPaymentProof() {
    const selectedPlan = document.getElementById('selected-plan-value').value;
    const file = document.getElementById('pay-proof').files[0];
    if(!selectedPlan) return alert("❌ Please select a plan.");
    if(!file) return alert("❌ Please upload a screenshot.");

    const btn = event.target;
    btn.innerText = "Compressing & Uploading...";
    btn.disabled = true;

    try {
        const compressedBase64 = await compressImage(file);
        const autoTID = "MANUAL_" + Math.random().toString(36).substr(2, 6).toUpperCase();

        await db.collection('payment_requests').add({
            uid: currentUser.uid, 
            email: currentUser.email, 
            tid: autoTID, 
            planRequested: selectedPlan, 
            targetCourse: currentCourse, // IMPORTANT: Save which course they want
            image: compressedBase64, 
            status: 'pending', 
            timestamp: new Date()
        });

        alert("✅ Request Sent! Please wait for admin approval.");
        document.getElementById('premium-modal').classList.add('hidden');

    } catch (e) {
        alert("Error: " + e.message);
    } finally {
        btn.innerText = "✅ Submit Request";
        btn.disabled = false;
    }
}

// --- ADMIN PANEL (UPDATED) ---

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

function deleteReport(id) { db.collection('reports').doc(id).delete().then(()=>loadAdminReports()); }

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
        if (u.role === 'guest') { hiddenGuests++; return; }
        if (!u.email) {
            if (u.role === 'admin' || u.isPremium) noEmailAdmins.push(u);
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
        html += renderUserRow(u, `<span style="color:red;">(No Email)</span>`);
        count++;
    });

    res.innerHTML = `
    <div style="padding:10px; color:#666; font-size:12px; border-bottom:1px solid #eee; display:flex; justify-content:space-between;">
        <span><b>${count}</b> Users</span>
        <span style="color:#94a3b8;">(Guests: ${hiddenGuests})</span>
    </div>` + html + "</div>";
}

function renderUserRow(u, extraLabel = "") {
    const isAdmin = u.role === 'admin';
    const isPrem = u.isPremium; // Legacy check for quick view
    return `
    <div class="user-list-item ${isAdmin ? "is-admin-row" : ""}">
        <div class="user-info-group">
            <div class="user-email-text">
                ${isAdmin ? '⭐' : ''} ${u.email || "Unknown User"} 
                ${u.username ? `(@${u.username})` : ""} ${extraLabel}
            </div>
            <div class="user-meta-row">
                <span class="status-badge ${isPrem ? 'badge-premium' : 'badge-free'}">${isPrem ? 'Prem (FCPS)' : 'Free'}</span>
                <span style="border-left:1px solid #cbd5e1; padding-left:10px;">Joined: ${formatDateHelper(u.joined)}</span>
            </div>
        </div>
        <button class="btn-manage-user" onclick="adminLookupUser('${u.id}')">⚙️ Manage</button>
    </div>`;
}

async function loadAdminPayments() {
    const list = document.getElementById('admin-payments-list');
    list.innerHTML = '<div style="text-align:center; padding:20px; color:#666;">Loading requests...</div>';
    
    try {
        const snap = await db.collection('payment_requests').where('status','==','pending').orderBy('timestamp', 'desc').get();
        if(snap.empty) { list.innerHTML = "<div style='padding:30px; text-align:center; color:#94a3b8;'>No pending payments.</div>"; return; }

        let html = "";
        snap.forEach(doc => {
            const p = doc.data();
            const reqPlan = p.planRequested ? p.planRequested.replace('_', ' ').toUpperCase() : "UNKNOWN";
            const courseLabel = p.targetCourse ? `<span style="background:#0f172a; color:white; padding:2px 6px; border-radius:4px; font-size:10px;">${p.targetCourse}</span>` : "";
            
            const imageHtml = p.image 
                ? `<div class="pay-proof-container" onclick="viewFullReceipt('${p.image.replace(/'/g, "\\'")}')"><img src="${p.image}" class="pay-proof-img"><span class="view-receipt-text">🔍 View Receipt</span></div>`
                : `<div>⚠️ No Image</div>`;

            html += `
            <div class="admin-payment-card" id="card-${doc.id}">
                <div class="pay-card-header">
                    <div><span class="pay-user-email">${p.email}</span></div>
                    <div>${courseLabel} <span class="pay-plan-badge">${p.planRequested}</span></div>
                </div>
                ${imageHtml}
                <div class="pay-action-box">
                    <div class="pay-controls-row">
                        <select id="dur-${doc.id}" class="pay-select">
                            <option value="1_month" ${p.planRequested === '1_month' ? 'selected' : ''}>1 Month</option>
                            <option value="6_months" ${p.planRequested === '6_months' ? 'selected' : ''}>6 Months</option>
                            <option value="lifetime" ${p.planRequested === 'lifetime' ? 'selected' : ''}>Lifetime</option>
                        </select>
                        <button class="btn-pay-action btn-approve" onclick="approvePayment('${doc.id}','${p.uid}', '${p.targetCourse}')">Approve</button>
                        <button class="btn-pay-action btn-reject" onclick="rejectPayment('${doc.id}')">Reject</button>
                    </div>
                </div>
            </div>`;
        });
        list.innerHTML = html;
    } catch (e) { list.innerHTML = `<div style="color:red;">Error: ${e.message}</div>`; }
}

function viewFullReceipt(base64Image) {
    const w = window.open("");
    w.document.write(`<html><body style="background:#222;display:flex;justify-content:center;align-items:center;height:100vh;"><img src="${base64Image}" style="max-height:100%;"></body></html>`);
}

async function rejectPayment(docId) {
    if(!confirm("Reject?")) return;
    await db.collection('payment_requests').doc(docId).update({ status: 'rejected', rejectedAt: new Date() });
    loadAdminPayments();
}

async function approvePayment(docId, userId, requestedCourse) {
    if(!confirm("Approve?")) return;
    const select = document.getElementById(`dur-${docId}`);
    const planKey = select.value; 
    const duration = PLAN_DURATIONS[planKey];
    
    let newExpiry = (planKey === 'lifetime') ? new Date("2100-01-01") : new Date(Date.now() + duration);
    
    // Default to FCPS if course missing in legacy request
    const target = requestedCourse || 'FCPS';
    const prefix = COURSE_CONFIG[target].prefix;

    await db.collection('users').doc(userId).update({ 
        [`${prefix}isPremium`]: true, 
        [`${prefix}plan`]: planKey,
        [`${prefix}expiryDate`]: newExpiry
    });

    await db.collection('payment_requests').doc(docId).update({ status: 'approved', approvedAt: new Date() });
    alert("Approved!");
    loadAdminPayments();
}

async function generateAdminKey() {
    const plan = document.getElementById('key-plan').value;
    const courseFor = document.getElementById('key-course-select').value; 
    let code = document.getElementById('key-custom-code').value || ('KEY-' + Math.random().toString(36).substr(2, 6).toUpperCase());
    const limit = parseInt(document.getElementById('key-limit').value) || 1;

    await db.collection('activation_keys').add({
        code: code, plan: plan, targetCourse: courseFor, maxUses: limit, usedCount: 0, usersRedeemed: [], createdAt: new Date()
    });
    
    alert(`✅ ${courseFor} Key: ${code}`);
    loadAdminKeys();
}

async function loadAdminKeys() {
    const list = document.getElementById('admin-keys-list');
    const snap = await db.collection('activation_keys').orderBy('createdAt', 'desc').limit(10).get();
    let html = "<table style='width:100%; font-size:12px;'><tr><th>Code</th><th>Course</th><th>Usage</th><th>Action</th></tr>";
    
    snap.forEach(doc => {
        const k = doc.data();
        html += `<tr><td>${k.code}</td><td>${k.targetCourse||'FCPS'}</td><td>${k.usedCount}/${k.maxUses}</td><td><button onclick="deleteKey('${doc.id}')">Del</button></td></tr>`;
    });
    list.innerHTML = html + "</table>";
}

function deleteKey(id) {
    if(confirm("Delete key?")) db.collection('activation_keys').doc(id).delete().then(() => loadAdminKeys());
}

async function adminLookupUser(targetId) {
    const input = targetId || document.getElementById('admin-user-input').value.trim();
    const res = document.getElementById('admin-user-result');
    res.innerHTML = "Searching...";
    
    let doc = null;

    let directDoc = await db.collection('users').doc(input).get();
    if(directDoc.exists) {
        doc = directDoc;
    } 
    else {
        let s = await db.collection('users').where('email','==',input).limit(1).get();
        if(!s.empty) {
            doc = s.docs[0];
        } 
        else {
            let u = await db.collection('users').where('username','==',input.toLowerCase()).limit(1).get();
            if(!u.empty) {
                doc = u.docs[0];
            }
        }
    }

    if(!doc || !doc.exists) { res.innerHTML = "Not found (Check Email, Username or UID)"; return; }
    res.innerHTML = renderAdminUserCard(doc); 
}

function renderAdminUserCard(doc) {
    const u = doc.data();
    const fcpsActive = u.isPremium && isDateActive(u.expiryDate);
    const mbbsActive = u.MBBS_isPremium && isDateActive(u.MBBS_expiryDate);

    return `
    <div class="user-card">
        <h3>${u.email}</h3>
        <p>FCPS: ${fcpsActive ? '✅' : '❌'}</p>
        <p>MBBS: ${mbbsActive ? '✅' : '❌'}</p>
        
        <div style="margin-top:10px;">
            <select id="adm-c-${doc.id}"><option value="FCPS">FCPS</option><option value="MBBS">MBBS</option></select>
            <select id="adm-p-${doc.id}"><option value="1_month">1 Month</option><option value="lifetime">Lifetime</option></select>
            <button onclick="adminGrantPremium('${doc.id}')">Grant</button>
        </div>
    </div>`;
}

async function adminGrantPremium(uid) {
    const course = document.getElementById(`adm-c-${uid}`).value;
    const plan = document.getElementById(`adm-p-${uid}`).value;
    const duration = PLAN_DURATIONS[plan];
    const prefix = COURSE_CONFIG[course].prefix;
    
    let newExpiry = (plan === 'lifetime') ? new Date("2100-01-01") : new Date(Date.now() + duration);

    await db.collection('users').doc(uid).update({
        [`${prefix}isPremium`]: true,
        [`${prefix}plan`]: plan,
        [`${prefix}expiryDate`]: newExpiry
    });
    alert(`Granted ${course}!`);
    adminLookupUser(uid);
}

async function adminRevokePremium(uid) {
    if(!confirm("Revoke premium for both courses?")) return;
    await db.collection('users').doc(uid).update({ isPremium: false, MBBS_isPremium: false });
    alert("🚫 Revoked All Premium");
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
        'auth-screen', 'course-selection-screen', 'dashboard-screen', 'quiz-screen', 'result-screen', 'admin-screen',
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
    document.getElementById('prem-content-code').classList.toggle('hidden', tab !== 'code');
    document.getElementById('prem-content-manual').classList.toggle('hidden', tab !== 'manual');
    document.getElementById('tab-btn-code').classList.toggle('active', tab === 'code');
    document.getElementById('tab-btn-manual').classList.toggle('active', tab === 'manual');
}

async function openProfileModal() {
    if (!currentUser || isGuest) return alert("Please log in to edit profile.");
    
    document.getElementById('profile-modal').classList.remove('hidden');
    document.getElementById('profile-plan').innerText = "Loading...";

    let freshData = {};
    try {
        const doc = await db.collection('users').doc(currentUser.uid).get();
        if (doc.exists) freshData = doc.data();
        userProfile = freshData;
    } catch (e) {
        freshData = userProfile || {};
    }

    const emailElem = document.getElementById('profile-email');
    const userInput = document.getElementById('edit-username');
    
    emailElem.innerText = currentUser.email;
    
    if (freshData.username) {
        userInput.value = freshData.username;
        userInput.disabled = true; 
        userInput.style.backgroundColor = "#f1f5f9"; 
        userInput.style.color = "#64748b"; 
        userInput.style.cursor = "not-allowed";
        userInput.title = "Username cannot be changed. Contact Admin.";
    } else {
        userInput.value = ""; 
        userInput.disabled = false; 
        userInput.style.backgroundColor = "white"; 
        userInput.style.color = "#0072ff"; 
        userInput.style.cursor = "text"; 
        userInput.placeholder = "Create a username (One-time only)";
    }

    document.getElementById('edit-name').value = freshData.displayName || "";
    document.getElementById('edit-phone').value = freshData.phone || "";
    document.getElementById('edit-college').value = freshData.college || "";
    document.getElementById('edit-exam').value = freshData.targetExam || "FCPS-1";

    let joinDateRaw = freshData.joined || currentUser.metadata.creationTime;
    let joinDateObj = parseDateRobust(joinDateRaw);
    document.getElementById('profile-joined').innerText = joinDateObj ? formatDateHelper(joinDateObj) : "N/A";

    const planElem = document.getElementById('profile-plan');
    const expiryElem = document.getElementById('profile-expiry');

    // Show status for CURRENT COURSE
    const premKey = getStoreKey('isPremium');
    const expKey = getStoreKey('expiryDate');
    const isPrem = freshData[premKey];
    
    if (isPrem) {
        planElem.innerText = `${currentCourse} PREMIUM 👑`;
        const expiryRaw = freshData[expKey];
        if (isDateActive(expiryRaw)) {
             expiryElem.innerText = formatDateHelper(expiryRaw);
             expiryElem.style.color = "#d97706";
        } else {
             expiryElem.innerText = "Expired";
             expiryElem.style.color = "red";
        }
    } else {
        planElem.innerText = `${currentCourse} Free Plan`;
        expiryElem.innerText = "-";
        expiryElem.style.color = "#64748b";
    }
}

async function saveDetailedProfile() {
    const btn = event.target;
    btn.innerText = "Saving...";
    btn.disabled = true;

    const name = document.getElementById('edit-name').value;
    const usernameRaw = document.getElementById('edit-username').value;
    const username = usernameRaw ? usernameRaw.trim().toLowerCase().replace(/\s+/g, '') : "";
    const phone = document.getElementById('edit-phone').value;
    const college = document.getElementById('edit-college').value;
    const exam = document.getElementById('edit-exam').value;

    try {
        if (username && username !== (userProfile.username || "")) {
            const check = await db.collection('users').where('username', '==', username).get();
            let taken = false;
            check.forEach(d => { if(d.id !== currentUser.uid) taken = true; });
            
            if (taken) throw new Error("⚠️ Username already taken.");
        }

        const updates = {
            displayName: name,
            phone: phone,
            college: college,
            targetExam: exam
        };
        if (username) updates.username = username;

        await db.collection('users').doc(currentUser.uid).update(updates);
        
        if (username) userProfile.username = username;
        userProfile.displayName = name;

        document.getElementById('user-display').innerText = name || username || "User";
        alert("✅ Saved!");
        document.getElementById('profile-modal').classList.add('hidden');

    } catch (e) {
        alert("Error: " + e.message);
    } finally {
        btn.innerText = "💾 Save Changes";
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

    const day = String(d.getDate()).padStart(2, '0');
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const month = months[d.getMonth()];
    const year = d.getFullYear();

    return `${day}/${month}/${year}`;
}

function openBadges() {
    const modal = document.getElementById('achievement-modal'); 
    const container = modal.querySelector('.ach-grid'); 

    if (!modal || !container) {
        console.error("Error: Could not find 'achievement-modal'.");
        return;
    }

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
        const solvedCount = (typeof userSolvedIDs !== 'undefined') ? userSolvedIDs.length : 0;
        const isUnlocked = solvedCount >= b.limit;

        const statusClass = isUnlocked ? 'unlocked' : 'locked';
        
        const statusIcon = isUnlocked 
            ? `<div class="ach-check">✓</div>` 
            : `<div class="ach-lock">🔒</div>`;

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

    container.innerHTML = html;
}

function updateBadgeButton() {
    // Basic implementation for now
    if(userSolvedIDs.length > 100) document.getElementById('main-badge-btn').innerText = "🥉";
    else document.getElementById('main-badge-btn').innerText = "🏆";
}

async function openAnalytics() {
    const modal = document.getElementById('analytics-modal');
    const content = document.getElementById('analytics-content');
    modal.classList.remove('hidden');
    content.innerHTML = "Loading...";

    if(!currentUser || isGuest) { content.innerHTML = "Guest mode."; return; }

    try {
        const doc = await db.collection('users').doc(currentUser.uid).get();
        // ISOLATED STATS
        const stats = doc.data()[getStoreKey('stats')] || {};
        
        let html = `<div class="perf-section-title">📊 ${currentCourse} Performance</div>`;
        
        Object.keys(stats).forEach(subj => {
            const s = stats[subj];
            const pct = Math.round((s.correct / s.total) * 100) || 0;
            
            html += `
            <div class="perf-item">
                <div class="perf-meta">
                    <span>${subj.replace(/_/g,' ')}</span>
                    <span>${pct}% (${s.correct}/${s.total})</span>
                </div>
                <div class="perf-bar-bg">
                    <div class="perf-bar-fill" style="width:${pct}%"></div>
                </div>
            </div>`;
        });

        html += `<div class="perf-section-title" style="margin-top:30px;">📜 Recent Exams</div>
                 <table class="exam-table">
                    <thead><tr><th>Date</th><th>Subject</th><th>Score</th></tr></thead>
                    <tbody>`;
        
        const snaps = await db.collection('users').doc(currentUser.uid).collection('results').orderBy('date','desc').limit(5).get();
        
        if(snaps.empty) html += `<tr><td colspan="3">No exams yet.</td></tr>`;
        
        snaps.forEach(r => {
            const d = r.data();
            const dateStr = d.date ? formatDateHelper(parseDateRobust(d.date)) : "-";
            const scoreColor = d.score === 0 ? "red" : "#1e293b";
            
            html += `<tr>
                <td>${dateStr}</td>
                <td>${d.subject}</td>
                <td style="color:${scoreColor}; font-weight:bold;">${d.score}%</td>
            </tr>`;
        });

        html += `</tbody></table>`;
        content.innerHTML = html;

    } catch(e) { content.innerText = "Error: " + e.message; }
}

function toggleTheme() {
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    document.body.setAttribute('data-theme', isDark ? '' : 'dark');
    document.getElementById('theme-btn').innerText = isDark ? '🌙' : '☀️';
    localStorage.setItem('fcps-theme', isDark ? 'light' : 'dark');
}

// Ensure Search works
const searchInput = document.getElementById('global-search');
if (searchInput) {
    searchInput.addEventListener('input', function(e) {
        const term = e.target.value.toLowerCase().trim();
        const resultsBox = document.getElementById('search-results');
        
        if (term.length < 3) {
            resultsBox.style.display = 'none';
            return;
        }

        const matches = allQuestions.filter(q => 
            (q.Question && q.Question.toLowerCase().includes(term)) || 
            (q.Topic && q.Topic.toLowerCase().includes(term))
        ).slice(0, 10); 

        if (matches.length === 0) {
            resultsBox.style.display = 'none';
            return;
        }

        resultsBox.innerHTML = '';
        resultsBox.style.display = 'block';

        matches.forEach(q => {
            const div = document.createElement('div');
            div.className = 'search-item';
            div.innerHTML = `
                <div style="font-weight:bold; color:#1e293b; font-size:13px;">${q.Topic || "General"}</div>
                <div style="color:#64748b; font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                    ${q.Question.substring(0, 60)}...
                </div>
            `;
            div.onclick = () => {
                resultsBox.style.display = 'none';
                document.getElementById('global-search').value = ""; 
                startSingleQuestionPractice(q);
            };
            resultsBox.appendChild(div);
        });
    });
}

function startSingleQuestionPractice(question) {
    filteredQuestions = [question]; 
    currentMode = 'practice';
    currentIndex = 0;
    
    showScreen('quiz-screen'); 
    renderPage();
    renderPracticeNavigator();
}

document.addEventListener('click', function(e) {
    if (e.target.id !== 'global-search') {
        const box = document.getElementById('search-results');
        if(box) box.style.display = 'none';
    }
});

// INITIAL LOAD THEME
window.onload = () => {
    if(localStorage.getItem('fcps-theme')==='dark') toggleTheme();
}

function parseDateRobust(input) {
    if (!input) return null;
    if (input.seconds) return new Date(input.seconds * 1000);
    if (input instanceof Date) return input;
    const d = new Date(input);
    return isNaN(d.getTime()) ? null : d;
}
