<?php

// Needed explicitly (Laravel's unpublished default is allowed_origins=['*'],
// which the browser rejects for credentialed requests) - the admin
// dashboard (Vue dev server on FRONTEND_PORT, see docker-compose.yml) needs
// cookies sent cross-origin for Sanctum's SPA session auth.
return [

    'paths' => ['api/*', 'sanctum/csrf-cookie'],

    'allowed_methods' => ['*'],

    'allowed_origins' => explode(',', env('FRONTEND_URLS', 'http://localhost:3041')),

    'allowed_origins_patterns' => [],

    'allowed_headers' => ['*'],

    'exposed_headers' => [],

    'max_age' => 0,

    'supports_credentials' => true,

];
