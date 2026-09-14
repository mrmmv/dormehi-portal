# Learner Portal Mobile App (Android & iOS)

This mobile app provides **100% Offline-First Examination capabilities** with automatic sync, anti-cheating protections, and deterministic question shuffling per learner.

---

## Features
1. **Offline Examination:** Students can download scheduled exams while connected to internet/Wi-Fi and complete them with zero internet.
2. **Deterministic Shuffling:** Questions are uniquely shuffled per learner using Knuth golden-ratio PRNG, so students sitting side-by-side see different question orders.
3. **Auto-Saving:** Every answer click is saved atomically to local storage. If the phone battery dies or the app restarts, zero answers are lost.
4. **Anti-Cheat Enforcement:**
   - Tab switching, minimizing, or app switching triggers instant security violations.
   - Screen pinning and full-screen enforcement.
   - **Android `FLAG_SECURE`:** Physically blocks screenshots and screen recording by operating system policy.
   - **In-Person Teacher Unlock:** If a student gets locked out offline, their Subject Teacher / Proctor can enter the exam-specific 4-digit PIN directly on the student's phone to unlock the test.
5. **Auto-Sync:** When the device reconnects to Wi-Fi/mobile data, pending completed exams are automatically uploaded and graded on the server.

---

## 📱 Easiest Way to Install on iOS (iPhone & iPad)

Apple has strict developer requirements ($99/year Apple Developer account + macOS computer with Xcode) to compile native `.ipa` files. 

However, **there is a zero-cost, instant way for students on iOS to install this app with full offline capabilities**:

### The 10-Second Progressive Web App (PWA) Method:
1. Open **Safari** on the iPhone or iPad.
2. Navigate to your student portal URL (e.g., `https://portal.yourdomain.com`).
3. Tap the **Share** button (the square with an arrow pointing up at the bottom of Safari).
4. Scroll down and tap **"Add to Home Screen"**.
5. Tap **Add** in the top right.

**Done!**
* The Learner Portal icon appears directly on the student's iOS Home Screen alongside other apps.
* It launches in **standalone mode** (Safari browser search bar and back buttons disappear).
* Thanks to the built-in Service Worker and `offline-exam-manager.js`, students can turn on **Airplane Mode** and take their downloaded exams completely offline!

---

## 🤖 Building the Native Android APK

### Step 1: Install Dependencies
Open terminal/cmd in the `mobile-app` directory:
```bash
cd mobile-app
npm install
```

### Step 2: Sync Web Assets
Whenever you make updates to the web portal, run:
```bash
npm run cap:sync
```

### Step 3: Add Android Platform
```bash
npx cap add android
```

### Step 4: Enable `FLAG_SECURE` (Blocks Screenshots & Screen Recording)
Open `mobile-app/android/app/src/main/java/ph/deped/dsmsmnhs/learnerportal/MainActivity.java`:
```java
package ph.deped.dsmsmnhs.learnerportal;

import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Anti-Cheat: Physically block screenshots, screen recording, and task switcher previews
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
        );
    }
}
```

### Step 5: Compile the Debug APK
```bash
cd android
./gradlew assembleDebug
```
The compiled APK will be located at:
`mobile-app/android/app/build/outputs/apk/debug/app-debug.apk`

---

## 🚀 Distributing the Android APK to Students
You do **NOT** need to publish to the Google Play Store. You can distribute the `.apk` directly to students:
1. **Direct Download from School Portal:** Place `learner-portal.apk` in `portal/public/downloads/` so students can download it directly from `https://your-school-portal.com/downloads/learner-portal.apk`.
2. **USB / Flash Drive / Bluetooth:** Transfer directly to Android devices in the classroom.
3. **Local Wi-Fi File Sharing:** Share over the school's local intranet.
