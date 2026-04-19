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
        req.onsuccess = () => resolve();
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
    loading.style.display = 'flex';

    try {
        allClothes = await dbGetAll();
    } catch (e) {
        loading.style.display = 'none';
        showToast('加载数据失败');
        return;
    }

    loading.style.display = 'none';

    const search = (document.getElementById('searchInput').value || '').trim().toLowerCase();
    const category = document.getElementById('categoryFilter').value;

    let filtered = allClothes;

    // Season / favorites filter
    if (currentSeason === 'favorites') {
        filtered = filtered.filter(c => c.favorite);
    } else if (currentSeason !== 'all') {
        filtered = filtered.filter(c => c.season === currentSeason);
    }

    // Category filter
    if (category !== 'all') {
        filtered = filtered.filter(c => c.category === category);
    }

    // Search filter
    if (search) {
        filtered = filtered.filter(c =>
            (c.name || '').toLowerCase().includes(search) ||
            (c.color || '').toLowerCase().includes(search)
        );
    }

    if (filtered.length === 0) {
        empty.style.display = 'block';
        return;
    }

    // Sort by created_at descending
    filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const fragment = document.createDocumentFragment();
    filtered.forEach((item, index) => {
        const card = createClothCard(item, index);
        fragment.appendChild(card);
    });
    grid.appendChild(fragment);
}

function updateStats() {
    const total = allClothes.length;
    const seasons = { spring_autumn: 0, summer: 0, winter: 0 };
    let favorites = 0;
    allClothes.forEach(c => {
        if (seasons[c.season] !== undefined) seasons[c.season]++;
        if (c.favorite) favorites++;
    });
    document.getElementById('count-all').textContent = total;
    document.getElementById('count-spring_autumn').textContent = seasons.spring_autumn;
    document.getElementById('count-summer').textContent = seasons.summer;
    document.getElementById('count-winter').textContent = seasons.winter;
    document.getElementById('count-favorites').textContent = favorites;
    document.getElementById('headerCount').textContent = total + ' 件';
}

// ===== Card =====
function createClothCard(item, index) {
    const card = document.createElement('div');
    card.className = 'cloth-card';
    card.style.animationDelay = (index * 0.06) + 's';
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
            <button class="card-action-btn" onclick="event.stopPropagation(); deleteClothing('${item.id}')" title="删除">
                🗑️
            </button>
        </div>
        <div class="cloth-card-info">
            <div class="cloth-card-name">${escapeHtml(item.name)}</div>
            <div class="cloth-card-tags">
                <span class="tag">${escapeHtml(seasonLabel)}</span>
                <span class="tag">${escapeHtml(categoryLabel)}</span>
                ${item.color ? `<span class="tag">${escapeHtml(item.color)}</span>` : ''}
            </div>
        </div>
    `;
    return card;
}

// ===== Favorite =====
async function toggleFavorite(id, isFav) {
    try {
        const item = await dbGet(id);
        if (!item) return;
        item.favorite = !isFav;
        await dbPut(item);
        await loadClothes();
        updateStats();
        showToast(item.favorite ? '已收藏' : '已取消收藏');
    } catch (e) {
        showToast('操作失败');
    }
}

// ===== Delete =====
async function deleteClothing(id) {
    if (!confirm('确定要删除这件衣服吗？')) return;
    try {
        await dbDelete(id);
        await loadClothes();
        updateStats();
        showToast('已删除');
    } catch (e) {
        showToast('删除失败');
    }
}

// ===== Detail =====
function showDetail(item) {
    currentDetailId = item.id;
    document.getElementById('detailTitle').textContent = item.name || '详情';
    document.getElementById('detailImg').src = item.imageData || '';
    document.getElementById('detailName').textContent = item.name || '-';
    document.getElementById('detailSeason').textContent = SEASON_LABELS[item.season] || item.season || '-';
    document.getElementById('detailCategory').textContent = CATEGORY_LABELS[item.category] || item.category || '-';
    document.getElementById('detailColor').textContent = item.color || '-';
    const date = item.created_at ? new Date(item.created_at).toLocaleDateString('zh-CN') : '-';
    document.getElementById('detailDate').textContent = date;
    document.getElementById('detailModal').classList.add('show');
}

function closeDetailModal() {
    document.getElementById('detailModal').classList.remove('show');
    currentDetailId = null;
}

async function deleteFromDetail() {
    if (!currentDetailId) return;
    if (!confirm('确定要删除这件衣服吗？')) return;
    try {
        await dbDelete(currentDetailId);
        closeDetailModal();
        await loadClothes();
        updateStats();
        showToast('已删除');
    } catch (e) {
        showToast('删除失败');
    }
}

// ===== Add Modal =====
function openAddModal() {
    resetAddForm();
    document.getElementById('addModal').classList.add('show');
}

function closeAddModal() {
    document.getElementById('addModal').classList.remove('show');
    resetAddForm();
}

function resetAddForm() {
    selectedFile = null;
    selectedBlob = null;
    document.getElementById('previewImg').style.display = 'none';
    document.getElementById('uploadPreviewArea').style.display = 'none';
    document.getElementById('uploadPlaceholder').style.display = 'flex';
    document.getElementById('clothName').value = '';
    document.getElementById('clothSeason').value = 'spring_autumn';
    document.getElementById('clothCategory').value = 'tops';
    document.getElementById('clothColor').value = '';
    document.getElementById('fileInput').value = '';
}

function removePreview() {
    selectedFile = null;
    selectedBlob = null;
    document.getElementById('previewImg').style.display = 'none';
    document.getElementById('uploadPreviewArea').style.display = 'none';
    document.getElementById('uploadPlaceholder').style.display = 'flex';
    document.getElementById('fileInput').value = '';
}

function setupUploadDragDrop() {
    const area = document.getElementById('uploadArea');
    if (!area) return;
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
        document.getElementById('uploadPreviewArea').style.display = 'flex';
        document.getElementById('uploadPlaceholder').style.display = 'none';
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
        updateStats();
        showToast('添加成功');
    } catch (e) {
        console.error('Save failed:', e);
        showToast('保存失败，请重试');
    } finally {
        btn.disabled = false;
        btn.textContent = '保存';
    }
}

function compressImage(file, maxSize, quality) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let w = img.width, h = img.height;
                if (w > maxSize || h > maxSize) {
                    if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
                    else { w = Math.round(w * maxSize / h); h = maxSize; }
                }
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// ===== Match Mode =====
function openMatchMode() {
    currentMatchSlot = null;
    document.querySelectorAll('.match-slot').forEach(s => s.classList.remove('active-slot'));
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
    const slotEl = document.querySelector(`.match-slot[data-slot="${slot}"]`);
    if (slotEl) slotEl.classList.add('active-slot');
    loadMatchClothes();
}

async function loadMatchClothes() {
    const grid = document.getElementById('matchGrid');
    grid.innerHTML = '';

    try {
        const clothes = await dbGetAll();
        const seasonFilter = document.getElementById('matchSeasonFilter').value;
        const categoryFilter = document.getElementById('matchCategoryFilter').value;

        let filtered = clothes;
        if (seasonFilter !== 'all') {
            filtered = filtered.filter(c => c.season === seasonFilter);
        }
        if (categoryFilter !== 'all') {
            filtered = filtered.filter(c => c.category === categoryFilter);
        }

        if (filtered.length === 0) {
            grid.innerHTML = '<p style="text-align:center;color:var(--text-dim);padding:30px;grid-column:1/-1;">暂无符合条件的衣服</p>';
            return;
        }

        filtered.forEach(item => {
            const div = document.createElement('div');
            div.className = 'match-item';
            if (currentMatchSlot && matchSlots[currentMatchSlot] === item.id) {
                div.classList.add('selected');
            }
            div.innerHTML = `<img src="${item.imageData || ''}" alt="${escapeHtml(item.name)}" loading="lazy">`;
            div.onclick = () => {
                if (!currentMatchSlot) { showToast('请先选择一个搭配位'); return; }
                matchSlots[currentMatchSlot] = item.id;
                updateMatchSlots();
                loadMatchClothes();
            };
            grid.appendChild(div);
        });
    } catch (e) {
        showToast('加载失败');
    }
}

function updateMatchSlots() {
    const slotTypes = ['tops', 'bottoms', 'outerwear', 'shoes'];
    slotTypes.forEach(async type => {
        const img = document.getElementById(`match-${type}`);
        const ph = document.getElementById(`match-${type}-ph`);
        const slotEl = document.querySelector(`.match-slot[data-slot="${type}"]`);
        const itemId = matchSlots[type];
        if (itemId) {
            try {
                const item = await dbGet(itemId);
                if (item && item.imageData) {
                    img.src = item.imageData;
                    img.style.display = 'block';
                    ph.style.display = 'none';
                    slotEl.classList.add('filled');
                } else {
                    img.style.display = 'none';
                    ph.style.display = 'block';
                    slotEl.classList.remove('filled');
                }
            } catch (e) {
                img.style.display = 'none';
                ph.style.display = 'block';
                slotEl.classList.remove('filled');
            }
        } else {
            img.style.display = 'none';
            ph.style.display = 'block';
            slotEl.classList.remove('filled');
        }
    });
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
