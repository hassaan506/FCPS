// ======================================================
// PWA & OFFLINE SETUP
// ======================================================
if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker
            .register("sw.js")
            .then((reg) => console.log("✅ Service Worker Registered"))
            .catch((err) => console.log("❌ SW Failed:", err));
    });
}

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

// Initialize Firebase
if (typeof firebase !== 'undefined' && !firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);

    // ✅ ADD THIS BLOCK: This saves the "Pending Queue" to the phone's hard drive
    firebase.firestore().enablePersistence()
        .catch((err) => {
            if (err.code == 'failed-precondition') {
                console.log("Offline mode failed: Multiple tabs open.");
            } else if (err.code == 'unimplemented') {
                console.log("Browser doesn't support offline storage.");
            }
        });

} else if (typeof firebase === 'undefined') {
    alert("CRITICAL ERROR: Firebase SDK not loaded.");
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

let selectedSubjectForModal = ""; 
let selectedExamTopics = [];
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
let userListener = null;
auth.onAuthStateChanged(async (user) => {
    if (user) {
        currentUser = user;
        isGuest = false;
        
        const authScreen = document.getElementById('auth-screen');
        if(authScreen) {
            authScreen.classList.add('hidden');
            authScreen.classList.remove('active');
        }

        const lastCourse = localStorage.getItem('last_active_course');
        
        // 🔥 NEW LOGIC: Check if the Admin Panel should be the priority
        const adminScreen = document.getElementById('admin-screen');
        const isAdminActive = localStorage.getItem('admin_mode') === 'true';

        if (isAdminActive) {
            // Stay on Admin Screen and just load the data in the background
            if (lastCourse && COURSE_CONFIG[lastCourse]) {
                currentCourse = lastCourse;
                loadQuestions(COURSE_CONFIG[lastCourse].sheet);
                loadUserData();
            }
        } 
        else if (lastCourse && COURSE_CONFIG[lastCourse]) {
            // Standard Auto-Redirect to Dashboard
            selectCourse(lastCourse); 
        } 
        else {
            showScreen('course-selection-screen');
            if(document.getElementById('course-selection-screen')) {
                updateCourseSelectionUI();
            }
        }
        
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
    
    // 🔥 NEW: Save this course to memory
    localStorage.setItem('last_active_course', courseName);

    currentCourse = courseName;
    const config = COURSE_CONFIG[courseName];

    // ... (rest of your existing code below is fine) ...
    // 1. Apply Visual Theme
    document.body.className = config.theme; 
    
    // 2. Update Header
    const badge = document.getElementById('active-course-badge');
    if(badge) badge.innerText = config.name; 
    
    const title = document.getElementById('stats-title');
    if(title) title.innerText = `📊 ${config.name} Progress`; 

    // 3. Load Data & Dashboard (Your existing admin check)
    const adminScreen = document.getElementById('admin-screen');
    const isAdminActive = adminScreen && 
                          !adminScreen.classList.contains('hidden') && 
                          adminScreen.style.display !== 'none';

    if (!isAdminActive) {
        showScreen('dashboard-screen');
    } else {
        console.log("✅ Admin Panel is open: Staying on Admin Screen...");
    }
    
    // Reset Data
    allQuestions = [];
    filteredQuestions = [];
    
    loadQuestions(config.sheet); 
    loadUserData(); 
}

function returnToCourseSelection() {
    // 🔥 NEW: Clear saved course so the menu appears next time
    localStorage.removeItem('last_active_course');

    // 1. Fix: Unhide the menu container if Admin Panel hid it
    const menu = document.getElementById('main-menu-container');
    if(menu) {
        menu.style.display = ''; 
        menu.classList.remove('hidden');
    }

    // 2. Ensure MBBS sub-menu is reset
    const mbbsContainer = document.getElementById('mbbs-years-container');
    if(mbbsContainer) {
        mbbsContainer.style.display = ''; 
        mbbsContainer.classList.add('hidden');
    }

    // 3. Proceed as normal
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

    // --- 1. USERNAME LOOKUP LOGIC ---
    // (This part often fails offline because it needs to search the DB)
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
            // If offline, the DB search fails. Tell user to try Email.
            if (e.message.includes('offline') || e.code === 'unavailable') {
                 alert("⚠️ Offline Mode Limitation\n\nWe cannot search for Usernames while offline.\nPlease try logging in with your EMAIL address instead.");
                 msg.innerText = "❌ Offline: Use Email to login.";
            } else {
                 msg.innerText = "Login Error: " + e.message;
            }
            return;
        }
    }
    
    // --- 2. AUTHENTICATION LOGIC ---
    auth.signInWithEmailAndPassword(emailToUse, p)
        .then(() => {
            msg.innerText = "✅ Success! Loading...";
            // onAuthStateChanged will handle the redirect
        })
        .catch(err => {
            console.error("Login Failed:", err);
            
            // ✅ SPECIFIC OFFLINE ERROR HANDLING
            if (err.code === 'auth/network-request-failed') {
                alert("⚠️ CONNECTION REQUIRED\n\nYou are currently OFFLINE.\n\nYou must connect to the internet to Log In.\n(Once logged in, you can go offline anytime).");
                msg.innerText = "❌ Offline. Please connect to internet.";
            } else if (err.code === 'auth/wrong-password') {
                msg.innerText = "❌ Incorrect Password.";
            } else if (err.code === 'auth/user-not-found') {
                msg.innerText = "❌ User not found.";
            } else {
                msg.innerText = "❌ " + err.message;
            }
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

async function logout() {
    console.log("👋 Logging out & Wiping Session Data...");

    // 1. 🔥 PRESERVE: Save the course preference before wiping memory
    const savedCourse = localStorage.getItem('last_active_course');

    try {
        // 2. Firebase SignOut (Wait for it to finish)
        await firebase.auth().signOut();

        // 3. 🔥 HARD WIPE: Clear Admin Cache & DOM
        if (typeof adminUsersCache !== 'undefined') {
            adminUsersCache = {}; 
        }
        
        const adminList = document.getElementById('admin-user-result');
        if (adminList) adminList.innerHTML = "";

        // 4. Reset Global Variables
        currentUser = null;
        userProfile = null;
        isGuest = false;

        // 5. 🔥 SECURITY WIPE: Clear ALL Local Storage
        // This is safer than removing items one by one
        localStorage.clear(); 

        // 6. 🔥 RESTORE: Put the course preference back
        if (savedCourse) {
            localStorage.setItem('last_active_course', savedCourse);
        }

        // 7. Reset UI: Hide all screens, show Auth
        document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
        document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden'));
        document.getElementById('auth-screen').classList.remove('hidden');

        // 8. Force Reload (To ensure a completely fresh state)
        setTimeout(() => {
            window.location.reload();
        }, 100);

    } catch (e) {
        console.error("Logout Error:", e);
        // If Firebase fails, force reload anyway
        window.location.reload();
    }
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
    // ✅ 1. Guest Mode Handling (Show Message instead of returning)
    if (isGuest) {
        const statsBox = document.getElementById('quick-stats');
        if(statsBox) {
            statsBox.style.opacity = "1";
            statsBox.innerHTML = `
                <div style="text-align:center; padding:15px; color:#64748b; font-size:13px; background:#f8fafc; border-radius:8px; border:1px dashed #cbd5e1;">
                    🔒 Please login to save your progress
                </div>`;
        }
        // NOW we return, after updating the UI
        return;
    }
    
    // 2. Wait for Auth to be ready (for logged-in users)
    if (!currentUser) { setTimeout(loadUserData, 500); return; }

    if (currentUser.displayName) {
        const nameDisplay = document.getElementById('user-display');
        if(nameDisplay) nameDisplay.innerText = currentUser.displayName;
    }

    const statsBox = document.getElementById('quick-stats');
    if(statsBox) statsBox.style.opacity = "0.5";

    let freshData = null;

    // --- 3. TRY LOADING FROM INTERNET ---
    try {
        // We set a short timeout so the app doesn't freeze waiting for internet
        const doc = await db.collection('users').doc(currentUser.uid).get({ source: 'default' });
        if (doc.exists) {
            freshData = doc.data();
            console.log("✅ Online: Profile Loaded");
            // SAVE to phone memory for next time
            localStorage.setItem('cached_user_profile', JSON.stringify(freshData));
        }
    } catch (e) {
        console.log("⚠️ Internet Failed. Switching to Offline Mode...");
    }

    // --- 4. IF INTERNET FAILED, LOAD FROM PHONE ---
    if (!freshData) {
        const cached = localStorage.getItem('cached_user_profile');
        if (cached) {
            console.log("✅ Offline: Loaded Saved Profile");
            freshData = JSON.parse(cached);
        } else {
            console.log("❌ No internet and no saved profile.");
            if(statsBox) statsBox.innerHTML = "<div style='color:red; font-size:12px;'>Offline & No Data. Please connect once.</div>";
            return;
        }
    }

    // Apply the data
    userProfile = freshData;

    // Load arrays safely
    userSolvedIDs = userProfile[getStoreKey('solved')] || [];
    userBookmarks = userProfile[getStoreKey('bookmarks')] || [];
    userMistakes = userProfile[getStoreKey('mistakes')] || [];

    // Update Stats UI
    renderStatsUI(statsBox); // (Helper function below to keep this clean)

    // Check Expiry & Process Questions
    updateBadgeButton();
    checkPremiumExpiry();
    if (allQuestions.length > 0) processData(allQuestions, true);
}
// Helper to draw the stats box
function renderStatsUI(statsBox) {
    if(!statsBox) return;
    
    let totalAttempts = 0, totalCorrect = 0;
    const statsObj = userProfile[getStoreKey('stats')] || {};
    Object.values(statsObj).forEach(s => { totalAttempts += (s.total||0); totalCorrect += (s.correct||0); });
    const accuracy = totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : 0;

    const config = COURSE_CONFIG[currentCourse];
    const displayName = config ? config.name : currentCourse;

    statsBox.style.opacity = "1";
    statsBox.innerHTML = `
        <div style="margin-top:5px; font-size:14px; line-height:1.8;">
            <div>✅ ${displayName} Solved: <b style="color:var(--primary);">${userSolvedIDs.length}</b></div>
            <div>🎯 Accuracy: <b>${accuracy}%</b> <span style="font-size:11px; color:#666;">(${totalCorrect}/${totalAttempts})</span></div>
            <div style="color:var(--danger);">❌ Pending Mistakes: <b>${userMistakes.length}</b></div>
            <div style="color:#f59e0b;">⭐ Bookmarked: <b>${userBookmarks.length}</b></div>
        </div>`;
}

async function updateUserStats(isCorrect, subject, questionUID) {
    // 1. Safety Checks
    if (isGuest || !currentUser) return;
    if (!userProfile) return;

    // 2. Initialize Stats
    const storeKey = getStoreKey('stats'); 
    if (!userProfile[storeKey]) userProfile[storeKey] = {};
    if (!userProfile[storeKey][subject]) userProfile[storeKey][subject] = { total: 0, correct: 0 };

    // 3. Update Counts
    userProfile[storeKey][subject].total += 1;
    if (isCorrect) userProfile[storeKey][subject].correct += 1;

    // 4. Update Lists (The Database Object)
    const solvedKey = getStoreKey('solved');     
    const mistakesKey = getStoreKey('mistakes'); 
    
    if (!userProfile[solvedKey]) userProfile[solvedKey] = [];
    if (!userProfile[mistakesKey]) userProfile[mistakesKey] = [];

    // Add to 'Solved' Database Object
    if (!userProfile[solvedKey].includes(questionUID)) {
        userProfile[solvedKey].push(questionUID);
    }

    // ============================================================
    // ✅ 4.5. CRITICAL FIX: SYNC LIVE GLOBAL VARIABLES
    // This makes the Navigator change color WITHOUT refreshing
    // ============================================================
    
    // A. Sync Solved (Green)
    // We check if the global array exists, then update it
    if (typeof userSolvedIDs !== 'undefined' && !userSolvedIDs.includes(questionUID)) {
        userSolvedIDs.push(questionUID);
    }

    // B. Sync Mistakes (Red)
    if (!isCorrect) {
        // Database Object
        if (!userProfile[mistakesKey].includes(questionUID)) {
            userProfile[mistakesKey].push(questionUID);
        }
        // ✅ Live Global Variable (Updates Navigator Red)
        if (typeof userMistakes !== 'undefined' && !userMistakes.includes(questionUID)) {
            userMistakes.push(questionUID);
        }
    } else {
        // If Correct...
        if (isMistakeReview === true) {
            // Remove from Database Object
            userProfile[mistakesKey] = userProfile[mistakesKey].filter(id => id !== questionUID);
            
            // ✅ Remove from Live Global Variable
            if (typeof userMistakes !== 'undefined') {
                const idx = userMistakes.indexOf(questionUID);
                if (idx > -1) userMistakes.splice(idx, 1);
            }
        }
        // Normal Mode: We do nothing (It stays in history)
    }
    // ============================================================


    // 5. Save to Phone Memory
    localStorage.setItem('cached_user_profile', JSON.stringify(userProfile));

    // 6. Sync to Cloud
    try {
        await db.collection('users').doc(currentUser.uid).update({
            [storeKey]: userProfile[storeKey],
            [solvedKey]: userProfile[solvedKey],
            [mistakesKey]: userProfile[mistakesKey]
        });
    } catch (e) {
        console.log("⚠️ Saved locally (Queueing for Cloud)");
    }

    // 7. 🔥 OPTIONAL: INSTANT UI PAINT
    // If you want the button to change color instantly before any other logic runs:
    try {
        // Assuming your navigator buttons have IDs like 'nav-btn-0', 'nav-btn-1'
        const navBtn = document.getElementById(`nav-btn-${currentIndex}`);
        if(navBtn) {
            if(isCorrect) {
                navBtn.classList.add('solved');
                if(isMistakeReview) navBtn.classList.remove('mistake');
            } else {
                navBtn.classList.add('mistake');
            }
        }
    } catch(err) { console.log("UI Paint error", err); }
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
// 5. UNIFIED ADMIN USER MANAGEMENT (Super Admin + Promote/Demote)
// ======================================================

// 🔒 SECURITY: Your Specific UID. 
// You cannot be banned, deleted, or have admin removed.
const SUPER_ADMIN_ID = "2eDvczf0OVdUdFEYLa1IjvzKrb32"; 

let adminUsersCache = {}; 

async function loadAllUsers() {
    console.log("🚀 Loading Users...");

    window.scrollTo(0, 0);

    const list = document.getElementById('admin-user-result');
    const searchInput = document.getElementById('admin-user-input');
    const searchVal = searchInput ? searchInput.value.trim().toLowerCase() : "";

    if (!list) return alert("❌ Error: 'admin-user-result' missing.");

    list.style.maxHeight = "60vh";
    list.style.overflowY = "auto";

    list.innerHTML = `
        <div style="text-align:center; padding:30px; color:#64748b;">
            <div style="font-size:24px; margin-bottom:10px;">⏳</div>
            <b>Fetching Database...</b>
        </div>
    `;

    try {
        const snap = await db.collection('users').get();
        if (snap.empty) {
            list.innerHTML = `<div style="padding:20px; text-align:center;">No users found.</div>`;
            return;
        }

        adminUsersCache = {};
        const now = Date.now();

        let admins = [];
        let users = [];

        let visibleCount = 0;
        let guestCount = 0;
        let ghostCount = 0;

        for (const doc of snap.docs) {
            const u = doc.data();
            const uid = doc.id;

            if (u.role === 'guest') { guestCount++; continue; }
            if (!u.email) { ghostCount++; continue; }

            const email = u.email.toLowerCase();
            const name = (u.displayName || "").toLowerCase();
            const idStr = uid.toLowerCase();

            if (
                searchVal === "" ||
                email.includes(searchVal) ||
                name.includes(searchVal) ||
                idStr.includes(searchVal)
            ) {
                visibleCount++;
                adminUsersCache[uid] = doc;

                // --------- PLAN LOGIC FOR MULTIPLE PREMIUM COURSES (PILLS) ---------
                let displayPlan = `<span style="color:#64748b;">Free</span>`;
                let premiumPillsHTML = "";

                let premiumCourses = [];

                Object.keys(COURSE_CONFIG).forEach(key => {
                    const config = COURSE_CONFIG[key];
                    const prefix = config.prefix;

                    const isPrem = u[prefix + 'isPremium'];
                    const expiryRaw = u[prefix + 'expiryDate'];

                    if (isPrem && isDateActive(expiryRaw)) {
                        const d = (expiryRaw.toDate ? expiryRaw.toDate() : new Date(expiryRaw));
                        const diffMs = d - now;
                        const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
                        const daysText = (daysLeft > 999) ? "Lifetime" : `${daysLeft} days left`;

                        premiumCourses.push({
                            name: config.name,
                            daysLeft: daysText
                        });
                    }
                });

                if (premiumCourses.length > 0) {
                    displayPlan = `<span style="color:#059669; font-weight:600;">Premium</span>`;

                    // Create pill HTML for each premium course
                    premiumPillsHTML = premiumCourses.map(pc => `
                        <span style="
                            display:inline-block;
                            background:#d1fae5;
                            color:#065f46;
                            font-size:10px;
                            font-weight:600;
                            padding:2px 6px;
                            border-radius:12px;
                            margin-right:4px;
                            white-space:nowrap;
                        ">
                            ${pc.name} (${pc.daysLeft})
                        </span>
                    `).join("");
                }

                // --------- ADMIN HIGHLIGHT ---------
                const isAdmin = (u.role === 'Admin' || u.role === 'admin');

                const rowHTML = `
                <div style="
                    background:${isAdmin ? '#f5f3ff' : 'white'}; 
                    border-bottom:1px solid #f1f5f9;
                    padding:12px;
                    display:flex;
                    justify-content:space-between;
                    align-items:center;
                    flex-wrap:wrap;
                ">
                    <div style="flex:1; padding-right:10px;">
                        <div style="font-weight:700; color:#1e293b; font-size:14px; margin-bottom:4px;">
                            ${u.email}
                        </div>

                        <div style="font-size:11px; display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                            <span style="
                                font-weight:700;
                                color:${isAdmin ? '#7e22ce' : '#475569'};
                                text-transform:capitalize;
                            ">
                                ${u.role || 'Student'}
                            </span>
                            <span style="color:#cbd5e1;">|</span>
                            ${displayPlan}
                            ${premiumPillsHTML}
                        </div>
                    </div>

                    <div style="flex:none; display:flex; align-items:center;">
                        <button onclick="openManageUserModal('${uid}')"
                            style="
                                width:32px; height:32px;
                                display:inline-flex;
                                align-items:center;
                                justify-content:center;
                                background:#3b82f6;
                                color:white;
                                border:none;
                                border-radius:6px;
                                cursor:pointer;
                                font-size:16px;
                                padding:0;
                            ">
                            ⚙️
                        </button>
                    </div>
                </div>`;

                if (isAdmin) admins.push(rowHTML);
                else users.push(rowHTML);
            }
        }

        // --------- FINAL RENDER ---------
        list.innerHTML = `
            <div style="padding:10px; font-size:12px; background:#f8fafc; border-bottom:1px solid #e2e8f0; position:sticky; top:0; z-index:10;">
                <b>${visibleCount}</b> Users (Hidden: ${guestCount} | Ghosts: ${ghostCount})
            </div> 
            ${admins.join("")} 
            ${users.join("")}
        `;

    } catch (e) {
        console.error(e);
        list.innerHTML = `<div style="color:red; padding:10px;">Error: ${e.message}</div>`;
    }
}

// 2. SEARCH REDIRECT
function adminLookupUser() { loadAllUsers(); }

// 3. RENDER ROW (With Delete Button & Badges)
function renderCompactUserRow(doc) {
    const u = doc.data();
    const uid = doc.id;

    let badge = `<span style="background:#f1f5f9; color:#64748b; padding:3px 8px; border-radius:12px; font-size:10px; font-weight:600;">FREE</span>`;

    let isPrem = false;
    const now = Date.now();

    // ---------- COURSE-BASED PREMIUM ----------
    Object.keys(COURSE_CONFIG).forEach(k => { 
        const prefix = COURSE_CONFIG[k].prefix;

        if (u[prefix + 'isPremium'] && u[prefix + 'expiryDate']) {
            let expiryMs = null;

            if (typeof u[prefix + 'expiryDate'].toMillis === 'function') {
                expiryMs = u[prefix + 'expiryDate'].toMillis();
            } else {
                expiryMs = new Date(u[prefix + 'expiryDate']).getTime();
            }

            if (expiryMs && expiryMs > now) isPrem = true;
        }
    });

    // ---------- LEGACY PREMIUM ----------
    if (!isPrem && u.isPremium && u.premiumExpiry) {
        let expiryMs = null;

        if (typeof u.premiumExpiry.toMillis === 'function') {
            expiryMs = u.premiumExpiry.toMillis();
        } else {
            expiryMs = new Date(u.premiumExpiry).getTime();
        }

        if (expiryMs && expiryMs > now) isPrem = true;
    }

    // ---------- NEW PLAN-BASED PREMIUM (CRITICAL FIX) ----------
    if (
        !isPrem &&
        u.plan &&
        u.plan.toLowerCase() !== 'free' &&
        u.planExpiry
    ) {
        let expiryMs = null;

        if (typeof u.planExpiry.toMillis === 'function') {
            expiryMs = u.planExpiry.toMillis();
        } else if (typeof u.planExpiry === 'number') {
            expiryMs = u.planExpiry;
        }

        if (expiryMs && expiryMs > now) isPrem = true;
    }

    // ---------- BADGE PRIORITY ----------
    if (isPrem) {
        badge = `<span style="background:#dcfce7; color:#166534; padding:3px 8px; border-radius:12px; font-size:10px; font-weight:600; border:1px solid #bbf7d0;">PREMIUM</span>`;
    }

    if (u.role === 'admin') {
        badge = `<span style="background:#7e22ce; color:white; padding:3px 8px; border-radius:12px; font-size:10px; font-weight:600;">ADMIN</span>`;
    }

    if (u.disabled) {
        badge = `<span style="background:#fee2e2; color:#991b1b; padding:3px 8px; border-radius:12px; font-size:10px; font-weight:600;">BANNED</span>`;
    }

    const displayName = u.displayName || `<span style="color:#ef4444; font-style:italic;">Unknown User</span>`;
    const displayEmail = u.email || `<span style="color:#94a3b8;">${uid}</span>`;

    return `
    <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 15px; border-bottom:1px solid #f1f5f9; background:white;">
        <div style="flex:1;">
            <div style="font-weight:600; color:#334155; font-size:14px;">${displayName}</div>
            <div style="font-size:12px; color:#64748b;">${displayEmail}</div>
        </div>

        <div style="display:flex; align-items:center; gap:8px;">
            ${badge}

            <button onclick="openManageUserModal('${uid}')"
                style="
                    width:32px;
                    height:32px;
                    display:inline-flex;
                    align-items:center;
                    justify-content:center;
                    background:#3b82f6;
                    color:white;
                    border:none;
                    border-radius:6px;
                    cursor:pointer;
                    font-size:16px;
                    padding:0;
                ">
                ⚙️
            </button>

            ${uid === SUPER_ADMIN_ID ? '' : `
                <button onclick="adminDeleteUserDoc('${uid}')"
                    style="background:#fee2e2; color:#991b1b; border:1px solid #fecaca; padding:6px 10px; border-radius:6px; cursor:pointer;">
                    🗑️
                </button>
            `}
        </div>
    </div>`;
}

function openManageUserModal(uid) {
    // 1. SAFETY: Remove any stuck/old modals first
    const existing = document.getElementById('admin-modal');
    if (existing) existing.remove();

    // 2. Get User Data
    const doc = adminUsersCache[uid];
    if (!doc) return alert("Please refresh the list.");
    const u = doc.data();
    
    // 3. Setup Permissions
    const isViewerSuperAdmin = (currentUser.uid === SUPER_ADMIN_ID);
    const isTargetSuperAdmin = (uid === SUPER_ADMIN_ID);
    const isAdmin = (u.role === 'admin' || u.role === 'Admin');

    // 4. GENERATE SUBSCRIPTION LIST (New Card Design)
    let activeSubs = "";
    const now = Date.now();

    Object.keys(COURSE_CONFIG).forEach(key => {
        const conf = COURSE_CONFIG[key];
        const prefix = conf.prefix;
        
        if (u[prefix + 'isPremium']) {
            const rawDate = u[prefix + 'expiryDate'];
            let displayString = "Unknown Date";
            let colorStyle = "color:#64748b; background:#f1f5f9; border:1px solid #e2e8f0;"; // Default Gray
             
            if (rawDate) {
                const d = (rawDate.toDate ? rawDate.toDate() : new Date(rawDate));
                const diffMs = d - now;
                const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
                const dateStr = d.toLocaleDateString('en-GB'); 

                if (daysLeft > 0) {
                    const daysTxt = (daysLeft > 10000) ? "Lifetime" : `${daysLeft} days left`;
                    // Stack date and days vertically for cleaner look
                    displayString = `<div style="font-weight:700; font-size:12px;">${dateStr}</div><div style="font-weight:400; font-size:10px; opacity:0.9;">${daysTxt}</div>`;
                    colorStyle = "color:#15803d; background:#dcfce7; border:1px solid #bbf7d0;"; // Green
                } else {
                    displayString = `<div style="font-weight:700;">${dateStr}</div><div>Expired</div>`;
                    colorStyle = "color:#b91c1c; background:#fee2e2; border:1px solid #fca5a5;"; // Red
                }
            }

            // 🔥 IMPROVED CARD UI
            activeSubs += `
            <div style="
                display: flex;
                justify-content: space-between;
                align-items: center;
                background: #ffffff;
                border: 1px solid #e2e8f0;
                border-radius: 10px;
                padding: 12px;
                margin-bottom: 8px;
                box-shadow: 0 1px 2px rgba(0,0,0,0.03);
                transition: transform 0.1s ease;
            ">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <div style="
                        width: 36px; height: 36px;
                        background: #ecfdf5;
                        color: #059669;
                        border-radius: 50%;
                        display: flex; align-items: center; justify-content: center;
                        font-size: 18px;
                        border: 1px solid #d1fae5;
                    ">✓</div>
                    
                    <div>
                        <div style="font-weight: 700; color: #0f172a; font-size: 14px;">${conf.name}</div>
                        <div style="font-size: 11px; color: #64748b;">Premium Access</div>
                    </div>
                </div>

                <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="
                        ${colorStyle} 
                        padding: 6px 12px; 
                        border-radius: 8px; 
                        font-size: 11px; 
                        text-align: right;
                        min-width: 90px;
                        line-height: 1.3;
                    ">
                        ${displayString}
                    </div>

                    <button onclick="adminRevokeSpecificCourse('${uid}', '${key}')" 
                        title="Revoke Subscription"
                        style="
                            width: 34px; height: 34px;
                            background: #fff1f2;
                            color: #be123c;
                            border: 1px solid #fda4af;
                            border-radius: 8px;
                            cursor: pointer;
                            display: flex; align-items: center; justify-content: center;
                            font-size: 14px;
                            transition: all 0.2s;
                        "
                        onmouseover="this.style.background='#ffe4e6'; this.style.borderColor='#fecaca';"
                        onmouseout="this.style.background='#fff1f2'; this.style.borderColor='#fda4af';"
                    >
                        ✕
                    </button>
                </div>
            </div>`;
        }
    });

    if(!activeSubs) activeSubs = `
        <div style="text-align:center; padding:20px; border:1px dashed #cbd5e1; border-radius:8px; background:#f8fafc;">
            <div style="font-size:20px; margin-bottom:5px;">📂</div>
            <div style="font-size:12px; color:#64748b;">No active subscriptions found.</div>
        </div>
    `;
    
    // 5. Populate Course Options
    let courseOpts = "";
    Object.keys(COURSE_CONFIG).forEach(k => { courseOpts += `<option value="${k}">${COURSE_CONFIG[k].name}</option>`; });
    
    // 6. Action Buttons
    let actionButtons = "";
    if (isTargetSuperAdmin) {
        if (!isViewerSuperAdmin) {
             actionButtons = `<div style="text-align:center; color:#7e22ce; font-weight:bold; padding:10px; background:#f3e8ff; border-radius:6px; border:1px solid #d8b4fe;">👑 This is the Main Admin (Protected).</div>`;
        } else {
             actionButtons = `<div style="text-align:center; font-size:11px; color:#94a3b8; padding:5px; font-style:italic;">(Use X buttons above to revoke subscriptions)</div>`;
        }
    } else {
        const roleBtn = isAdmin 
            ? `<button onclick="adminToggleRole('${uid}', 'student'); closeAdminModal(true);" style="background:#64748b; color:white; padding:10px; border-radius:6px; cursor:pointer; border:none; font-weight:bold;">⬇️ Remove Admin Access</button>`
            : `<button onclick="adminToggleRole('${uid}', 'admin'); closeAdminModal(true);" style="background:#7e22ce; color:white; padding:10px; border-radius:6px; cursor:pointer; border:none; font-weight:bold;">⬆️ Promote to Admin</button>`;
        
        const banBtn = u.disabled 
            ? `<button onclick="adminToggleBan('${uid}', false); closeAdminModal(true);" style="flex:1; background:#10b981; color:white; padding:10px; border-radius:6px; cursor:pointer; border:none;">✅ Unban</button>`
            : `<button onclick="adminToggleBan('${uid}', true); closeAdminModal(true);" style="flex:1; background:#ef4444; color:white; padding:10px; border-radius:6px; cursor:pointer; border:none;">⛔ Ban</button>`;
        
        const deleteBtn = isViewerSuperAdmin 
            ? `<button onclick="adminDeleteUserDoc('${uid}');" style="background:#991b1b; color:white; padding:10px; border-radius:6px; cursor:pointer; font-weight:bold; border:none;">🗑️ Delete User</button>` 
            : '';

        actionButtons = `
            <h4 style="margin:0 0 10px 0; color:#b91c1c; font-size:14px;">⚠️ Account Actions</h4>
            <div style="display:flex; flex-direction:column; gap:8px;">
                ${roleBtn}
                <div style="display:flex; gap:10px;">
                    ${banBtn}
                </div>
                ${deleteBtn}
            </div>`;
    }

    // 7. Create and Append Modal
    const modalHtml = `
    <div class="admin-modal-overlay" id="admin-modal" onclick="closeAdminModal(event)">
        <div class="admin-modal-content">
            <button class="close-modal-btn" onclick="closeAdminModal(true)">&times;</button>
            <div style="text-align:center; margin-bottom:20px; border-bottom:1px solid #f1f5f9; padding-bottom:15px;">
                <div style="width:48px; height:48px; background:#eff6ff; color:#3b82f6; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:24px; margin:0 auto 10px auto;">👤</div>
                <h3 style="margin:0; font-size:18px; color:#1e293b;">${u.displayName || "User"}</h3>
                <div style="font-size:13px; color:#64748b;">${u.email}</div>
                <div style="font-size:10px; color:#cbd5e1; margin-top:4px; font-family:monospace;">ID: ${uid}</div>
            </div>

            <div style="margin-bottom:20px;">
                <label style="font-size:11px; font-weight:800; color:#94a3b8; text-transform:uppercase; letter-spacing:0.5px; display:block; margin-bottom:10px;">Active Subscriptions</label>
                ${activeSubs}
            </div>

            <div style="border:1px solid #dcfce7; background:#f0fdf4; padding:15px; border-radius:10px; margin-bottom:20px;">
                <h4 style="margin:0 0 10px 0; color:#15803d; font-size:14px; display:flex; align-items:center; gap:6px;">🎁 Grant New Access</h4>
                <div style="display:flex; gap:8px; margin-bottom:10px;">
                    <select id="modal-course" style="flex:2; padding:10px; border-radius:6px; border:1px solid #cbd5e1; font-size:13px; background:white;">${courseOpts}</select>
                    <select id="modal-duration" style="flex:1; padding:10px; border-radius:6px; border:1px solid #cbd5e1; font-size:13px; background:white;">
                        <option value="1">1 Day</option>
                        <option value="7">1 Week</option>
                        <option value="15">15 Days</option>
                        <option value="30">1 Month</option>
                        <option value="90">3 Months</option>
                        <option value="180">6 Months</option> <option value="365">1 Year</option>
                        <option value="9999">Lifetime</option>
                    </select>
                </div>
                <button onclick="runModalGrant('${uid}')" style="width:100%; background:#16a34a; color:white; padding:12px; border:none; border-radius:8px; cursor:pointer; font-weight:600; font-size:14px; box-shadow:0 2px 4px rgba(22,163,74,0.2);">Grant Access</button>
            </div>

            ${actionButtons}
        </div>
    </div>`;

    const div = document.createElement('div');
    div.innerHTML = modalHtml;
    document.body.appendChild(div.firstElementChild);
}

// 3. CLOSE MODAL HELPER
function closeAdminModal(force) {
    if (force === true || (event && event.target.id === 'admin-modal')) {
        const modal = document.getElementById('admin-modal');
        if (modal) modal.remove();
    }
}

// ✅ SECURE ROLE TOGGLE (Direct vs Request)
async function adminToggleRole(uid, newRole) {
    if(uid === SUPER_ADMIN_ID) return alert("❌ Action Blocked: You cannot modify the Main Admin.");
    if(uid === currentUser.uid) return alert("❌ Action Blocked: You cannot modify your own admin status.");

    const targetDoc = adminUsersCache[uid];
    if (!targetDoc) return alert("Error: Refresh list.");
    const targetUser = targetDoc.data();
    const targetEmail = targetUser.email || "Unknown";

    // A. Super Admin = Direct Update
    if (currentUser.uid === SUPER_ADMIN_ID) {
        if(!confirm(`Change ${targetEmail} to ${newRole.toUpperCase()}?`)) return;
        try {
            await db.collection('users').doc(uid).update({ role: newRole });
            alert("Success!");
            closeAdminModal(true);
            loadAllUsers();
        } catch(e) { alert("Error: " + e.message); }
        return;
    }

    // B. Sub-Admin = Request
    alert(`ℹ️ REQUEST SENT\n\nOnly Super Admin can change roles.\nRequest sent for: ${targetEmail}`);
    try {
        await db.collection('admin_requests').add({
            targetUid: uid, targetEmail: targetEmail, newRole: newRole,
            requestedBy: currentUser.uid, requesterEmail: currentUser.email,
            status: 'pending', timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        closeAdminModal(true);
    } catch(e) { alert("Error: " + e.message); }
}

// ✅ SECURE DELETE USER (Robust Version)
async function adminDeleteUserDoc(uid) {
    if(uid === SUPER_ADMIN_ID) return alert("❌ Cannot delete Main Admin!");
    if(!confirm("⚠️ PERMANENTLY DELETE USER?\n\nThis wipes all data.")) return;
    
    // Check if Sub-Admin is trying to delete an Admin
    const u = adminUsersCache[uid].data();
    if(u.role === 'admin' && currentUser.uid !== SUPER_ADMIN_ID) {
        return alert("⛔ Access Denied. Only Super Admin can delete other Admins.");
    }

    try {
        await db.collection('users').doc(uid).delete();
        alert("✅ Deleted.");
        closeAdminModal(true);
        loadAllUsers();
    } catch(e) { alert("Error: " + e.message); }
}

// ===========================================
// NEW: ADMIN APPROVAL WORKFLOW
// ===========================================

async function openAdminRequests() {
    // Security Check: Only Super Admin can open this
    if (currentUser.uid !== SUPER_ADMIN_ID) return alert("Unauthorized.");

    // Create Modal UI
    const modalHtml = `
    <div class="admin-modal-overlay" id="req-modal" onclick="closeReqModal(event)">
        <div class="admin-modal-content" style="max-height:80vh; overflow-y:auto;">
            <button class="close-modal-btn" onclick="closeReqModal(true)">&times;</button>
            <h3 style="text-align:center; color:#7e22ce;">🔔 Pending Approvals</h3>
            <div id="req-list" style="margin-top:15px;">Loading...</div>
        </div>
    </div>`;

    const div = document.createElement('div');
    div.innerHTML = modalHtml;
    document.body.appendChild(div.firstElementChild);

    // Fetch Requests
    try {
        const snap = await db.collection('admin_requests')
            .where('status', '==', 'pending')
            .orderBy('timestamp', 'desc')
            .get();

        const listDiv = document.getElementById('req-list');
        
        if (snap.empty) {
            listDiv.innerHTML = "<div style='text-align:center; color:#999; padding:20px;'>No pending requests.</div>";
            return;
        }

        let html = "";
        snap.forEach(doc => {
            const r = doc.data();
            const typeColor = r.newRole === 'admin' ? '#dcfce7' : '#fee2e2';
            const typeText = r.newRole === 'admin' ? '⬆️ PROMOTE TO ADMIN' : '⬇️ REVOKE ADMIN';
            
            html += `
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px; margin-bottom:10px;">
                <div style="font-size:10px; font-weight:bold; background:${typeColor}; display:inline-block; padding:2px 6px; border-radius:4px; margin-bottom:5px;">${typeText}</div>
                <div style="font-size:13px; margin-bottom:4px;"><b>Target:</b> ${r.targetEmail}</div>
                <div style="font-size:12px; color:#64748b; margin-bottom:10px;"><b>Requested By:</b> ${r.requesterEmail}</div>
                
                <div style="display:flex; gap:10px;">
                    <button onclick="processAdminReq('${doc.id}', '${r.targetUid}', '${r.newRole}', true)" style="flex:1; background:#16a34a; color:white; border:none; padding:8px; border-radius:4px; cursor:pointer;">✅ Approve</button>
                    <button onclick="processAdminReq('${doc.id}', null, null, false)" style="flex:1; background:#ef4444; color:white; border:none; padding:8px; border-radius:4px; cursor:pointer;">❌ Reject</button>
                </div>
            </div>`;
        });
        
        listDiv.innerHTML = html;

    } catch (e) {
        document.getElementById('req-list').innerText = "Error loading requests.";
        console.error(e);
    }
}

function closeReqModal(force) {
    if (force === true || (event && event.target.id === 'req-modal')) {
        const m = document.getElementById('req-modal');
        if(m) m.remove();
    }
}

async function processAdminReq(reqId, targetUid, newRole, isApproved) {
    const listDiv = document.getElementById('req-list');
    listDiv.innerHTML = "<div style='text-align:center; padding:20px;'>Processing...</div>";

    try {
        const batch = db.batch();
        const reqRef = db.collection('admin_requests').doc(reqId);

        if (isApproved) {
            // 1. Update the User's Role (ACTUALLY make them admin/student)
            const userRef = db.collection('users').doc(targetUid);
            batch.update(userRef, { role: newRole });
            
            // 2. Mark Request as Approved
            batch.update(reqRef, { status: 'approved', actionedBy: 'SuperAdmin' });
        } else {
            // Mark Request as Rejected (Do NOT update user)
            batch.update(reqRef, { status: 'rejected', actionedBy: 'SuperAdmin' });
        }

        await batch.commit();
        
        alert(isApproved ? "✅ Request Approved & Applied!" : "❌ Request Rejected.");
        closeReqModal(true);
        loadAllUsers(); // Refresh main list to see the change

    } catch(e) {
        alert("Error: " + e.message);
        closeReqModal(true);
    }
}

async function runModalGrant(uid) {
    const course = document.getElementById('modal-course').value;
    const days = parseInt(document.getElementById('modal-duration').value);
    const prefix = COURSE_CONFIG[course].prefix;
    const durationMs = (days === 9999) ? 4000000000000 : (days * 86400000);
    const newExpiry = new Date(Date.now() + durationMs);

    await db.collection('users').doc(uid).update({
        [`${prefix}isPremium`]: true,
        [`${prefix}plan`]: 'admin_grant',
        [`${prefix}expiryDate`]: newExpiry
    });
    alert("Granted!");
    closeAdminModal(true);
    loadAllUsers();
}

async function adminToggleBan(uid, shouldBan) {
    if(uid === SUPER_ADMIN_ID) return alert("Cannot ban Main Admin.");
    await db.collection('users').doc(uid).update({ disabled: shouldBan });
    alert("Updated.");
    closeAdminModal(true);
    loadAllUsers();
}

async function adminRevokePremium(uid) {
    if(!confirm("Remove subscriptions?")) return;
    const updates = { isPremium: false, premiumExpiry: null };
    Object.keys(COURSE_CONFIG).forEach(k => {
        updates[COURSE_CONFIG[k].prefix + 'isPremium'] = false;
        updates[COURSE_CONFIG[k].prefix + 'expiryDate'] = null;
    });
    await db.collection('users').doc(uid).update(updates);
    alert("Revoked.");
    closeAdminModal(true);
    loadAllUsers();
}

function loadQuestions(url) {
    const storageKey = 'cached_questions_' + currentCourse; // Unique key (e.g. cached_questions_MBBS_1)
    
    // 1. Try to fetch from Internet
    Papa.parse(url, {
        download: true,
        header: true,
        skipEmptyLines: true,
        complete: function(results) {
            console.log("✅ Online: Questions downloaded");
            // SAVE to phone memory
            localStorage.setItem(storageKey, JSON.stringify(results.data));
            processData(results.data);
        },
        error: function(e) {
            console.log("⚠️ Offline: Switching to saved data...");
            // 2. If Offline, load from phone memory
            const cached = localStorage.getItem(storageKey);
            if (cached) {
                alert("You are currently OFFLINE.\nLoaded saved questions.");
                processData(JSON.parse(cached));
            } else {
                alert("You are Offline and no data is saved.\nPlease connect to internet once to download the course.");
            }
        }
    });
}

function processData(data, reRenderOnly = false) {
    if(!reRenderOnly) {
        const seen = new Set();
        allQuestions = [];
        data.forEach((row, index) => {
            // Clean up row data
            delete row.Book; delete row.Exam; delete row.Number;
            const qText = row.Question || row.Questions;
            const correctVal = row.CorrectAnswer;

            if (!qText || !correctVal) return;

            // Generate Unique ID based on question text
            const qSignature = String(qText).trim().toLowerCase();
            if (seen.has(qSignature)) return; 
            seen.add(qSignature);

            row._uid = "id_" + Math.abs(generateHash(qSignature));
            row.Question = qText; 
            row.SheetRow = index + 2; 

            // Normalize Subject/Topic
            const subj = row.Subject ? row.Subject.trim() : "General";
            const topic = row.Topic ? row.Topic.trim() : "Mixed";
            row.Subject = subj; 
            row.Topic = topic;
            
            allQuestions.push(row);
        });
    }

    // 🔥 NEW: Render the Grid Dashboard instead of the old lists
    renderSubjectGrid();
    
    // Update Admin counter if present
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
    
    // 1. Update the Tab Buttons (Visual State)
    document.getElementById('btn-mode-practice').classList.toggle('active', mode === 'practice');
    document.getElementById('btn-mode-test').classList.toggle('active', mode === 'test');

    // 2. Show/Hide the "Create Multi-Subject Exam" button
    // This button should only appear in Exam Mode
    const multiBtn = document.getElementById('multi-exam-controls');
    if(multiBtn) {
        if (mode === 'test') {
            multiBtn.classList.remove('hidden');
        } else {
            multiBtn.classList.add('hidden');
        }
    }
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
// 8. QUIZ ENGINE (FIXED & ROBUST)
// ======================================================

// ==========================================
// 📄 RENDER PAGE (Handles Logic & Buttons)
// ==========================================

// ==========================================
// 🛠️ CREATE QUESTION CARD (Safe Mode)
// ==========================================

function reportCurrentQuestion() {
    if (!filteredQuestions || filteredQuestions.length === 0) return;
    const currentQ = filteredQuestions[currentIndex];
    if (currentQ) {
        openReportModal(currentQ._uid);
    }
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
    // 1. IF ANSWER IS CORRECT
    // ==========================================
    if (isCorrect) {
        
        // A. Add to Solved List
        if (!userSolvedIDs.includes(q._uid)) {
            userSolvedIDs.push(q._uid);
            batch.update(userRef, {
                [sKey]: firebase.firestore.FieldValue.arrayUnion(q._uid),
                [`${statKey}.${subjectKey}.correct`]: firebase.firestore.FieldValue.increment(1),
                [`${statKey}.${subjectKey}.total`]: firebase.firestore.FieldValue.increment(1)
            });
        }

        // B. CHECK MODE BEFORE REMOVING
        if (isMistakeReview === true) {
            // ONLY remove if we are in Mistake Review Mode
            
            // Remove from Local Array
            const idx = userMistakes.indexOf(q._uid);
            if (idx > -1) userMistakes.splice(idx, 1);

            // Remove from Database
            batch.update(userRef, {
                [mKey]: firebase.firestore.FieldValue.arrayRemove(q._uid)
            });
            console.log("Deleted from mistakes (Review Mode)");
        } else {
            // In Normal Mode, do NOT remove it
            console.log("Correct Answer: Kept in history (Normal Mode)");
        }

    } 
    // ==========================================
    // 2. IF ANSWER IS WRONG
    // ==========================================
    else {
        // Add to Mistake List
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

// ==========================================
// 1. OPEN PANEL & FORCE DISPLAY (AGGRESSIVE FIX)
// ==========================================
function openAdminPanel() {
    console.log("🚀 Force Opening Admin Panel...");
    localStorage.setItem('current_screen', 'admin-screen');
    // 1. Security Check
    if (!userProfile || userProfile.role !== 'admin') {
        return alert("⛔ Access Denied: Admins only.");
    }

    // 2. 🔥 THE GHOST BUSTER: Force Hide ALL Known Containers by ID
    // We list every single ID that could possibly take up space
    const idsToHide = [
        'auth-screen', 
        'course-selection-screen', 
        'dashboard-screen', 
        'quiz-screen', 
        'result-screen', 
        'main-menu-container',   // <--- Likely the culprit
        'mbbs-years-container',  // <--- Likely the culprit
        'test-sidebar', 
        'practice-nav-container',
        'premium-modal',
        'explanation-modal'
    ];

    idsToHide.forEach(id => {
        const el = document.getElementById(id);
        if(el) {
            el.style.display = 'none';       // Force CSS hide
            el.classList.add('hidden');      // Add utility class
            el.classList.remove('active');   // Remove active state
        }
    });

    // 3. Hide generic screens just in case we missed one
    document.querySelectorAll('.screen').forEach(s => {
        s.style.display = 'none';
        s.classList.add('hidden');
    });

    // 4. PREPARE ADMIN SCREEN
    const adminScreen = document.getElementById('admin-screen');
    if (!adminScreen) return alert("❌ Error: 'admin-screen' ID missing in HTML.");
    
    // Reset Admin Screen Styles
    adminScreen.classList.remove('hidden');
    adminScreen.classList.add('active');
    adminScreen.style.display = 'block'; 
    adminScreen.style.marginTop = "0px"; // Ensure no top margin issues
    adminScreen.style.paddingTop = "20px";

    // 5. FORCE SHOW 'USERS' TAB
    const userTab = document.getElementById('tab-users');
    if (userTab) {
        userTab.classList.remove('hidden');
        userTab.style.display = 'block'; 
    }

    // 6. Hide other admin tabs
    ['tab-reports', 'tab-payments', 'tab-keys'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.add('hidden');
            el.style.display = 'none';
        }
    });

    // 7. Update Buttons
    document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
    const buttons = document.querySelectorAll('.admin-tab');
    buttons.forEach(btn => {
        if(btn.innerText.includes('Users') || (btn.getAttribute('onclick') && btn.getAttribute('onclick').includes('users'))) {
            btn.classList.add('active');
        }
    });

    // 8. 🚀 FINAL SCROLL FORCE
    // We do this inside a tiny timeout to let the DOM refresh first
    setTimeout(() => {
        window.scrollTo(0, 0);
        document.body.scrollTop = 0; // For Safari
        document.documentElement.scrollTop = 0; // For Chrome/Firefox
    }, 10);

 // 9. Load Data
if (typeof adminUsersCache !== 'undefined') adminUsersCache = null; // Clear old cache
loadAllUsers();
}
// 2. TAB SWITCHER (Standard Logic)
function switchAdminTab(tabName) {
    console.log("🔄 Switching to tab:", tabName);

    // Hide all tab contents
    ['reports', 'payments', 'keys', 'users'].forEach(t => {
        const el = document.getElementById('tab-' + t);
        if (el) {
            el.classList.add('hidden');
            el.style.display = 'none'; // Ensure hidden
        }
    });

    // Show target tab
    const target = document.getElementById('tab-' + tabName);
    if (target) {
        target.classList.remove('hidden');
        target.style.display = 'block'; // Ensure visible
    }

    // Update Buttons
    document.querySelectorAll('.admin-tab').forEach(btn => btn.classList.remove('active'));
    const buttons = document.querySelectorAll('.admin-tab');
    buttons.forEach(btn => {
        const attr = btn.getAttribute('onclick');
        if (attr && attr.includes(tabName)) btn.classList.add('active');
    });

    // Load Data
    if (tabName === 'users') loadAllUsers();
    if (tabName === 'reports' && typeof loadAdminReports === 'function') loadAdminReports();
    if (tabName === 'payments' && typeof loadAdminPayments === 'function') loadAdminPayments();
    
    if (tabName === 'keys') {
        const select = document.getElementById('key-course-select');
        if (select && select.children.length === 0 && typeof getCourseOptionsHTML === 'function') {
            select.innerHTML = getCourseOptionsHTML('FCPS');
        }
        if (typeof loadAdminKeys === 'function') loadAdminKeys();
    }
}


async function loadAdminReports() {
    const list = document.getElementById('admin-reports-list');
    list.innerHTML = '<div style="padding:20px; text-align:center; color:#64748b;">Loading reports...</div>';

    try {
        // Fetch pending reports
        const snap = await db.collection('reports')
                             .where('status', '==', 'pending')
                             .orderBy('timestamp', 'desc')
                             .get();
        
        if(snap.empty) {
            list.innerHTML = "<div style='padding:20px; text-align:center; color:#10b981;'>✅ No pending reports.</div>";
            return;
        }

        let html = "";
        snap.forEach(doc => {
            const r = doc.data();
            
            // 1. MATCH THE KEYS from your submitReportFinal function
            // Saved as 'questionId', so we must read 'questionId'
            const qId = r.questionId; 

            // Saved as 'reportedBy', so we read 'reportedBy'
            const reporter = r.reportedBy || "Guest"; 

            // Saved as 'issue', so we read 'issue'
            const issueText = r.issue || "No details provided.";

            // 2. FIND THE QUESTION TEXT
            let questionPreview = "";
            
            // Check if we are in the same course as the report
            if (r.courseId === currentCourse) {
                // Find question by ID (checking both string and number formats)
                const qData = allQuestions.find(q => q._uid == qId || q.id == qId);
                
                if (qData) {
                    const shortText = qData.Question.length > 90 ? qData.Question.substring(0, 90) + "..." : qData.Question;
                    questionPreview = `<div style="font-weight:700; color:#1e293b; margin-bottom:6px; font-size:13px; border-left:3px solid #3b82f6; padding-left:8px;">Q: ${shortText}</div>`;
                } else {
                    questionPreview = `<div style="color:#ef4444; font-size:11px;">(Question ID not found in this course file)</div>`;
                }
            } else {
                // If admin is in 'FCPS' but report is for 'Third Year'
                questionPreview = `<div style="color:#64748b; font-size:11px; background:#f1f5f9; padding:6px; border-radius:4px;">
                    ⚠️ Switch to <b>"${r.courseName}"</b> to view this question text.
                </div>`;
            }

            html += `
            <div class="admin-card" style="border-left:4px solid #f59e0b; background:white; margin-bottom:12px; padding:15px; border-radius:8px; box-shadow:0 1px 3px rgba(0,0,0,0.1);">
                
                <div style="font-size:11px; color:#64748b; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #f1f5f9; padding-bottom:8px;">
                    <span>
                        <b style="color:#0f172a;">${r.courseName || "Unknown Course"}</b> 
                        <span style="background:#e2e8f0; padding:2px 6px; border-radius:4px; margin-left:5px;">Row ${r.excelRow || "?"}</span>
                    </span>
                    <span style="color:#0f172a; font-weight:600;">👤 ${reporter}</span>
                </div>
                
                ${questionPreview}
                
                <div style="background:#fff1f2; padding:10px; border-radius:6px; margin:10px 0; font-size:13px; color:#be123c; border:1px solid #fda4af;">
                    <b>Report:</b> "${issueText}"
                </div>

                <div style="text-align:right; display:flex; gap:8px; justify-content:flex-end;">
                     <button class="btn-sm" style="background:white; border:1px solid #ef4444; color:#ef4444; padding:6px 12px; border-radius:4px; cursor:pointer; font-size:12px;" onclick="deleteReport('${doc.id}')">🗑️ Ignore</button>
                     <button class="btn-sm" style="background:#10b981; color:white; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; font-size:12px;" onclick="resolveReport('${doc.id}')">✅ Mark Resolved</button>
                </div>
            </div>`;
        });
        list.innerHTML = html;
    } catch(e) {
        console.error(e);
        list.innerHTML = `<div style="color:red; padding:20px;">Error: ${e.message}</div>`;
    }
}

window.deleteReport = function(id) {
    // 1. Safety Check
    if(!confirm("Mark this report as resolved and delete it?")) return;

    // 2. Delete from Database
    db.collection('reports').doc(id).delete()
        .then(() => {
            // 3. Refresh the list on screen
            loadAdminReports();
        })
        .catch(e => {
            alert("Error: " + e.message);
        });
};


async function loadAdminPayments() {
    const list = document.getElementById('admin-payments-list');
    list.innerHTML = '<div style="text-align:center; padding:20px; color:#666;">Loading requests...</div>';
    
    try {
        const snap = await db.collection('payment_requests').where('status','==','pending').orderBy('timestamp', 'desc').get();
        if(snap.empty) { list.innerHTML = "<div style='padding:30px; text-align:center; color:#94a3b8;'>No pending payments.</div>"; return; }

        let html = "";
        snap.forEach(doc => {
            const p = doc.data();
            
            // 1. FIX COURSE NAME (MBBS_2 -> Second Year)
            const courseKey = p.targetCourse || 'FCPS';
            const courseName = COURSE_CONFIG[courseKey] ? COURSE_CONFIG[courseKey].name : courseKey;

            // 2. FIX PLAN NAME (1_week -> 1 Week)
            let planDisplay = p.planRequested || "Unknown";
            // Replace underscores with spaces
            planDisplay = planDisplay.replace(/_/g, ' ');
            // Capitalize (CSS does this too, but this handles the text directly)
            
            const imageHtml = p.image 
                ? `<div class="pay-proof-container" onclick="viewFullReceipt('${p.image.replace(/'/g, "\\'")}')"><img src="${p.image}" class="pay-proof-img"><span class="view-receipt-text">🔍 View Receipt</span></div>`
                : `<div>⚠️ No Image</div>`;

            // Dropdown with ALL 8 PLANS
            html += `
            <div class="admin-payment-card" id="card-${doc.id}">
                <div class="pay-card-header">
                    <div><span class="pay-user-email">${p.email}</span></div>
                    <div>
                        <span style="background:#0f172a; color:white; padding:4px 8px; border-radius:4px; font-size:11px; font-weight:bold; margin-right:5px;">${courseName}</span> 
                        
                        <span class="pay-plan-badge" style="text-transform:capitalize;">${planDisplay}</span>
                    </div>
                </div>
                ${imageHtml}
                <div class="pay-action-box">
                    <label style="font-size:11px; font-weight:bold; color:#64748b;">Approve Duration:</label>
                    <div class="pay-controls-row">
                        <select id="dur-${doc.id}" class="pay-select">
                            <option value="1_day">1 Day</option>
                            <option value="1_week">1 Week</option>
                            <option value="15_days">15 Days</option>
                            <option value="1_month" ${p.planRequested === '1_month' ? 'selected' : ''}>1 Month</option>
                            <option value="3_months" ${p.planRequested === '3_months' ? 'selected' : ''}>3 Months</option>
                            <option value="6_months" ${p.planRequested === '6_months' ? 'selected' : ''}>6 Months</option>
                            <option value="12_months" ${p.planRequested === '12_months' ? 'selected' : ''}>12 Months</option>
                            <option value="lifetime" ${p.planRequested === 'lifetime' ? 'selected' : ''}>Lifetime</option>
                        </select>
                        <button class="btn-pay-action btn-approve" onclick="approvePayment('${doc.id}','${p.uid}', '${courseKey}')">Approve</button>
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

// ======================================================
// 11. HELPERS & UTILITIES
// ======================================================

function showScreen(screenId) {
    const ids = [
        'auth-screen', 'course-selection-screen', 'dashboard-screen', 
        'quiz-screen', 'result-screen', 'admin-screen',
        'explanation-modal', 'premium-modal', 'profile-modal', 
        'analytics-modal', 'badges-modal', 
        'study-modal' // <--- ADDED THIS (Fixes the stuck modal)
    ];

    // 1. Hide Everything
    ids.forEach(id => {
        const el = document.getElementById(id);
        if(el) { 
            el.classList.add('hidden'); 
            el.classList.remove('active'); 
            el.style.display = ''; // Clear inline styles
        }
    });
    
    document.querySelectorAll('.modal-overlay').forEach(el => el.classList.add('hidden'));
    
    // 2. Show Target
    const target = document.getElementById(screenId);
    if(target) { 
        target.classList.remove('hidden'); 
        target.classList.add('active'); 
    }
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
    const textEl = document.getElementById('explanation-text');
    
    // 🔥 FIX: Use 'innerHTML' so <b> and <span> tags actually work
    textEl.innerHTML = q.Explanation || "No explanation.";
    
    // Show the modal
    const modal = document.getElementById('explanation-modal');
    modal.classList.remove('hidden');
    
    // Optional: Add active class for animation
    setTimeout(() => {
        modal.classList.add('active');
    }, 10);
}

function closeModal() { document.getElementById('explanation-modal').classList.add('hidden'); }
function nextPageFromModal() { closeModal(); setTimeout(nextPage, 300); }
function nextPage() { currentIndex++; renderPage(); }
function prevPage() { currentIndex--; renderPage(); }

function openPremiumModal() { 
    // ✅ Guest Check
    if (isGuest) {
        return alert("Please login to view Premium Plans & Subscribe.");
    }
    
    const modal = document.getElementById('premium-modal');
    if (modal) {
        modal.style.display = 'flex'; 
        modal.classList.remove('hidden'); 
    }
}
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
    // ✅ 1. Guest Check (Immediate Popup)
    // Stops the modal from opening if the user is a Guest
    if (isGuest) {
        return alert("Please login to unlock Trophies & Achievements.");
    }

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
    const btn = document.getElementById('main-badge-btn');
    if(!btn) return;

    const solvedCount = (typeof userSolvedIDs !== 'undefined') ? userSolvedIDs.length : 0;

    // Check from Highest to Lowest
    if (solvedCount >= 5000) {
        btn.innerText = "👑"; // Master
    } else if (solvedCount >= 2000) {
        btn.innerText = "💎"; // Diamond
    } else if (solvedCount >= 1000) {
        btn.innerText = "🥇"; // Gold
    } else if (solvedCount >= 500) {
        btn.innerText = "🥈"; // Silver
    } else if (solvedCount >= 100) {
        btn.innerText = "🥉"; // Bronze <--- You will see this now
    } else if (solvedCount >= 10) {
        btn.innerText = "👶"; // Novice
    } else {
        btn.innerText = "🏆"; // Default (No Badge)
    }
}

async function openAnalytics() {
    // ✅ 1. Guest Check (Immediate Popup)
    // This runs BEFORE opening the modal
    if (isGuest) {
        return alert("Login to view your detailed analytics.");
    }

    const modal = document.getElementById('analytics-modal');
    const content = document.getElementById('analytics-content');
    
    // Only open the modal if they are NOT a guest
    modal.classList.remove('hidden');
    content.innerHTML = "Loading...";

    if(!currentUser) { content.innerHTML = "Please log in."; return; }

    try {
        const doc = await db.collection('users').doc(currentUser.uid).get();
        // ISOLATED STATS: Uses the correct key (e.g., MBBS1_stats)
        const stats = doc.data()[getStoreKey('stats')] || {};
        
        // Use the readable name (e.g. "First Year") from config
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

    const courseName = COURSE_CONFIG[currentCourse] ? COURSE_CONFIG[currentCourse].name : currentCourse;
    const rowIndex = allQuestions.findIndex(q => q._uid === qId);
    const excelRow = (rowIndex !== -1) ? (rowIndex + 2) : "Unknown";

    const reportData = {
        questionId: qId,
        excelRow: excelRow,       
        courseId: currentCourse,   
        courseName: courseName,    
        issue: text,
        reportedBy: currentUser ? currentUser.email : 'Guest',
        timestamp: new Date(),
        
        // ✅ CHANGE THIS FROM 'open' TO 'pending'
        status: 'pending' 
    };

    try {
        await db.collection('reports').add(reportData);
        
        document.getElementById('report-modal').classList.remove('active');
        setTimeout(() => document.getElementById('report-modal').classList.add('hidden'), 300);
        document.getElementById('report-text').value = "";
        
        alert("✅ Report Sent! Thank you for your feedback.");
        
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
// --- SMART INSTALL LOGIC (HYBRID) ---
let deferredPrompt; // Stores the native prompt if available

// 1. Listen for the browser's native install event (Android/PC)
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    console.log("✅ Native install prompt captured");
});

// 2. Inject the "How to Install" Modal HTML automatically
const installGuideHTML = `
<div id="install-guide-modal" style="
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(15, 23, 42, 0.7); backdrop-filter: blur(5px); z-index: 9999;
    display: none; justify-content: center; align-items: center; font-family: sans-serif;
">
    <div style="
        background: white; width: 90%; max-width: 450px; max-height: 90vh;
        border-radius: 20px; overflow: hidden; display: flex; flex-direction: column;
        box-shadow: 0 20px 25px rgba(0,0,0,0.1); animation: popIn 0.3s ease;
    ">
        <div style="padding: 20px; border-bottom: 1px solid #f1f5f9; text-align: center; background: white;">
            <div style="font-size: 32px; margin-bottom: 8px;">📲</div>
            <h2 style="margin: 0; color: #1e293b; font-size: 20px; font-weight: 800;">Install App</h2>
            <p style="margin: 5px 0 0; color: #64748b; font-size: 13px;">Add to home screen for the best experience.</p>
        </div>

        <div style="padding: 20px; overflow-y: auto; background: #fff;">
            <div style="background:#f8fafc; padding:12px; border-radius:10px; margin-bottom:10px; border:1px solid #e2e8f0;">
                <strong style="display:block; margin-bottom:6px; color:#0f172a; font-size:14px;">🍎 iOS (Safari)</strong>
                <ol style="margin:0; padding-left:20px; font-size:13px; color:#475569; line-height:1.5;">
                    <li>Tap the <b>Share</b> icon <span style="font-size:15px">↥</span></li>
                    <li>Scroll down & tap <b>Add to Home Screen</b></li>
                    <li>Tap <b>Add</b> (top right)</li>
                </ol>
            </div>

            <div style="background:#f8fafc; padding:12px; border-radius:10px; margin-bottom:10px; border:1px solid #e2e8f0;">
                <strong style="display:block; margin-bottom:6px; color:#0f172a; font-size:14px;">🤖 Android (Chrome)</strong>
                <ol style="margin:0; padding-left:20px; font-size:13px; color:#475569; line-height:1.5;">
                    <li>Tap <b>Three Dots</b> (⋮) at top right</li>
                    <li>Tap <b>Install App</b> or <b>Add to Home Screen</b></li>
                    <li>Tap <b>Install</b> to confirm</li>
                </ol>
            </div>
        </div>

        <button onclick="document.getElementById('install-guide-modal').style.display='none'" 
            style="padding: 15px; background: white; border: none; border-top: 1px solid #f1f5f9; color: #64748b; cursor: pointer; font-weight: 600; font-size: 14px; width: 100%;">
            Close
        </button>
    </div>
</div>
`;
document.body.insertAdjacentHTML('beforeend', installGuideHTML);

// 3. Configure the Install Button
function setupInstallButton() {
    const installBtn = document.getElementById('install-btn');
    if (installBtn) {
        // Force button visible
        installBtn.style.display = 'block';
        installBtn.innerHTML = "📲 Install App";
        
        // Remove old listeners by cloning
        const newBtn = installBtn.cloneNode(true);
        installBtn.parentNode.replaceChild(newBtn, installBtn);
        
        // Add Smart Click Event
        newBtn.addEventListener('click', async () => {
            if (deferredPrompt) {
                // A. Try Native Android/PC Prompt first
                deferredPrompt.prompt();
                const { outcome } = await deferredPrompt.userChoice;
                console.log("User response:", outcome);
                deferredPrompt = null;
            } else {
                // B. If Native fails (or on iOS), show the Manual Guide
                document.getElementById('install-guide-modal').style.display = 'flex';
            }
        });
    }
}

// Run setup immediately or when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupInstallButton);
} else {
    setupInstallButton();
}

async function adminDeleteGhosts() {
    if(!confirm("⚠️ Delete all 'Ghost' users?\n\n(These are broken records with no email address).\nThis cannot be undone.")) return;
    
    const list = document.getElementById('admin-user-result');
    // Show loading state so you know it's working
    list.innerHTML = "<div style='padding:20px; text-align:center; color:red;'>🧹 Cleaning up database... please wait...</div>";

    try {
        const snap = await db.collection('users').get({ source: 'server' });
        const batch = db.batch();
        let deleteCount = 0;

        snap.forEach(doc => {
            const u = doc.data();
            // Identify the ghosts again
            if (!u.email) {
                batch.delete(doc.ref);
                deleteCount++;
            }
        });

        if (deleteCount > 0) {
            await batch.commit();
            alert(`✅ Success! Deleted ${deleteCount} ghost records.`);
        } else {
            alert("No ghosts found to delete.");
        }
        
        // Reload list to see the clean result
        loadAllUsers();

    } catch(e) {
        alert("Error: " + e.message);
        loadAllUsers(); // Restore list if error
    }
}

async function adminRevokeSpecificCourse(uid, courseKey) {
    const config = COURSE_CONFIG[courseKey];
    if(!config) return;

    if (!confirm(`⚠️ REVOKE ${config.name.toUpperCase()}?\n\nAre you sure you want to remove access for this specific course?`)) return;

    const prefix = config.prefix;
    try {
        await db.collection('users').doc(uid).update({
            [`${prefix}isPremium`]: false,
            [`${prefix}expiryDate`]: null,
            [`${prefix}plan`]: null
        });
        
        alert(`✅ ${config.name} Revoked.`);
        closeAdminModal(true); 
        loadAllUsers(); // Reloads the list to show the change
    } catch (e) {
        alert("Error: " + e.message);
    }
}

// ======================================================
// 🔍 SEARCH & DASHBOARD LOGIC (MASTER FIX)
// ======================================================

function handleSearchInput() {
    const input = document.getElementById('subject-search');
    const term = input ? input.value : '';
    renderSubjectGrid(term);
}

// 1. Render the Grid (Main Dashboard Cards)
function renderSubjectGrid(filterText = '') {
    const grid = document.getElementById('subject-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const searchText = filterText.toLowerCase().trim();
    
    // Safety check if data isn't loaded yet
    if (!allQuestions || allQuestions.length === 0) {
        grid.innerHTML = "<div style='text-align:center; padding:30px; color:#94a3b8;'>Loading questions...</div>";
        return;
    }

    const subjects = [...new Set(allQuestions.map(q => q.Subject))].sort();
    let hasResults = false;

    subjects.forEach(sub => {
        const subQuestions = allQuestions.filter(q => q.Subject === sub);
        
        // Search Filter Logic
        const matchSubject = sub.toLowerCase().includes(searchText);
        const matchTopic = subQuestions.some(q => (q.Topic || "").toLowerCase().includes(searchText));
        const matchQ = subQuestions.some(q => (q.Question || "").toLowerCase().includes(searchText));

        if (searchText && !matchSubject && !matchTopic && !matchQ) return;
        hasResults = true;

        const count = subQuestions.length;
        
        // Subject Progress
        const safeSolvedIDs = (typeof userSolvedIDs !== 'undefined') ? userSolvedIDs : [];
        const solvedCount = subQuestions.filter(q => safeSolvedIDs.includes(q._uid)).length;
        const percent = count === 0 ? 0 : Math.round((solvedCount / count) * 100);

        const card = document.createElement('div');
        card.className = 'subject-card';
        card.style.cssText = "background:white; border:1px solid #e2e8f0; border-radius:12px; padding:16px; margin-bottom:15px; box-shadow:0 2px 4px rgba(0,0,0,0.02); cursor:pointer; transition:transform 0.2s;";
        
        card.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:12px;">
                <h3 style="margin:0; font-size:16px; font-weight:700; color:#1e293b;">${sub}</h3>
                <span style="font-size:11px; font-weight:700; color:#059669; background:#d1fae5; padding:4px 10px; border-radius:20px;">
                    ${solvedCount} / ${count}
                </span>
            </div>
            <div style="background:#f1f5f9; height:8px; border-radius:4px; overflow:hidden;">
                <div style="width:${percent}%; background:#10b981; height:100%; transition:width 0.3s ease;"></div>
            </div>
        `;
        
        card.onclick = () => openSubjectModal(sub);
        grid.appendChild(card);
    });

    if(!hasResults) {
        grid.innerHTML = "<div style='text-align:center; padding:30px; color:#94a3b8;'>No subjects found.</div>";
    }
}

// 2. Open Subject Modal
function openSubjectModal(subject) {
    selectedSubjectForModal = subject;
    selectedExamTopics = [];

    const modal = document.getElementById('study-modal');
    document.getElementById('modal-subject-title').innerText = subject;

    const subjectQs = allQuestions.filter(q => q.Subject === subject);
    const topics = [...new Set(subjectQs.map(q => q.Topic))].sort();

    // Stats
    const safeSolvedIDs = (typeof userSolvedIDs !== 'undefined') ? userSolvedIDs : [];
    const subjSolved = subjectQs.filter(q => safeSolvedIDs.includes(q._uid)).length;
    const subjTotal = subjectQs.length;
    const subjPct = subjTotal === 0 ? 0 : Math.round((subjSolved / subjTotal) * 100);

    const list = document.getElementById('modal-topic-list');
    const actions = document.getElementById('modal-actions-area');
    const settings = document.getElementById('exam-settings-area');
    const footer = document.getElementById('modal-footer');
    const subtitle = document.getElementById('modal-mode-subtitle');

    list.innerHTML = '';
    actions.innerHTML = '';

    // Reset Exam Button
    const startBtn = footer.querySelector('button');
    if(startBtn) {
        startBtn.onclick = startExamFromModal;
        startBtn.innerText = "Start Exam";
    }

    if (currentMode === 'practice') {
        // 🟢 PRACTICE MODE
        subtitle.innerText = "Select a topic to start immediately.";
        settings.classList.add('hidden');
        footer.style.display = 'none'; 

        // Practice All Button
        const btnAll = document.createElement('button');
        btnAll.style.cssText = "width:100%; text-align:left; background:linear-gradient(135deg, #10b981 0%, #059669 100%); color:white; border:none; padding:15px; border-radius:12px; margin-bottom:20px; box-shadow:0 4px 6px rgba(16, 185, 129, 0.2); cursor:pointer;";
        btnAll.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <span style="font-weight:bold; font-size:15px;">Practice Entire Subject</span>
                <span style="background:rgba(255,255,255,0.2); font-size:12px; padding:3px 8px; border-radius:12px; font-weight:600;">${subjSolved} / ${subjTotal}</span>
            </div>
            <div style="background:rgba(0,0,0,0.2); height:6px; border-radius:3px; overflow:hidden;">
                <div style="width:${subjPct}%; background:white; height:100%;"></div>
            </div>
        `;
        btnAll.onclick = () => {
            closeStudyModal();
            startPractice(subject, null); 
        };
        actions.appendChild(btnAll);

        // Topic List
        topics.forEach(topic => {
            const topQs = subjectQs.filter(q => q.Topic === topic);
            const topTotal = topQs.length;
            const topSolved = topQs.filter(q => safeSolvedIDs.includes(q._uid)).length;
            const topPct = topTotal === 0 ? 0 : Math.round((topSolved / topTotal) * 100);

            const row = document.createElement('div');
            row.style.cssText = "background:white; border:1px solid #f1f5f9; border-radius:10px; padding:12px 15px; margin-bottom:10px; cursor:pointer; transition:all 0.1s;";
            row.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <span style="font-weight:600; color:#334155; font-size:14px;">${topic}</span>
                    <span style="font-size:11px; font-weight:700; color:#0f766e; background:#ccfbf1; padding:3px 8px; border-radius:12px;">${topSolved} / ${topTotal}</span>
                </div>
                <div style="background:#f1f5f9; height:5px; border-radius:3px; overflow:hidden; width:100%;">
                     <div style="width:${topPct}%; background:#10b981; height:100%;"></div>
                </div>
            `;
            row.onclick = () => {
                closeStudyModal();
                startPractice(subject, topic);
            };
            list.appendChild(row);
        });

    } else {
        // 🔵 EXAM MODE
        subtitle.innerText = "Select topics to include in your exam.";
        settings.classList.remove('hidden');
        footer.style.display = 'block';

        const selectAllDiv = document.createElement('div');
        selectAllDiv.innerHTML = `
            <div style="padding:12px; display:flex; align-items:center; gap:12px; background:#f8fafc; border-radius:8px; margin-bottom:15px; border:1px solid #e2e8f0;">
                <input type="checkbox" id="chk-select-all" onchange="toggleSelectAllTopics(this)" style="width:18px; height:18px; cursor:pointer;"> 
                <label for="chk-select-all" style="font-weight:bold; color:#1e293b; font-size:14px; cursor:pointer;">Select All '${subject}' Topics</label>
            </div>
        `;
        actions.appendChild(selectAllDiv);

        topics.forEach(topic => {
            const row = document.createElement('div');
            row.style.cssText = "padding:12px; border-bottom:1px solid #f1f5f9; cursor:pointer; font-size:14px; color:#334155; display:flex; align-items:center;";
            row.innerText = topic;
            row.onclick = () => {
                row.classList.toggle('selected');
                if (row.classList.contains('selected')) {
                    row.style.background = "#eff6ff"; row.style.color = "#1d4ed8"; row.style.fontWeight = "bold";
                    if(!selectedExamTopics.includes(topic)) selectedExamTopics.push(topic);
                } else {
                    row.style.background = "transparent"; row.style.color = "#334155"; row.style.fontWeight = "normal";
                    selectedExamTopics = selectedExamTopics.filter(t => t !== topic);
                }
                document.getElementById('chk-select-all').checked = false;
            };
            list.appendChild(row);
        });
    }
    modal.classList.remove('hidden');
}

function toggleSelectAllTopics(checkbox) {
    const rows = document.getElementById('modal-topic-list').children;
    const allTopics = [...new Set(allQuestions.filter(q => q.Subject === selectedSubjectForModal).map(q => q.Topic))];

    if (checkbox.checked) {
        Array.from(rows).forEach(r => {
            r.classList.add('selected'); r.style.background = "#eff6ff"; r.style.color = "#1d4ed8"; r.style.fontWeight = "bold";
        });
        selectedExamTopics = allTopics;
    } else {
        Array.from(rows).forEach(r => {
            r.classList.remove('selected'); r.style.background = "transparent"; r.style.color = "#334155"; r.style.fontWeight = "normal";
        });
        selectedExamTopics = [];
    }
}

function closeStudyModal() {
    document.getElementById('study-modal').classList.add('hidden');
}

// ======================================================
// 🚀 START LOGIC (LINKING DASHBOARD TO QUIZ)
// ======================================================

function startPractice(subject, topic) {
    // 1. Filter Questions
    let pool = allQuestions.filter(q => q.Subject === subject);
    if (topic) pool = pool.filter(q => q.Topic === topic);

    // 2. Handle Limits (Guest/Free)
    const isAdmin = userProfile && userProfile.role === 'admin';
    const premKey = (typeof getStoreKey === 'function') ? getStoreKey('isPremium') : 'isPremium';
    const expKey = (typeof getStoreKey === 'function') ? getStoreKey('expiryDate') : 'expiryDate';
    const isPrem = userProfile && userProfile[premKey] && isDateActive(userProfile[expKey]);

    let limit = 50; // Default Free
    if (isAdmin || isPrem) limit = Infinity;
    else if (isGuest) limit = 20;

    if (pool.length > limit) pool = pool.slice(0, limit);

    if (pool.length === 0) return alert("No questions available.");

    // 3. Unattempted Check
    const onlyUnattempted = document.getElementById('unattempted-only') ? document.getElementById('unattempted-only').checked : false;
    if (onlyUnattempted && typeof userSolvedIDs !== 'undefined') {
        pool = pool.filter(q => !userSolvedIDs.includes(q._uid));
        if (pool.length === 0) return alert("🎉 You have solved all available free questions!");
    }

    // 4. Launch Quiz
    filteredQuestions = pool;
    currentMode = 'practice';
    currentIndex = 0;
    
    // Switch Screen
    showScreen('quiz-screen');
    renderPage(); // <--- THIS IS THE KEY FUNCTION
}

function startExamFromModal() {
    const countInput = document.getElementById('new-exam-q-count').value;
    const minsInput = document.getElementById('new-exam-timer').value;
    if (selectedExamTopics.length === 0) return alert("Select at least one topic.");

    let pool = allQuestions.filter(q => q.Subject === selectedSubjectForModal && selectedExamTopics.includes(q.Topic));
    
    const unattemptedOnly = document.getElementById('unattempted-only').checked;
    if (unattemptedOnly && typeof userSolvedIDs !== 'undefined') pool = pool.filter(q => !userSolvedIDs.includes(q._uid));
    if (pool.length === 0) return alert("No questions available.");

    let finalCount = parseInt(countInput) || 20;
    filteredQuestions = pool.sort(() => Math.random() - 0.5).slice(0, finalCount);
    
    closeStudyModal();
    currentMode = 'test';
    currentIndex = 0;
    testAnswers = {};
    testFlags = {};
    testTimeRemaining = parseInt(minsInput) * 60;
    
    showScreen('quiz-screen');
    renderPage();
    
    clearInterval(testTimer);
    testTimer = setInterval(updateTimer, 1000);
}

// ======================================================
// 8. QUIZ ENGINE (DISPLAY LOGIC)
// ======================================================

function renderPage() {
    const container = document.getElementById('quiz-content-area');
    if (!container) return console.error("❌ Error: #quiz-content-area missing HTML");
    
    container.innerHTML = "";
    window.scrollTo(0, 0);

    // Sidebar & Timer Logic
    const timerDisplay = document.getElementById('timer');
    const sidebar = document.getElementById('test-sidebar');
    if(currentMode === 'practice') {
        if(timerDisplay) timerDisplay.classList.add('hidden');
        if(sidebar) sidebar.classList.remove('active');
        if(typeof renderPracticeNavigator === 'function') renderPracticeNavigator();
    } else {
        if(timerDisplay) timerDisplay.classList.remove('hidden');
        if(sidebar) sidebar.classList.add('active');
        if(typeof renderNavigator === 'function') renderNavigator();
    }

    // Buttons Logic
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const submitBtn = document.getElementById('submit-btn');

    if(prevBtn) prevBtn.classList.toggle('hidden', currentIndex === 0);
    
    const isLast = currentIndex === filteredQuestions.length - 1;
    if(nextBtn) nextBtn.classList.toggle('hidden', isLast);
    
    if(submitBtn) {
        submitBtn.classList.toggle('hidden', !(currentMode === 'test' && isLast));
    }

    // Render Card
    if (filteredQuestions[currentIndex]) {
        const card = createQuestionCard(filteredQuestions[currentIndex], currentIndex);
        container.appendChild(card);
    } else {
        container.innerHTML = "<div style='padding:20px;'>Error: Question not found.</div>";
    }
}

function createQuestionCard(q, index, showNumber = true) {
    const block = document.createElement('div');
    block.className = "test-question-block";
    block.id = `q-card-${index}`;

    // ✅ SAFEGUARDS: Prevent crash if arrays are undefined
    const safeFlags = (typeof testFlags !== 'undefined' && testFlags) ? testFlags : {};
    const safeBookmarks = (typeof userBookmarks !== 'undefined' && Array.isArray(userBookmarks)) ? userBookmarks : [];
    const safeSolved = (typeof userSolvedIDs !== 'undefined' && Array.isArray(userSolvedIDs)) ? userSolvedIDs : [];

    if (safeFlags[q._uid]) {
        block.classList.add('is-flagged-card');
    }

    const isBookmarked = (currentMode === 'test') ? false : safeBookmarks.includes(q._uid);
    const isFlagged = safeFlags[q._uid] || false;

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

        // Safe check for testAnswers
        if (typeof testAnswers !== 'undefined' && testAnswers && testAnswers[q._uid] === opt) {
            btn.classList.add('selected');
        }
        
        optionsDiv.appendChild(btn);
    });

    block.appendChild(optionsDiv);
    return block;
}
function checkAnswer(selected, btn, q) {
    if (currentMode === 'test') {
        testAnswers[q._uid] = selected;
        Array.from(btn.parentElement.children).forEach(b => {
            b.style.background = "white"; b.style.borderColor = "#cbd5e1";
        });
        btn.style.background = "#eff6ff"; btn.style.borderColor = "#3b82f6";
        renderNavigator();
        return;
    }

    // Practice Mode Logic
    let correct = (q.CorrectAnswer || "").trim();
    let isCorrect = false;
    
    if (selected.toLowerCase() === correct.toLowerCase()) isCorrect = true;
    else {
        const getOpt = (k) => q[k] || q[k.replace("Option", "Option ")];
        const map = {'A': getOpt('OptionA'), 'B': getOpt('OptionB'), 'C': getOpt('OptionC'), 'D': getOpt('OptionD'), 'E': getOpt('OptionE')};
        if (map[correct] === selected) isCorrect = true;
    }

    if (isCorrect) {
        btn.style.background = "#dcfce7"; btn.style.borderColor = "#22c55e"; btn.style.color = "#14532d";
        if(typeof updateUserStats === 'function') updateUserStats(true, q.Subject, q._uid);
        showExplanation(q);
    } else {
        btn.style.background = "#fee2e2"; btn.style.borderColor = "#ef4444"; btn.style.color = "#7f1d1d";
        if(typeof updateUserStats === 'function') updateUserStats(false, q.Subject, q._uid);
    }
    renderPracticeNavigator();
}

function renderNavigator() {
    const nav = document.getElementById('nav-grid');
    if(!nav) return;
    nav.innerHTML = "";
    filteredQuestions.forEach((q, idx) => {
        const btn = document.createElement('button');
        btn.innerText = idx + 1;
        btn.style.cssText = "width:35px; height:35px; border:1px solid #ccc; border-radius:4px; cursor:pointer; background:white; margin:2px;";
        if(currentIndex === idx) btn.style.border = "2px solid black";
        if(testAnswers[q._uid]) { btn.style.background = "#3b82f6"; btn.style.color="white"; btn.style.border="none"; }
        btn.onclick = () => { currentIndex = idx; renderPage(); };
        nav.appendChild(btn);
    });
}

function renderPracticeNavigator() {
    const nav = document.getElementById('practice-nav-container');
    if (!nav) return; // Stop if HTML element is missing
    
    nav.classList.remove('hidden'); 
    nav.innerHTML = "";

    // ✅ SAFEGUARDS: Ensure arrays exist
    const safeSolved = (typeof userSolvedIDs !== 'undefined' && Array.isArray(userSolvedIDs)) ? userSolvedIDs : [];
    const safeMistakes = (typeof userMistakes !== 'undefined' && Array.isArray(userMistakes)) ? userMistakes : [];

    filteredQuestions.forEach((q, idx) => {
        const btn = document.createElement('button');
        btn.className = "nav-btn";
        btn.innerText = idx + 1;

        if (currentIndex === idx) btn.classList.add('current');
        
        // Use safe arrays
        if (safeSolved.includes(q._uid)) {
            btn.style.borderColor = "#10b981"; // Green
            btn.style.color = "#10b981";
        }
        if (safeMistakes.includes(q._uid)) {
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

function toggleFlag(uid, btn, idx) {
    if(testFlags[uid]) delete testFlags[uid]; else testFlags[uid] = true;
    renderPage(); 
}
