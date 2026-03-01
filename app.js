import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import {
    getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
    onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
    getFirestore, collection, addDoc, getDocs, doc, getDoc, setDoc, updateDoc, deleteDoc,
    query, orderBy, limit, where, startAfter
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// Firebase Configuration Make sure these are the ones you provided
const firebaseConfig = {
    apiKey: "AIzaSyB0LQisnfRg4jCsXVLHiqvtlfH20wuJxZQ",
    authDomain: "ringtone-c5470.firebaseapp.com",
    projectId: "ringtone-c5470",
    storageBucket: "ringtone-c5470.firebasestorage.app",
    messagingSenderId: "1025987989249",
    appId: "1:1025987989249:web:6ae6bdad7a615dbb935500"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Config
const RAZORPAY_KEY_ID = "rzp_live_SLUmR37GVplOsp";
const SUBSCRIPTION_AMOUNT = 100; // ₹1
const SUBSCRIPTION_DAYS = 30;
const ADMIN_EMAIL = "ringtonehub9web@gmail.com";
const ADMIN_SEC_PWD = "SecureAdmin#2026";
const CATEGORIES = ["Latest", "Hindi", "Telugu", "Tamil", "BGM", "Malayalam", "Bengali", "Trending"]; // Kept for admin form rendering
const POSTS_PER_PAGE = 5;

// Global State
let currentUser = null;
let userSubscription = { status: 'inactive', expiryDate: null };
let isAdminVerified = false;
let currentPendingGithubLink = null;

let currentCategoryFilter = null;
let lastVisibleQueryDoc = null;
let firstVisibleQueryDoc = null;
let currentPage = 1;

let homepageLayoutConfig = []; // Stores the layout for homepage
let allPostsCacheForSearch = []; // Simple cache for searching

// ==========================================
// CODE INJECTION (Runs on load)
// ==========================================
async function loadGlobalSettings() {
    try {
        const settingsDoc = await getDoc(doc(db, "settings", "global"));
        if (settingsDoc.exists()) {
            const data = settingsDoc.data();
            if (data.headCode) document.getElementById('injectedHeader').innerHTML = data.headCode;
            if (data.bodyCode) document.getElementById('injectedBodyStart').innerHTML = data.bodyCode;
            if (data.footerCode) document.getElementById('injectedFooter').innerHTML = data.footerCode;
        }
    } catch (e) {
        console.error("Error loading settings:", e);
    }
}
loadGlobalSettings();

// ==========================================
// AUTHENTICATION & UI STATUS
// ==========================================
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        await fetchUserData(user.uid);
        updateUIAfterAuth();
    } else {
        currentUser = null;
        userSubscription = { status: 'inactive', expiryDate: null };
        updateUIAfterAuth();
    }
});

async function fetchUserData(uid) {
    try {
        const userDoc = await getDoc(doc(db, "users", uid));
        if (userDoc.exists()) {
            const data = userDoc.data();
            if (data.subscriptionStatus === 'active') {
                if (new Date().getTime() > data.expiryDate) {
                    await updateDoc(doc(db, "users", uid), { subscriptionStatus: 'inactive' });
                    userSubscription = { status: 'inactive', expiryDate: data.expiryDate };
                } else {
                    userSubscription = { status: 'active', expiryDate: data.expiryDate };
                }
            } else {
                userSubscription = { status: 'inactive', expiryDate: data.expiryDate };
            }
        } else {
            await setDoc(doc(db, "users", uid), {
                email: currentUser.email,
                subscriptionStatus: 'inactive',
                expiryDate: null,
                createdAt: new Date().getTime()
            });
        }
    } catch (e) {
        console.error("Error fetching user data:", e);
    }
}

function updateUIAfterAuth() {
    // Top Nav
    const authBtn = document.getElementById('authBtn');
    const userStatus = document.getElementById('userStatus');
    if (authBtn && userStatus) {
        if (currentUser) {
            authBtn.textContent = 'Logout';
            userStatus.classList.remove('hidden');
            if (userSubscription.status === 'active') {
                userStatus.innerHTML = '<i class="fas fa-crown"></i> Premium';
                userStatus.style.color = '#10b981';
                userStatus.style.backgroundColor = 'rgba(16, 185, 129, 0.15)';
                userStatus.style.borderColor = 'rgba(16, 185, 129, 0.3)';
            } else {
                userStatus.innerHTML = '<i class="fas fa-user"></i> Free User';
                userStatus.style.color = '#9ca3af';
                userStatus.style.backgroundColor = 'rgba(156, 163, 175, 0.15)';
                userStatus.style.borderColor = 'transparent';
            }
        } else {
            authBtn.textContent = 'Login';
            userStatus.classList.add('hidden');
        }
    }

    // Single Post view update if open
    if (document.getElementById('singlePostModal')?.classList.contains('active')) {
        renderPlayersForCurrentPost(); // Re-render buttons
    }

    // Admin Access Logic (Only run if on admin.html)
    const adminPanel = document.getElementById('adminPanel');
    if (adminPanel) {
        if (!currentUser) {
            document.getElementById('adminAuthNotice').classList.remove('hidden');
            document.getElementById('adminSecondaryAuth').classList.add('hidden');
            adminPanel.classList.add('hidden');
            document.getElementById('adminLogoutBtn').classList.add('hidden');
            isAdminVerified = false;
        } else if (currentUser.email.toLowerCase() !== ADMIN_EMAIL) {
            // Unverified user on admin page
            document.getElementById('adminAuthNotice').classList.remove('hidden');
            document.getElementById('adminAuthNotice').innerHTML = `<h2><i class="fas fa-lock"></i> Unauthorized</h2><p>This account does not have admin privileges.</p><a href="index.html" class="btn primary-btn" style="margin-top:1rem;">Go to main site</a>`;
            document.getElementById('adminSecondaryAuth').classList.add('hidden');
            adminPanel.classList.add('hidden');
            document.getElementById('adminLogoutBtn').classList.remove('hidden');
        } else {
            // Logged in as ADMIN
            document.getElementById('adminAuthNotice').classList.add('hidden');
            document.getElementById('adminLogoutBtn').classList.remove('hidden');
            if (isAdminVerified) {
                document.getElementById('adminSecondaryAuth').classList.add('hidden');
                adminPanel.classList.remove('hidden');
                loadAdminPosts(); // Load table
            } else {
                document.getElementById('adminSecondaryAuth').classList.remove('hidden');
                adminPanel.classList.add('hidden');
            }
        }
    }
}

// Global Auth Handlers
document.getElementById('authBtn')?.addEventListener('click', () => {
    if (currentUser) signOut(auth);
    else document.getElementById('authModal').classList.add('active');
});

let isLoginMode = true;
document.getElementById('toggleAuth')?.addEventListener('click', (e) => {
    e.preventDefault();
    isLoginMode = !isLoginMode;
    document.getElementById('authTitle').textContent = isLoginMode ? 'Login to RingtoneDKHR' : 'Create an Account';
    document.getElementById('authSubmitBtn').textContent = isLoginMode ? 'Login' : 'Sign Up';
    e.target.textContent = isLoginMode ? 'Sign up' : 'Login';
    e.target.previousSibling.textContent = isLoginMode ? "Don't have an account? " : "Already have an account? ";
    document.getElementById('authError').textContent = '';
});

document.getElementById('authForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('authSubmitBtn');
    btn.disabled = true; btn.textContent = 'Processing...';
    try {
        if (isLoginMode) {
            await signInWithEmailAndPassword(auth, document.getElementById('email').value, document.getElementById('password').value);
        } else {
            const cred = await createUserWithEmailAndPassword(auth, document.getElementById('email').value, document.getElementById('password').value);
            await setDoc(doc(db, "users", cred.user.uid), {
                email: cred.user.email, subscriptionStatus: 'inactive', expiryDate: null, createdAt: new Date().getTime()
            });
        }
        document.getElementById('authModal').classList.remove('active');
        e.target.reset();
    } catch (error) {
        document.getElementById('authError').textContent = error.message.replace('Firebase:', '').trim();
    } finally {
        btn.disabled = false; btn.textContent = isLoginMode ? 'Login' : 'Sign Up';
    }
});

// Modal Close logic mapping
document.querySelectorAll('.close-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const targetId = e.target.getAttribute('data-target');
        if (targetId) document.getElementById(targetId).classList.remove('active');
    });
});

// ==========================================
// PAYMENT LOGIC
// ==========================================
window.triggerPricingModal = function (githubLink) {
    if (!currentUser) {
        document.getElementById('authModal').classList.add('active');
        return;
    }
    if (userSubscription.status === 'active') {
        window.open(githubLink, '_blank');
        return;
    }
    // Not subscribed, show pricing modal
    currentPendingGithubLink = githubLink;
    document.getElementById('pricingModal').classList.add('active');
};

document.getElementById('initiateRazorpayBtn')?.addEventListener('click', () => {
    const options = {
        "key": RAZORPAY_KEY_ID,
        "amount": SUBSCRIPTION_AMOUNT,
        "currency": "INR",
        "name": "RingtoneDKHR Premium",
        "description": "Premium Membership for ₹1 (30 Days)",
        "handler": async function (response) {
            try {
                const expiry = new Date().getTime() + (SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000);
                await updateDoc(doc(db, "users", currentUser.uid), {
                    subscriptionStatus: 'active', expiryDate: expiry
                });
                userSubscription.status = 'active';
                userSubscription.expiryDate = expiry;
                updateUIAfterAuth();
                document.getElementById('pricingModal').classList.remove('active');
                if (currentPendingGithubLink) window.open(currentPendingGithubLink, '_blank');
            } catch (err) {
                alert("Payment succeeded but server update failed.");
            }
        },
        "prefill": { "email": currentUser.email },
        "theme": { "color": "#3b82f6" }
    };
    new Razorpay(options).open();
});

// ==========================================
// FRONTEND RENDERING (INDEX.HTML)
// ==========================================
const mainContainer = document.getElementById('mainContainer');
const categorySectionsContainer = document.getElementById('categorySectionsContainer');
const homeLoader = document.getElementById('homeLoader');

if (mainContainer) {
    loadHomepageContent();
}

async function fetchHomepageLayout() {
    try {
        const docSnap = await getDoc(doc(db, "site_settings", "homepage_layout"));
        if (docSnap.exists() && (docSnap.data().categories || docSnap.data().config)) {
            const data = docSnap.data().categories || docSnap.data().config;
            if (data && data.length > 0) {
                // Ignore the saved layout if it only has 'Latest' so that we can show the new defaults
                if (data.length === 1 && data[0].category === 'Latest') {
                    // Fall through to show the default 5 categories instead of just 1
                } else {
                    homepageLayoutConfig = data;
                    return;
                }
            }
        }

        // Default fallback if no layout is saved yet or empty
        homepageLayoutConfig = [
            { category: 'Latest', count: 4 },
            { category: 'Hindi', count: 4 },
            { category: 'Telugu', count: 4 },
            { category: 'Tamil', count: 4 },
            { category: 'BGM', count: 4 }
        ];
    } catch (e) {
        console.error("Error fetching layout config:", e);
        homepageLayoutConfig = [
            { category: 'Latest', count: 4 },
            { category: 'Hindi', count: 4 },
            { category: 'Telugu', count: 4 },
            { category: 'Tamil', count: 4 },
            { category: 'BGM', count: 4 }
        ];
    }
}

async function loadHomepageContent() {
    homeLoader.classList.remove('hidden');
    categorySectionsContainer.innerHTML = '';

    await fetchHomepageLayout();

    // If layout config is forcibly empty or failed badly, do a basic fallback query for ALL latest posts
    if (!homepageLayoutConfig || homepageLayoutConfig.length === 0) {
        homepageLayoutConfig = [
            { category: 'Latest', count: 4 },
            { category: 'Hindi', count: 4 },
            { category: 'Telugu', count: 4 },
            { category: 'Tamil', count: 4 },
            { category: 'BGM', count: 4 }
        ];
    }

    let allPosts = [];
    try {
        const q = query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(100));
        const snap = await getDocs(q);
        snap.forEach(docSnap => {
            allPosts.push({ ...docSnap.data(), id: docSnap.id });
        });
    } catch (e) {
        console.error("Error fetching homepage posts:", e);
    }

    for (const layoutItem of homepageLayoutConfig) {
        try {
            const matchedPosts = allPosts.filter(data =>
                layoutItem.category === 'Latest' ||
                (data.categories && data.categories.includes(layoutItem.category)) ||
                (data.category === layoutItem.category)
            ).slice(0, layoutItem.count);

            if (matchedPosts.length > 0) {
                const section = document.createElement('div');
                section.className = 'category-section';

                let html = `
                    <div class="cat-header">
                        <h3>${layoutItem.category} Ringtones</h3>
                        <button class="view-all-btn" onclick="openCategoryView('${layoutItem.category}')">More Ringtones <i class="fas fa-chevron-right"></i></button>
                    </div>
                    <div class="poster-grid">
                `;

                matchedPosts.forEach(data => {
                    // Convert old string category to array on-the-fly
                    if (data.category && (!data.categories || data.categories.length === 0)) {
                        data.categories = [data.category];
                    } else if (typeof data.categories === 'string') {
                        data.categories = [data.categories];
                    }

                    const postJson = escape(JSON.stringify(data));

                    // Grab category badge preference (new array first, then old string, then fallback)
                    const primaryCat = (data.categories && data.categories.length > 0) ? data.categories[0] : (data.category || layoutItem.category);
                    html += `
                        <div class="poster-card" onclick="openSinglePost('${postJson}')">
                            <div class="poster-img-wrapper">
                                <img src="${data.thumbnail}" loading="lazy" alt="${data.title}">
                                <div class="play-overlay"><i class="fas fa-play-circle"></i></div>
                            </div>
                            <div class="poster-info">
                                <div class="poster-title">${data.title}</div>
                                <div class="poster-cat">${primaryCat}</div>
                            </div>
                        </div>
                    `;
                });
                html += `</div>`;
                section.innerHTML = html;
                categorySectionsContainer.appendChild(section);
            }
        } catch (e) {
            console.error(`Error loading category ${layoutItem.category}`, e);
        }
    }
    homeLoader.classList.add('hidden');
}

// --- Category View / Pagination Logic ---
const categoryViewContainer = document.getElementById('categoryViewContainer');
const searchViewContainer = document.getElementById('searchViewContainer');
const categoryGrid = document.getElementById('categoryGrid');
const prevPageBtn = document.getElementById('prevPageBtn');
const nextPageBtn = document.getElementById('nextPageBtn');
const pageIndicator = document.getElementById('pageIndicator');

window.openCategoryView = async function (cat) {
    currentCategoryFilter = cat;
    currentPage = 1;
    mainContainer.classList.add('hidden');
    categoryViewContainer.classList.remove('hidden');
    document.getElementById('categoryViewTitle').textContent = `${cat} Ringtones`;
    document.title = `${cat} Ringtones - RingtoneDKHR`;
    if (searchViewContainer) searchViewContainer.classList.add('hidden');

    await fetchCategoryPage("first");
};

// Global back listener
document.querySelectorAll('.back-to-home-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        if (categoryViewContainer) categoryViewContainer.classList.add('hidden');
        if (searchViewContainer) searchViewContainer.classList.add('hidden');
        if (mainContainer) mainContainer.classList.remove('hidden');
        document.title = "RingtoneDKHR - Premium Ringtones";
        if (document.getElementById('searchInput')) document.getElementById('searchInput').value = '';
    });
});

async function fetchCategoryPage(dir) {
    categoryGrid.innerHTML = '<div class="loader"><i class="fas fa-spinner fa-spin"></i> Fetching...</div>';

    // Due to missing indexes or backward compatibility (string vs array), 
    // we use client side filtered fetches for now to guarantee functionality
    try {
        const q = query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(100)); // Fetch up to 100 
        const snap = await getDocs(q);
        categoryGrid.innerHTML = '';

        if (snap.empty) {
            categoryGrid.innerHTML = '<p class="text-secondary text-center">No posts found.</p>';
            nextPageBtn.disabled = true;
            return;
        }

        let allMatchedPosts = [];
        snap.forEach(docSnap => {
            const data = docSnap.data();
            if (currentCategoryFilter === 'Latest' ||
                (data.categories && data.categories.includes(currentCategoryFilter)) ||
                (data.category === currentCategoryFilter)) {
                allMatchedPosts.push({ ...data, id: docSnap.id });
            }
        });

        if (allMatchedPosts.length === 0) {
            categoryGrid.innerHTML = '<p class="text-secondary text-center">No posts found for this category.</p>';
            nextPageBtn.disabled = true;
            return;
        }

        // Basic Pagination Math (Client Side on the 100 cache)
        const totalItems = allMatchedPosts.length;
        const totalPages = Math.ceil(totalItems / POSTS_PER_PAGE);
        if (currentPage > totalPages) currentPage = totalPages;
        if (currentPage < 1) currentPage = 1;

        const startIndex = (currentPage - 1) * POSTS_PER_PAGE;
        const endIndex = startIndex + POSTS_PER_PAGE;
        const pageItems = allMatchedPosts.slice(startIndex, endIndex);

        pageItems.forEach(data => {
            const postJson = escape(JSON.stringify(data));
            const primaryCat = (data.categories && data.categories.length > 0) ? data.categories[0] : (data.category || "Category");
            categoryGrid.innerHTML += `
                <div class="poster-card" onclick="openSinglePost('${postJson}')">
                    <div class="poster-img-wrapper">
                        <img src="${data.thumbnail}" loading="lazy" alt="${data.title}">
                        <div class="play-overlay"><i class="fas fa-play-circle"></i></div>
                    </div>
                    <div class="poster-info">
                        <div class="poster-title">${data.title}</div>
                        <div class="poster-cat">${primaryCat}</div>
                    </div>
                </div>
            `;
        });

        pageIndicator.textContent = `Page ${currentPage} of ${totalPages || 1}`;
        prevPageBtn.disabled = currentPage === 1;
        nextPageBtn.disabled = currentPage === totalPages || totalPages === 0;

    } catch (e) {
        console.error(e);
        categoryGrid.innerHTML = '<p class="text-danger">Failed to load posts.</p>';
    }
}

nextPageBtn?.addEventListener('click', () => {
    currentPage++;
    fetchCategoryPage("next");
});
prevPageBtn?.addEventListener('click', () => {
    // Simple reset to page 1 logic for this scoped app if they hit previous
    // To properly do prev, reverse query required.
    currentPage = 1;
    fetchCategoryPage("first");
});


// --- Search Logic ---
const searchInput = document.getElementById('searchInput');
const searchGrid = document.getElementById('searchGrid');
const searchLoader = document.getElementById('searchLoader');
let searchTimeout = null;

if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        const queryStr = e.target.value.toLowerCase().trim();

        // Hide/Show logic based on input
        if (queryStr.length > 0) {
            if (mainContainer && !mainContainer.classList.contains('hidden')) mainContainer.classList.add('hidden');
            if (categoryViewContainer && !categoryViewContainer.classList.contains('hidden')) categoryViewContainer.classList.add('hidden');
            if (searchViewContainer) searchViewContainer.classList.remove('hidden');
        }

        if (queryStr.length < 2) {
            if (queryStr.length === 0) {
                // If emptied, go back to main screen, hide search
                if (searchViewContainer) searchViewContainer.classList.add('hidden');
                if (mainContainer) mainContainer.classList.remove('hidden');
            }
            return;
        }

        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            performSearch(queryStr);
        }, 500); // Debounce
    });
}

async function performSearch(queryText) {
    if (!searchViewContainer) return;

    document.title = `Search: ${queryText} - RingtoneDKHR`;

    searchGrid.innerHTML = '';
    searchLoader.classList.remove('hidden');

    try {
        // Fetch posts incrementally or full scan if database is small.
        // For production with thousands of items, Algolia or MeiliSearch is recommended.
        // Here we do a client-side filter of the latest 100 posts for the demo.
        const q = query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(100));
        const snap = await getDocs(q);

        let resultsHtml = '';
        let count = 0;

        snap.forEach(docSnap => {
            const data = docSnap.data();
            const titleMatch = data.title.toLowerCase().includes(queryText);
            const tagsMatch = data.tags && data.tags.toLowerCase().includes(queryText);

            if (titleMatch || tagsMatch) {
                count++;
                const postJson = escape(JSON.stringify({ ...data, id: docSnap.id }));
                const primaryCat = data.categories && data.categories.length > 0 ? data.categories[0] : "";

                resultsHtml += `
                    <div class="poster-card" onclick="openSinglePost('${postJson}')">
                        <div class="poster-img-wrapper">
                            <img src="${data.thumbnail}" loading="lazy" alt="${data.title}">
                            <div class="play-overlay"><i class="fas fa-play-circle"></i></div>
                        </div>
                        <div class="poster-info">
                            <div class="poster-title">${data.title}</div>
                            <div class="poster-cat">${primaryCat}</div>
                        </div>
                    </div>
                `;
            }
        });

        if (count === 0) {
            searchGrid.innerHTML = `<p class="text-secondary" style="grid-column: 1/-1; text-align: center; padding: 2rem;">No results found for "${queryText}".</p>`;
        } else {
            searchGrid.innerHTML = resultsHtml;
        }

    } catch (e) {
        console.error("Search error:", e);
        searchGrid.innerHTML = '<p class="text-danger">Search failed.</p>';
    } finally {
        searchLoader.classList.add('hidden');
    }
}


// --- Single Post Logic ---
let activePostData = null;

window.openSinglePost = function (encodedData) {
    const data = JSON.parse(unescape(encodedData));
    activePostData = data;

    // Set Meta
    document.title = data.title + " - RingtoneDKHR";
    if (data.metaDesc) document.getElementById('globalMetaDesc').content = data.metaDesc;

    // Render UI
    document.getElementById('spTitle').textContent = data.title;
    const primaryCat = data.categories && data.categories.length > 0 ? data.categories[0] : "";
    document.getElementById('spCategory').textContent = primaryCat;
    document.getElementById('spPoster').src = data.thumbnail;
    document.getElementById('spDescription').innerHTML = data.content;

    // Tags
    const tagsDiv = document.getElementById('spTags');
    tagsDiv.innerHTML = '';
    if (data.tags) {
        data.tags.split(',').forEach(t => {
            if (t.trim()) tagsDiv.innerHTML += `<span class="sp-tag">#${t.trim()}</span>`;
        });
    }

    renderPlayersForCurrentPost();
    document.getElementById('singlePostModal').classList.add('active');
};

function renderPlayersForCurrentPost() {
    if (!activePostData) return;
    const list = document.getElementById('spPlayersList');
    list.innerHTML = '';

    const isPremium = userSubscription.status === 'active';

    if (activePostData.players && activePostData.players.length > 0) {
        activePostData.players.forEach(p => {
            const btnHtml = isPremium
                ? `<button class="btn primary-btn full-btn" onclick="window.open('${p.url}', '_blank')"><i class="fas fa-download"></i> Download HQ</button>`
                : `<button class="btn accent-btn full-btn" onclick="triggerPricingModal('${p.url}')"><i class="fas fa-gem"></i> Subscribe to Download</button>`;

            list.innerHTML += `
                <div class="player-item">
                    <div class="pi-header">
                        <span class="pi-title">${p.name}</span>
                    </div>
                    <div class="pi-html-wrap" style="margin: 1rem 0;">
                        ${p.html}
                    </div>
                    <div class="pi-actions">
                        ${btnHtml}
                    </div>
                </div>
            `;
        });
    } else {
        list.innerHTML = '<p class="text-secondary">No audio tracks available for this post.</p>';
    }
}


// ==========================================
// ADMIN DASHBOARD LOGIC
// ==========================================
// Tabs
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active-tab'));
        e.target.classList.add('active');
        document.getElementById(e.target.getAttribute('data-tab')).classList.add('active-tab');

        if (e.target.getAttribute('data-tab') === 'managePostsTab') loadAdminPosts();
    });
});

document.getElementById('secondaryAdminForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (document.getElementById('adminSecPwd').value === ADMIN_SEC_PWD) {
        isAdminVerified = true;
        document.getElementById('adminSecPwd').value = '';
        document.getElementById('adminSecError').textContent = '';
        updateUIAfterAuth();
    } else {
        document.getElementById('adminSecError').textContent = 'Incorrect Secondary Password.';
    }
});

document.getElementById('adminLogoutBtn')?.addEventListener('click', () => { isAdminVerified = false; signOut(auth); });

// Dynamic Players UI in Editor
const addPlayerBtn = document.getElementById('addPlayerBtn');
const playersContainer = document.getElementById('playersContainer');

if (addPlayerBtn) {
    addPlayerBtn.addEventListener('click', () => {
        const rowCount = playersContainer.children.length + 1;
        const row = document.createElement('div');
        row.className = 'player-input-row';
        row.innerHTML = `
            <span class="row-num">${rowCount}</span>
            <div class="pi-fields">
                <input type="text" class="pi-name" placeholder="Track Name" required>
                <input type="text" class="pi-html" placeholder="<audio controls...>" required>
                <input type="url" class="pi-url" placeholder="GitHub Download URL" required>
            </div>
            <button type="button" class="btn danger-btn remove-player-btn"><i class="fas fa-trash"></i></button>
        `;
        playersContainer.appendChild(row);

        row.querySelector('.remove-player-btn').addEventListener('click', () => {
            row.remove();
            // Re-index
            let i = 1;
            playersContainer.querySelectorAll('.row-num').forEach(el => { el.textContent = i++; });
        });
    });

    // Attach listener to initial row
    document.querySelector('.remove-player-btn')?.addEventListener('click', function () {
        this.parentElement.remove();
    });
}

// Add or Edit Post Submit
document.getElementById('addPostForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser || currentUser.email.toLowerCase() !== ADMIN_EMAIL || !isAdminVerified) return alert("Unauthorized!");

    const msg = document.getElementById('adminStatusMsg');
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Saving...';

    // Gather dynamic players array
    const players = [];
    document.querySelectorAll('.player-input-row').forEach(row => {
        players.push({
            name: row.querySelector('.pi-name').value,
            html: row.querySelector('.pi-html').value,
            url: row.querySelector('.pi-url').value
        });
    });

    // Gather checked categories
    const categories = [];
    document.querySelectorAll('.cat-cb:checked').forEach(cb => {
        categories.push(cb.value);
    });

    if (categories.length === 0) {
        alert("Please select at least one category.");
        btn.disabled = false; btn.textContent = 'Publish Post';
        return;
    }

    const postData = {
        title: document.getElementById('postTitle').value,
        slug: document.getElementById('postSlug').value,
        categories: categories,
        thumbnail: document.getElementById('postThumbnail').value,
        metaDesc: document.getElementById('postMetaDesc').value,
        tags: document.getElementById('postTags').value,
        content: document.getElementById('postContent').value,
        players: players,
        addedBy: currentUser.uid
    };

    const editingId = document.getElementById('editingPostId').value;

    try {
        if (editingId) {
            postData.updatedAt = new Date().getTime();
            await updateDoc(doc(db, "posts", editingId), postData);
            msg.textContent = 'Post Updated Successfully!';
            document.getElementById('formTitle').innerHTML = '<i class="fas fa-plus-circle"></i> Create New Post';
            btn.textContent = 'Publish Post';
            document.getElementById('editingPostId').value = '';
        } else {
            postData.createdAt = new Date().getTime();
            await addDoc(collection(db, "posts"), postData);
            msg.textContent = 'Post Published Successfully!';
        }

        msg.style.color = 'var(--accent-color)';
        e.target.reset();
        playersContainer.innerHTML = ''; // clear dynamic rows
        // Uncheck all category checkboxes after reset
        document.querySelectorAll('.cat-cb').forEach(cb => { cb.checked = false; });
    } catch (err) {
        msg.textContent = 'Error: ' + err.message;
        msg.style.color = 'var(--danger-color)';
    } finally {
        if (!editingId) btn.disabled = false;
        else btn.disabled = false;

        setTimeout(() => msg.textContent = '', 3000);
    }
});

// Manage Posts List
async function loadAdminPosts() {
    const list = document.getElementById('postsListBody');
    if (!list) return;
    list.innerHTML = '<tr><td colspan="5" class="text-center"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>';

    try {
        const q = query(collection(db, "posts"), orderBy("createdAt", "desc"));
        const snap = await getDocs(q);
        list.innerHTML = '';
        if (snap.empty) { list.innerHTML = '<tr><td colspan="5" class="text-center">No posts found.</td></tr>'; return; }

        snap.forEach(docSnap => {
            const data = docSnap.data();
            const d = new Date(data.createdAt).toLocaleDateString();
            const postJson = escape(JSON.stringify({ ...data, id: docSnap.id }));
            const primaryCat = data.categories && data.categories.length > 0 ? data.categories.join(', ') : '';

            list.innerHTML += `
                <tr>
                    <td><img src="${data.thumbnail}" loading="lazy"></td>
                    <td><strong>${data.title}</strong><br><small class="text-secondary">${data.players.length} tracks</small></td>
                    <td>${primaryCat}</td>
                    <td>${d}</td>
                    <td>
                        <button class="btn outline-btn btn-sm" onclick="editAdminPost('${postJson}')"><i class="fas fa-edit"></i></button>
                        <button class="btn danger-btn btn-sm" onclick="deleteAdminPost('${docSnap.id}')"><i class="fas fa-trash"></i></button>
                    </td>
                </tr>
            `;
        });
    } catch (e) { console.error(e); }
}

window.editAdminPost = function (encodedData) {
    const data = JSON.parse(unescape(encodedData));

    // Switch to Create Tab
    document.querySelector('.tab-btn[data-tab="createPostTab"]').click();
    document.getElementById('formTitle').innerHTML = '<i class="fas fa-edit"></i> Edit Post';
    document.querySelector('#addPostForm button[type="submit"]').textContent = 'Update Post';

    // Populate simple fields
    document.getElementById('editingPostId').value = data.id;
    document.getElementById('postTitle').value = data.title || '';
    document.getElementById('postSlug').value = data.slug || '';
    document.getElementById('postThumbnail').value = data.thumbnail || '';
    document.getElementById('postMetaDesc').value = data.metaDesc || '';
    document.getElementById('postTags').value = data.tags || '';
    document.getElementById('postContent').value = data.content || '';

    // Checkboxes
    document.querySelectorAll('.cat-cb').forEach(cb => {
        cb.checked = data.categories && data.categories.includes(cb.value);
    });

    // Players List
    const playersContainer = document.getElementById('playersContainer');
    playersContainer.innerHTML = '';

    if (data.players) {
        let i = 1;
        data.players.forEach(p => {
            const row = document.createElement('div');
            row.className = 'player-input-row';
            row.innerHTML = `
                <span class="row-num">${i++}</span>
                <div class="pi-fields">
                    <input type="text" class="pi-name" value="${p.name || ''}" placeholder="Track Name" required>
                    <input type="text" class="pi-html" value="${p.html.replace(/"/g, '&quot;') || ''}" placeholder="<audio controls...>" required>
                    <input type="url" class="pi-url" value="${p.url || ''}" placeholder="GitHub Download URL" required>
                </div>
                <button type="button" class="btn danger-btn remove-player-btn"><i class="fas fa-trash"></i></button>
            `;
            playersContainer.appendChild(row);

            row.querySelector('.remove-player-btn').addEventListener('click', () => {
                row.remove();
                let idx = 1;
                playersContainer.querySelectorAll('.row-num').forEach(el => { el.textContent = idx++; });
            });
        });
    }
};

window.deleteAdminPost = async function (id) {
    if (confirm("Are you sure you want to delete this post?")) {
        try {
            await deleteDoc(doc(db, "posts", id));
            loadAdminPosts(); // refresh
        } catch (e) { alert("Error deleting: " + e.message); }
    }
}

// ==========================================
// LAYOUT MANAGER LOGIC
// ==========================================
const layoutItemsList = document.getElementById('layoutItemsList');

// Function to render layout items inside Admin
async function renderAdminLayoutManager() {
    if (!layoutItemsList) return;
    layoutItemsList.innerHTML = '<p class="loader"><i class="fas fa-spinner fa-spin"></i> Loading layout config...</p>';

    await fetchHomepageLayout();

    layoutItemsList.innerHTML = '';
    if (homepageLayoutConfig.length === 0) {
        layoutItemsList.innerHTML = '<p class="text-secondary">No sections configured.</p>';
        return;
    }

    homepageLayoutConfig.forEach((item, index) => {
        addLayoutRowToDOM(item.category, item.count, index);
    });
}

function addLayoutRowToDOM(category, count, index) {
    const row = document.createElement('div');
    row.className = 'layout-item';
    row.innerHTML = `
        <div class="layout-info">
            <i class="fas fa-grip-lines text-secondary" style="cursor: move;"></i>
            <strong>${category}</strong>
            <span class="text-secondary">Shows</span>
            <input type="number" class="layout-count-input layout-count" value="${count}" min="1" max="20">
            <span class="text-secondary">Posts</span>
            <input type="hidden" class="layout-cat-value" value="${category}">
        </div>
        <div class="layout-actions">
            <button class="btn outline-btn btn-sm move-up" title="Move Up" ${index === 0 ? 'disabled' : ''}><i class="fas fa-arrow-up"></i></button>
            <button class="btn outline-btn btn-sm move-down" title="Move Down"><i class="fas fa-arrow-down"></i></button>
            <button class="btn danger-btn btn-sm del-layout" title="Remove"><i class="fas fa-trash"></i></button>
        </div>
    `;
    layoutItemsList.appendChild(row);

    // Attach event listeners explicitly
    row.querySelector('.del-layout').addEventListener('click', () => {
        row.remove();
        updateLayoutButtonStates();
        document.getElementById('saveLayoutBtn').click();
    });
    row.querySelector('.move-up').addEventListener('click', () => {
        if (row.previousElementSibling) {
            row.parentNode.insertBefore(row, row.previousElementSibling);
            updateLayoutButtonStates();
            document.getElementById('saveLayoutBtn').click();
        }
    });
    row.querySelector('.move-down').addEventListener('click', () => {
        if (row.nextElementSibling) {
            row.parentNode.insertBefore(row.nextElementSibling, row);
            updateLayoutButtonStates();
            document.getElementById('saveLayoutBtn').click();
        }
    });
}

function updateLayoutButtonStates() {
    const rows = layoutItemsList.querySelectorAll('.layout-item');
    rows.forEach((row, i) => {
        row.querySelector('.move-up').disabled = i === 0;
        row.querySelector('.move-down').disabled = i === rows.length - 1;
    });
}

document.getElementById('addLayoutSectionBtn')?.addEventListener('click', () => {
    const cat = document.getElementById('newLayoutCat').value;
    const count = parseInt(document.getElementById('newLayoutCount').value) || 4;
    addLayoutRowToDOM(cat, count, layoutItemsList.children.length);
    updateLayoutButtonStates();
    document.getElementById('saveLayoutBtn').click(); // Auto sync
});

document.getElementById('saveLayoutBtn')?.addEventListener('click', async (e) => {
    e.preventDefault();
    if (!currentUser || currentUser.email.toLowerCase() !== ADMIN_EMAIL || !isAdminVerified) return alert("Unauthorized!");

    const msg = document.getElementById('layoutStatusMsg');
    const btn = e.target;
    btn.disabled = true; btn.textContent = 'Saving...';

    const layoutArray = [];
    document.querySelectorAll('.layout-item').forEach(row => {
        layoutArray.push({
            category: row.querySelector('.layout-cat-value').value,
            count: parseInt(row.querySelector('.layout-count-input').value) || 4
        });
    });

    try {
        await setDoc(doc(db, "site_settings", "homepage_layout"), { categories: layoutArray }, { merge: false });
        msg.textContent = 'Layout Configuration Saved Successfully!';
        msg.style.color = 'var(--accent-color)';
        setTimeout(() => msg.textContent = '', 3000);
    } catch (err) {
        msg.textContent = 'Error: ' + err.message;
        msg.style.color = 'var(--danger-color)';
    } finally {
        btn.disabled = false; btn.textContent = 'Save Layout configuration';
    }
});

// Refresh layout UI when entering tab
document.querySelector('.tab-btn[data-tab="layoutManagerTab"]')?.addEventListener('click', () => {
    renderAdminLayoutManager();
});


// Settings Injection (existing logic)
document.getElementById('settingsForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser || currentUser.email.toLowerCase() !== ADMIN_EMAIL || !isAdminVerified) return alert("Unauthorized!");

    const msg = document.getElementById('settingsStatusMsg');
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Saving...';

    const settingsData = {
        headCode: document.getElementById('headCode').value,
        bodyCode: document.getElementById('bodyCode').value,
        footerCode: document.getElementById('footerCode').value
    };

    try {
        await setDoc(doc(db, "settings", "global"), settingsData);
        msg.textContent = 'Settings Saved Successfully! Reload app to see changes.';
        msg.style.color = 'var(--accent-color)';
    } catch (err) {
        msg.textContent = 'Error: ' + err.message;
        msg.style.color = 'var(--danger-color)';
    } finally {
        btn.disabled = false; btn.textContent = 'Save Settings';
    }
});

// Load settings into form if opened
if (document.getElementById('settingsForm')) {
    setTimeout(async () => {
        try {
            const d = await getDoc(doc(db, "settings", "global"));
            if (d.exists()) {
                document.getElementById('headCode').value = d.data().headCode || '';
                document.getElementById('bodyCode').value = d.data().bodyCode || '';
                document.getElementById('footerCode').value = d.data().footerCode || '';
            }
        } catch (e) { }
    }, 1000);
}
