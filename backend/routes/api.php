<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\LiveKitController;
use App\Http\Controllers\AnswerPointSyncController;
use App\Http\Controllers\BusinessController;
use App\Http\Controllers\PhoneNumberController;
use App\Http\Controllers\VoiceController;
use App\Http\Controllers\CallLogController;
use App\Http\Controllers\UsageController;

Route::get('/user', function (Request $request) {
    return $request->user();
})->middleware('auth:sanctum');

// Single shared admin login (Sanctum SPA session auth) for the dashboard -
// see AuthController.
Route::post('/login', [AuthController::class, 'login']);
Route::middleware('auth:sanctum')->group(function () {
    Route::post('/logout', [AuthController::class, 'logout']);
    Route::get('/me', [AuthController::class, 'user']);
});


Route::get('/health', function () {
    return response()->json([
        'status' => 'ok',
        'time' => now()->toIso8601String(),
    ]);
});

Route::post('/livekit/token', [LiveKitController::class, 'token']);

// Internal ingestion endpoint for ai-runtime's end-of-call POST - shared
// API key, not a browser session (see VerifyRuntimeApiKey).
Route::post('/call-logs', [CallLogController::class, 'store'])->middleware('runtime.key');

// Admin dashboard - Sanctum session auth.
Route::middleware('auth:sanctum')->group(function () {
    Route::get('/businesses', [BusinessController::class, 'index']);
    Route::post('/businesses', [BusinessController::class, 'store']);
    // Pulls AnswerPoint's real client list in and reconciles it into
    // businesses/phone_numbers (see AnswerPointClientSync) - the
    // businesses/index.vue "Sync now" button. Registered as its own
    // literal-path POST route so it can't collide with the numeric
    // {business} PUT/DELETE routes below regardless of file order.
    Route::post('/businesses/sync-answerpoint', [AnswerPointSyncController::class, 'sync']);
    // Registered here, BEFORE the public GET /businesses/{slug} route
    // below, on purpose: Laravel matches GET routes for the same path
    // shape in registration order and only falls through to the next one
    // when a constraint fails, so this needs to come first in the file
    // for whereNumber to actually do its job. If this ever gets moved
    // above/after that route without moving this whole group with it,
    // a numeric business id would incorrectly fall through to the slug
    // lookup (or vice versa, break this route for good ids) - keep them
    // adjacent in file order, not just distinguished by constraint.
    Route::get('/businesses/{business}', [BusinessController::class, 'showById'])->whereNumber('business');
    Route::put('/businesses/{business}', [BusinessController::class, 'update']);
    Route::delete('/businesses/{business}', [BusinessController::class, 'destroy']);

    Route::get('/phone-numbers', [PhoneNumberController::class, 'index']);
    Route::post('/phone-numbers', [PhoneNumberController::class, 'store']);
    Route::put('/phone-numbers/{phoneNumber}', [PhoneNumberController::class, 'update']);
    Route::delete('/phone-numbers/{phoneNumber}', [PhoneNumberController::class, 'destroy']);

    Route::get('/voices', [VoiceController::class, 'index']);
    // "Hear a sample" button on the business edit page - see
    // VoiceController::preview(). {voiceId} isn't constrained to the UUID
    // shape here; the controller/ai-runtime side validates and returns a
    // clean 400/502 rather than a route-matching 404 for a bad id.
    Route::get('/voices/{voiceId}/preview', [VoiceController::class, 'preview'])->whereUuid('voiceId');

    Route::get('/call-logs', [CallLogController::class, 'index']);
    Route::get('/call-logs/{callLog}', [CallLogController::class, 'show']);

    Route::get('/usage/summary', [UsageController::class, 'summary']);
});

// Public - ai-runtime's per-call routing lookup (see
// BusinessController::showByPhone and ai-runtime's LaravelClient.ts /
// test-token.ts:beginCall). Two path segments, so this can't collide with
// the single-segment routes below it either way - no ordering hazard
// like the numeric-id/slug pair above.
Route::get('/businesses/by-phone/{number}', [BusinessController::class, 'showByPhone']);

// Public - ai-runtime's own KB fetch at process startup, and its fallback
// when phone-based routing above doesn't apply or fails (see
// ai-runtime/src/services/LaravelClient.ts). Registered AFTER the admin
// group above so the numeric {business} route there (constrained with
// whereNumber) gets first crack at a numeric segment; only a non-numeric
// slug falls through to here. Everything else business-related is
// admin-dashboard-only, in the group above.
Route::get('/businesses/{slug}', [BusinessController::class, 'show']);
