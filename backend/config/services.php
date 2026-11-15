<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    // Shared secret ai-runtime sends as X-Runtime-Api-Key when POSTing a
    // completed call's log (see app/Http/Middleware/VerifyRuntimeApiKey.php
    // and ai-runtime/src/services/CallLogClient.ts).
    'runtime' => [
        'api_key' => env('BACKEND_API_KEY'),
    ],

    // The reverse direction of the above: this backend calling INTO
    // ai-runtime, for VoiceController::preview() only (CARTESIA_API_KEY
    // lives solely in ai-runtime/.env - see
    // ai-runtime/src/tts/synthesizeVoicePreview.ts). Default is the
    // service name/port docker-compose.yml gives ai-runtime on the
    // shared `voice-ai` network - ai-runtime publishes no host port, so
    // this only resolves from inside another container on that network.
    'ai_runtime' => [
        'base_url' => env('AI_RUNTIME_URL', 'http://ai-runtime:3001'),
    ],

    // AnswerPoint (the client's existing CodeIgniter-based platform human
    // support agents already use) - "Create Message" API. Each business's
    // own numeric clientId lives on businesses.answerpoint_client_id
    // instead of here (see app/Services/AnswerPoint/AnswerPointClient.php)
    // - this block only holds the account-wide bits (endpoint + auth).
    // No auth token/header needed - confirmed 2026-09-16 against
    // AnswerPoint's own Flutter app source, which authenticates every
    // request purely by the clientId/client_id it sends, never a bearer
    // token (see AnswerPointClient's own comment for the full finding).
    // 'enabled' gates the whole integration off by default until every
    // relevant business's clientId is filled in - see
    // PushCallLogToAnswerPoint::shouldPush(). Flip ANSWERPOINT_ENABLED=true
    // in .env once that's done.
    'answerpoint' => [
        'enabled' => env('ANSWERPOINT_ENABLED', false),
        'base_url' => env('ANSWERPOINT_BASE_URL', 'https://api.answerpoint.co.uk/main/createMessage'),
        // Unused for now (see note above) - kept in case AnswerPoint adds
        // real auth later.
        'api_key' => env('ANSWERPOINT_API_KEY'),
        // "List all clients" endpoint (id/name/phone numbers/status) -
        // requested from AnswerPoint's team 2026-09-17, not yet received.
        // No default URL on purpose: AnswerPointClient::fetchClients()
        // throws a clear error rather than silently no-op-ing if this is
        // still blank when someone clicks "Sync now".
        'clients_url' => env('ANSWERPOINT_CLIENTS_URL'),
    ],

];
