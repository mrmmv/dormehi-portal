/**
 * Offline Exam Manager
 * Provides offline storage, media pre-caching, auto-saving, offline anti-cheat tracking,
 * teacher proctor PIN verification, and automatic background sync.
 */

class OfflineExamManager {
    constructor() {
        this.dbName = 'LearnerPortalOfflineDB';
        this.dbVersion = 2;
        this.db = null;
        this.syncing = false;
        this.initPromise = this.initDB();
        this.setupNetworkListeners();
    }

    // Initialize IndexedDB
    async initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // 1. Cached Exam Bundles
                if (!db.objectStoreNames.contains('exams')) {
                    db.createObjectStore('exams', { keyPath: 'id' });
                }

                // 2. In-Progress Exam State (Auto-save)
                if (!db.objectStoreNames.contains('progress')) {
                    db.createObjectStore('progress', { keyPath: 'examId' });
                }

                // 3. Outbox / Sync Queue (Finished exams waiting for connection)
                if (!db.objectStoreNames.contains('sync_queue')) {
                    db.createObjectStore('sync_queue', { keyPath: 'examId' });
                }

                // 4. Cached Media Assets (Images, Audio clips)
                if (!db.objectStoreNames.contains('media_cache')) {
                    db.createObjectStore('media_cache', { keyPath: 'url' });
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };

            request.onerror = (event) => {
                console.error('IndexedDB init error:', event.target.error);
                reject(event.target.error);
            };
        });
    }

    async getDB() {
        if (!this.db) await this.initPromise;
        return this.db;
    }

    // Network status helpers
    isOnline() {
        return navigator.onLine;
    }

    setupNetworkListeners() {
        window.addEventListener('online', () => {
            console.log('🌐 Network connection restored. Checking pending exam sync queue...');
            this.updateSyncUI();
            this.syncPendingExams();
        });

        window.addEventListener('offline', () => {
            console.log('📴 Device switched to OFFLINE mode.');
            this.updateSyncUI();
        });
    }

    // Cache a media asset (image/audio) as Base64 Data URL
    async cacheMediaAsset(url) {
        if (!url || url.startsWith('data:') || url.startsWith('blob:')) return url;
        
        try {
            const db = await this.getDB();
            // Check if already in media_cache
            const cached = await new Promise((resolve) => {
                const tx = db.transaction('media_cache', 'readonly');
                const req = tx.objectStore('media_cache').get(url);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve(null);
            });

            if (cached && cached.dataUrl) {
                return cached.dataUrl;
            }

            // Fetch and convert to base64
            const response = await fetch(url, { mode: 'cors' });
            if (!response.ok) return url;

            const blob = await response.blob();
            const dataUrl = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.readAsDataURL(blob);
            });

            // Store in media_cache
            const tx = db.transaction('media_cache', 'readwrite');
            tx.objectStore('media_cache').put({ url, dataUrl, cached_at: new Date().toISOString() });

            return dataUrl;
        } catch (e) {
            console.warn('Failed to pre-cache media asset:', url, e);
            return url;
        }
    }

    // Download complete exam bundle for offline taking
    async downloadExamForOffline(examId, onProgress = null) {
        const token = localStorage.getItem('studentToken');
        if (!token) throw new Error('Student session expired. Please sign in while online.');

        if (onProgress) onProgress(10, 'Fetching exam questions & instructions...');

        const response = await fetch(`/api/student/exams/${examId}/offline-bundle`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({ error: 'Failed to download exam' }));
            throw new Error(err.error || 'Server rejected offline download');
        }

        const bundle = await response.json();
        const mediaAssets = bundle.media_assets || [];
        const totalMedia = mediaAssets.length;

        // Pre-cache media assets
        const cachedMediaMap = {};
        for (let i = 0; i < totalMedia; i++) {
            const mediaUrl = mediaAssets[i];
            if (onProgress) {
                const pct = 20 + Math.round(((i + 1) / totalMedia) * 60);
                onProgress(pct, `Caching media assets (${i + 1}/${totalMedia})...`);
            }
            try {
                const apiOrigin = window.__API_BASE__ || window.location.origin;
                const fullUrl = mediaUrl.startsWith('http') ? mediaUrl : `${apiOrigin}${mediaUrl.startsWith('/') ? '' : '/'}${mediaUrl}`;
                const cachedDataUrl = await this.cacheMediaAsset(fullUrl);
                cachedMediaMap[mediaUrl] = cachedDataUrl;
            } catch (e) {
                console.warn('Could not cache:', mediaUrl, e);
            }
        }

        if (onProgress) onProgress(85, 'Injecting offline media into exam questions...');

        // Replace media URLs in questions with local cached data
        if (bundle.exam_questions && Array.isArray(bundle.exam_questions)) {
            bundle.exam_questions = bundle.exam_questions.map(q => {
                const updatedQ = { ...q };
                if (updatedQ.image && cachedMediaMap[updatedQ.image]) updatedQ.image = cachedMediaMap[updatedQ.image];
                if (updatedQ.audio && cachedMediaMap[updatedQ.audio]) updatedQ.audio = cachedMediaMap[updatedQ.audio];
                if (updatedQ.option_a_image && cachedMediaMap[updatedQ.option_a_image]) updatedQ.option_a_image = cachedMediaMap[updatedQ.option_a_image];
                if (updatedQ.option_b_image && cachedMediaMap[updatedQ.option_b_image]) updatedQ.option_b_image = cachedMediaMap[updatedQ.option_b_image];
                if (updatedQ.option_c_image && cachedMediaMap[updatedQ.option_c_image]) updatedQ.option_c_image = cachedMediaMap[updatedQ.option_c_image];
                if (updatedQ.option_d_image && cachedMediaMap[updatedQ.option_d_image]) updatedQ.option_d_image = cachedMediaMap[updatedQ.option_d_image];
                return updatedQ;
            });
        }

        bundle.downloaded_at = new Date().toISOString();
        bundle.student_token = token;

        // Store into IndexedDB 'exams'
        const db = await this.getDB();
        await new Promise((resolve, reject) => {
            const tx = db.transaction('exams', 'readwrite');
            const req = tx.objectStore('exams').put(bundle);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });

        if (onProgress) onProgress(100, 'Exam downloaded and ready for offline taking!');
        this.updateSyncUI();
        return bundle;
    }

    // Check if exam is downloaded
    async isExamDownloaded(examId) {
        try {
            const db = await this.getDB();
            return new Promise((resolve) => {
                const tx = db.transaction('exams', 'readonly');
                const req = tx.objectStore('exams').get(parseInt(examId));
                req.onsuccess = () => resolve(!!req.result);
                req.onerror = () => resolve(false);
            });
        } catch (e) {
            return false;
        }
    }

    // Get downloaded exam bundle
    async getDownloadedExam(examId) {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('exams', 'readonly');
            const req = tx.objectStore('exams').get(parseInt(examId));
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    }

    // Auto-save student progress during the exam (called on every option click)
    async saveProgress(examId, data) {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('progress', 'readwrite');
            const store = tx.objectStore('progress');
            const getReq = store.get(parseInt(examId));

            getReq.onsuccess = () => {
                const current = getReq.result || { examId: parseInt(examId), answers: {}, violationsLog: [], violationCount: 0 };
                const updated = {
                    ...current,
                    ...data,
                    examId: parseInt(examId),
                    last_saved_at: new Date().toISOString()
                };
                store.put(updated);
                resolve(updated);
            };

            getReq.onerror = () => reject(getReq.error);
        });
    }

    // Retrieve saved progress
    async getProgress(examId) {
        const db = await this.getDB();
        return new Promise((resolve) => {
            const tx = db.transaction('progress', 'readonly');
            const req = tx.objectStore('progress').get(parseInt(examId));
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        });
    }

    // Log an offline anti-cheat violation
    async logOfflineViolation(examId, violationType, details) {
        const db = await this.getDB();
        return new Promise((resolve) => {
            const tx = db.transaction('progress', 'readwrite');
            const store = tx.objectStore('progress');
            const req = store.get(parseInt(examId));

            req.onsuccess = () => {
                const progress = req.result || { examId: parseInt(examId), answers: {}, violationsLog: [], violationCount: 0 };
                const newViolation = {
                    type: violationType,
                    description: details,
                    timestamp: new Date().toISOString()
                };
                const updatedLog = [...(progress.violationsLog || []), newViolation];
                const updatedCount = (progress.violationCount || 0) + 1;

                store.put({
                    ...progress,
                    violationsLog: updatedLog,
                    violationCount: updatedCount,
                    last_violation_at: new Date().toISOString()
                });

                resolve({ count: updatedCount, log: updatedLog });
            };
            req.onerror = () => resolve({ count: 1, log: [] });
        });
    }

    // Verify teacher proctor unlock PIN in offline mode
    async verifyTeacherPin(examId, enteredPin) {
        if (!enteredPin) return false;
        const exam = await this.getDownloadedExam(examId);
        if (!exam || !exam.proctor_pin_hash) return false;

        // Compute SHA-256 in browser using Web Crypto API
        const encoder = new TextEncoder();
        const data = encoder.encode(String(enteredPin).trim() + '_' + String(examId));
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        const isValid = hashHex.toLowerCase() === exam.proctor_pin_hash.toLowerCase();

        if (isValid) {
            // Unlock: reset violation counter in progress
            const db = await this.getDB();
            const tx = db.transaction('progress', 'readwrite');
            const store = tx.objectStore('progress');
            const req = store.get(parseInt(examId));
            req.onsuccess = () => {
                if (req.result) {
                    const updated = {
                        ...req.result,
                        violationCount: 0,
                        unlocked_by_teacher_at: new Date().toISOString()
                    };
                    store.put(updated);
                }
            };
        }

        return isValid;
    }

    // Mark exam as finished and enqueue for sync
    async queueForSync(examId, answers, startedAt, submittedAt, violationsLog = [], violationCount = 0) {
        const token = localStorage.getItem('studentToken');
        const db = await this.getDB();

        const syncItem = {
            examId: parseInt(examId),
            answers: answers || {},
            started_at: startedAt || new Date().toISOString(),
            submitted_at: submittedAt || new Date().toISOString(),
            violations_log: violationsLog || [],
            violation_count: violationCount || 0,
            status: 'pending',
            student_token: token,
            queued_at: new Date().toISOString()
        };

        await new Promise((resolve, reject) => {
            const tx = db.transaction('sync_queue', 'readwrite');
            const req = tx.objectStore('sync_queue').put(syncItem);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });

        this.updateSyncUI();

        // If currently online, attempt immediate sync
        if (this.isOnline()) {
            return await this.syncExamItem(syncItem);
        }

        return { offlineSaved: true, message: 'Saved on device. Will auto-sync when online.' };
    }

    // Upload a single completed exam to server
    async syncExamItem(syncItem) {
        const token = syncItem.student_token || localStorage.getItem('studentToken');
        if (!token) throw new Error('No authentication token available for sync');

        const response = await fetch(`/api/student/exams/${syncItem.examId}/sync-offline`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                answers: syncItem.answers,
                started_at: syncItem.started_at,
                submitted_at: syncItem.submitted_at,
                violations_log: syncItem.violations_log,
                violation_count: syncItem.violation_count
            })
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({ error: 'Sync failed' }));
            throw new Error(err.error || 'Server rejected sync');
        }

        const result = await response.json();

        // On successful sync, remove from sync_queue and clean up progress
        const db = await this.getDB();
        const tx = db.transaction(['sync_queue', 'progress'], 'readwrite');
        tx.objectStore('sync_queue').delete(syncItem.examId);
        tx.objectStore('progress').delete(syncItem.examId);

        this.updateSyncUI();
        return result;
    }

    // Background sync all pending exams
    async syncPendingExams() {
        if (this.syncing || !this.isOnline()) return;
        this.syncing = true;

        try {
            const db = await this.getDB();
            const items = await new Promise((resolve) => {
                const tx = db.transaction('sync_queue', 'readonly');
                const req = tx.objectStore('sync_queue').getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => resolve([]);
            });

            if (items.length === 0) {
                this.syncing = false;
                this.updateSyncUI();
                return;
            }

            console.log(`📤 Auto-syncing ${items.length} pending exam(s)...`);
            for (const item of items) {
                try {
                    await this.syncExamItem(item);
                    console.log(`✅ Synced Exam ID #${item.examId} successfully.`);
                } catch (e) {
                    console.warn(`⚠️ Failed to sync exam #${item.examId}:`, e.message);
                }
            }

            this.updateSyncUI();
            if (typeof window.renderExams === 'function') {
                window.renderExams();
            }
        } catch (e) {
            console.error('Error during auto-sync:', e);
        } finally {
            this.syncing = false;
        }
    }

    // Get count of pending sync items
    async getPendingSyncCount() {
        try {
            const db = await this.getDB();
            return new Promise((resolve) => {
                const tx = db.transaction('sync_queue', 'readonly');
                const req = tx.objectStore('sync_queue').count();
                req.onsuccess = () => resolve(req.result || 0);
                req.onerror = () => resolve(0);
            });
        } catch (e) {
            return 0;
        }
    }

    // Update global UI banner for sync and online/offline status
    async updateSyncUI() {
        const syncBar = document.getElementById('offlineSyncBar');
        const statusText = document.getElementById('offlineSyncStatusText');
        const syncBtn = document.getElementById('offlineSyncNowBtn');
        if (!syncBar || !statusText) return;

        const online = this.isOnline();
        const pendingCount = await this.getPendingSyncCount();

        if (pendingCount > 0) {
            syncBar.style.display = 'flex';
            syncBar.style.background = online ? '#0284c7' : '#d97706';
            statusText.innerHTML = online
                ? `<i class="fas fa-cloud-upload-alt"></i> <strong>${pendingCount} Exam(s) Waiting to Sync</strong> (Internet available)`
                : `<i class="fas fa-wifi-slash"></i> <strong>${pendingCount} Exam(s) Stored Offline</strong> (Will sync when internet returns)`;
            if (syncBtn) {
                syncBtn.style.display = online ? 'inline-block' : 'none';
            }
        } else if (!online) {
            syncBar.style.display = 'flex';
            syncBar.style.background = '#475569';
            statusText.innerHTML = `<i class="fas fa-plane"></i> <strong>Offline Mode</strong> — You can take downloaded exams without internet.`;
            if (syncBtn) syncBtn.style.display = 'none';
        } else {
            syncBar.style.display = 'none';
        }
    }
}

// Global Singleton Instance
window.offlineExamManager = new OfflineExamManager();
