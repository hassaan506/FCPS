// HANDLE PWA SHORTCUTS
window.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const action = params.get('action');
    
    // Wait for auth to settle (approx 500ms) then redirect
    if(action && currentUser) {
        setTimeout(() => {
            if (action === 'exam') {
                showScreen('dashboard-screen');
                setMode('test');
                // Optional: Auto-scroll to exam section
                document.getElementById('test-settings').scrollIntoView();
            } else if (action === 'stats') {
                openAnalytics();
            } else if (action === 'mistakes') {
                startMistakePractice();
            }
        }, 1000);
    }
});

// ======================================================
// 1. CONFIGURATION & FIREBASE SETUP
// ======================================================

// --- NEW: MULTI-COURSE CONFIGURATION ---
const COURSE_CONFIG = {
    // --- MAIN COURSE: FCPS ---
    'FCPS': {
        name: "FCPS Part 1",
        sheet: "https://docs.google.com/spreadsheets/d/e/2PACX-1vR8aw1eGppF_fgvI5VAOO_3XEONyI-4QgWa0IgQg7K-VdxeFyn4XBpWT9tVDewbQ6PnMEQ80XpwbASh/pub?output=csv",
        prefix: "", 
        theme: "" 
    },

    // --- SUB COURSE: MBBS (Years 1-5) ---
    
    'MBBS_1': { 
        name: "First Year", 
        sheet: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQavpclI1-TLczhnGiPiF7g6rG32F542mmjCBIg612NcSAkdhXScIgsK6-4w6uGVM9l_XbQe6aCiOyE/pub?output=csv", 
        prefix: "MBBS1_", 
        theme: "mbbs-mode" 
    },

    'MBBS_2': { 
        name: "Second Year", 
        sheet: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQvD7HQYS6gFFcwo4_DTkvR9BIh70xjM4M1XMTSD5DFeGv69BTXtGVchf3ON6CFxRJ3GIN7t2ojU5Gb/pub?output=csv", 
        prefix: "MBBS2_", 
        theme: "mbbs-mode" 
    },

    'MBBS_3': { 
        name: "Third Year", 
        sheet: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSPwZrNWryh937oxXV1zwnBYtnhysGCiJ0wLaV7J941MFGVhaG_1BC-ZODYZlgDATW6UOXrJrac-bdV/pub?output=csv", 
        prefix: "MBBS3_", 
        theme: "mbbs-mode" 
    },

    'MBBS_4': { 
        name: "Fourth Year", 
        sheet: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTTGsPZWg-U9_zG2_FWkQWDp5nsQ8OVGqQnoqdqxw4bQz2JSAYsgPvrgbrwX8gtiJj5LrY9MUaNvkBn/pub?output=csv", 
        prefix: "MBBS4_", 
        theme: "mbbs-mode" 
    },

    'MBBS_5': { 
        name: "Final Year", 
        sheet: "https://docs.google.com/spreadsheets/d/e/2PACX-1vS6fLWMz_k89yK_S8kfjqAGs9I_fGzBE-WQ-Ci8l-D5ownRGV0I1Tz-ifZZKBOTXZAx9bvs4wVuWLID/pub?output=csv", 
        prefix: "MBBS_", 
        theme: "mbbs-mode" 
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

let userListener = null; // Variable to track the real-time connection

async function checkLoginSecurity(user) {
    try {
        const docRef = db.collection('users').doc(user.uid);
        
        // 1. Initial Check & Setup
        const doc = await docRef.get();

        if (!doc.exists) {
            // New User: Create Profile & Set Device ID
            await docRef.set({
                email: user.email,
                deviceId: currentDeviceId, // Lock to this device
                role: 'student',
                joined: new Date(),
                isPremium: false, solved: [], bookmarks: [], mistakes: [], stats: {}
            }, { merge: true });
        } else {
            // Existing User: ALWAYS update to THIS device ID on login
            // This "kicks out" any other device currently logged in
            await docRef.update({ 
                deviceId: currentDeviceId,
                email: user.email // Keep email sync updated
            });
        }
        
        // 2. REAL-TIME PROTECTION (The Fix)
        // This listens for changes. If the DB changes, this code runs instantly.
        if (userListener) userListener(); // Stop any old listeners
        
        userListener = docRef.onSnapshot((snapshot) => {
            if (!snapshot.exists) return;
            const data = snapshot.data();
            userProfile = data; // Keep local profile fresh

            // A. Check for Device Conflict
            if (data.deviceId && data.deviceId !== currentDeviceId) {
                // The DB says a different device is active. We must log out.
                auth.signOut();
                alert("⚠️ Session Ended\n\nYou have logged in on another device. This session is now closed.");
                window.location.reload();
                return;
            }

            // B. Check for Ban Status
            if (data.disabled) {
                auth.signOut();
                alert("⛔ Your account has been disabled by the admin.");
                window.location.reload();
                return;
            }

            updateCourseSelectionUI();
  
            if (userProfile.role === 'admin') {
                const btn = document.getElementById('admin-btn');
                if(btn) btn.classList.remove('hidden');
            }
        });

    } catch (e) { 
        console.error("Auth Error:", e); 
        alert("Login Error: " + e.message); 
    }
}

function updateCourseSelectionUI() {
    if(!userProfile) return;
    
    // 1. Check FCPS
    const fcpsActive = userProfile.isPremium && isDateActive(userProfile.expiryDate);
    const fcpsBadge = document.getElementById('status-badge-FCPS');
    if(fcpsBadge) setBadgeUI(fcpsBadge, fcpsActive);

    // 2. Check ALL MBBS Years (1 to 5)
    // This works because our COURSE_CONFIG knows that 'MBBS_5' uses the old "MBBS_" prefix
    checkYearStatus('MBBS_1', 'status-badge-MBBS1');
    checkYearStatus('MBBS_2', 'status-badge-MBBS2');
    checkYearStatus('MBBS_3', 'status-badge-MBBS3');
    checkYearStatus('MBBS_4', 'status-badge-MBBS4');
    checkYearStatus('MBBS_5', 'status-badge-MBBS5'); 
}

// Helper to avoid repetitive code
function checkYearStatus(courseKey, elementId) {
    const config = COURSE_CONFIG[courseKey];
    if(!config) return; // Safety check
    
    const prefix = config.prefix; // Gets "MBBS1_" or "MBBS_" depending on the year
    
    const isPrem = userProfile[prefix + 'isPremium'];
    const expiry = userProfile[prefix + 'expiryDate'];
    
    const isActive = isPrem && isDateActive(expiry);
    
    const badge = document.getElementById(elementId);
    if(badge) setBadgeUI(badge, isActive);
}

function setBadgeUI(element, isActive) {
    element.innerText = isActive ? "✅ Active" : "🔒 Free Version";
    element.style.background = isActive ? "#d1fae5" : "#e2e8f0";
    element.style.color = isActive ? "#065f46" : "#475569";
}

function selectCourse(courseName) {
    if (!COURSE_CONFIG[courseName]) return alert("Course coming soon!");
    
    currentCourse = courseName;
    const config = COURSE_CONFIG[courseName];

    // 1. Apply Visual Theme
    document.body.className = config.theme; 
    
    // 2. Update Header with the NICE NAME, not the ID
    const badge = document.getElementById('active-course-badge');
    if(badge) badge.innerText = config.name; // <--- This fixes the top badge
    
    const title = document.getElementById('stats-title');
    if(title) title.innerText = `📊 ${config.name} Progress`; // <--- This fixes the dashboard title

    // 3. Load Data & Dashboard
    showScreen('dashboard-screen');
    
    // Reset Data
    allQuestions = [];
    filteredQuestions = [];
    
    loadQuestions(config.sheet); 
    loadUserData(); 
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
    userProfile = { 
        role: 'guest', 
        isPremium: false, 
        MBBS_isPremium: false 
    };
    if(document.getElementById('course-selection-screen')) {
        showScreen('course-selection-screen');
        updateCourseSelectionUI(); 
    } else {
        selectCourse('FCPS');
    }
    const display = document.getElementById('user-display');
    if(display) display.innerText = "Guest User";
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

async function resetPassword() {
    let email = document.getElementById('email').value.trim();
    
    // 1. If the email field is empty or looks like a username (no '@'), ask for the email explicitly
    if (!email || !email.includes('@')) {
        email = prompt("Please enter your registered Email Address to reset your password:");
    }
    
    if (!email) return; // User cancelled or entered nothing

    const msg = document.getElementById('auth-msg');
    if (msg) msg.innerText = "Sending reset email...";

    try {
        // 2. Trigger Firebase Reset
        await auth.sendPasswordResetEmail(email);
        alert(`✅ Reset link sent to: ${email}\n\nPlease check your Inbox (and Spam folder) to create a new password.`);
        if (msg) msg.innerText = "";
    } catch (e) {
        console.error(e);
        if (e.code === 'auth/user-not-found') {
            alert("❌ That email is not registered.");
        } else {
            alert("Error: " + e.message);
        }
        if (msg) msg.innerText = "Error sending email.";
    }
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

    // Update Display Name in Top Bar
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

        // --- FIX: Get the Readable Name (e.g. "Final Year") ---
        const config = COURSE_CONFIG[currentCourse];
        const displayName = config ? config.name : currentCourse;

        if(statsBox) {
            statsBox.style.opacity = "1"; 
            statsBox.innerHTML = `
                <div style="margin-top:5px; font-size:14px; line-height:1.8;">
                    <div>✅ ${displayName} Solved: <b style="color:var(--primary);">${userSolvedIDs.length}</b></div>
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
    
    // Check Premium Status
    const premKey = getStoreKey('isPremium');
    const expKey = getStoreKey('expiryDate');
    const isPrem = userProfile && userProfile[premKey] && isDateActive(userProfile[expKey]);
    const isAdmin = userProfile && userProfile.role === 'admin';

    // --- NEW LIMIT LOGIC ---
    let limit = Infinity;
    let userType = "Premium";

    if (isAdmin) {
        limit = Infinity;
    } else if (isGuest) {
        limit = 20; // Guest Limit
        userType = "Guest";
    } else if (!isPrem) {
        limit = 50; // Free User Limit (Non-Premium)
        userType = "Free";
    }

    // Apply Limit
    if (pool.length > limit) {
        pool = pool.slice(0, limit);
        if (currentIndex === 0) {
            alert(`🔒 ${userType} Limit Reached\n\nYou are limited to ${limit} questions per section in ${userType} mode.\n\nUpgrade to Premium to unlock the full ${currentCourse} bank!`);
        }
    }
    // -----------------------

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
    // 1. Remove duplicates from local array immediately
    userBookmarks = [...new Set(userBookmarks)];

    if (userBookmarks.length === 0) return alert("No bookmarks found for this course.");

    // 2. Filter Questions
    // Make sure we only get questions that actually exist in the current sheet data
    filteredQuestions = allQuestions.filter(q => userBookmarks.includes(q._uid));
    
    if (filteredQuestions.length === 0) {
        // This handles the case where you bookmarked a question from a different course/sheet
        return alert("You have bookmarks, but they don't match the current loaded questions (FCPS/MBBS). Switch course to view them.");
    }
    
    currentMode = 'practice';
    isMistakeReview = false;
    currentIndex = 0;
    
    showScreen('quiz-screen');
    renderPage();
    // Also render navigator so you can see the count immediately
    renderPracticeNavigator(); 
}

function startTest() {
    const isAdmin = userProfile && userProfile.role === 'admin';
    const premKey = getStoreKey('isPremium');
    const expKey = getStoreKey('expiryDate');
    const isPrem = userProfile && userProfile[premKey] && isDateActive(userProfile[expKey]);

    let count = parseInt(document.getElementById('q-count').value);
    const mins = parseInt(document.getElementById('t-limit').value);

    // --- NEW EXAM LIMIT LOGIC ---
    let maxQuestions = Infinity;
    
    if (isAdmin) {
        maxQuestions = Infinity;
    } else if (isGuest) {
        maxQuestions = 20;
    } else if (!isPrem) {
        maxQuestions = 50;
    }

    if (count > maxQuestions) {
        alert(`🔒 Limit Exceeded\n\n${isGuest ? "Guest" : "Free"} accounts are limited to ${maxQuestions} questions per exam.\n\nReducing question count to ${maxQuestions}.`);
        count = maxQuestions;
        // Update the input to reflect the change visually
        document.getElementById('q-count').value = maxQuestions;
    }
    // ----------------------------

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
    
    // Ensure we don't try to take more questions than exist in the pool
    const finalCount = Math.min(count, pool.length);
    
    filteredQuestions = pool.sort(() => Math.random() - 0.5).slice(0, finalCount);
    
    currentMode = 'test';
    currentIndex = 0;
    testAnswers = {};
    testFlags = {}; 
    testTimeRemaining = mins * 60;
    
    showScreen('quiz-screen');
    document.getElementById('timer').classList.remove('hidden');
    document.getElementById('test-sidebar').classList.add('active');
    
    // Ensure the navigator renders immediately
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

    if (testFlags[q._uid]) {
        block.classList.add('is-flagged-card');
    }

    const isBookmarked = (currentMode === 'test') ? false : userBookmarks.includes(q._uid);
    const isFlagged = testFlags[q._uid] || false;

    const header = document.createElement('div');
    header.className = "question-card-header";
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

    const qText = document.createElement('div');
    qText.className = "test-q-text";
    qText.innerHTML = q.Question || "Missing Text";
    block.appendChild(qText);

    const optionsDiv = document.createElement('div');
    optionsDiv.className = "options-group";
    optionsDiv.id = `opts-${index}`;

    let rawOpts = [q.OptionA, q.OptionB, q.OptionC, q.OptionD, q.OptionE].filter(o => o && o.trim() !== "");

    let normalOpts = [];
    let bottomOpts = [];

    rawOpts.forEach(opt => {
        const lower = opt.toLowerCase();

        if (lower.includes("all of") || lower.includes("none of") || lower.includes("of the above") || lower.includes("all the")) {
            bottomOpts.push(opt);
        } else {
            normalOpts.push(opt);
        }
    });

    let finalOpts = [...shuffleArray(normalOpts), ...bottomOpts];

    finalOpts.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = "option-btn";
        // The span ensures the text and the eye icon are separated correctly
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

// ==========================================
// FIX 2: QUESTION NAVIGATORS
// ==========================================

function renderNavigator() {
    // Target the ID found in your HTML: <div id="nav-grid">
    const nav = document.getElementById('nav-grid'); 
    if (!nav) return;
    nav.innerHTML = "";

    filteredQuestions.forEach((q, idx) => {
        const btn = document.createElement('button');
        btn.className = "nav-btn"; // Ensure you have CSS for this class
        btn.innerText = idx + 1;
        
        // Style styling based on state
        if (currentIndex === idx) btn.classList.add('current');
        if (testFlags[q._uid]) btn.classList.add('flagged');
        if (testAnswers[q._uid]) btn.classList.add('answered');

        btn.onclick = () => {
            currentIndex = idx;
            renderPage();
        };
        nav.appendChild(btn);
    });
}

function renderPracticeNavigator() {
    // Target the ID found in your HTML: <div id="practice-nav-container">
    const nav = document.getElementById('practice-nav-container');
    if (!nav) return;
    
    nav.classList.remove('hidden'); // Make sure it's visible
    nav.innerHTML = "";

    // In practice mode, we create a simple horizontal scroller or grid
    filteredQuestions.forEach((q, idx) => {
        const btn = document.createElement('button');
        btn.className = "nav-btn";
        btn.innerText = idx + 1;

        if (currentIndex === idx) btn.classList.add('current');
        
        // Show Red/Green if previously attempted
        if (userSolvedIDs.includes(q._uid)) {
            btn.style.borderColor = "#10b981"; // Green
            btn.style.color = "#10b981";
        }
        if (userMistakes.includes(q._uid)) {
            btn.style.borderColor = "#ef4444"; // Red
            btn.style.color = "#ef4444";
        }

        btn.onclick = () => {
            currentIndex = idx;
            renderPage();
        };
        nav.appendChild(btn);
    });
}

// ======================================================
// 9. DATABASE SAVING & SUBMISSION (UPDATED PREFIX)
// ======================================================

async function saveProgressToDB(q, isCorrect) {
    if (!currentUser || isGuest) return;

    const userRef = db.collection('users').doc(currentUser.uid);
    const sKey = getStoreKey('solved');
    const mKey = getStoreKey('mistakes');
    const statKey = getStoreKey('stats');
    const subjectKey = q.Subject.replace(/\W/g,'_');

    const batch = db.batch();

    // ==========================================
    // 1. AGAR JAWAB SAHI HAI (CORRECT)
    // ==========================================
    if (isCorrect) {
        
        // A. Solved List me daal do (Green karne ke liye)
        if (!userSolvedIDs.includes(q._uid)) {
            userSolvedIDs.push(q._uid);
            batch.update(userRef, {
                [sKey]: firebase.firestore.FieldValue.arrayUnion(q._uid),
                [`${statKey}.${subjectKey}.correct`]: firebase.firestore.FieldValue.increment(1),
                [`${statKey}.${subjectKey}.total`]: firebase.firestore.FieldValue.increment(1)
            });
        }

        if (isMistakeReview === true) {
            // Local se nikalo
            const idx = userMistakes.indexOf(q._uid);
            if (idx > -1) userMistakes.splice(idx, 1);

            // Database se nikalo
            batch.update(userRef, {
                [mKey]: firebase.firestore.FieldValue.arrayRemove(q._uid)
            });
            console.log("Deleted from mistakes (Review Mode)");
        } else {
            console.log("Correct Answer: Mistake NOT deleted (Normal Mode)");
        }

    } 

    else {
        // Mistake List me daal do
        if (!userMistakes.includes(q._uid)) {
            userMistakes.push(q._uid);
            
            batch.update(userRef, {
                [mKey]: firebase.firestore.FieldValue.arrayUnion(q._uid),
                [`${statKey}.${subjectKey}.total`]: firebase.firestore.FieldValue.increment(1)
            });
        }
    }

    // Save Changes
    try {
        await batch.commit();
        // UI ke numbers update karo
        if (typeof updateLiveStatsUI === "function") updateLiveStatsUI();
    } catch(e) {
        console.error(e);
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
    
    // Arrays to collect data for Bulk Update
    let newSolved = [];
    let newMistakes = [];

    filteredQuestions.forEach(q => {
        const user = testAnswers[q._uid];
        const correctText = getOptionText(q, getCorrectLetter(q));
        
        if(user === correctText) {
            // CORRECT
            score++;
            if(currentUser && !isGuest && !userSolvedIDs.includes(q._uid)) {
                newSolved.push(q._uid);
            }
        } else {
            // WRONG or LEFT (Unanswered)
            // FIX: Add to mistakes list
            if(currentUser && !isGuest && !userMistakes.includes(q._uid)) {
                newMistakes.push(q._uid);
            }
        }
    });

    const pct = Math.round((score/filteredQuestions.length)*100);

    // --- SAVE TO DATABASE ---
    if(currentUser && !isGuest) {
        const batch = db.batch();
        const userRef = db.collection('users').doc(currentUser.uid);
        const sKey = getStoreKey('solved');
        const mKey = getStoreKey('mistakes');

        // 1. Save Result History
        userRef.collection('results').add({
            date: new Date(), 
            score: pct, 
            total: filteredQuestions.length, 
            subject: `${currentCourse} Exam`
        });

        // 2. Bulk Add Solved
        if(newSolved.length > 0) {
            userRef.update({ [sKey]: firebase.firestore.FieldValue.arrayUnion(...newSolved) });
            userSolvedIDs.push(...newSolved); // Update local state immediately
        }

        // 3. Bulk Add Mistakes (Wrong/Left)
        if(newMistakes.length > 0) {
            userRef.update({ [mKey]: firebase.firestore.FieldValue.arrayUnion(...newMistakes) });
            userMistakes.push(...newMistakes); // Update local state immediately
        }
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

    // --- FIX: TEST MODE LOGIC ---
    if (currentMode === 'test') {
        // In exam, we DO NOT remove. We only ADD.
        // Even if it's already there, we just show visual confirmation that we clicked it.
        
        if (!userBookmarks.includes(uid)) {
            userBookmarks.push(uid);
            await db.collection('users').doc(currentUser.uid).update({
                [key]: firebase.firestore.FieldValue.arrayUnion(uid)
            });
        }
        // Visually turn it yellow so user knows it registered
        btn.innerHTML = "⭐";
        btn.classList.add('bookmark-active');
        return; 
    }

    // --- STANDARD PRACTICE MODE (TOGGLE) ---
    if (userBookmarks.includes(uid)) {
        // Remove
        userBookmarks = userBookmarks.filter(id => id !== uid);
        btn.innerHTML = "☆";
        btn.classList.remove('bookmark-active');
        
        await db.collection('users').doc(currentUser.uid).update({
            [key]: firebase.firestore.FieldValue.arrayRemove(uid)
        });
    } else {
        // Add
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
    
    if(tab==='keys') {
        // --- FIX: POPULATE KEY GENERATOR DROPDOWN DYNAMICALLY ---
        const select = document.getElementById('key-course-select');
        if(select) select.innerHTML = getCourseOptionsHTML('FCPS');
        loadAdminKeys();
    }
    
    if(tab==='users') loadAllUsers();
}

async function loadAdminReports() {
    const list = document.getElementById('admin-reports-list');
    list.innerHTML = "Loading issues...";

    try {
        const snap = await db.collection('reports').orderBy('timestamp', 'desc').limit(50).get();
        if(snap.empty) { list.innerHTML = "No reports found."; return; }

        let html = "";
        snap.forEach(doc => {
            const r = doc.data();
            const dateStr = r.timestamp ? formatDateHelper(r.timestamp.toDate()) : "-";
            
            // Fallback if old reports don't have the new fields yet
            const displayCourse = r.courseName || r.courseId || "Unknown Course";
            const displayRow = r.excelRow || "Unknown Row";

            html += `
            <div class="report-card" style="border-left: 5px solid #ef4444; background: white; padding: 15px; margin-bottom: 15px; border-radius: 10px; box-shadow: 0 2px 5px rgba(0,0,0,0.05);">
                <div style="display:flex; justify-content:space-between; margin-bottom:10px; border-bottom:1px solid #eee; padding-bottom:10px;">
                    <div>
                        <span style="background:#fee2e2; color:#b91c1c; padding:4px 8px; border-radius:6px; font-weight:bold; font-size:11px; text-transform:uppercase;">${displayCourse}</span>
                        <span style="background:#e0f2fe; color:#0369a1; padding:4px 8px; border-radius:6px; font-weight:bold; font-size:11px; margin-left:5px;">ROW ${displayRow}</span>
                    </div>
                    <span style="font-size:11px; color:#94a3b8;">${dateStr}</span>
                </div>

                <p style="font-size:13px; color:#334155; margin:0 0 10px 0;">
                    <b>Issue:</b> ${r.issue}
                </p>
                <div style="font-size:11px; color:#64748b;">
                    Reported by: ${r.reportedBy}
                </div>
                
                <div style="margin-top:10px; text-align:right;">
                    <button onclick="resolveReport('${doc.id}')" style="background:white; border:1px solid #cbd5e1; color:#475569; padding:5px 10px; border-radius:6px; font-size:11px; cursor:pointer;">✅ Mark Resolved</button>
                    <button onclick="deleteReport('${doc.id}')" style="background:white; border:1px solid #fca5a5; color:#ef4444; padding:5px 10px; border-radius:6px; font-size:11px; cursor:pointer; margin-left:5px;">🗑️ Delete</button>
                </div>
            </div>`;
        });
        list.innerHTML = html;
    } catch(e) {
        list.innerHTML = "Error loading reports: " + e.message;
    }
}

function deleteReport(id) {
    if(!confirm("Mark this report as resolved and delete it?")) return;
    db.collection('reports').doc(id).delete()
        .then(() => loadAdminReports())
        .catch(e => alert("Error: " + e.message));
}

function deleteReport(id) { db.collection('reports').doc(id).delete().then(()=>loadAdminReports()); }

async function loadAllUsers() {
    const list = document.getElementById('admin-user-result');
    const searchInput = document.getElementById('admin-user-input');
    const searchVal = searchInput ? searchInput.value.trim().toLowerCase() : "";

    list.innerHTML = "<div style='text-align:center; padding:20px;'>Loading database...</div>";

    try {
        // 1. Fetch Users (No limit or strict ordering to ensure we get everyone)
        const snap = await db.collection('users').limit(100).get();

        if (snap.empty) {
            list.innerHTML = "<div style='padding:20px; text-align:center;'>No users found.</div>";
            return;
        }

        let html = "";
        let count = 0;
        let guestCount = 0;

        // 2. Loop through users
        snap.forEach(doc => {
            const u = doc.data();
            
            // --- FILTER: SKIP GUESTS ---
            if (u.role === 'guest') {
                guestCount++;
                return; // Stop here, do not add to HTML
            }

            const uid = doc.id.toLowerCase();
            const email = (u.email || "No Email").toLowerCase();
            
            // 3. Search Filter
            if (searchVal === "" || email.includes(searchVal) || uid.includes(searchVal)) {
                html += renderAdminUserCard(doc); 
                count++;
            }
        });

        // 4. Show Results
        if (count === 0) {
             list.innerHTML = `<div style='padding:20px; text-align:center;'>No matching users found.<br><span style="font-size:11px; color:#999;">(Hidden Guests: ${guestCount})</span></div>`;
        } else {
             const header = `
             <div style="padding:10px; font-size:12px; color:#666; text-align:right; border-bottom:1px solid #eee; margin-bottom:10px;">
                Found: <b>${count}</b> Users <span style="color:#94a3b8; margin-left:10px;">(Hidden Guests: ${guestCount})</span>
             </div>`;
             list.innerHTML = header + html;
        }

    } catch (e) {
        console.error(e);
        list.innerHTML = `<div style='color:red; padding:10px;'>Error: ${e.message}</div>`;
    }
}


function renderUserRow(u, extraLabel = "") {
    const isAdmin = u.role === 'admin';
    
    // Check Statuses
    const fcpsPrem = u.isPremium; 
    const mbbsPrem = u.MBBS_isPremium;
    const isBanned = u.disabled === true; // Check if banned
    
    let badgeHTML = "";
    
    // 1. Determine Subscription Badge
    if (fcpsPrem && mbbsPrem) badgeHTML = `<span class="status-badge badge-premium" style="background:purple; color:white;">ALL ACCESS</span>`;
    else if (fcpsPrem) badgeHTML = `<span class="status-badge badge-premium">FCPS Premium</span>`;
    else if (mbbsPrem) badgeHTML = `<span class="status-badge badge-premium" style="background:#dcfce7; color:#166534;">MBBS Premium</span>`;
    else badgeHTML = `<span class="status-badge badge-free">Free User</span>`;

    // 2. Add Banned Badge if applicable
    if (isBanned) {
        badgeHTML += ` <span class="status-badge" style="background:#ef4444; color:white; margin-left:5px;">⛔ BANNED</span>`;
    }

    return `
    <div class="user-list-item ${isAdmin ? "is-admin-row" : ""}" style="${isBanned ? 'opacity: 0.6; background: #fee2e2;' : ''}">
        <div class="user-info-group">
            <div class="user-email-text">
                ${isAdmin ? '⭐' : ''} ${u.email || "Unknown User"} 
                ${u.username ? `(@${u.username})` : ""} ${extraLabel}
            </div>
            <div class="user-meta-row">
                ${badgeHTML}
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

        // --- PREPARE OPTIONS DYNAMICALLY (SORTED BY DURATION) ---
        const allPlans = Object.keys(PLAN_DURATIONS).sort((a,b) => PLAN_DURATIONS[a] - PLAN_DURATIONS[b]);
        
        let html = "";
        snap.forEach(doc => {
            const p = doc.data();
            const reqPlan = p.planRequested ? p.planRequested.replace('_', ' ').toUpperCase() : "UNKNOWN";
            const courseLabel = p.targetCourse ? `<span style="background:#0f172a; color:white; padding:2px 6px; border-radius:4px; font-size:10px;">${p.targetCourse}</span>` : "";
            
            const imageHtml = p.image 
                ? `<div class="pay-proof-container" onclick="viewFullReceipt('${p.image.replace(/'/g, "\\'")}')"><img src="${p.image}" class="pay-proof-img"><span class="view-receipt-text">🔍 View Receipt</span></div>`
                : `<div>⚠️ No Image</div>`;

            // Generate dropdown options for THIS specific request
            let optionsHtml = "";
            allPlans.forEach(key => {
                const label = key.replace(/_/g, ' ').toUpperCase();
                const isSelected = p.planRequested === key ? 'selected' : '';
                optionsHtml += `<option value="${key}" ${isSelected}>${label}</option>`;
            });

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
                            ${optionsHtml} </select>
                        <button class="btn-pay-action btn-approve" onclick="approvePayment('${doc.id}','${p.uid}', '${p.targetCourse}')">Approve</button>
                        <button class="btn-pay-action btn-reject" onclick="rejectPayment('${doc.id}')">Reject</button>
                    </div>
                </div>
            </div>`;
        });
        list.innerHTML = html;
    } catch (e) { list.innerHTML = `<div style="color:red;">Error: ${e.message}</div>`; }
}

// ==========================================
// 📱 MOBILE BACK BUTTON FIX (Receipt Viewer)
// ==========================================

function viewFullReceipt(base64Image) {
    // 1. Create Modal on the fly if it doesn't exist
    let modal = document.getElementById('receipt-view-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'receipt-view-modal';
        modal.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.95); z-index:99999; display:none; justify-content:center; align-items:center; flex-direction:column;";
        
        modal.innerHTML = `
            <button onclick="closeReceiptModal()" style="position:absolute; top:20px; right:20px; background:rgba(255,0,0,0.8); color:white; border:none; width:40px; height:40px; border-radius:50%; font-size:20px; cursor:pointer; font-weight:bold;">✕</button>
            <img id="receipt-dynamic-img" src="" style="max-width:100%; max-height:85%; object-fit:contain; border-radius:4px;">
            <p style="color:#ccc; margin-top:10px; font-size:12px;">(Press Back to Close)</p>
        `;
        document.body.appendChild(modal);
    }

    // 2. Show Image
    const img = document.getElementById('receipt-dynamic-img');
    img.src = base64Image;
    modal.style.display = 'flex';

    // 3. MAGIC FIX: Push a new state to history
    // This makes the browser think we went to a new page, so "Back" button works
    history.pushState({ modal: 'receipt' }, 'View Receipt', '#view-receipt');
}

function closeReceiptModal() {
    const modal = document.getElementById('receipt-view-modal');
    if (modal && modal.style.display !== 'none') {
        // If the URL has the hash, go back (this triggers the popstate listener below)
        if (window.location.hash === '#view-receipt') {
            history.back(); 
        } else {
            // Fallback: just hide it
            modal.style.display = 'none';
        }
    }
}

// 4. Listen for the Physical Back Button
window.addEventListener('popstate', function(event) {
    const modal = document.getElementById('receipt-view-modal');
    // If modal is open, the back button just closes it
    if (modal && modal.style.display !== 'none') {
        modal.style.display = 'none';
        // We do NOT exit the app because the 'back' event was consumed by the hash change
    }
});

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
    const isBanned = u.disabled === true;

    // Generate dynamic badges for all active courses
    let statusHtml = "";
    Object.keys(COURSE_CONFIG).forEach(key => {
        const conf = COURSE_CONFIG[key];
        // Check if user has this specific course active
        const isPrem = u[conf.prefix + 'isPremium'];
        const expiry = u[conf.prefix + 'expiryDate'];
        
        if (isPrem && isDateActive(expiry)) {
            statusHtml += `<div style="background:#dcfce7; color:#166534; padding:5px 8px; border-radius:6px; font-size:11px; margin-bottom:5px; border:1px solid #bbf7d0;">
                ✅ <b>${conf.name}</b> Active
            </div>`;
        }
    });

    if(statusHtml === "") statusHtml = `<div style="color:#64748b; font-size:12px;">No active subscriptions.</div>`;

    return `
    <div class="user-card">
        <div style="margin-bottom:15px;">
            <button onclick="loadAllUsers()" style="background:#64748b; color:white; border:none; padding:5px 10px; border-radius:4px; font-size:12px; cursor:pointer;">⬅ Back to Users List</button>
        </div>

        <h3>${u.email}</h3>
        <p style="font-size:12px; color:#666;">UID: ${doc.id}</p>
        
        <div style="background:#f8fafc; padding:15px; border-radius:8px; margin:15px 0; border:1px solid #e2e8f0;">
            <strong>Current Status:</strong><br>
            ${statusHtml}
        </div>
        
        <hr style="border:0; border-top:1px solid #eee; margin:15px 0;">

        <h4>Grant Subscription</h4>
        <div style="display:flex; gap:5px; flex-direction:column;">
            <label style="font-size:11px; font-weight:bold; color:#64748b;">Select Course:</label>
            <select id="adm-c-${doc.id}" style="padding:8px; border:1px solid #ccc; border-radius:4px; width:100%;">
                ${getCourseOptionsHTML('FCPS')}
            </select>

            <label style="font-size:11px; font-weight:bold; color:#64748b; margin-top:5px;">Duration:</label>
            <select id="adm-p-${doc.id}" style="padding:8px; border:1px solid #ccc; border-radius:4px; width:100%;">
                <option value="1_day">1 Day</option>
                <option value="1_week">1 Week</option>
                <option value="15_days">15 Days</option>
                <option value="1_month">1 Month</option>
                <option value="3_months">3 Months</option>
                <option value="6_months">6 Months</option>
                <option value="12_months">12 Months</option>
                <option value="lifetime">Lifetime</option>
            </select>

            <button onclick="adminGrantPremium('${doc.id}')" style="margin-top:10px; background:#10b981; color:white; border:none; padding:10px; border-radius:6px; cursor:pointer; font-weight:bold;">✅ Grant Access</button>
        </div>

        <hr style="border:0; border-top:1px solid #eee; margin:15px 0;">

        <h4>Danger Zone</h4>
        <div style="display:flex; gap:10px;">
            <button onclick="adminRevokePremium('${doc.id}')" style="background:#f59e0b; color:white; border:none; padding:8px; border-radius:4px; cursor:pointer;">🚫 Revoke All</button>
            ${isBanned 
                ? `<button onclick="adminToggleBan('${doc.id}', false)" style="background:#10b981; color:white; border:none; padding:8px; border-radius:4px; cursor:pointer;">✅ Unban User</button>`
                : `<button onclick="adminToggleBan('${doc.id}', true)" style="background:#ef4444; color:white; border:none; padding:8px; border-radius:4px; cursor:pointer;">⛔ Ban User</button>`
            }
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

    // ... (Existing code for Email/Name inputs remains the same) ...
    document.getElementById('profile-email').innerText = currentUser.email;
    document.getElementById('edit-name').value = freshData.displayName || "";
    document.getElementById('edit-phone').value = freshData.phone || "";
    document.getElementById('edit-college').value = freshData.college || "";
    document.getElementById('edit-exam').value = freshData.targetExam || "FCPS-1";
    
    // Username Logic (Keep existing)
    const userInput = document.getElementById('edit-username');
    if (freshData.username) {
        userInput.value = freshData.username;
        userInput.disabled = true; 
        userInput.style.backgroundColor = "#f1f5f9"; 
    } else {
        userInput.value = ""; 
        userInput.disabled = false; 
        userInput.style.backgroundColor = "white"; 
    }

    let joinDateRaw = freshData.joined || currentUser.metadata.creationTime;
    let joinDateObj = parseDateRobust(joinDateRaw);
    document.getElementById('profile-joined').innerText = joinDateObj ? formatDateHelper(joinDateObj) : "N/A";

    const planElem = document.getElementById('profile-plan');
    const expiryElem = document.getElementById('profile-expiry');

    // --- FIX: USE CORRECT PREFIX AND NAME ---
    const currentConfig = COURSE_CONFIG[currentCourse]; // Get Config for current course
    const prefix = currentConfig.prefix;
    const readableName = currentConfig.name;

    const isPrem = freshData[prefix + 'isPremium'];
    const expiryRaw = freshData[prefix + 'expiryDate'];
    
    if (isPrem) {
        planElem.innerText = `${readableName} PREMIUM 👑`; // <--- Now says "First Year PREMIUM"
        if (isDateActive(expiryRaw)) {
             expiryElem.innerText = formatDateHelper(expiryRaw);
             expiryElem.style.color = "#d97706";
        } else {
             expiryElem.innerText = "Expired";
             expiryElem.style.color = "red";
        }
    } else {
        planElem.innerText = `${readableName} Free Plan`;
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
        // ISOLATED STATS: Uses the correct key (e.g., MBBS1_stats)
        const stats = doc.data()[getStoreKey('stats')] || {};
        
        // --- FIX: Use the readable name (e.g. "First Year") from config ---
        const displayName = COURSE_CONFIG[currentCourse].name; 
        
        let html = `<div class="perf-section-title">📊 ${displayName} Performance</div>`;
        
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

        html += `<div class="perf-section-title" style="margin-top:30px;">📜 Recent ${displayName} Exams</div>
                 <table class="exam-table">
                    <thead><tr><th>Date</th><th>Subject</th><th>Score</th></tr></thead>
                    <tbody>`;
        
        // 1. FETCH MORE RECORDS 
        const snaps = await db.collection('users').doc(currentUser.uid)
            .collection('results')
            .orderBy('date','desc')
            .limit(20) 
            .get();
        
        // 2. FILTER THE RECORDS 
        const allResults = snaps.docs.map(doc => doc.data());
        // We filter by checking if the saved subject contains our current course key (e.g. MBBS_1)
        const filteredResults = allResults.filter(r => r.subject && r.subject.includes(currentCourse));

        // 3. CHECK IF EMPTY AFTER FILTERING
        if(filteredResults.length === 0) {
            html += `<tr><td colspan="3">No ${displayName} exams yet.</td></tr>`;
        } else {
            // 4. DISPLAY ONLY FILTERED RESULTS (Show max 5)
            filteredResults.slice(0, 5).forEach(d => {
                const dateStr = d.date ? formatDateHelper(parseDateRobust(d.date)) : "-";
                const scoreColor = d.score < 50 ? "red" : (d.score >= 70 ? "green" : "#1e293b");
                
                html += `<tr>
                    <td>${dateStr}</td>
                    <td>${d.subject}</td>
                    <td style="color:${scoreColor}; font-weight:bold;">${d.score}%</td>
                </tr>`;
            });
        }

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

// ==========================================
// FIX 1: NAVIGATION & EXIT LOGIC
// ==========================================

function goHome() {
    // 1. Stop Timer
    if (testTimer) {
        clearInterval(testTimer);
        testTimer = null;
    }

    // 2. Reset State
    currentMode = 'practice';
    testAnswers = {};
    testFlags = {};
    
    // 3. Hide Quiz Elements
    const timerEl = document.getElementById('timer');
    if(timerEl) timerEl.classList.add('hidden');
    
    const sidebar = document.getElementById('test-sidebar');
    if(sidebar) sidebar.classList.remove('active');
    
    const practiceNav = document.getElementById('practice-nav-container');
    if(practiceNav) practiceNav.classList.add('hidden');

    // 4. CRITICAL FIX: Reload User Data to update counters (Mistakes/Bookmarks)
    loadUserData(); 

    // 5. Go to Dashboard
    showScreen('dashboard-screen');
}
// ==========================================
// FIX: REPORTING SYSTEM
// ==========================================
function openReportModal(questionId) {
    // 1. Find the question object to get the text for context
    const q = allQuestions.find(item => item._uid === questionId);
    if(!q) return alert("Error identifying question.");

    // 2. Set the hidden ID and clear previous text
    document.getElementById('report-q-id').value = questionId;
    document.getElementById('report-text').value = "";
    
    // 3. Show Modal with Animation
    const modal = document.getElementById('report-modal');
    modal.classList.remove('hidden'); // Make it display: flex
    
    // Small delay allows the browser to realize it's visible before starting the animation
    setTimeout(() => {
        modal.classList.add('active'); // Triggers opacity: 1 and slide up
    }, 10);
}

async function submitReportFinal() {
    const text = document.getElementById('report-text').value;
    const qId = document.getElementById('report-q-id').value;
    
    if (!text) return alert("Please describe the issue.");

    // 1. Get Readable Course Name (e.g. "Final Year")
    const courseName = COURSE_CONFIG[currentCourse] ? COURSE_CONFIG[currentCourse].name : currentCourse;

    // 2. Calculate Google Sheet Row
    // The array starts at 0. In Sheets, Row 1 is Header. So Data starts at Row 2.
    // Logic: Array Index + 2 = Excel Row
    const rowIndex = allQuestions.findIndex(q => q._uid === qId);
    const excelRow = (rowIndex !== -1) ? (rowIndex + 2) : "Unknown";

    // 3. Prepare the Report
    const reportData = {
        questionId: qId,
        excelRow: excelRow,        // <--- NEW: The exact row in your sheet
        courseId: currentCourse,   // e.g. MBBS_5
        courseName: courseName,    // <--- NEW: e.g. Final Year
        issue: text,
        reportedBy: currentUser ? currentUser.email : 'Guest',
        timestamp: new Date(),
        status: 'open'
    };

    // 4. Save to Database
    try {
        await db.collection('reports').add(reportData);
        
        // UI Cleanup
        document.getElementById('report-modal').classList.remove('active');
        setTimeout(() => document.getElementById('report-modal').classList.add('hidden'), 300);
        document.getElementById('report-text').value = "";
        
        // Helper Message for You
        alert(`✅ Report Sent!\n\n(Note for Admin: This is Row ${excelRow} in the ${courseName} sheet)`);
        
    } catch (e) {
        alert("Error sending report: " + e.message);
    }
}

async function resetAccountData() {
    if (!currentUser || isGuest) return alert("Guests cannot reset progress.");

    // 1. Confirm deletion
    const confirmed = confirm(`⚠️ FINAL WARNING: This will delete ALL progress for ${currentCourse}.\n\n- Exam History will be wiped.\n- All Solved questions will be lost.\n- Mistakes list will be cleared.\n- Stats/Accuracy will be reset.\n\nAre you sure?`);
    
    if (!confirmed) return;

    const btn = event.target;
    const oldText = btn.innerText;
    btn.innerText = "Deleting...";
    btn.disabled = true;

    try {
        const userRef = db.collection('users').doc(currentUser.uid);
        
        // --- STEP 1: Wipe Main Profile Data (Solved, Mistakes, Stats) ---
        const sKey = getStoreKey('solved');
        const mKey = getStoreKey('mistakes');
        const bKey = getStoreKey('bookmarks');
        const statKey = getStoreKey('stats');

        // We use a Batch to do everything together safely
        const batch = db.batch();

        batch.update(userRef, {
            [sKey]: [],        // Clear Solved
            [mKey]: [],        // Clear Mistakes
            [bKey]: [],        // Clear Bookmarks
            [statKey]: {}      // Clear Stats Object
        });

        // --- STEP 2: Wipe Exam History (The Missing Part) ---
        // We must query the results collection and delete docs that match the current course
        const resultsSnapshot = await userRef.collection('results').get();
        
        let deletedCount = 0;
        
        resultsSnapshot.forEach(doc => {
            const data = doc.data();
            // Only delete results that belong to the current course (FCPS or MBBS)
            if (data.subject && data.subject.includes(currentCourse)) {
                batch.delete(doc.ref);
                deletedCount++;
            }
        });

        // --- STEP 3: Commit All Deletes ---
        await batch.commit();

        alert(`✅ Reset Complete!\n\nDeleted ${deletedCount} exam records and all progress for ${currentCourse}.`);
        window.location.reload();

    } catch (e) {
        console.error(e);
        alert("Error resetting data: " + e.message);
        btn.innerText = oldText;
        btn.disabled = false;
    }
}

// --- HELPER: Generate Dropdown Options for Admin ---
function getCourseOptionsHTML(selectedValue) {
    let html = "";
    // Loop through every course in your config (FCPS, MBBS_1, MBBS_2, etc.)
    Object.keys(COURSE_CONFIG).forEach(key => {
        const course = COURSE_CONFIG[key];
        const isSelected = (key === selectedValue) ? "selected" : "";
        html += `<option value="${key}" ${isSelected}>${course.name}</option>`;
    });
    return html;
}

// =========================================================
// 🎮 UNIVERSAL INPUT MANAGER (v6 - Bookmarks & Double Tap)
// =========================================================

// --- 1. CONFIGURATION ---
const SWIPE_THRESHOLD = 40; 
const DOUBLE_TAP_DELAY = 300; // Time in ms to count as double tap
let touchStartX = 0, touchStartY = 0;
let lastTapTime = 0; // Tracks the last time you tapped

// --- 2. KEYBOARD LISTENER ---
document.addEventListener('keydown', function(e) {
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

    // --- A. BOOKMARK SHORTCUT (Key: 'S') ---
    if (e.key.toLowerCase() === 's') {
        // Look for bookmark button by ID or Icon/Text
        const bookmarkBtn = findButton('bookmark-btn', ['Bookmark', 'Save', '⭐', '★', 'Mark']);
        triggerElement(bookmarkBtn);
    }

    // --- B. SMART ESCAPE (Close Popup OR Exit) ---
    if (e.key === 'Escape') {
        if (closeActivePopups()) return;
        const exitBtn = findButton('exit-btn', ['Exit', 'Quit']);
        if (exitBtn) exitBtn.click();
        else if (typeof goHome === 'function') goHome();
        return;
    }

    // --- C. NAVIGATION (Arrow Keys) ---
    if (e.key === 'ArrowRight') {
        closeActivePopups(); 
        triggerElement(findButton('next-btn', ['Next', '→', 'Skip', '>']));
    }
    if (e.key === 'ArrowLeft') {
        closeActivePopups();
        triggerElement(findButton('prev-btn', ['Prev', 'Back', '←', '<']));
    }

    // --- D. OPTIONS (1-5) ---
    const keyMap = {'1':0, '2':1, '3':2, '4':3, '5':4};
    if (keyMap.hasOwnProperty(e.key)) {
        const options = document.querySelectorAll('.option-btn, .answer-btn, #options-container button');
        if (options[keyMap[e.key]]) triggerElement(options[keyMap[e.key]]);
    }
});

// --- 3. TOUCH LISTENERS (Swipe + Double Tap) ---
window.addEventListener('touchstart', e => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
}, {passive: false});

window.addEventListener('touchend', e => {
    const nextBtn = document.getElementById('next-btn'); 
    // Only run if we are in a quiz session
    if (!nextBtn || nextBtn.offsetParent === null) return;

    const touchEndX = e.changedTouches[0].screenX;
    const touchEndY = e.changedTouches[0].screenY;
    
    const diffX = touchStartX - touchEndX;
    const diffY = touchStartY - touchEndY;
    const currentTime = new Date().getTime();

    // --- CHECK FOR SWIPE (Must be a long movement) ---
    if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > SWIPE_THRESHOLD) {
        closeActivePopups(); 
        if (diffX > 0) triggerElement(findButton('next-btn', ['Next', '→'])); 
        else triggerElement(findButton('prev-btn', ['Prev', 'Back']));
    }
    
    // --- CHECK FOR DOUBLE TAP (Must be very little movement) ---
    else if (Math.abs(diffX) < 10 && Math.abs(diffY) < 10) {
        const tapLength = currentTime - lastTapTime;
        
        if (tapLength < DOUBLE_TAP_DELAY && tapLength > 0) {
            // DOUBLE TAP DETECTED! -> Trigger Bookmark
            e.preventDefault(); // Stop zoom
            const bookmarkBtn = findButton('bookmark-btn', ['Bookmark', 'Save', '⭐', '★']);
            triggerElement(bookmarkBtn);
        }
        lastTapTime = currentTime;
    }

}, {passive: false});

// --- 4. HELPER FUNCTIONS ---

function closeActivePopups() {
    const popupIds = ['explanation-modal', 'explanation-box', 'modal-overlay'];
    let closedSomething = false;

    popupIds.forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.classList.contains('hidden')) {
            el.classList.add('hidden'); 
            closedSomething = true;
        }
    });

    if (!closedSomething) {
        const openModals = document.querySelectorAll('.modal:not(.hidden), .popup:not(.hidden)');
        openModals.forEach(m => { m.classList.add('hidden'); closedSomething = true; });
    }
    return closedSomething;
}

function findButton(id, keywords) {
    let btn = document.getElementById(id);
    if (isValid(btn)) return btn;
    const all = document.querySelectorAll('button, .btn, i, span'); // Also check icons
    for (let b of all) {
        // Check text OR title attribute (for icon-only buttons)
        const text = (b.innerText || "") + (b.title || ""); 
        if (isValid(b) && keywords.some(k => text.includes(k))) return b;
    }
    return null;
}

function isValid(el) { return el && !el.disabled && el.offsetParent !== null; }

function triggerElement(el) {
    if (el) {
        el.click();
        el.classList.add('simulate-active'); // Add CSS class for visual effect
        setTimeout(() => el.classList.remove('simulate-active'), 150);
    }
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}


function showMbbsYears() {
    document.getElementById('main-menu-container').classList.add('hidden');
    document.getElementById('mbbs-years-container').classList.remove('hidden');
}

function backToMainMenu() {
    document.getElementById('mbbs-years-container').classList.add('hidden');
    document.getElementById('main-menu-container').classList.remove('hidden');
}

// ======================================================
// 6. ADMIN ACTIONS (Paste at the very bottom of script.js)
// ======================================================

// --- REPORT ACTIONS ---
async function resolveReport(id) {
    if(!confirm("Mark this issue as resolved?")) return;
    try {
        await db.collection('reports').doc(id).update({ status: 'resolved' });
        alert("✅ Issue marked as resolved.");
        loadAdminReports(); // Refresh the list
    } catch(e) { alert("Error: " + e.message); }
}

async function deleteReport(id) {
    if(!confirm("Delete this report permanently?")) return;
    try {
        await db.collection('reports').doc(id).delete();
        alert("🗑️ Report deleted.");
        loadAdminReports(); // Refresh the list
    } catch(e) { alert("Error: " + e.message); }
}

// --- KEY ACTIONS ---
async function deleteKey(id) {
    if(!confirm("Delete this activation key?")) return;
    try {
        await db.collection('activation_keys').doc(id).delete();
        loadAdminKeys(); // Refresh the list
    } catch(e) { alert("Error: " + e.message); }
}

// --- PAYMENT ACTIONS ---
async function rejectPayment(id) {
    if(!confirm("Reject this payment request?")) return;
    try {
        await db.collection('payment_requests').doc(id).update({ status: 'rejected' });
        alert("❌ Request rejected.");
        loadAdminPayments(); // Refresh the list
    } catch(e) { alert("Error: " + e.message); }
}

// ======================================================
// 7. PWA INSTALL LOGIC
// ======================================================
let deferredPrompt; // Variable to store the install event

// 1. Listen for the browser saying "This app can be installed!"
window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent the mini-infobar from appearing on mobile
    e.preventDefault();
    // Stash the event so it can be triggered later.
    deferredPrompt = e;
    
    // Show the install button (if it was hidden)
    const installBtn = document.getElementById('install-btn');
    if (installBtn) {
        installBtn.style.display = 'block';
        installBtn.innerHTML = "📱 Install App";
    }
    console.log("✅ App is ready to install!");
});

// 2. Handle the Button Click
const installBtn = document.getElementById('install-btn');
if(installBtn) {
    installBtn.addEventListener('click', async () => {
        if (!deferredPrompt) {
            alert("App is already installed or not supported in this browser. \n\n(Try using Chrome or Safari's 'Add to Home Screen' option).");
            return;
        }
        
        // Show the install prompt
        deferredPrompt.prompt();
        
        // Wait for the user to respond to the prompt
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`User response to the install prompt: ${outcome}`);
        
        // We've used the prompt, so clear it
        deferredPrompt = null;
    });
}

// 3. Detect if App is already installed
window.addEventListener('appinstalled', () => {
    // Hide the install button
    const installBtn = document.getElementById('install-btn');
    if (installBtn) installBtn.style.display = 'none';
    
    // Clear the prompt
    deferredPrompt = null;
    console.log('✅ PWA was installed');
});
