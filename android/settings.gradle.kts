// The native Android app (docs/NATIVE-ANDROID.md): one module, the app.
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    // Every dependency from these two, declared here once: a module that
    // named a repository of its own would fail the build.
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "WingtipMaps"
include(":app")
