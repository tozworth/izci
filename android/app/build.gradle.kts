plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.izci.android"
    compileSdk = 36
    buildFeatures { buildConfig = true }
    buildTypes {
        getByName("debug") {
            isDebuggable = true
            isMinifyEnabled = false
        }
    }
    defaultConfig {
        applicationId = "app.izci.android"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.4.0-mvp"
    }
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("web-assets"))
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

val syncWebAssets by tasks.registering(Sync::class) {
    from(rootProject.file("../dist-android"))
    into(layout.buildDirectory.dir("web-assets/web"))
    doFirst {
        check(rootProject.file("../dist-android/index.html").isFile) { "Run npm run android:frontend first." }
    }
}
tasks.named("preBuild") { dependsOn(syncWebAssets) }

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    testImplementation("junit:junit:4.13.2")
}
