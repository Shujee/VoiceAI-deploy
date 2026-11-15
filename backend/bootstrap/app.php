<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Sanctum SPA auth for the admin dashboard (Vue, separate origin -
        // see FRONTEND_PORT in docker-compose.yml): adds the
        // EnsureFrontendRequestsAreStateful middleware to the api group so
        // requests from a stateful domain (config/sanctum.php ->
        // SANCTUM_STATEFUL_DOMAINS) authenticate via the session cookie
        // instead of requiring a bearer token.
        $middleware->statefulApi();

        $middleware->alias([
            'runtime.key' => \App\Http\Middleware\VerifyRuntimeApiKey::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*'),
        );
    })->create();
