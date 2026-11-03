package app.wingtipmaps.android

/**
 * Where the servers are: the host the build was made for
 * (BuildConfig.WINGTIP_HOST, from the WINGTIP_HOST the workflow passes),
 * the gateway at its root and the planner behind the gateway's proxy, as
 * the website and the iOS app have them (PlannerProxyController:
 * `/api/planner/course` upstream is `/api/course`).
 */
object Config {
    val host: String = BuildConfig.WINGTIP_HOST.trim().ifEmpty { "wingtipmaps.app" }

    /** The gateway: accounts, flights, the planner's proxy. */
    val gateway: String get() = "https://$host"

    /** The planner's operation paths are `/api/…`; through the gateway
     *  they are `/api/planner/…` (PlannerPath rewrites them). */
    const val plannerPrefix = "/api/planner"

    /** A planner path as the gateway serves it. */
    fun plannerPath(path: String): String =
        if (path.startsWith("/api/")) plannerPrefix + path.removePrefix("/api") else path
}
