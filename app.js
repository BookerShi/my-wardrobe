// ===== Database (IndexedDB) =====
const DB_NAME = 'WardrobeDB';
const DB_VERSION = 1;
const STORE = 'clothes';
let db = null;

function openDB() {
    return new Promise((resolve, reject) => {
        if (db) return resolve(db);
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = e => {
            const d = e.target.result;
            if (!d.objectStoreNames.contains(STORE)) {
                d.createObjectStore(STORE, { keyPath: 'id' });
            }
        };
        req.onsuccess = e => { db = e.target.result; resolve(db); };
        req.onerror = e => reject(e.target.error);
    });
}

async function dbGetAll() {
    const d = await openDB();
    return new Promise((resolve, reject) => {
        const tx = d.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function dbGet(id) {
    const d = await openDB();
    return new Promise((resolve, reject) => {
        const tx = d.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function dbPut(item) {
    const d = await openDB();
    return new Promise((resolve, reject) => {
        const tx = d.transaction(STORE, 'readwrite');
        const req = tx.objectStore(STORE).put(item);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function dbDelete(id) {
    const d = await openDB();
    return new Promise((resolve, reject) => {
        const tx = d.transaction(STORE, 'readwrite');
        const req = tx.objectStore(STORE).delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

// ===== State =====
let currentSeason = 'all';
let allClothes = [];
let selectedFile = null;
let selectedBlob = null;
let matchSlots = { tops: null, bottoms: null, outerwear: null, shoes: null };
let currentMatchSlot = null;
let currentDetailId = null;
let searchTimer = null;

const SEASON_LABELS = { spring_autumn: '春秋', summer: '夏', winter: '冬' };
const CATEGORY_LABELS = { tops: '上装', bottoms: '下装', dresses: '连衣裙', outerwear: '外套', shoes: '鞋子', bags: '包包', accessories: '配饰' };

// ===== Init =====
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await openDB();
        await loadClothes();
        updateStats();
        setupUploadDragDrop();
        setupNavClicks();
        registerSW();
    } catch (e) {
        console.error('Init failed:', e);
        showToast('初始化失败，请刷新重试');
    }
});

function registerSW() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
}

// ===== Navigation =====
function setupNavClicks() {
    document.querySelectorAll('.tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentSeason = btn.dataset.season;
            loadClothes();
        });
    });
}

// ===== Load & Filter =====
async function loadClothes() {
    const grid = document.getElementById('clothesGrid');
    const empty = document.getElementById('emptyState');
    const loading = document.getElementById('loading');

    grid.innerHTML = '';
    empty.style.display = 'none';
    loading.style.display = 'block';

    try {
        let clothes = await dbGetAll();

        const category = document.getElementById('categoryFilter').value;
        const search = document.getElementById('searchInput').value.trim().toLowerCase();

        if (currentSeason !== 'all' && currentSeason !== 'favorites') {
            clothes = clothes.filter(c => c.season === currentSeason);
        }
        if (currentSeason === 'favorites') {
            clothes = clothes.filter(c => c.favorite);
        }
        if (category !== 'all') {
            clothes = clothes.filter(c => c.category === category);
        }
        if (search) {
            clothes = clothes.filter(c =>
                (c.name || '').toLowerCase().includes(search) ||
                (c.color || '').toLowerCase().includes(search)
            );
        }

        // Sort newest first
        clothes.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

        allClothes = clothes;
        loading.style.display = 'none';

        if (clothes.length === 0) {
            empty.style.display = 'block';
            return;
        }

        clothes.forEach((item, index) => {
            const card = createClothCard(item);
            card.style.animationDelay = `${index * 0.05}s`;
            grid.appendChild(card);
        });
    } catch (e) {
        loading.style.display = 'none';
        showToast('加载失败');
    }
}

async function updateStats() {
    const clothes = await dbGetAll();
    const total = clothes.length;
    const seasons = { spring_autumn: 0, summer: 0, winter: 0 };
    let favorites = 0;
    clothes.forEach(c => {
        if (seasons[c.season] !== undefined) seasons[c.season]++;
        if (c.favorite) favorites++;
    });
    document.getElementById('count-all').textContent = total;
    document.getElementById('count-spring_autumn').textContent = seasons.spring_autumn;
    document.getElementById('count-summer').textContent = seasons.summer;
    document.getElementById('count-winter').textContent = seasons.winter;
    document.getElementById('count-favorites').textContent = favorites;
}

// ===== Card =====
function createClothCard(item) {
    const card = document.createElement('div');
    card.className = 'cloth-card';
    card.onclick = () => showDetail(item);

    const seasonLabel = SEASON_LABELS[item.season] || item.season;
    const categoryLabel = CATEGORY_LABELS[item.category] || item.category;
    const imgSrc = item.imageData || '';

    card.innerHTML = `
        <img src="${imgSrc}" alt="${escapeHtml(item.name)}" loading="lazy">
        <div class="cloth-card-actions">
            <button class="card-action-btn ${item.favorite ? 'favorited' : ''}" onclick="event.stopPropagation(); toggleFavorite('${item.id}', ${!!item.favorite})" title="收藏">
                ${item.favorite ? '❤️' : '🤍'}
            </button>
            <button class="card-action-btn" onclick="event.stopPropagation(); confirmDelete('${item.id}')" title="删除">🗑️</button>
        </div>
        <div class="cloth-card-info">
            <div class="cloth-card-name">${escapeHtml(item.name)}</div>
            <div class="cloth-card-tags">
                <span class="tag">${seasonLabel}</span>
                <span class="tag">${categoryLabel}</span>
                ${item.color ? `<span class="tag">${escapeHtml(item.color)}</span>` : ''}
            </div>
        </div>
    `;
    return card;
}

// ===== Add Clothing =====
function openAddModal() {
    document.getElementById('addModal').classList.add('show');
    resetAddForm();
}

function closeAddModal() {
    document.getElementById('addModal').classList.remove('show');
    resetAddForm();
}

function resetAddForm() {
    selectedFile = null;
    selectedBlob = null;
    document.getElementById('previewImg').style.display = 'none';
    document.getElementById('uploadPlaceholder').style.display = 'flex';
    document.getElementById('uploadActions').style.display = 'flex';
    document.getElementById('clothName').value = '';
    document.getElementById('clothSeason').value = 'spring_autumn';
    document.getElementById('clothCategory').value = 'tops';
    document.getElementById('clothColor').value = '';
    document.getElementById('fileInput').value = '';
}

function setupUploadDragDrop() {
    const area = document.getElementById('uploadArea');
    area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('dragover'); });
    area.addEventListener('dragleave', () => area.classList.remove('dragover'));
    area.addEventListener('drop', e => {
        e.preventDefault();
        area.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) processFile(file);
    });
}

// ===== Photo picking: album vs camera =====
function pickFromAlbum() {
    const input = document.getElementById('fileInput');
    input.removeAttribute('capture');
    input.accept = 'image/*';
    input.click();
}

function takePhoto() {
    const input = document.getElementById('fileInput');
    input.setAttribute('capture', 'environment');
    input.accept = 'image/*';
    input.click();
}

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) processFile(file);
    // Reset capture so next click uses default behavior
    const input = document.getElementById('fileInput');
    input.removeAttribute('capture');
}

function processFile(file) {
    selectedFile = file;
    const reader = new FileReader();
    reader.onload = e => {
        document.getElementById('previewImg').src = e.target.result;
        document.getElementById('previewImg').style.display = 'block';
        document.getElementById('uploadPlaceholder').style.display = 'none';
        document.getElementById('uploadActions').style.display = 'none';
    };
    reader.readAsDataURL(file);
}

async function saveClothing() {
    if (!selectedFile) { showToast('请先选择一张照片'); return; }

    const name = document.getElementById('clothName').value.trim() || '未命名';
    const season = document.getElementById('clothSeason').value;
    const category = document.getElementById('clothCategory').value;
    const color = document.getElementById('clothColor').value.trim();

    const btn = document.getElementById('saveBtn');
    btn.disabled = true;
    btn.textContent = '保存中...';

    try {
        // Compress image before storing
        const imageData = await compressImage(selectedFile, 800, 0.8);

        const item = {
            id: generateId(),
            name, season, category, color,
            imageData,
            favorite: false,
            created_at: new Date().toISOString()
        };

        await dbPut(item);
        closeAddModal();
        await loadClothes();
        await updateStats();
        showToast('添加成功 ✨');
    } catch (e) {
        console.error('Save failed:', e);
        showToast('保存失败');
    } finally {
        btn.disabled = false;
        btn.textContent = '保存';
    }
}

function compressImage(file, maxW, quality) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let w = img.width, h = img.height;
            if (w > maxW) { h = h * maxW / w; w = maxW; }
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
    });
}

// ===== Favorite & Delete =====
async function toggleFavorite(id, current) {
    try {
        const item = await dbGet(id);
        if (!item) return;
        item.favorite = !current;
        await dbPut(item);
        await loadClothes();
        await updateStats();
    } catch (e) {
        showToast('操作失败');
    }
}

function confirmDelete(id) {
    if (confirm('确定要删除这件衣服吗？')) {
        deleteClothing(id);
    }
}

async function deleteClothing(id) {
    try {
        await dbDelete(id);
        await loadClothes();
        await updateStats();
        showToast('已删除');
        // Close detail modal if open
        if (currentDetailId === id) closeDetailModal();
    } catch (e) {
        showToast('删除失败');
    }
}

// ===== Detail =====
async function showDetail(item) {
    currentDetailId = item.id;
    document.getElementById('detailTitle').textContent = item.name || '详情';
    document.getElementById('detailImg').src = item.imageData || '';
    document.getElementById('detailName').textContent = item.name || '-';
    document.getElementById('detailSeason').textContent = SEASON_LABELS[item.season] || item.season || '-';
    document.getElementById('detailCategory').textContent = CATEGORY_LABELS[item.category] || item.category || '-';
    document.getElementById('detailColor').textContent = item.color || '-';
    document.getElementById('detailDate').textContent = formatDate(item.created_at);
    document.getElementById('detailDeleteBtn').onclick = () => {
        if (confirm('确定要删除这件衣服吗？')) {
            deleteClothing(item.id);
        }
    };
    document.getElementById('detailModal').classList.add('show');
}

function closeDetailModal() {
    document.getElementById('detailModal').classList.remove('show');
    currentDetailId = null;
}

function formatDate(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ===== Match Mode =====
function openMatchMode() {
    matchSlots = { tops: null, bottoms: null, outerwear: null, shoes: null };
    currentMatchSlot = null;
    document.getElementById('matchModal').classList.add('show');
    updateMatchSlots();
    loadMatchClothes();
}

function closeMatchModal() {
    document.getElementById('matchModal').classList.remove('show');
}

function pickForSlot(slot) {
    currentMatchSlot = slot;
    document.querySelectorAll('.match-slot').forEach(s => s.classList.remove('active-slot'));
    document.querySelector(`.match-slot[data-slot="${slot}"]`).classList.add('active-slot');
    loadMatchClothes();
}

async function loadMatchClothes() {
    const grid = document.getElementById('matchGrid');
    grid.innerHTML = '';

    let clothes = await dbGetAll();

    if (currentMatchSlot) {
        // Only show items matching the slot category
        const catMap = { tops: 'tops', bottoms: 'bottoms', outerwear: 'outerwear', shoes: 'shoes' };
        const targetCat = catMap[currentMatchSlot];
        clothes = clothes.filter(c => c.category === targetCat);
    }

    const seasonFilter = document.getElementById('matchSeasonFilter').value;
    const catFilter = document.getElementById('matchCategoryFilter').value;
    if (seasonFilter !== 'all') clothes = clothes.filter(c => c.season === seasonFilter);
    if (catFilter !== 'all') clothes = clothes.filter(c => c.category === catFilter);

    clothes.forEach(item => {
        const div = document.createElement('div');
        div.className = 'match-item' + (isInMatchSlots(item.id) ? ' selected' : '');
        div.innerHTML = `<img src="${item.imageData}" alt="${escapeHtml(item.name)}" loading="lazy">`;
        div.onclick = () => selectForMatch(item);
        grid.appendChild(div);
    });
}

function isInMatchSlots(id) {
    return Object.values(matchSlots).some(s => s && s.id === id);
}

function selectForMatch(item) {
    if (!currentMatchSlot) return;
    matchSlots[currentMatchSlot] = item;
    updateMatchSlots();
    loadMatchClothes();
}

function updateMatchSlots() {
    for (const [slot, item] of Object.entries(matchSlots)) {
        const img = document.getElementById(`match-${slot}`);
        const ph = document.getElementById(`match-${slot}-ph`);
        const slotEl = document.querySelector(`.match-slot[data-slot="${slot}"]`);

        if (item) {
            img.src = item.imageData;
            img.style.display = 'block';
            ph.style.display = 'none';
            slotEl.classList.add('filled');
        } else {
            img.style.display = 'none';
            ph.style.display = 'block';
            slotEl.classList.remove('filled');
        }
    }
}

function clearMatch() {
    matchSlots = { tops: null, bottoms: null, outerwear: null, shoes: null };
    currentMatchSlot = null;
    document.querySelectorAll('.match-slot').forEach(s => s.classList.remove('active-slot'));
    updateMatchSlots();
    loadMatchClothes();
}

// ===== Search =====
function debounceSearch() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadClothes, 300);
}

// ===== Utils =====
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
}

// Close modals on overlay click
document.querySelectorAll('.overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
        if (e.target === overlay) overlay.classList.remove('show');
    });
});

document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.overlay.show').forEach(m => m.classList.remove('show'));
    }
});
