plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Set by android/scripts/build-apk.mjs (npm run android:build).
val pbVersionName = (findProperty("pbVersionName") as String?) ?: "0.0.0-dev"
val pbVersionCode = ((findProperty("pbVersionCode") as String?) ?: "1").toInt()
// The release key lives outside the repository (%USERPROFILE%\.photobooth); an update APK
// must be signed with the same key or Android refuses to install it over the old one.
val releaseKeystore = System.getenv("PB_ANDROID_KEYSTORE")

android {
    namespace = "com.memories.photobooth"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.memories.photobooth"
        minSdk = 26
        targetSdk = 35
        versionCode = pbVersionCode
        versionName = pbVersionName
    }

    signingConfigs {
        if (releaseKeystore != null) {
            create("release") {
                storeFile = file(releaseKeystore)
                storePassword = System.getenv("PB_ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("PB_ANDROID_KEY_ALIAS") ?: "photobooth"
                keyPassword = System.getenv("PB_ANDROID_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (releaseKeystore != null) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        buildConfig = true
    }
    // The kiosk pages are copied here by android/scripts/prepare-web.mjs (not committed).
    androidResources {
        ignoreAssetsPattern = "!.svn:!.git:!.ds_store:!*.scc:!CVS:!thumbs.db:!picasa.ini:!*~"
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
