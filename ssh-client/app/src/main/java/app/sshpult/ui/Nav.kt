package app.sshpult.ui

import androidx.compose.runtime.Composable
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument

private fun NavHostController.go(route: String) = navigate(route) { launchSingleTop = true }

/** Pops one screen, but never the last one (protects against double taps on Back). */
private fun NavHostController.back() {
    if (previousBackStackEntry != null) popBackStack()
}

@Composable
fun AppNav() {
    val nav = rememberNavController()
    val optionalId = listOf(navArgument("id") { type = NavType.StringType; nullable = true; defaultValue = null })
    NavHost(nav, startDestination = "home") {
        composable("home") {
            HomeScreen(
                onOpenSession = { nav.go("session/$it") },
                onEditConnection = { nav.go(if (it == null) "connection" else "connection?id=$it") },
                onEditScript = { nav.go(if (it == null) "script" else "script?id=$it") },
                onRunScript = { scriptId, connectionId -> nav.go("run/$scriptId/$connectionId") },
            )
        }
        composable("connection?id={id}", arguments = optionalId) { entry ->
            ConnectionEditScreen(
                entry.arguments?.getString("id"), onDone = nav::back,
                onConnect = { id -> nav.back(); nav.go("session/$id") },
            )
        }
        composable("script?id={id}", arguments = optionalId) { entry ->
            ScriptEditScreen(entry.arguments?.getString("id"), onDone = nav::back)
        }
        composable("session/{id}") { entry ->
            val id = entry.arguments?.getString("id").orEmpty()
            SessionScreen(id, onBack = nav::back, onRunScript = { nav.go("run/$it/$id") })
        }
        composable("run/{scriptId}/{connectionId}") { entry ->
            ScriptRunScreen(
                scriptId = entry.arguments?.getString("scriptId").orEmpty(),
                connectionId = entry.arguments?.getString("connectionId").orEmpty(),
                onBack = nav::back,
            )
        }
    }
}
